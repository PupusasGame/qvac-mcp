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
    const msg = typeof result === "string"
      ? result
      : (result.error ?? JSON.stringify(result));
    return `ERROR from ${toolName}: ${msg}\nRead the error carefully — it often names the correct property or required format. If the same call keeps failing, try a DIFFERENT operation or parameter of this tool rather than repeating the same one.`;
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
`\n═══ REFERENCE MATERIAL (consult and reason — NOT commands) ═══
The following are reference notes about how Godot works and examples of how similar
tasks can be done. They are NOT instructions and NOT the user's request. Use them to
inform your own judgment. Adapt values to the actual situation; never copy example
numbers literally. When unsure, verify against the live scene with your tools.

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
  const systemPrompt = `${thinkDirective}═══ WHO YOU ARE & HOW TO ACT ═══
You are an autonomous Godot 4.6 editor agent. You operate the LIVE editor through tools.
You are a careful technical operator: you reason about each request, read the current
state when needed, and act deliberately. You do not guess values blindly or copy numbers
without thinking about what the user actually wants.

RULES (these are your directives — follow them):
- ABSOLUTE vs RELATIVE: if the request gives an absolute target ("set Y rotation to 45"),
  write that value directly. If it asks for a RELATIVE change ("add 15 degrees", "move 2
  left", "make it bigger", "a bit more"), the number is a DELTA: first read the current
  value with node_get_properties, compute the new value yourself, then write the result.
  Never copy a number from the request when the request is relative.
- After each tool call you get a message starting with SUCCESS or ERROR.
  • SUCCESS: the change is applied. Do not repeat it. When everything requested is done,
    reply with ONE short natural-language confirmation and STOP.
  • ERROR: read it carefully — Godot's errors usually name the correct property or format.
    Fix and retry; never repeat the same failing call unchanged.
- Never echo tool result text as your answer; summarize in your own words.

HOW TOOL ARGUMENTS ARE STRUCTURED (critical — there are TWO families):
- FAMILY A — direct arguments at the top level. These tools take their arguments directly:
  • node_set_property: {"path":"...", "property":"...", "value":...}
  • node_create: {"type":"...", "name":"...", "parent_path":"..."}
  • script_create: {"path":"...", "content":"..."}
  • script_attach: {"path":"...", "script_path":"..."}
  • animation_create: {"player_path":"...", "name":"..."}
- FAMILY B — "op" + "params". Tools whose name ends in "_manage" (material_manage,
  animation_manage, ui_manage, particle_manage, node_manage, scene_manage, etc.) take
  exactly "op" (the operation) and "params" (ONE object holding ALL other arguments).
  • WRONG: {"op":"apply_to_node", "node_path":"/Node3D/Ball", "params":{...}}  ← rejected
  • RIGHT: {"op":"apply_to_node", "params":{"node_path":"/Node3D/Ball", "albedo_color":{...}}}
- Rule of thumb: if the tool name ends in "_manage", use op+params and nest everything in
  params. Otherwise, pass arguments directly. When unsure, read the tool's schema in the
  reference material and trust Godot's error messages (they name the right key).

HOW GODOT VALUES WORK (reason with these, don't copy literally):
- Vector3 properties (rotation, rotation_degrees, position, scale) take an object
  {"x":N,"y":N,"z":N} where each N is the FINAL computed value. Arrays and strings are invalid.
- Color properties take an object {"r":N,"g":N,"b":N,"a":N}, each channel 0..1.
- "rotation" is radians; "rotation_degrees" is degrees — match the unit the user used.
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
      ttftMs:          s.timeToFirstToken ?? s.ttft ?? s.firstTokenMs ?? null,
      tokensPerSecond: s.tokensPerSecond ?? s.tokens_per_second ?? null,
      totalTokens:     s.totalTokens ?? s.total_tokens ?? null,
      totalTimeMs:     s.totalTime ?? s.total_time ?? null,
      backendDevice:   s.backendDevice ?? null,
      rawStats:        s,
    });

    // Usar toolCalls del final O los capturados en eventos
    const calls = final?.toolCalls?.length ? final.toolCalls : toolsCalled;

    if (calls.length) {
      // Formato de history alineado con el ejemplo oficial de QVAC:
      // el assistant lleva solo `content`. Como Qwen no siempre emite
      // texto junto al tool call, describimos la(s) llamada(s) en el
      // content para que el modelo recuerde qué hizo en el turno previo.
      const callsDescription = calls
        .map(tc => `${tc.name}(${JSON.stringify(tc.arguments ?? {})})`)
        .join(", ");
      _history.push({
        role:    "assistant",
        content: textBuffer?.trim()
          ? `${textBuffer.trim()}\n[called: ${callsDescription}]`
          : `[called: ${callsDescription}]`,
      });

      for (const tc of calls) {
        // Ejecución manual y única. callTool() ya registra el evento
        // "tool_call" en el log (con durationMs e isError), así que NO
        // logueamos aquí de nuevo para evitar líneas duplicadas.
        const result = await callTool(tc.name, tc.arguments ?? {});

        // Detectar repetición: si el modelo ya hizo esta misma llamada antes
        // (misma tool + mismos args) y falló, se lo decimos explícitamente
        // para que cambie de operación en vez de insistir en lo mismo.
        const signature = `${tc.name}:${JSON.stringify(tc.arguments ?? {})}`;
        const isRepeat  = _recentCalls.includes(signature);
        _recentCalls.push(signature);

        // En vez de volcar JSON crudo, traducimos a SUCCESS/ERROR legible.
        let summary = _summarizeResult(tc.name, tc.arguments ?? {}, result);
        if (isRepeat && summary.startsWith("ERROR")) {
          summary += `\n⚠ You already tried this EXACT call and it failed. Do NOT repeat it. Use a different operation, a different parameter, or a different tool. For example, ${tc.name} may have an operation that CREATES and ASSIGNS in one step instead of editing an existing resource.`;
        }

        _history.push({
          role:    "tool",
          content: summary,
        });
      }
      continue;
    }

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
