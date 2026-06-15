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
    systemPrompt: `TRANSFORM MODE (Godot 4.6) — how the engine works here:

FACT: A "visible object" in Godot is a MeshInstance3D node that has a MESH RESOURCE in its
"mesh" property. A bare node with no mesh renders NOTHING. So when the user asks to create
any named shape (a cube, a sphere, a plane, a floor, a wall…), creating it means giving it
a mesh — not just making an empty node. Only create an empty node when the user explicitly
asks for an empty/container node.

FACT: The reliable way to give a node a mesh is a mesh resource FILE (.tres), then point the
node's "mesh" property at that file. The mesh resource TYPE inside the file decides the shape
— the node type is always MeshInstance3D; the shape comes from the mesh resource. Assigning
an inline {"type":"BoxMesh"} object is unreliable and may render nothing — use the .tres file.

Blueprint to create any visible shape (generalize the mesh type to the shape asked):
  1. node_create type="MeshInstance3D", name=<NAME>, parent_path="".
  2. filesystem_manage op="write_text", params={"path":"res://meshes/<NAME>.tres",
     "content":"[gd_resource type=\\"<MESH_TYPE>\\" format=3]\\n[resource]"}.
  3. node_set_property path="/Node3D/<NAME>", property="mesh", value="res://meshes/<NAME>.tres".
Pick <MESH_TYPE> from the shape: a box/cube→BoxMesh, a ball/sphere→SphereMesh, a flat
plane/floor→PlaneMesh, and so on. (Example with a box: type="BoxMesh". Apply the same shape
of steps for any other mesh type.)

FACT: Move / rotate / scale use node_set_property with a Vector3 value {"x":N,"y":N,"z":N}:
  • position  — where it sits.   • rotation_degrees — its orientation.   • scale — its size.
  Example: node_set_property path="/Node3D/<NAME>", property="position", value={"x":2,"y":0,"z":0}.
For a relative change ("move it a bit", "add 15") read the current value first, then write the sum.`,
    docs: [
      `TIP — mesh types for different shapes. The mesh resource type inside the .tres decides
the shape: BoxMesh (cube/box), SphereMesh (ball), PlaneMesh (flat floor/wall), CylinderMesh,
CapsuleMesh, PrismMesh, TorusMesh. Some accept a size: a sized plane uses content
"[gd_resource type=\\"PlaneMesh\\" format=3]\\n[resource]\\nsize = Vector2(2, 2)".`,

      `TIP — duplicate a node and place the copy.
Step 1: node_manage op="duplicate", params={"path":"/Node3D/<NAME>"}.
Step 2: read the new node's path with scene_get_hierarchy (the copy is usually "<NAME>Copy").
Step 3: node_set_property on the copy to move it, e.g. property="position", value={"x":0,"y":1,"z":0}.`,

      `TIP — do several known steps in one atomic batch with batch_execute.
batch_execute params={"commands":[
  {"command":"create_node","params":{"type":"MeshInstance3D","name":"<NAME>","parent_path":""}},
  {"command":"set_property","params":{"path":"/Node3D/<NAME>","property":"position","value":{"x":0,"y":1,"z":0}}}
]}.
Inside commands use the PLUGIN names: "create_node" and "set_property" (not node_create /
node_set_property). The whole batch rolls back if any step fails. Good for sequences like
stacking several nodes — one batch instead of many separate calls.`,
    ],
  },

  // ── MATERIAL ───────────────────────────────────────────────────────────────
  material: {
    label: "Material",
    description: "Set colors, materials, and the visual look of meshes.",
    tools: ["material_manage", "node_set_property", "filesystem_manage"],
    systemPrompt: `MATERIAL MODE (Godot 4.6) — how the engine works here:

FACT: The look of a 3D mesh (its color, metalness, transparency, glow) is set by applying a
MATERIAL to it — NEVER by a "modulate" property. "modulate" only exists on 2D nodes; a
MeshInstance3D has no modulate and trying to set it fails. To change how a mesh looks, use
material_manage, not node_set_property on a color property.

FACT: The node must already have a mesh to show its material. If a mesh has no visible mesh
resource yet, give it one first (that is a transform-mode task), then apply the material.

Blueprint to set a mesh's look (adapt the inner properties to what's asked):
  material_manage op="apply_to_node", params={"node_path":<NODE_PATH>, "params":{ <LOOK> }}.
  Note the NESTED params: the material properties live in an inner "params" object.
  <LOOK> properties (combine as needed):
    • color:        "albedo_color":{"r":R,"g":G,"b":B,"a":A}   (channels 0.0–1.0, NOT 0–255)
    • transparency: alpha (a) below 1.0 makes it see-through (no separate flag needed)
    • metal/shiny:  "metallic":1.0, "roughness":0.15
    • glow:         "emission_enabled":true, "emission":{"r":R,"g":G,"b":B}, "emission_energy_multiplier":N
  Example (red): params={"node_path":"/Node3D/<NAME>","params":{"albedo_color":{"r":1,"g":0,"b":0,"a":1}}}.
  Generalize the color to whatever is asked (e.g. orange ≈ {"r":1,"g":0.5,"b":0,"a":1}).

FACT: To put an existing material FILE on a node instead, use node_set_property
property="material_override", value="res://materials/<NAME>.tres".

Blueprint to create and apply a custom SHADER (for effects beyond a plain material):
  1. Write the shader as a .gdshader text file, ALL ON ONE LINE (no line breaks, no tabs):
     filesystem_manage op="write_text", params={"path":"res://shaders/<NAME>.gdshader",
     "content":"shader_type spatial; void fragment() { ALBEDO = vec3(0.0, 1.0, 1.0); ALPHA = 0.6; }"}.
     CRITICAL: a 3D shader starts with "shader_type spatial;" and the whole body stays on ONE
     line, statements separated by "; ". Do NOT put \\n or tabs inside content — they break the call.
  2. Wrap it in a ShaderMaterial .tres: filesystem_manage op="write_text",
     params={"path":"res://materials/<NAME>.tres","content":"[gd_resource type=\\"ShaderMaterial\\" load_steps=2 format=3]\\n[ext_resource type=\\"Shader\\" path=\\"res://shaders/<NAME>.gdshader\\" id=\\"1\\"]\\n[resource]\\nshader = ExtResource(\\"1\\")"}.
  3. Assign it: node_set_property path=<NODE_PATH>, property="material_override", value="res://materials/<NAME>.tres".
  Adapt the ALBEDO/ALPHA in the shader to the look asked.`,
    docs: [
      `TIP — combine looks in one call. The inner params can hold several properties at once,
so a mesh can be metallic AND glowing together:
params={"node_path":"/Node3D/<NAME>","params":{"metallic":1.0,"roughness":0.15,"emission_enabled":true,"emission":{"r":0,"g":1,"b":1},"emission_energy_multiplier":2.0}}.
A polished metal that glows is one apply_to_node call, not two.`,

      `TIP — common colors as 0–1 channels: red {"r":1,"g":0,"b":0,"a":1}, green {"r":0,"g":1,"b":0,"a":1},
blue {"r":0,"g":0,"b":1,"a":1}, orange {"r":1,"g":0.5,"b":0,"a":1}, cyan {"r":0,"g":1,"b":1,"a":1},
white {"r":1,"g":1,"b":1,"a":1}. Alpha below 1 makes it semi-transparent (e.g. glass a≈0.4).`,
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
signal_manage op="connect", params={"path":"/Node3D/PlayButton","signal":"pressed","target":"/Node3D","method":"_on_play_pressed"}.
"path" is the node that emits (the button); "target" is the node whose method runs.`,
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

      `TIP — connect a signal to a method via tool.
signal_manage op="connect", params={"path":"/Node3D/Btn","signal":"pressed","target":"/Node3D","method":"_on_btn"}.
"path" is the node that emits the signal; "target" is the node whose method runs.`,
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

  // ── INPUT ──────────────────────────────────────────────────────────────────
  input: {
    label: "Input",
    description: "Define input actions and bind keys (player controls like WASD).",
    tools: ["input_map_manage"],
    systemPrompt: `INPUT MODE (Godot 4.6) — verified tool contracts:
- An input action is a NAMED control (e.g. "move_forward") that one or more keys trigger.
- Create the action first: input_map_manage op="add_action", params={"action":"move_forward"}.
- Then bind a key to it: input_map_manage op="bind_event", params={"action":"move_forward","event_type":"key","keycode":"W"}.
- The keycode is the key as a string: "W", "A", "S", "D", "Space", "Enter". One action can have several keys.
- Actions and their keys are saved to project.godot.`,
    docs: [
      `INPUT: Set up WASD movement actions.
For each direction, add the action then bind its key (two calls per direction):
Step 1: input_map_manage op="add_action", params={"action":"move_forward"}.
Step 2: input_map_manage op="bind_event", params={"action":"move_forward","event_type":"key","keycode":"W"}.
Repeat for "move_back"/"S", "move_left"/"A", "move_right"/"D".
The keycode is the letter as a string. Add the action before binding its key.`,

      `INPUT: Add a single action and key (e.g. jump on Space).
Step 1: input_map_manage op="add_action", params={"action":"jump"}.
Step 2: input_map_manage op="bind_event", params={"action":"jump","event_type":"key","keycode":"Space"}.`,
    ],
  },

  // ── EFFECTS ────────────────────────────────────────────────────────────────
  effects: {
    label: "Effects",
    description: "Particle emitters and visual resources: gradients, noise, environments.",
    tools: ["particle_manage", "resource_manage"],
    systemPrompt: `EFFECTS MODE (Godot 4.6) — verified tool contracts:
- particle_manage makes GPUParticles3D emitters. Create one with op="create", params={"parent_path":<PARENT>,"name":<NAME>,"type":"gpu_3d"}.
- For a ready-made look, op="apply_preset" with a "preset" (verified: "fire"). apply_preset CREATES the node, so set parent_path/name where you want it.
- resource_manage writes reusable .tres files: gradient textures, noise textures, environments. Each takes a "resource_path" to save to.
- These resource files are persistent on disk (not undoable). Create them, then assign where needed.`,
    docs: [
      `EFFECTS: Add a fire particle effect.
particle_manage op="apply_preset", params={"parent_path":"/Node3D","name":"Fire","type":"gpu_3d","preset":"fire"}.
This creates a GPUParticles3D named "Fire" under /Node3D with the fire look applied. Its path is then "/Node3D/Fire".`,

      `EFFECTS: Create a plain particle emitter to configure yourself.
particle_manage op="create", params={"parent_path":"/Node3D","name":"Sparks","type":"gpu_3d"}.
The draw and process materials are set up automatically; the new node's path is "/Node3D/Sparks".`,

      `EFFECTS: Make a gradient texture.
resource_manage op="gradient_texture_create", params={"resource_path":"res://textures/grad.tres","stops":[{"offset":0,"color":{"r":1,"g":0,"b":0,"a":1}},{"offset":1,"color":{"r":0,"g":0,"b":1,"a":1}}]}.
Colors are 0-1. Two stops make a two-color gradient; add more stops for more colors.`,

      `EFFECTS: Make a noise texture (for terrain, clouds, distortion).
resource_manage op="noise_texture_create", params={"resource_path":"res://textures/noise.tres"}.
Uses FastNoiseLite (simplex_smooth). Assign the .tres where a texture is needed.`,

      `EFFECTS: Create an environment resource (sky, fog, ambient light).
resource_manage op="environment_create", params={"resource_path":"res://env/world.tres","preset":"default"}.
Assign it to a WorldEnvironment node's "environment" property afterwards.`,
    ],
  },

  // ── BATCH ────────────────────────────────────────────────────────────────────
  batch: {
    label: "Batch",
    description: "Build several nodes at once atomically (create many objects, structures).",
    tools: ["batch_execute", "filesystem_manage", "scene_get_hierarchy"],
    systemPrompt: `BATCH MODE (Godot 4.6) — build many things in ONE atomic call.
batch_execute runs a list of commands in order and ROLLS BACK all of them if any fails.
TWO CRITICAL RULES (verified against the server):
1. Each item uses the key "command" (NOT "tool"), and the value is a PLUGIN command name,
   NOT an MCP tool name. Use: create_node, set_property, duplicate_node (NOT node_create / node_set_property).
2. Each item is {"command":<PLUGIN_CMD>, "params":{...}}. The params are the same fields the
   single tool would take.
A node created earlier in the batch CAN be referenced by later commands in the same batch
(its path is parent_path + "/" + name).
For meshes inside a batch, set the "mesh" property to a .tres resource path you have written
with filesystem_manage BEFORE the batch (inline mesh objects are unreliable).`,
    docs: [
      `BATCH: Create several cubes at once.
First (outside the batch) write a mesh resource once: filesystem_manage op="write_text", params={"path":"res://meshes/box.tres","content":"[gd_resource type=\\"BoxMesh\\" format=3]\\n[resource]"}.
Then: batch_execute params={"commands":[
  {"command":"create_node","params":{"type":"MeshInstance3D","name":"Cube1","parent_path":"/Node3D"}},
  {"command":"set_property","params":{"path":"/Node3D/Cube1","property":"mesh","value":"res://meshes/box.tres"}},
  {"command":"create_node","params":{"type":"MeshInstance3D","name":"Cube2","parent_path":"/Node3D"}},
  {"command":"set_property","params":{"path":"/Node3D/Cube2","property":"mesh","value":"res://meshes/box.tres"}},
  {"command":"set_property","params":{"path":"/Node3D/Cube2","property":"position","value":{"x":0,"y":1,"z":0}}}
]}.
Note: commands use create_node / set_property (plugin names), and "command" not "tool".`,

      `BATCH: Stack cubes into a tower.
Write the mesh .tres first, then one create_node + set_property(mesh) + set_property(position) per cube, all in the commands array. Increment the Y position for each: 0, 1, 2, 3...`,
    ],
  },
};

export const ACTIVE_MODES = ["transform", "material", "animation", "ui", "script", "scene", "batch", "input", "effects"];
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
