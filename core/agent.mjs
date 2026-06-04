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
  const nodos = (hierarchy?.nodes ?? [])
    .map(n => `  ${n.path} (${n.type})`).join("\n");
  return {
    text:     `Scene: ${state?.current_scene ?? "unknown"}\nNodes:\n${nodos}`,
    rootName: hierarchy?.nodes?.[0]?.name ?? "Node",
  };
}

function _buildPrompt(instruction, context) {
  return `You are a Godot 4 editor agent. Return ONLY a JSON array of steps. No text, no markdown, no explanation.

TOOL FORMATS — use exactly these formats:

node_manage duplicate:
{"tool":"node_manage","args":{"op":"duplicate","params":{"path":"/Node3D/Ball"}}}

node_manage rename:
{"tool":"node_manage","args":{"op":"rename","params":{"path":"/Node3D/Ball2","new_name":"PlayerBall"}}}

node_manage delete:
{"tool":"node_manage","args":{"op":"delete","params":{"path":"/Node3D/Ball2"}}}

node_manage move:
{"tool":"node_manage","args":{"op":"move","params":{"path":"/Node3D/Ball","new_parent":"/Node3D/Container"}}}

node_create:
{"tool":"node_create","args":{"type":"Label","name":"MyLabel","parent_path":"/Node3D"}}

node_set_property:
{"tool":"node_set_property","args":{"path":"/Node3D/MyLabel","property":"text","value":"Hello"}}

scene_save:
{"tool":"scene_save","args":{}}

scene_get_hierarchy (use after create/duplicate to verify):
{"tool":"scene_get_hierarchy","args":{"depth":3}}

script_create:
{"tool":"script_create","args":{"path":"res://scripts/ball.gd","content":"extends MeshInstance3D\\n\\nfunc _ready():\\n\\tpass"}}

script_attach:
{"tool":"script_attach","args":{"path":"/Node3D/Ball","script_path":"res://scripts/ball.gd"}}

batch_execute (for multiple independent steps):
{"tool":"batch_execute","args":{"commands":[{"command":"create_node","params":{"type":"Label","name":"HUD","parent_path":"/Node3D"}},{"command":"set_property","params":{"path":"/Node3D/HUD","property":"text","value":"Score: 0"}}]}}

RULES:
- Always use exact tool formats above
- Scene root is /${context.rootName}
- Paths start with /
- After duplicate/create always add scene_get_hierarchy to verify
- Return ONLY valid JSON array

CURRENT SCENE:
${context.text}

TASK: ${instruction}

JSON array only:`;
}

function _extraerJSON(texto) {
  // Limpiar el texto — quitar markdown y whitespace extra
  const limpio = texto
    .replace(/```json/g, "").replace(/```/g, "").trim();

  // Intentar array directo
  const arrMatch = limpio.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch {}
  }

  // Intentar objeto solo → envolver en array
  const objMatch = limpio.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return [JSON.parse(objMatch[0])]; } catch {}
  }

  // Extraer todos los objetos JSON individualmente del texto
  // Útil cuando el modelo genera objetos mal separados
  const objetos = [];
  const regex = /\{"tool"[\s\S]*?\}(?=\s*[,\]"]|\s*$)/g;
  let match;
  while ((match = regex.exec(limpio)) !== null) {
    try {
      // Intentar parsear completando el objeto si está incompleto
      const obj = JSON.parse(match[0]);
      if (obj.tool) objetos.push(obj);
    } catch {}
  }
  if (objetos.length) return objetos;

  return null;
}

async function _ejecutar(pasos, onToolCall) {
  const resultados = [];
  for (const paso of pasos) {
    const { tool, args = {} } = paso;
    if (!tool) continue;
    if (onToolCall) onToolCall(tool, args);
    const resultado = await callTool(tool, args);
    const esError   = resultado?.isError || resultado?.error;
    resultados.push({ tool, args, resultado, esError });
    if (esError) return { ok: false, resultados, error: resultado };
  }
  return { ok: true, resultados };
}

export async function runInstruction(instruction, onToken, onToolCall) {
  const start = Date.now();

  const context = await _captureContext();
  if (onToken) onToken("🤔 Planificando...\n");

  const prompt = _buildPrompt(instruction, context);
  const run    = completion({
    modelId:   getModelId(),
    history:   [{ role: "user", content: prompt }],
    stream:    false,
    maxTokens: config.model.maxTokens,
  });

  const rawPlan = (await run.text)?.trim() ?? "";
  if (onToken) onToken(rawPlan + "\n");

  const pasos = _extraerJSON(rawPlan);
  if (!pasos?.length) {
    const msg = "⚠️ El modelo no generó un plan JSON válido.";
    if (onToken) onToken(msg);
    appendLog({ event: "instruction", instruction, error: "no_json", durationMs: Date.now() - start });
    return msg;
  }

  if (onToken) onToken(`\n▶ Ejecutando ${pasos.length} pasos...\n`);

  const ejecucion     = await _ejecutar(pasos, onToolCall);
  const contextFinal  = await _captureContext();

  const respuesta = ejecucion.ok
    ? `✓ Completado.\n${contextFinal.text}`
    : `⚠️ Error: ${JSON.stringify(ejecucion.error)}\n${contextFinal.text}`;

  _history.push({ role: "user",      content: instruction });
  _history.push({ role: "assistant", content: respuesta   });

  appendLog({
    event: "instruction", instruction,
    pasos: pasos.length, ok: ejecucion.ok,
    durationMs: Date.now() - start,
  });

  return respuesta;
}

export function clearHistory() { _history = []; }
export function getHistory()   { return [..._history]; }
