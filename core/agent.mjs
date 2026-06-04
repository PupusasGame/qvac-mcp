import { completion }         from "@qvac/sdk";
import { getModelId }         from "./model.mjs";
import { callTool, getTools } from "./mcp.mjs";
import { appendLog }          from "./logger.mjs";
import { config }             from "../config/config.mjs";

let _history = [];

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
// Sin handler, el SDK no las ejecuta por su cuenta: emite los toolCall
// y nosotros los ejecutamos manualmente en el loop. Esto evita la
// doble ejecución (SDK + loop) que corrompía el estado de la escena.
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
  // Evita que _history crezca sin control entre instrucciones y
  // desborde el contexto del modelo. El system prompt se reconstruye
  // abajo con el estado de escena fresco, así que no perdemos contexto.
  _history = [];

  const context = await _captureContext();

  const systemPrompt = `/no_think
You are a Godot 4.6 editor agent. Call tools immediately. No explanations.
When the task is done, reply with one short confirmation sentence and STOP — do not call more tools.

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

        // Resultado como mensaje `tool` simple (formato oficial QVAC):
        // sin tool_call_id. Prefijamos el nombre de la tool para que el
        // modelo sepa de qué llamada vino el resultado.
        const resultText = typeof result === "string"
          ? result
          : JSON.stringify(result);
        _history.push({
          role:    "tool",
          content: `${tc.name} result: ${resultText}`,
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
