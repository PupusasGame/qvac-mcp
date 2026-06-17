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

FACT: Choose the mesh type by the object's nature, not just its name. A flat surface seen
from one side (floor, wall, ground) can be a PlaneMesh. But an object that must be solid, or
seen from BOTH sides (anything with a distinct front and back face), must be a BoxMesh — a
PlaneMesh has only one face and disappears when viewed from behind. When an object is flat
but needs both faces, use a thin BoxMesh, not a PlaneMesh.

Blueprint to create any visible shape (generalize the mesh type to the shape asked):
  1. node_create type="MeshInstance3D", name=<NAME>, parent_path="".
  2. filesystem_manage op="write_text", params={"path":"res://meshes/<NAME>.tres",
     "content":"[gd_resource type=\\"<MESH_TYPE>\\" format=3]\\n[resource]"}.
  3. node_set_property path="/Node3D/<NAME>", property="mesh", value="res://meshes/<NAME>.tres".
Pick <MESH_TYPE> from the shape: a box/cube→BoxMesh, a ball/sphere→SphereMesh, a flat
plane/floor→PlaneMesh, and so on. (Example with a box: type="BoxMesh". Apply the same shape
of steps for any other mesh type.)

FACT: Move / rotate / scale use node_set_property with a Vector3 value {"x":N,"y":N,"z":N}:
  • position  — where it sits.   • rotation_degrees — its orientation.   • scale — its size (1 = normal).
  Example: node_set_property path="/Node3D/<NAME>", property="position", value={"x":2,"y":0,"z":0}.

FACT: There are two kinds of change, and they are handled differently:
  • ABSOLUTE ("set Y rotation to 45", "scale to 2", "move to x=3"): write the value directly.
  • RELATIVE ("rotate a bit more", "a little bigger", "move it up some", "flatten it"): you
    must FIRST read the current value (node_get_properties), then compute the new value from
    it, then write the result. Never write a fresh absolute value for a relative request — it
    discards what was there. Example, "rotate 15° more on Y": read rotation_degrees (say y=30),
    then write {"x":0,"y":45,"z":0}. To FLATTEN something, shrink one scale axis toward a small
    value (the thickness) while keeping the other two — read the current scale, then write the
    reduced axis. Which axis is the thickness depends on how the object faces.

FACT: A node's COLOR or material is NOT a property of the node itself. There is no "color",
"albedo_color" or "material" property to set with node_set_property — trying that fails. The
look of a mesh is applied with the material tools (material mode). In transform mode, stick to
geometry: create/visible, position, rotation_degrees, scale, duplicate.`,
    docs: [
      `TIP — deciding the shape when creating an object. If the user names a shape, map it to a
mesh resource type: box/cube/tile/wall/slab → BoxMesh (solid, two-sided); ball/orb/planet
→ SphereMesh; flat ground/floor seen from above → PlaneMesh; pillar/can/tube → CylinderMesh;
pill/capsule/character → CapsuleMesh; wedge/ramp/roof → PrismMesh; ring/donut → TorusMesh.
Decision rule: if the object is solid or must be seen from both sides, choose BoxMesh, never
PlaneMesh. The node is always MeshInstance3D; the .tres type is what changes.`,

      `TIP — reshaping an existing object (flatten, thin, stretch, squash, "make it look like X").
This is a SCALE change, not a new mesh. Recognize it: the object exists and the user wants its
proportions changed. The scale Vector3 has three independent axes — width (x), height (y),
depth/thickness (z). Reason about the SILHOUETTE the user described and set every axis to match
it, not just one:
  • "flatten" / "thin" → shrink the thickness axis toward a small value, keep the others.
  • a flat object that is also longer in one direction → shrink thickness AND set the other two
    axes to the width:height ratio that the description implies (don't leave them both at 1 if
    the shape isn't square).
  • "bigger / stretch / squash" → raise or lower the axis the verb points to.
If the request is relative ("a bit thinner", "flatter"), read the current scale first and adjust
from it. The key habit: decide all three axes deliberately from the shape described, never copy
a fixed set of numbers.`,

      `TIP — duplicating and placing copies. When the user wants another one, or a row/grid/stack,
duplicate then move: node_manage op="duplicate" params={"path":"/Node3D/<NAME>"}, then read the
new node's path (usually "<NAME>2"), then node_set_property position on the copy so it doesn't
overlap the original. For many copies in a pattern, prefer one batch_execute over many calls.`,

      `TIP — orienting an object (rotate, spin, tilt, turn, face). Orientation is the
"rotation_degrees" Vector3 in degrees: Y turns it left/right like a turntable, X tips it
forward/back, Z rolls it sideways. Decide which axis the verb implies ("spin" / "turn" usually
Y). For an absolute angle write it directly; for "turn a bit more" / "rotate further", read the
current rotation_degrees first and add to it — writing a fresh value discards the existing angle.`,

      `TIP — doing a multi-step build as one atomic action with batch_execute. When the task is a
known sequence (a staircase, a tower, a row of objects, create-then-position), put the steps in
one batch instead of many separate calls — it is cleaner and avoids emitting several tool calls
at once. params={"commands":[{"command":"create_node","params":{...}},{"command":"set_property","params":{...}}]}.
Inside commands use PLUGIN names "create_node"/"set_property". The whole batch rolls back on any failure.`,
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

FACT: CREATING a material/shader and ASSIGNING one are different actions — do not confuse them.
If the user says the material or shader ALREADY EXISTS (e.g. "apply the existing holo material",
"use the shader I made", gives a res:// path that is already there), do NOT write or overwrite
any file. Just assign it: node_set_property property="material_override", value=<EXISTING_PATH>.
Only write shader/material files (the create blueprint below) when the look does not exist yet.
Overwriting an existing shader destroys the user's tuned values.

FACT: A node's material_override must point to a MATERIAL file (a .tres), never to a raw
.gdshader. A .gdshader is shader CODE; it must live inside a ShaderMaterial .tres wrapper, and
that .tres is what gets assigned. So:
  • If you are given a .tres path → assign it directly with material_override.
  • If you are given a .gdshader path (raw shader) → the material to assign is its ShaderMaterial
    .tres. If that .tres already exists, assign it. If only the .gdshader exists, first write the
    ShaderMaterial .tres that wraps it (step 2 of the blueprint below), then assign THAT .tres.
  Never set material_override to a .gdshader directly — it is not a material.

Blueprint to create and apply a custom SHADER (only when it does NOT already exist):
  1. Write the shader as a .gdshader text file, ALL ON ONE LINE (no line breaks, no tabs):
     filesystem_manage op="write_text", params={"path":"res://shaders/<NAME>.gdshader",
     "content":"shader_type spatial; void fragment() { ALBEDO = vec3(0.0, 1.0, 1.0); ALPHA = 0.6; }"}.
     CRITICAL: a 3D shader starts with "shader_type spatial;" and the whole body stays on ONE
     line, statements separated by "; ". Do NOT put \\n or tabs inside content — they break the call.
  2. Wrap it in a ShaderMaterial .tres: filesystem_manage op="write_text",
     params={"path":"res://materials/<NAME>.tres","content":"[gd_resource type=\\"ShaderMaterial\\" load_steps=2 format=3]\\n[ext_resource type=\\"Shader\\" path=\\"res://shaders/<NAME>.gdshader\\" id=\\"1\\"]\\n[resource]\\nshader = ExtResource(\\"1\\")"}.
  3. Assign it: node_set_property path=<NODE_PATH>, property="material_override", value="res://materials/<NAME>.tres".
  Adapt the ALBEDO/ALPHA in the shader to the look asked. (If the shader already exists, skip
  steps 1–2 and only do step 3 with the existing path.)`,
    docs: [
      `TIP — recognizing a "look" request and choosing the path. If the user wants a node to look
a certain way (color, shiny, glowing, transparent), that is a material applied with
material_manage op="apply_to_node" and a NESTED params. If the user references a material/shader
that ALREADY EXISTS (a res:// path, "the material I made"), do NOT recreate it — assign it with
node_set_property property="material_override". Decide first: new look → apply_to_node; existing
asset → material_override. Never set color via a node property; the mesh has none.`,

      `TIP — color. "make it red/blue/orange/…" → apply_to_node with albedo_color, channels 0.0–1.0:
params={"node_path":"/Node3D/<NAME>","params":{"albedo_color":{"r":1,"g":0,"b":0,"a":1}}}. Reason
the channels from the color name (orange ≈ r1 g0.5 b0; purple ≈ r0.6 g0 b0.8). Alpha below 1
also makes it see-through, so glass/transparent = a low alpha like 0.35.`,

      `TIP — surface feel: shiny vs matte vs metal. "shiny/chrome/metal" → high metallic, low
roughness: {"metallic":1.0,"roughness":0.15}. "matte/dull" → low metallic, high roughness. The
two properties together describe the surface; decide both from the words used.`,

      `TIP — glow / emit light / neon. When something should appear to give off light, enable
emission: {"emission_enabled":true,"emission":{"r":0,"g":1,"b":1},"emission_energy_multiplier":3.0}.
The emission color is what glows; the multiplier is the brightness. Needs a visible mesh to show.`,

      `TIP — combining several looks in ONE call. The inner params can hold many properties at once,
so reason about the full description and set them together. "glowing chrome" =
{"metallic":1.0,"roughness":0.15,"emission_enabled":true,"emission":{...},"emission_energy_multiplier":2.0}.
Don't make separate calls for each adjective — build one params with all of them.`,

      `TIP — applying a custom SHADER for effects a plain material can't do (holographic, scrolling,
fresnel). If it doesn't exist yet, write the .gdshader (one line, starts "shader_type spatial;"),
wrap it in a ShaderMaterial .tres, then material_override the node with the .tres. If the shader
ALREADY exists, skip writing and only material_override the existing .tres — recreating destroys
its tuned uniform values.`,
    ],
  },

  // ── ANIMATION ──────────────────────────────────────────────────────────────
  animation: {
    label: "Animation",
    description: "Create animation clips and presets (pulse, fade, shake), play them.",
    tools: ["animation_create", "animation_manage", "node_create"],
    systemPrompt: `ANIMATION MODE (Godot 4.6) — how the engine works here:

FACT: Animations live inside an AnimationPlayer node. NOTHING can be animated until an
AnimationPlayer EXISTS. So the FIRST step of any animation request is to create the player:
animation_manage op="player_create", params={"parent_path":"/Node3D","name":"AnimationPlayer"}.
If you try a preset before the player exists, it fails with "Node not found". Create the
player, THEN add the animation, THEN play it. Reuse one player for several animations.

FACT: Presets are the easy, reliable path — pick the preset that matches the motion asked, and
use ONLY that preset's own parameters (mixing them up fails):
  • pulse  → scale heartbeat (grow/shrink), for "pulse", "beat", "throb".
             params: to_scale (peak size), duration.
  • fade   → opacity in/out, for "fade in", "fade out", "appear", "disappear".
             params: duration.
  • shake  → jitter position, for "shake", "wobble", "vibrate", "rumble".
             params: frequency (how fast), duration. (NOT to_scale — that's pulse only.)
  Every preset also takes player_path, target_path (absolute path of the node, e.g.
  "/Node3D/<NAME>"), and animation_name. Decide the preset from the verb the user used, then
  pass only that preset's params.

FACT: Presets are NOT idempotent. If an animation with that animation_name already exists, the
call fails with "Animation '<name>' already exists. Pass overwrite=true or delete it first." So
either pass "overwrite":true in params to replace it, or use a fresh animation_name. This is not
a fatal error — recover by adding overwrite=true and retrying.

FACT: Paths are relative to the scene root ("/Node3D/Child"), never runtime "/root/..." paths.
target_path must be the absolute path of an existing node.

Blueprint (generalize the preset and target to the request):
  1. animation_manage op="player_create", params={"parent_path":"/Node3D","name":"AnimationPlayer"}.
  2. animation_manage op="preset_<KIND>", params={"player_path":"/Node3D/AnimationPlayer",
     "target_path":<NODE_PATH>, "animation_name":<NAME>, ...motion params...}.
  3. animation_manage op="play", params={"player_path":"/Node3D/AnimationPlayer","animation_name":<NAME>}.
  Use op="set_autoplay" instead of play to make it run automatically on scene start.`,
    docs: [
      `TIP — always create the AnimationPlayer first. Any animation request starts with
animation_manage op="player_create", params={"parent_path":"/Node3D","name":"AnimationPlayer"}.
A preset aimed at a player that doesn't exist yet fails. One player can hold many animations,
so create it once, then add each animation to it.`,

      `TIP — choosing the preset from the words. "pulse/beat/throb/heartbeat" → preset_pulse
(scale). "fade/appear/disappear/dissolve" → preset_fade (opacity). "shake/wobble/vibrate/
rumble/jitter" → preset_shake (position). Match the user's verb to the motion, then call that
preset. If none fits, pulse and shake cover most "make it lively" requests.`,

      `TIP — pulse (a node growing and shrinking). animation_manage op="preset_pulse",
params={"player_path":"/Node3D/AnimationPlayer","target_path":"/Node3D/<NAME>","to_scale":1.2,"duration":2.0,"animation_name":"pulse"}.
to_scale is the peak size (1.2 = 20% bigger); duration is one cycle. target_path is absolute.`,

      `TIP — shake (a node jittering in place, e.g. an impact or attention-grab).
animation_manage op="preset_shake", params={"player_path":"/Node3D/AnimationPlayer","target_path":"/Node3D/<NAME>","frequency":30.0,"duration":1.0,"animation_name":"shake"}.
frequency is how fast it jitters; duration how long. Use frequency, not to_scale (that's pulse).
The player must exist first. If "shake" already exists, add "overwrite":true to replace it.`,

      `TIP — fade (a node appearing or disappearing). animation_manage op="preset_fade",
params={"player_path":"/Node3D/AnimationPlayer","target_path":"/Node3D/<NAME>","duration":1.0,"animation_name":"fade"}.`,

      `TIP — play vs autoplay. op="play" runs it now (good for a demo). op="set_autoplay" makes it
start automatically whenever the scene runs. Both take player_path and animation_name.`,
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
    systemPrompt: `SCRIPT MODE (Godot 4.6) — how the engine works here:

FACT: Behavior comes from a GDScript file (.gd) ATTACHED to a node. Two steps: write the
script file, then attach it to the node. Writing alone does nothing until it is attached.

Blueprint to give a node behavior:
  1. script_create params={"path":"res://scripts/<NAME>.gd", "content":<GDSCRIPT>}.
  2. script_attach params={"node_path":<NODE_PATH>, "script_path":"res://scripts/<NAME>.gd"}.

FACT: The script CONTENT is real GDScript code, not JSON. Inside it: extends <CLASS>,
func _process(delta):, vectors as Vector3(x, y, z), and indentation matters (tabs). In the
tool call, newlines and tabs are written as \\n and \\t escapes inside the content string.
Keep scripts SHORT — a few lines. Long multi-line scripts can break the tool call on small
models; if a behavior needs a long script, prefer a brief one or build it in small pieces.

FACT: CREATE vs ATTACH vs EDIT are different. If a script already exists, do not rewrite it —
attach it (script_attach) or edit it (script_patch). Only script_create when the file is new.`,
    docs: [
      `TIP — a script that spins/rotates a node every frame.
Step 1: script_create params={"path":"res://scripts/spin.gd","content":"extends Node3D\\n\\n@export var speed: float = 90.0\\n\\nfunc _process(delta: float) -> void:\\n\\trotation_degrees.y += speed * delta"}.
Step 2: script_attach params={"node_path":"/Node3D/<NAME>","script_path":"res://scripts/spin.gd"}.
@export makes "speed" editable in the Inspector. Keep the script short so the tool call stays intact.`,

      `TIP — a script that moves a node with keyboard input (needs input actions defined first).
content="extends Node3D\\n\\n@export var speed: float = 4.0\\n\\nfunc _process(delta: float) -> void:\\n\\tvar dir := Vector3.ZERO\\n\\tif Input.is_action_pressed(\\"move_forward\\"): dir.z -= 1\\n\\tif Input.is_action_pressed(\\"move_back\\"): dir.z += 1\\n\\tposition += dir * speed * delta".
Then script_attach to the node. The action names must match those registered in input mode.`,

      `TIP — edit an existing script without rewriting it. script_patch
params={"path":"res://scripts/<NAME>.gd","old_text":"speed: float = 90.0","new_text":"speed: float = 180.0"}.
It finds old_text and replaces it with new_text — good for tweaking a value or adding a line.`,

      `TIP — inspect a script before editing. script_manage op="find_symbols",
params={"path":"res://scripts/<NAME>.gd"} returns its extends, functions, and @export vars with
line numbers, so you know what is there before patching.`,

      `TIP — connect a signal to a method. signal_manage op="connect",
params={"path":"/Node3D/Btn","signal":"pressed","target":"/Node3D","method":"_on_btn"}.
"path" is the node that emits the signal; "target" is the node whose method runs. The target's
method should exist in a script attached to the target.`,

      `TIP — register a global singleton (autoload), reachable from any script by name.
autoload_manage op="add", params={"name":"<GLOBAL_NAME>","path":"res://scripts/<NAME>.gd","singleton":true}.
Use op="list" to see current autoloads. Saved to project.godot.`,
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
