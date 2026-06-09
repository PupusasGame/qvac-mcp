// modes.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Modos por dominio. Conocimiento CONCISO, AFIRMATIVO ("do this when..."), con
// contratos de herramienta VERIFICADOS empíricamente contra el MCP Godot 4.6
// (hi-godot/godot-ai v2.6.x). Cada ejemplo es un patrón probado que funciona.
// ─────────────────────────────────────────────────────────────────────────────

export const BASE_TOOLS = [
  "session_manage",
  "session_activate",
  "editor_state",
  "scene_get_hierarchy",
  "node_get_properties",
  "editor_screenshot",
  "logs_read",
];

export const MODES = {
  // ── TRANSFORM ──────────────────────────────────────────────────────────────
  transform: {
    label: "Transform",
    description: "Move, rotate, scale, position nodes; create, duplicate, rename, delete nodes.",
    tools: ["node_set_property", "node_create", "node_find", "node_manage", "filesystem_manage", "batch_execute"],
    systemPrompt: `TRANSFORM MODE (Godot 4.6) — verified tool contracts:
- node_set_property uses: path, property, value. Example: path="/Node3D/Ball", property="position", value={"x":0,"y":1,"z":0}.
- Vectors are JSON objects {"x":N,"y":N,"z":N}. A Node3D has position, rotation_degrees, scale.
- node_create uses: type, name, parent_path. parent_path is relative to the scene root ("" means the root itself).
- To make a VISIBLE shape: create a MeshInstance3D, write a mesh .tres file (e.g. BoxMesh) with filesystem_manage, then set the node's "mesh" property to that file path. Assigning an inline {"type":"BoxMesh"} object is unreliable — use the .tres file path.
- For several known steps at once, use batch_execute (see its doc).`,
    docs: [
      `TRANSFORM: Move a node to a position.
node_set_property path="/Node3D/Ball", property="position", value={"x":3,"y":0,"z":0}.
For a relative move, read the current position with node_get_properties first, then write the new value.`,

      `TRANSFORM: Rotate a node.
node_set_property path="/Node3D/Ball", property="rotation_degrees", value={"x":0,"y":45,"z":0}.
All three axes are required in the object. Y is the vertical-axis spin.`,

      `TRANSFORM: Scale a node.
node_set_property path="/Node3D/Ball", property="scale", value={"x":2,"y":2,"z":2}.`,

      `TRANSFORM: Create a visible cube / sphere / plane / cylinder (verified 3-step flow).
The reliable way is to create the mesh as a .tres resource file, then assign that file.
Step 1: node_create type="MeshInstance3D", name="Cube", parent_path="".
Step 2: filesystem_manage op="write_text", params={"path":"res://meshes/cube.tres","content":"[gd_resource type=\\"BoxMesh\\" format=3]\\n[resource]"}.
Step 3: node_set_property path="/Node3D/Cube", property="mesh", value="res://meshes/cube.tres".
Mesh resource types for step 2: BoxMesh (cube), SphereMesh, PlaneMesh (flat), CylinderMesh, CapsuleMesh, PrismMesh, TorusMesh. For a sized plane use content "[gd_resource type=\\"PlaneMesh\\" format=3]\\n[resource]\\nsize = Vector2(2, 2)".
The node type is always MeshInstance3D; the shape comes from the mesh resource file.`,

      `TRANSFORM: Duplicate a node and place the copy.
Step 1: node_manage op="duplicate", params={"path":"/Node3D/Cube"}.
Step 2: read the new node's path with scene_get_hierarchy (it is usually "<name>Copy").
Step 3: node_set_property on the copy to move it, e.g. property="position", value={"x":0,"y":1,"z":0}.`,

      `TRANSFORM: Do several known steps atomically with batch_execute.
batch_execute params={"commands":[
  {"command":"create_node","params":{"type":"MeshInstance3D","name":"Cube","parent_path":""}},
  {"command":"set_property","params":{"path":"/Node3D/Cube","property":"mesh","value":{"type":"BoxMesh"}}}
]}.
Inside commands use the PLUGIN names: "create_node" and "set_property" (not node_create / node_set_property). The whole batch rolls back if any step fails.`,
    ],
  },

  // ── MATERIAL ───────────────────────────────────────────────────────────────
  material: {
    label: "Material",
    description: "Set colors, materials, and the visual look of meshes.",
    tools: ["material_manage", "node_set_property", "filesystem_manage"],
    systemPrompt: `MATERIAL MODE (Godot 4.6) — verified tool contracts:
- To color a mesh, use material_manage op="apply_to_node". The material values go in a params object INSIDE params. Shape: params={"node_path":"/Node3D/Floor","params":{"albedo_color":{"r":1,"g":0,"b":0,"a":1}}}.
- Color channels are 0.0 to 1.0 (not 0-255). Alpha < 1 makes it semi-transparent.
- To put an existing material file on a node, use node_set_property path="...", property="material_override", value="res://materials/your.tres".
- A shader lives in a .gdshader text file made with filesystem_manage op="write_text". See the shader doc.`,
    docs: [
      `MATERIAL: Color a mesh (fastest, verified).
material_manage op="apply_to_node", params={"node_path":"/Node3D/Floor","params":{"albedo_color":{"r":0,"g":1,"b":1,"a":1}}}.
The inner params holds the material properties: albedo_color, metallic, roughness, emission. Cyan is {"r":0,"g":1,"b":1,"a":1}; adapt to the color asked.`,

      `MATERIAL: Make a mesh semi-transparent.
material_manage op="apply_to_node", params={"node_path":"/Node3D/Glass","params":{"albedo_color":{"r":0.7,"g":0.7,"b":0.9,"a":0.4}}}.
Alpha (a) below 1 creates the transparency; no separate transparency flag is needed.`,

      `MATERIAL: Make a mesh metallic / shiny.
material_manage op="apply_to_node", params={"node_path":"/Node3D/Ball","params":{"metallic":1.0,"roughness":0.15}}.
High metallic + low roughness reads as polished metal.`,

      `MATERIAL: Create and apply a SHADER (verified flow).
Step 1 — write the shader file: filesystem_manage op="write_text", params={"path":"res://shaders/holo.gdshader","content":"shader_type spatial;\\nvoid fragment() {\\n\\tALBEDO = vec3(0.0, 1.0, 1.0);\\n\\tALPHA = 0.6;\\n}"}.
Step 2 — write a ShaderMaterial .tres pointing to it: filesystem_manage op="write_text", params={"path":"res://materials/holo.tres","content":"[gd_resource type=\\"ShaderMaterial\\" load_steps=2 format=3]\\n[ext_resource type=\\"Shader\\" path=\\"res://shaders/holo.gdshader\\" id=\\"1\\"]\\n[resource]\\nshader = ExtResource(\\"1\\")"}.
Step 3 — assign it: node_set_property path="/Node3D/Card", property="material_override", value="res://materials/holo.tres".
A 3D shader file must start with "shader_type spatial;". Adapt the ALBEDO/ALPHA to the look asked.`,
    ],
  },

  // ── ANIMATION ──────────────────────────────────────────────────────────────
  animation: {
    label: "Animation",
    description: "Create animation clips and presets (pulse, fade, shake), play them.",
    tools: ["animation_create", "animation_manage", "node_create"],
    systemPrompt: `ANIMATION MODE (Godot 4.6) — verified tool contracts:
- Make the player once: animation_manage op="player_create", params={"parent_path":"/Node3D","name":"AnimationPlayer"}.
- Presets are the easy path. preset_pulse uses: player_path, target_path (absolute, e.g. "/Node3D/Ball"), to_scale, duration, animation_name.
- Play with op="play", params={"player_path":"...","animation_name":"..."}.
- The target of a preset is "target_path" and it is an absolute scene path.`,
    docs: [
      `ANIMATION: Create the AnimationPlayer (do this first).
animation_manage op="player_create", params={"parent_path":"/Node3D","name":"AnimationPlayer"}.`,

      `ANIMATION: Make a node pulse (scale heartbeat).
animation_manage op="preset_pulse", params={"player_path":"/Node3D/AnimationPlayer","target_path":"/Node3D/Ball","to_scale":1.2,"duration":2.0,"animation_name":"pulse"}.
target_path is the node that pulses, as an absolute path. to_scale is the peak size.`,

      `ANIMATION: Fade a node in/out.
animation_manage op="preset_fade", params={"player_path":"/Node3D/AnimationPlayer","target_path":"/Node3D/Ball","duration":1.0,"animation_name":"fade"}.`,

      `ANIMATION: Play an animation.
animation_manage op="play", params={"player_path":"/Node3D/AnimationPlayer","animation_name":"pulse"}.
Use op="set_autoplay" instead to make it run on scene start.`,
    ],
  },

  // ── UI ─────────────────────────────────────────────────────────────────────
  ui: {
    label: "UI",
    description: "Create and configure UI: labels, buttons, containers, signals.",
    tools: ["ui_manage", "theme_manage", "node_create", "node_set_property", "node_manage", "signal_manage"],
    systemPrompt: `UI MODE (Godot 4.6) — verified tool contracts:
- UI nodes are Control nodes: Label, Button, Panel, VBoxContainer, HBoxContainer.
- Create them with node_create type="Label" (etc.), parent_path pointing at a CanvasLayer or Control parent.
- KEY: after node_create, the node's path is parent_path + "/" + name. If you created it under "/Node3D/Cube2" with name "Hello", its path is "/Node3D/Cube2/Hello" — use that full path in node_set_property.
- Set text/size with node_set_property using path + property (e.g. property="text", value="Score: 0").
- Position with ui_manage op="set_anchor_preset". Valid presets: top_left, top_right, center_top, center, center_bottom, bottom_left, bottom_right, full_rect, center_left, center_right (there is no plain "top" — use center_top).`,
    docs: [
      `UI: Add a label and set its text.
Step 1: node_create type="Label", name="ScoreLabel", parent_path="/Node3D".
Step 2: the new path is "/Node3D/ScoreLabel". node_set_property path="/Node3D/ScoreLabel", property="text", value="Score: 0".
If you parented it under another node, include that node in the path (parent_path + "/" + name).`,

      `UI: Add a button.
node_create type="Button", name="PlayButton", parent_path="/Node3D".
node_set_property path="/Node3D/PlayButton", property="text", value="Play".`,

      `UI: Connect a button press to a method.
signal_manage op="connect", params={"source_path":"/Node3D/PlayButton","signal":"pressed","target_path":"/Node3D","method":"_on_play_pressed"}.`,
    ],
  },

  // ── SCRIPT ─────────────────────────────────────────────────────────────────
  script: {
    label: "Script",
    description: "Write and attach GDScript, manage signals and autoloads.",
    tools: ["script_create", "script_patch", "script_attach", "script_manage", "signal_manage", "autoload_manage"],
    systemPrompt: `SCRIPT MODE (Godot 4.6) — verified tool contracts:
- script_create writes a .gd file: params with path (res://scripts/x.gd) and content.
- script_attach puts a script on a node: params with node_path and script_path.
- Inside GDScript, vectors are written as Vector3(x,y,z) (GDScript code, different from tool values which are JSON).`,
    docs: [
      `SCRIPT: Create and attach a script that spins a node.
Step 1: script_create params={"path":"res://scripts/spin.gd","content":"extends Node3D\\n\\n@export var speed: float = 90.0\\n\\nfunc _process(delta: float) -> void:\\n\\trotation_degrees.y += speed * delta"}.
Step 2: script_attach params={"node_path":"/Node3D/Ball","script_path":"res://scripts/spin.gd"}.
@export makes "speed" editable in the Inspector.`,

      `SCRIPT: Connect a signal via tool.
signal_manage op="connect", params={"source_path":"/Node3D/Btn","signal":"pressed","target_path":"/Node3D","method":"_on_btn"}.`,
    ],
  },

  // ── SCENE ──────────────────────────────────────────────────────────────────
  scene: {
    label: "Scene",
    description: "Open/save scenes, run the project, write files.",
    tools: ["scene_open", "scene_save", "scene_manage", "project_run", "project_manage", "camera_manage", "audio_manage", "filesystem_manage", "node_create", "node_set_property"],
    systemPrompt: `SCENE MODE (Godot 4.6) — verified tool contracts:
- Save the scene after edits: scene_save (no params needed for the current scene).
- Write any text file: filesystem_manage op="write_text", params={"path":"res://...","content":"..."}.
- Run the project with project_run.`,
    docs: [
      `SCENE: Save the current scene.
scene_save. Call it after making changes you want to persist.`,

      `SCENE: Write a text/data file.
filesystem_manage op="write_text", params={"path":"res://data/config.json","content":"{}"}.`,
    ],
  },
};

export const ACTIVE_MODES = ["transform", "material", "animation", "ui", "script", "scene"];
export const DEFAULT_MODE  = "transform";

export function toolsForMode(modeName) {
  const mode = MODES[modeName];
  if (!mode) return BASE_TOOLS.slice();
  return [...new Set([...BASE_TOOLS, ...(mode.tools ?? [])])];
}

export function systemPromptForMode(modeName) {
  return MODES[modeName]?.systemPrompt ?? "";
}

export function docsForMode(modeName) {
  return MODES[modeName]?.docs ?? [];
}

export function allModeDocs() {
  const out = [];
  for (const [name, mode] of Object.entries(MODES)) {
    for (const d of (mode.docs ?? [])) {
      out.push(`[MODE:${name}] ${d}`);
    }
  }
  return out;
}

export function isValidMode(modeName) {
  return ACTIVE_MODES.includes(modeName);
}
