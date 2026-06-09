import { completion }         from "@qvac/sdk";
import { getModelId }         from "./model.mjs";
import { callTool, getTools } from "./mcp.mjs";
import { appendLog }          from "./logger.mjs";
import { searchDocs, getLastSearch } from "./rag.mjs";
import { toolsForMode, DEFAULT_MODE, isValidMode, MODES, systemPromptForMode } from "./modes.mjs";
import { config }             from "../config/config.mjs";

let _history = [];

// Bandera de cancelación. El REPL la activa con requestCancel() al recibir
// Ctrl+C. El loop de runInstruction la revisa entre iteraciones: termina la
// iteración actual y NO empieza la siguiente, volviendo limpio al prompt.
let _cancelRequested = false;
export function requestCancel() { _cancelRequested = true; }

// Traduce el resultado crudo de una tool a una señal clara y legible
// para el modelo. Sin esto, el modelo recibe JSON crudo, no reconoce el
// éxito, y tiende a repetir la llamada o a hacer eco del texto.
// Devuelve algo como "SUCCESS: ..." o "ERROR: ...".
function _summarizeResult(toolName, args, result) {
  // Detectar error: callTool devuelve {error, isError:true} o un string con el mensaje
  const isError =
    (result && typeof result === "object" && result.isError) ||
    (typeof result === "string" && /error|wrong_type|cannot|failed/i.test(result));

  if (isError) {
    // Pasamos el mensaje de error de Godot ÍNTEGRO. Godot suele incluir
    // pistas muy útiles ("Did you mean: material_override...", "path must end
    // with .tres", "expected keys x,y,z") que el modelo necesita para
    // corregir. NO lo truncamos ni lo reformulamos: el texto de Godot ya es
    // la mejor guía disponible.
    const errObj = (result && typeof result === "object") ? result.error : null;
    const msg = typeof result === "string"
      ? result
      : (result.error ?? JSON.stringify(result));

    // El server de Godot AI devuelve errores ESTRUCTURADOS que a veces incluyen
    // data.suggestions (fuzzy match de la op/parámetro correcto). Si está, lo
    // resaltamos: es la corrección que el propio server propone.
    let suggestionLine = "";
    const sugg = errObj && typeof errObj === "object"
      ? (errObj.data?.suggestions ?? errObj.suggestions)
      : null;
    if (Array.isArray(sugg) && sugg.length) {
      suggestionLine = `\n👉 The server SUGGESTS: ${sugg.join(", ")}. Use one of these.`;
    } else if (typeof msg === "string") {
      // Pista textual común: "Did you mean: x, y, z?"
      const m = msg.match(/did you mean:?\s*([^?.]+)/i);
      if (m) suggestionLine = `\n👉 The server hints: ${m[1].trim()}. Use one of these.`;
    }

    return `ERROR from ${toolName}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}${suggestionLine}\nRead the error carefully — it often names the correct property or required format. If the same call keeps failing, try a DIFFERENT operation or parameter of this tool rather than repeating the same one.`;
  }

  // Éxito: resumen compacto y claro. Para set_property mostramos qué quedó.
  if (toolName === "node_set_property" && result && typeof result === "object") {
    const val = JSON.stringify(result.value ?? args?.value);
    return `SUCCESS: ${toolName} set ${args?.property} on ${args?.path} to ${val}. The change is applied. Do NOT call this tool again for the same change.`;
  }

  const compact = typeof result === "string" ? result : JSON.stringify(result);
  return `SUCCESS: ${toolName} completed. Result: ${compact.slice(0, 300)}`;
}

// Modo "thinking" de Qwen3. Por defecto APAGADO (más rápido): anteponemos
// /no_think al system prompt. El REPL puede alternarlo con setThinkMode().
let _thinkMode = false;
export function setThinkMode(on) { _thinkMode = !!on; }
export function getThinkMode()   { return _thinkMode; }

// ── Rescate de tool calls emitidos como TEXTO ────────────────────────────────
// Qwen3 sobre llama.cpp a veces emite el tool call como texto plano
// (<tool_call>{"name":...,"arguments":...}</tool_call> o un bloque JSON) en vez
// de como toolCall estructurado que el SDK parsea. Cuando eso pasa, el SDK lo
// entrega en el contentText y el agente lo perdería. Esta función recupera esos
// tool calls del texto para poder ejecutarlos igual. No es un parche cosmético:
// es parsear el formato real que el modelo produce, que es un comportamiento
// conocido y documentado de esta familia de modelos.
function _rescueToolCallsFromText(text) {
  if (!text || typeof text !== "string") return [];
  const calls = [];

  // Estrategia robusta: buscar cada marcador de inicio de tool call y, desde la
  // primera "{", extraer el objeto JSON COMPLETO contando llaves balanceadas.
  // Una regex no sirve para JSON anidado (no cuenta llaves), así que lo hacemos
  // manualmente — es la forma fiable de capturar objetos con params anidados.
  const markers = [];
  // Marcador 1: <tool_call> (formato Hermes que a veces se filtra como texto)
  let idx = text.indexOf("<tool_call>");
  while (idx !== -1) { markers.push(idx + "<tool_call>".length); idx = text.indexOf("<tool_call>", idx + 1); }
  // Marcador 2: si no hubo tags, intentar desde un bloque ```json o la primera {
  if (markers.length === 0) {
    const fence = text.indexOf("```json");
    if (fence !== -1) markers.push(fence + "```json".length);
    else if (text.trim().startsWith("{")) markers.push(text.indexOf("{"));
  }

  for (const startAfter of markers) {
    const obj = _extractBalancedJson(text, startAfter);
    if (obj) {
      const parsed = _tryParseCall(obj);
      if (parsed) calls.push(parsed);
    }
  }
  return calls;
}

// Desde la posición dada, encuentra la primera "{" y devuelve el substring del
// objeto JSON completo, contando llaves balanceadas (ignorando llaves dentro
// de strings). Devuelve null si no encuentra un objeto balanceado.
function _extractBalancedJson(text, from) {
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Intenta convertir un string JSON en {name, arguments}. Acepta tanto
// {"name":"x","arguments":{...}} como {"name":"x","parameters":{...}}.
function _tryParseCall(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    if (obj && typeof obj.name === "string") {
      const args = obj.arguments ?? obj.parameters ?? obj.args ?? {};
      return { name: obj.name, arguments: typeof args === "string" ? JSON.parse(args) : args };
    }
  } catch { /* no era JSON válido */ }
  return null;
}

// Modo debug: cuando está activo, el agente emite un resumen compacto de las
// capas usadas (modo, docs RAG con scores, tool elegida) vía el callback onDebug.
let _debug = false;
export function setDebug(on) { _debug = !!on; }
export function getDebug()   { return _debug; }

async function _captureContext() {
  const [state, hierarchy] = await Promise.all([
    callTool("editor_state", {}),
    callTool("scene_get_hierarchy", { depth: 3, limit: 40 }),
  ]);
  const nodes    = hierarchy?.nodes ?? [];
  const nodos    = nodes.map(n => `  ${n.path} (${n.type})`).join("\n");
  const rootName = nodes[0]?.name ?? "Node";
  return {
    text: `Scene: ${state?.current_scene ?? "unknown"}\nNodes:\n${nodos}`,
    rootName,
  };
}

// Solo las tools esenciales para no saturar el contexto del modelo pequeño
// Modo activo. Determina qué tools se exponen al modelo y a qué dominio se
// enfoca la búsqueda RAG. El REPL lo cambia con setMode().
let _mode = DEFAULT_MODE;
export function setMode(modeName) {
  if (isValidMode(modeName)) { _mode = modeName; return true; }
  return false;
}
export function getMode() { return _mode; }

// Declaramos las tools SOLO con su esquema (sin handler).
// Sin handler, el SDK no las ejecuta por su cuenta: emite los toolCall
// y nosotros los ejecutamos manualmente en el loop. Esto evita la
// doble ejecución (SDK + loop) que corrompía el estado de la escena.
// El filtro de tools ahora depende del MODO activo, no de una lista fija.
function _buildTools(tools) {
  const allowed  = toolsForMode(_mode);
  const filtered = tools.filter(t => allowed.includes(t.name));
  return filtered.map(t => ({
    name:        t.name,
    description: (t.description ?? t.name).slice(0, 600),
    parameters:  t.inputSchema ?? {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  }));
}

export async function runInstruction(instruction, onToken, onToolCall, onDebug) {
  const modelId = getModelId();
  const tools   = getTools();
  const start   = Date.now();

  // Reset por instrucción: cada tarea arranca con history limpio.
  // Evita que _history crezca sin control entre instrucciones y
  // desborde el contexto del modelo. El system prompt se reconstruye
  // abajo con el estado de escena fresco, así que no perdemos contexto.
  _history = [];
  _cancelRequested = false;   // limpiar cualquier cancelación previa

  const context = await _captureContext();

  // ── BLOQUE 3 (REFERENCIA / RAG) ──────────────────────────────────────────
  // Recuperar material de referencia relevante a la instrucción. Se ENMARCA
  // explícitamente como referencia consultiva, NO como órdenes: el modelo debe
  // razonar con esto y consultarlo a criterio, no copiar valores literales.
  let docsBlock = "";
  let ragDocs   = [];   // guardamos los docs recuperados para el log de inferencia
  try {
    const allowedTools = toolsForMode(_mode);
    const docs = await searchDocs(instruction, allowedTools);
    ragDocs = docs;
    if (docs.length) {
      docsBlock =
`\n═══ REFERENCE MATERIAL ═══
This section has TWO kinds of content — treat them very differently:
1. HARD FACTS about Godot and the tools (which tool creates what, which property lives on
   which class, required path formats). Lines starting with "FACT:" are NON-NEGOTIABLE —
   they describe how the engine actually works. If a FACT contradicts your instinct, the
   FACT is correct and your instinct is wrong. Ignoring a FACT produces guaranteed errors.
2. EXAMPLE VALUES (colors, positions, names, numbers). These ARE adaptable — fit them to
   the user's actual request; never copy example numbers literally.

${docs.map(d => `• ${d}`).join("\n\n")}
`;
    }
  } catch { /* RAG es best-effort; no romper el agente si falla */ }

  // ── BLOQUE 2 (MODO ACTIVO) ───────────────────────────────────────────────
  const modeInfo = MODES[_mode];
  const modeKnowledge = systemPromptForMode(_mode);
  const modeBlock = modeInfo
    ? `\n═══ ACTIVE MODE: ${modeInfo.label} ═══
${modeInfo.description}
Only the tools for this mode are available. Stay within this task domain.
${modeKnowledge ? "\n" + modeKnowledge + "\n" : ""}`
    : "";

  // ── BLOQUE 4 (ESCENA) ────────────────────────────────────────────────────
  const sceneBlock = `\n═══ CURRENT SCENE ═══\n${context.text}`;

  const thinkDirective = _thinkMode ? "" : "/no_think\n";

  // ── BLOQUE 1 (IDENTIDAD + REGLAS) + ensamblaje en orden ──────────────────
  const systemPrompt = `${thinkDirective}═══ WHO YOU ARE ═══
You are a Godot 4.6 editor agent. You operate the LIVE editor by calling tools.
Read the current state when you need it, then act. Use tools to do the work — don't just describe it.

═══ HOW TO ACT ═══
- After each tool call you get SUCCESS or ERROR.
  • SUCCESS: the change is applied. When everything asked is done, reply with ONE short confirmation and stop.
  • ERROR: it usually names the correct key or format. Adjust and try a DIFFERENT call — never repeat the same failing call.
- For an ABSOLUTE value ("set Y to 45"), write it directly. For a RELATIVE change ("add 15", "a bit bigger"), read the current value first, compute the new one, then write it.
- After you create a node, its path is parent_path + "/" + name. Use that exact path in the next call (e.g. created under "/Node3D" with name "Ball" → path is "/Node3D/Ball").
- Summarize results in your own words; don't echo raw tool output.

═══ TOOL CALL FORMAT (two shapes) ═══
- Tools ending in "_manage" take exactly { "op": "...", "params": { ...everything... } }.
  Example: { "op":"apply_to_node", "params":{ "node_path":"/Node3D/Ball", "params":{ "albedo_color":{"r":1,"g":0,"b":0,"a":1} } } }
- Other tools take their arguments directly:
  • node_set_property: { "path":"...", "property":"...", "value":... }
  • node_create: { "type":"...", "name":"...", "parent_path":"..." }
- Vectors are objects {"x":N,"y":N,"z":N}; colors are {"r":N,"g":N,"b":N,"a":N} (0..1). The reference material below gives the exact verified shape for each task — follow it.
${modeBlock}${docsBlock}${sceneBlock} `;

  _history.push({ role: "user", content: instruction });

  const completionTools = _buildTools(tools);
  let finalResponse = "";
  let iterations    = 0;
  const maxIter     = 8;
  const _recentCalls = [];   // firmas de llamadas recientes, para detectar repeticiones

  // Panel de debug: resumen compacto de las capas usadas para esta instrucción.
  // Solo se emite si el modo debug está activo. main.mjs lo pinta con color.
  if (_debug && onDebug) {
    const rag = getLastSearch();
    onDebug({
      mode:       _mode,
      think:      _thinkMode ? "on" : "off",
      toolCount:  completionTools.length,
      ragHits:    rag.length,
      ragTop:     rag.slice(0, 3).map(r => ({
        score: typeof r.score === "number" ? r.score.toFixed(2) : "?",
        name:  (r.preview || "").replace(/^\[MODE:\w+\]\s*/, "").split("\n")[0].replace(/^TOOL:\s*/, "").slice(0, 42),
      })),
    });
  }

  while (iterations < maxIter) {
    // Si el usuario pidió cancelar (Ctrl+C), no empezamos otra iteración.
    if (_cancelRequested) {
      finalResponse = "⚠ Operación cancelada por el usuario.";
      break;
    }
    iterations++;

    const run = completion({
      modelId,
      history: [
        { role: "system", content: systemPrompt },
        ..._history,
      ],
      tools:           completionTools,
      stream:          true,
      maxTokens:       config.model.maxTokens,
      captureThinking: true,
    });

    let textBuffer  = "";
    let toolsCalled = [];

    for await (const event of run.events) {
      switch (event.type) {
        case "contentDelta":
          textBuffer += event.text;
          if (onToken) onToken(event.text);
          break;
        case "thinkingDelta":
          if (onToken) onToken(`\x1b[2m${event.text}\x1b[0m`);
          break;
        case "toolCall":
          toolsCalled.push(event.call);
          if (onToolCall) onToolCall(event.call.name, event.call.arguments);
          break;
        case "toolError":
          if (onToken) onToken(`\n⚠️ ${event.error.message}\n`);
          break;
      }
    }

    const final = await run.final;

    // ── Métricas de inferencia (requisito de la hackathon: prompt, tokens, TTFT, tok/s)
    // Los nombres de campo varían entre versiones del SDK, así que leemos
    // defensivamente con varios alias y dejamos el objeto stats crudo por si acaso.
    const s = final?.stats ?? {};

    // En la PRIMERA iteración guardamos el desglose COMPLETO de lo que el modelo
    // recibió, capa por capa: así se puede ver exactamente qué leyó primero,
    // con qué referencia trabajó (RAG), y cómo llegó a su decisión. En las
    // iteraciones siguientes el system prompt se repite, así que solo guardamos
    // la instrucción para no inflar el log.
    const promptDetail = iterations === 1
      ? {
          user_instruction: instruction,
          mode:             _mode,
          think:            _thinkMode ? "on" : "off",
          layers: {
            // Capa 1: identidad + reglas (system prompt base, sin los otros bloques)
            base_rules:   systemPrompt
                            .replace(modeBlock, "")
                            .replace(docsBlock, "")
                            .replace(sceneBlock, "")
                            .trim(),
            // Capa 2: modo activo + conocimiento curado
            active_mode:  modeBlock.trim(),
            // Capa 3: referencia recuperada (RAG) — los fragmentos crudos
            rag_reference: ragDocs,
            // Capa 4: escena actual
            scene:        context.text,
          },
          full_system_prompt: systemPrompt,   // el ensamblado exacto enviado
        }
      : { user_instruction: instruction, mode: _mode, note: "system prompt repeated from iteration 1" };

    appendLog({
      event:           "inference",
      iteration:       iterations,
      prompt:          promptDetail,
      // La DECISIÓN del modelo en esta iteración: qué generó y qué tools eligió.
      model_output:    textBuffer.trim().slice(0, 500),
      tools_chosen:    (final?.toolCalls?.length ? final.toolCalls : toolsCalled)
                         .map(tc => ({ name: tc.name, arguments: tc.arguments })),
      tool_calls_rescued_from_text:
                       (!(final?.toolCalls?.length || toolsCalled.length) &&
                        _rescueToolCallsFromText(final?.contentText ?? textBuffer).length > 0) || undefined,
      ttftMs:          s.timeToFirstToken ?? s.ttft ?? s.firstTokenMs ?? null,
      tokensPerSecond: s.tokensPerSecond ?? s.tokens_per_second ?? null,
      totalTokens:     s.totalTokens ?? s.total_tokens ?? null,
      totalTimeMs:     s.totalTime ?? s.total_time ?? null,
      backendDevice:   s.backendDevice ?? null,
      rawStats:        s,
    });

    // Tool calls: primero los estructurados del SDK; si no hay, intentamos
    // RESCATAR los que el modelo pudo haber emitido como texto (bug conocido
    // de Qwen3+llama.cpp al razonar). Así no perdemos la intención del modelo.
    let calls = final?.toolCalls?.length ? final.toolCalls : toolsCalled;
    let rescued = false;
    if (!calls.length) {
      const fromText = _rescueToolCallsFromText(final?.contentText ?? textBuffer);
      if (fromText.length) {
        calls = fromText;
        rescued = true;
      }
    }

    if (calls.length) {
      // FORMATO ESTRUCTURADO DE TOOL CALLS (alineado con el protocolo que el
      // modelo espera): el turno del assistant lleva un array `tool_calls` con
      // un id por llamada, y cada resultado va como {role:"tool", tool_call_id}.
      // Esto le enseña al modelo el formato CORRECTO en cada turno, en vez de
      // mostrarle tool calls como texto (que lo inducía a imitar ese error).
      const structuredCalls = calls.map((tc, i) => ({
        id:   tc.id ?? `call_${iterations}_${i}`,
        type: "function",
        function: {
          name:      tc.name,
          arguments: typeof tc.arguments === "string"
            ? tc.arguments
            : JSON.stringify(tc.arguments ?? {}),
        },
      }));

      _history.push({
        role:       "assistant",
        content:    textBuffer?.trim() && !rescued ? textBuffer.trim() : "",
        tool_calls: structuredCalls,
      });

      for (let i = 0; i < calls.length; i++) {
        const tc = calls[i];
        const callId = structuredCalls[i].id;
        const result = await callTool(tc.name, tc.arguments ?? {});

        // Detectar repetición de una llamada que ya falló, para empujar al
        // modelo a cambiar de enfoque en vez de insistir en lo mismo.
        const signature = `${tc.name}:${JSON.stringify(tc.arguments ?? {})}`;
        const isRepeat  = _recentCalls.includes(signature);
        _recentCalls.push(signature);

        let summary = _summarizeResult(tc.name, tc.arguments ?? {}, result);
        if (isRepeat && summary.startsWith("ERROR")) {
          summary += `\n⚠ You already tried this EXACT call and it failed. Do NOT repeat it. Use a different operation, a different parameter, or a different tool.`;
        }

        // Resultado en formato estructurado: ligado a su tool_call_id.
        _history.push({
          role:         "tool",
          tool_call_id: callId,
          content:      summary,
        });
      }
      continue;
    }

    // Sin tool calls (ni estructurados ni rescatables): es una respuesta final.
    finalResponse = (final?.contentText ?? textBuffer).trim();
    _history.push({ role: "assistant", content: finalResponse });
    break;
  }

  if (iterations >= maxIter) {
    finalResponse = "Alcancé el límite de operaciones.";
    _history.push({ role: "assistant", content: finalResponse });
  }

  appendLog({ event: "instruction", instruction, iterations, durationMs: Date.now() - start, response: finalResponse });
  return finalResponse;
}

export function clearHistory() { _history = []; }
export function getHistory()   { return [..._history]; }
