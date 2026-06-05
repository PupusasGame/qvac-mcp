import { completion }         from "@qvac/sdk";
import { getModelId }         from "./model.mjs";
import { callTool, getTools } from "./mcp.mjs";
import { appendLog }          from "./logger.mjs";
import { config }             from "../config/config.mjs";

let _history = [];


let _cancelRequested = false;
export function requestCancel() { _cancelRequested = true; }


function _summarizeResult(toolName, args, result) {
  // Detectar error: callTool devuelve {error, isError:true} o un string con el mensaje
  const isError =
    (result && typeof result === "object" && result.isError) ||
    (typeof result === "string" && /error|wrong_type|cannot|failed/i.test(result));

  if (isError) {
    const msg = typeof result === "string"
      ? result
      : (result.error ?? JSON.stringify(result));
    return `ERROR from ${toolName}: ${msg}. Fix the arguments and try again, or report the problem.`;
  }

  // Éxito: resumen compacto y claro. Para set_property mostramos qué quedó.
  if (toolName === "node_set_property" && result && typeof result === "object") {
    const val = JSON.stringify(result.value ?? args?.value);
    return `SUCCESS: ${toolName} set ${args?.property} on ${args?.path} to ${val}. The change is applied. Do NOT call this tool again for the same change.`;
  }

  const compact = typeof result === "string" ? result : JSON.stringify(result);
  return `SUCCESS: ${toolName} completed. Result: ${compact.slice(0, 300)}`;
}

// /no_think al system prompt. El REPL puede alternarlo con setThinkMode().
let _thinkMode = false;
export function setThinkMode(on) { _thinkMode = !!on; }
export function getThinkMode()   { return _thinkMode; }

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
const CORE_TOOLS = [
  "editor_state",
  "scene_get_hierarchy",
  "node_get_properties",
  "node_create",
  "node_set_property",
  "node_manage",
  "node_find",
  "scene_save",
  "script_create",
  "script_attach",
  "script_patch",
  "batch_execute",
  "resource_manage",
  "material_manage",
];

// Declaramos las tools SOLO con su esquema (sin handler).

function _buildTools(tools) {
  const filtered = tools.filter(t => CORE_TOOLS.includes(t.name));
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

export async function runInstruction(instruction, onToken, onToolCall) {
  const modelId = getModelId();
  const tools   = getTools();
  const start   = Date.now();

  // Reset por instrucción: cada tarea arranca con history limpio.

  _history = [];
  _cancelRequested = false;   // limpiar cualquier cancelación previa

  const context = await _captureContext();

  const thinkDirective = _thinkMode ? "" : "/no_think\n";
  const systemPrompt = `${thinkDirective}You are a Godot 4.6 editor agent. Call tools immediately. No explanations.
After each tool call you receive a message starting with SUCCESS or ERROR.
- On SUCCESS: the change is already applied. Do NOT call the same tool again. If all requested changes are done, reply with ONE short natural-language confirmation sentence and STOP.
- On ERROR: read the message, fix your arguments, and retry once. Do not repeat the same failing call unchanged.
Never echo the tool result text back as your answer; summarize it in your own words.

VALUE FORMATS (strict):
- Vector3 properties (rotation, rotation_degrees, position, scale) MUST be a JSON object: {"x":0,"y":45,"z":0}. NEVER use an array like [0,45,0] and NEVER wrap it in a string.
- Color properties MUST be an object: {"r":1,"g":0,"b":0,"a":1}.
- Rotation in Godot uses radians for "rotation" and degrees for "rotation_degrees" — pick the property that matches the unit requested.

SCENE:
${context.text} `;

  _history.push({ role: "user", content: instruction });

  const completionTools = _buildTools(tools);
  let finalResponse = "";
  let iterations    = 0;
  const maxIter     = 8;

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

    const s = final?.stats ?? {};
    appendLog({
      event:           "inference",
      iteration:       iterations,
      prompt:          instruction,
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

        const result = await callTool(tc.name, tc.arguments ?? {});

        // En vez de volcar JSON crudo, traducimos a SUCCESS/ERROR legible.

        const summary = _summarizeResult(tc.name, tc.arguments ?? {}, result);
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
