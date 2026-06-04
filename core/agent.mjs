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

function _buildTools(tools) {
  const filtered = tools.filter(t => CORE_TOOLS.includes(t.name));
  return filtered.map(t => ({
    name:        t.name,
    description: (t.description ?? t.name).slice(0, 150),
    parameters:  t.inputSchema ?? {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    handler: async (args) => {
      const result = await callTool(t.name, args);
      return JSON.stringify(result);
    },
  }));
}

export async function runInstruction(instruction, onToken, onToolCall) {
  const modelId = getModelId();
  const tools   = getTools();
  const start   = Date.now();

  const context = await _captureContext();

  const systemPrompt = `You are a Godot 4 editor agent. Call tools immediately. No explanations.

SCENE:
${context.text}

KEY RULES:
- node_manage needs op + params: {"op":"duplicate","params":{"path":"/Node3D/Ball"}}
- node_manage ops: duplicate, rename, delete, move(index), reparent(new_parent)
- - To change color of any MeshInstance3D node:
  1. material_manage op="create" params={"path":"res://materials/<name>.tres","type":"standard","overwrite":true}
  2. material_manage op="set_param" params={"path":"res://materials/<name>.tres","param":"albedo_color","value":{"r":1,"g":0,"b":0,"a":1}}
  3. material_manage op="assign" params={"node_path":"/<root>/<NodeName>","resource_path":"res://materials/<name>.tres"}
  4. scene_save
- NEVER use node_set_property for colors — always use material_manage
- Paths start with / relative to /${context.rootName}
- Reply briefly in Spanish when done`;

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

    // Usar toolCalls del final O los capturados en eventos
    const calls = final?.toolCalls?.length ? final.toolCalls : toolsCalled;

    if (calls.length) {
      _history.push({
        role:       "assistant",
        content:    textBuffer || null,
        tool_calls: calls.map(tc => ({
          id:       tc.id,
          type:     "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        })),
      });

      for (const tc of calls) {
        // Si el handler ya lo ejecutó usa invoke(), si no ejecuta manualmente
        const result = tc.invoke
          ? await tc.invoke()
          : await callTool(tc.name, tc.arguments ?? {});

        appendLog({ event: "tool_call", tool: tc.name, args: tc.arguments, result });

        _history.push({
          role:         "tool",
          tool_call_id: tc.id,
          content:      typeof result === "string" ? result : JSON.stringify(result),
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
