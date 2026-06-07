// modes.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Modos por dominio. Cada modo define TRES cosas:
//   1. tools       → qué herramientas MCP se exponen al modelo en ese modo.
//   2. systemPrompt → conocimiento curado de Godot 4.6 que SIEMPRE se inyecta
//                     en ese modo (no depende de que el RAG lo recupere).
//   3. docs         → documentos específicos del modo que se ingieren en el RAG.
//
// Tres flancos contra "el modelo no sabe usar Godot":
//   - tools acotadas  → menos confusión entre herramientas parecidas.
//   - systemPrompt    → conocimiento garantizado por dominio.
//   - docs por modo   → recuperación RAG enfocada.
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
    description: "Move, rotate, scale, position nodes; create, delete, rename, reparent nodes.",
    tools: ["node_set_property", "node_create", "node_find", "node_manage"],
    systemPrompt: `TRANSFORM MODE — how Godot 4.6 transforms work (reason with this):
- A Node3D exposes position (Vector3, local), rotation_degrees (Vector3, degrees), rotation (Vector3, radians), and scale (Vector3, default {"x":1,"y":1,"z":1}). Each Vector3 is an object {"x":N,"y":N,"z":N} of FINAL values.
- Axes: X is pitch, Y is yaw (turning), Z is roll. Node paths are relative to the scene root (e.g. "/Node3D/Ball").
- KEY DISTINCTION — absolute vs relative:
  • Absolute ("set Y rotation to 45", "move to x=2"): write the value directly.
  • Relative ("add 15 degrees", "rotate a bit more", "move 2 left", "make it bigger"): the number in the request is a DELTA, not the final value. First read the node's current value with node_get_properties, then add/apply the delta yourself, then write the computed result. Example reasoning: current rotation_degrees.y is 45, user says "add 15" → write y = 60, not 15.
- node_create makes a node (type + parent path). node_manage handles duplicate / rename / delete / reparent / move. After duplicating, confirm the new node's path with scene_get_hierarchy before using it.`,
    docs: [
      `TRANSFORM: Moving a node in 3D space.
position is a Vector3 object {"x":N,"y":N,"z":N} of final coordinates. For an absolute move, write the target directly. For a relative move ("2 units left"), read the current position first, subtract/add on the right axis, then write the result. Left/right is usually the X axis, up/down is Y, forward/back is Z.`,

      `TRANSFORM: Rotating a node.
rotation_degrees is a Vector3 object in degrees; rotation is the same in radians. Pick the one matching the unit asked. For an ABSOLUTE rotation ("set Y to 45") write {"x":0,"y":45,"z":0}. For a RELATIVE rotation ("add 15 degrees on Y", "rotate a bit more"), the number is a delta: read the current rotation_degrees with node_get_properties, add the delta to the right axis, and write the computed total. All three axes must be present in the object you write.`,

      `TRANSFORM: Scaling a node.
scale is a Vector3 object, default {"x":1,"y":1,"z":1}. "Twice as big" means multiply current scale by 2 (read current first if it may not be 1). Uniform scale uses equal components; non-uniform differs per axis.`,

      `TRANSFORM: Duplicating and placing a node next to the original.
First node_manage op "duplicate" on the source path. Then scene_get_hierarchy to learn the new node's actual path (never assume the name). Then set its position. The new node starts at the original's transform, so to offset it, read its position and add the offset.`,

      `TRANSFORM: Creating a new 3D node.
node_create takes a Godot class name as type, an optional name, and a parent_path. Common 3D types: Node3D, MeshInstance3D, DirectionalLight3D, OmniLight3D, SpotLight3D, Camera3D, RigidBody3D, StaticBody3D, CollisionShape3D, Area3D, GPUParticles3D, CSGBox3D, CSGSphere3D.
parent_path is WHERE in the tree the node attaches. To create sibling nodes (independent objects), give them all the SAME parent_path (e.g. "/Node3D"), NOT each other as parents.`,

      `TRANSFORM: Placing objects "on top of" / "stacked" on each other (spatial, not hierarchy).
"On top of" means a higher POSITION on the Y axis — it does NOT mean making one node a child of another. Create all the objects as siblings under the same parent (e.g. parent_path "/Node3D"), then give each a higher position.y.
Example — 3 stacked cubes: create Cube1, Cube2, Cube3 all with parent_path "/Node3D"; then set Cube1 position y=0, Cube2 position y=1, Cube3 position y=2 (assuming ~1 unit tall). Never make Cube2 a child of Cube1 just because it sits on top — that nests the tree incorrectly. Use node positions to stack, not parent_path.`,
    ],
  },

  // ── MATERIAL ───────────────────────────────────────────────────────────────
  material: {
    label: "Material",
    description: "Set colors, materials, textures, and visual look of meshes.",
    tools: ["material_manage", "node_set_property", "script_create"],
    systemPrompt: `MATERIAL MODE KNOWLEDGE (Godot 4.6):
- A freshly created MeshInstance3D usually has NO material resource (.tres) to edit.
- FASTEST way to color a mesh: material_manage op="apply_to_node". Inside params put node_path plus the MATERIAL PROPERTIES directly. Example: params={"node_path":"/Node3D/Floor","albedo_color":{"r":1,"g":0,"b":0,"a":1}}.
- IMPORTANT: params only accepts REAL StandardMaterial3D property names (albedo_color, metallic, roughness, emission_enabled, emission, etc.). Do NOT put "slot", "transparency", or "type" inside params — those are not material properties and will be rejected. apply_to_node defaults the slot to override automatically.
- For semi-transparent: set albedo_color with alpha < 1 (e.g. "a":0.5). Do NOT pass a "transparency" key — alpha in albedo_color is what creates transparency.
- Presets via op="apply_preset": metal, glass, emissive, unlit, matte, ceramic, wood, plastic. Example: params={"node_path":"/Node3D/Ball","preset":"metal"}.
- Color values are 0.0 to 1.0, NOT 0-255. red={"r":1,"g":0,"b":0,"a":1}, white={"r":1,"g":1,"b":1,"a":1}, gray={"r":0.5,"g":0.5,"b":0.5,"a":1}.
- SHADERS need a 3-step flow (see the shader doc below) — a .gdshader file must exist with code BEFORE a ShaderMaterial can use it.
- material_manage uses op + params (nested object), never flat arguments.`,
    docs: [
      `MATERIAL: Changing the color of a MeshInstance3D (fastest method).
Use material_manage op="apply_to_node". Inside params put node_path and the material properties directly.
Example: paint Floor red → op="apply_to_node", params={"node_path":"/Node3D/Floor","albedo_color":{"r":1,"g":0,"b":0,"a":1}}.
Do NOT add "slot", "type", or "transparency" inside params — only real material properties like albedo_color, metallic, roughness. Works even if the node has no material yet.`,

      `MATERIAL: Making something semi-transparent.
Transparency comes from the alpha channel of albedo_color, not a separate flag.
Example: half-transparent gray → op="apply_to_node", params={"node_path":"/Node3D/Cube3","albedo_color":{"r":0.5,"g":0.5,"b":0.5,"a":0.5}}.
The "a" value below 1.0 makes it see-through. Never pass a "transparency" key.`,

      `MATERIAL: Using a preset look.
material_manage op="apply_preset" applies a curated visual style to a node.
Available presets: metal, glass, emissive, unlit, matte, ceramic, wood, plastic.
Example: make Ball look metallic → op="apply_preset", params={"node_path":"/Node3D/Ball","preset":"metal"}.`,

      `MATERIAL: Creating and using a SHADER (3 steps, order matters).
A ShaderMaterial needs a .gdshader FILE that already contains shader code. You cannot create a shader material pointing at a file that doesn't exist yet.
Step 1 — write the shader file first using the SCRIPT tools: script_create path="res://shaders/holographic.gdshader" content="shader_type spatial;\\nvoid fragment() { ALBEDO = vec3(0.0, 1.0, 1.0); }".
Step 2 — create a ShaderMaterial that references it: material_manage op="create", params={"path":"res://materials/holographic.tres","type":"shader","shader_path":"res://shaders/holographic.gdshader","overwrite":true}.
Step 3 — assign it to the node: material_manage op="assign", params={"node_path":"/Node3D/Ball","resource_path":"res://materials/holographic.tres"}.
Then set shader uniforms with op="set_shader_param", params={"path":"res://materials/holographic.tres","param":"<uniform_name>","value":<value>}.`,

      `MATERIAL: Editing an existing .tres material file.
Only use op="set_param" when a .tres file already exists. The path MUST end in .tres, .material, or .res — never a node path.
Example: op="set_param", params={"path":"res://materials/floor.tres","param":"albedo_color","value":{"r":0,"g":0,"b":1,"a":1}}.`,

      `MATERIAL: Making a material glow (emissive).
Use op="apply_to_node" with emission properties inside params, or op="apply_preset" preset "emissive".
Example: params={"node_path":"/Node3D/Ball","emission_enabled":true,"emission":{"r":0,"g":1,"b":1,"a":1},"emission_energy_multiplier":2.0}.`,
    ],
  },

  // ── ANIMATION ──────────────────────────────────────────────────────────────
  animation: {
    label: "Animation",
    description: "Create animation clips, tracks, keyframes; play and preset animations.",
    tools: ["animation_create", "animation_manage", "node_create", "node_find"],
    systemPrompt: `ANIMATION MODE KNOWLEDGE (Godot 4.6):
- Animations REQUIRE an AnimationPlayer node. ALWAYS do this first: check the scene for an existing AnimationPlayer (look in the CURRENT SCENE list). If none exists, create one with node_create type="AnimationPlayer", parent_path pointing at a sensible parent (e.g. the node you want to animate, or "/Node3D"). Only AFTER it exists can you create or play animations.
- The player_path you pass to animation tools must be the ACTUAL path of the AnimationPlayer you created/found — verify it in the scene, do not assume "/Node3D/AnimationPlayer" exists.
- animation_create: creates a NEW clip inside an existing AnimationPlayer. Requires player_path and animation_name.
- animation_manage ops: add_property_track, add_method_track, set_autoplay, play, stop, list, get, delete, validate, and presets.
- Presets (one call each): op="preset_pulse" (scale bounce), "preset_fade" (alpha in/out), "preset_slide" (position), "preset_shake". They need params with player_path, target_path, and the preset's options.
- To add a manual keyframe track: op="add_property_track", params={"player_path":"...","animation_name":"...","node_path":"...","property":"position","keyframes":[{"time":0,"value":{"x":0,"y":0,"z":0}},{"time":1,"value":{"x":3,"y":0,"z":0}}]}.
- Keyframe "time" is in seconds; "value" matches the property type (Vector3 for position/rotation_degrees/scale).
- After creating animations, consider set_autoplay so they run, or op="play" for editor preview.`,
    docs: [
      `ANIMATION: Creating a movement animation from A to B.
Step 1: If no AnimationPlayer exists, node_create type="AnimationPlayer", parent_path="/Node3D".
Step 2: animation_create player_path="/Node3D/AnimationPlayer", animation_name="Move".
Step 3: animation_manage op="add_property_track", params={"player_path":"/Node3D/AnimationPlayer","animation_name":"Move","node_path":"/Node3D/Ball","property":"position","keyframes":[{"time":0,"value":{"x":0,"y":0,"z":0}},{"time":2,"value":{"x":5,"y":0,"z":0}}]}.
Step 4: animation_manage op="play", params={"player_path":"/Node3D/AnimationPlayer","animation_name":"Move"}.`,

      `ANIMATION: Using a preset animation effect.
op="preset_fade": fades a node in/out (modulate alpha). params: player_path, node_path, duration.
op="preset_slide": slides node from offset to original position. params: player_path, node_path, direction ("left","right","up","down"), distance, duration.
op="preset_shake": shakes a node. params: player_path, node_path, intensity, duration.
op="preset_pulse": scales node up and back. params: player_path, node_path, scale_factor, duration.
Example: shake the Ball → op="preset_shake", params={"player_path":"/Node3D/AnimationPlayer","node_path":"/Node3D/Ball","intensity":0.3,"duration":0.5}.`,

      `ANIMATION: Looping an animation.
After creating the animation, set loop mode:
animation_manage op="get" to inspect, then op="validate" to check keyframes.
To set autoplay: op="set_autoplay", params={"player_path":"/Node3D/AnimationPlayer","animation_name":"Move","autoplay":true}.`,

      `ANIMATION: Rotating a node continuously (spin effect).
Create an animation with rotation_degrees track:
keyframes: [{"time":0,"value":{"x":0,"y":0,"z":0}}, {"time":2,"value":{"x":0,"y":360,"z":0}}]
Set loop mode and autoplay for continuous spin.`,
    ],
  },

  // ── UI ─────────────────────────────────────────────────────────────────────
  ui: {
    label: "UI",
    description: "Build HUDs, menus, layouts, themes, and Control nodes.",
    tools: ["ui_manage", "theme_manage", "node_create", "node_set_property", "node_manage"],
    systemPrompt: `UI MODE KNOWLEDGE (Godot 4.6):
- UI nodes inherit from Control. Common types: Label, Button, Panel, TextureRect, ProgressBar, HBoxContainer, VBoxContainer, GridContainer, MarginContainer, CenterContainer, ColorRect, RichTextLabel, LineEdit, SpinBox, CheckBox, OptionButton, TabContainer, ScrollContainer, PopupMenu, WindowDialog.
- UI nodes live under a CanvasLayer or directly under the root for 2D/UI scenes.
- ui_manage op="set_anchor_preset" places a Control in a corner or edge: presets are "top_left","top_right","bottom_left","bottom_right","center","full_rect","top_wide","bottom_wide","left_wide","right_wide".
- ui_manage op="set_text" sets the text of a Label, Button, or RichTextLabel.
- ui_manage op="build_layout" creates a full layout tree from a spec in one call.
- theme_manage sets colors, fonts, font sizes, and styleboxes on a Theme resource.
- To set a Label's text color: theme_manage op="set_color", params={"theme_path":"res://themes/hud.tres","class_name":"Label","name":"font_color","value":{"r":1,"g":1,"b":0,"a":1}}.
- anchor presets control where the node sticks: bottom_right for score, top_left for health bar, center for menus.
- Container nodes (HBox, VBox, Grid) auto-layout their children — no need to set positions manually.`,
    docs: [
      `UI: Creating a HUD label in the corner.
Step 1: node_create type="Label", name="ScoreLabel", parent_path="/Node3D" (or your CanvasLayer path).
Step 2: ui_manage op="set_text", params={"path":"/Node3D/ScoreLabel","text":"Score: 0"}.
Step 3: ui_manage op="set_anchor_preset", params={"path":"/Node3D/ScoreLabel","preset":"top_right"}.
The label will stick to the top-right corner regardless of screen size.`,

      `UI: Building a complete HUD layout in one call.
ui_manage op="build_layout" accepts a tree spec and creates all nodes at once.
Example spec: {"type":"MarginContainer","name":"HUD","parent":"/Node3D","children":[{"type":"HBoxContainer","children":[{"type":"Label","name":"HealthLabel","text":"HP: 100"},{"type":"Label","name":"ScoreLabel","text":"Score: 0"}]}]}.`,

      `UI: Styling text with theme_manage.
Step 1: theme_manage op="create", params={"path":"res://themes/hud.tres"}.
Step 2: theme_manage op="set_font_size", params={"theme_path":"res://themes/hud.tres","class_name":"Label","name":"font_size","value":24}.
Step 3: theme_manage op="set_color", params={"theme_path":"res://themes/hud.tres","class_name":"Label","name":"font_color","value":{"r":1,"g":1,"b":0,"a":1}}.
Step 4: theme_manage op="apply", params={"theme_path":"res://themes/hud.tres","node_path":"/Node3D/HUD"}.`,

      `UI: Creating a button with a signal.
Step 1: node_create type="Button", name="StartButton", parent_path="/Node3D".
Step 2: ui_manage op="set_text", params={"path":"/Node3D/StartButton","text":"Start Game"}.
Step 3: ui_manage op="set_anchor_preset", params={"path":"/Node3D/StartButton","preset":"center"}.
Step 4: signal_manage op="connect", params={"source_path":"/Node3D/StartButton","signal":"pressed","target_path":"/Node3D","method":"_on_start_pressed"}.`,

      `UI: Progress bar (health bar, loading bar).
node_create type="ProgressBar", name="HealthBar", parent_path="/Node3D".
node_set_property path="/Node3D/HealthBar", property="min_value", value=0.
node_set_property path="/Node3D/HealthBar", property="max_value", value=100.
node_set_property path="/Node3D/HealthBar", property="value", value=75.
ui_manage op="set_anchor_preset", params={"path":"/Node3D/HealthBar","preset":"top_wide"}.`,
    ],
  },

  // ── SCRIPT ─────────────────────────────────────────────────────────────────
  script: {
    label: "Script",
    description: "Write and attach GDScript, manage signals, autoloads, and input maps.",
    tools: ["script_create", "script_patch", "script_attach", "script_manage", "signal_manage", "autoload_manage", "input_map_manage"],
    systemPrompt: `SCRIPT MODE KNOWLEDGE (Godot 4.6):
- GDScript files use extension .gd and start with "extends ClassName".
- CRITICAL: the "extends" class MUST match (or be a parent of) the target node's type. If you attach a script to a MeshInstance3D, write "extends MeshInstance3D" — not "extends Node3D" generically — so the script can access that node's properties (e.g. rotation_degrees, material_override). When unsure of the node's type, read it first with node_get_properties.
- script_create: creates a .gd file at a res:// path with content. ALWAYS precedes script_attach.
- script_attach: attaches the .gd file to a node. path = node path in scene, script_path = res:// path.
- script_patch: edits an existing .gd file with anchor-based string replacement. Safer than rewriting the whole file.
- Common base classes: Node3D (3D objects), MeshInstance3D (visible meshes), Node2D (2D), CharacterBody3D (physics character), RigidBody3D (physics), Control (UI), Node (generic).
- _ready() runs once when the node enters the scene tree. _process(delta) runs every frame. _physics_process(delta) runs at a fixed rate. Use _process for visual/continuous motion (e.g. spinning), _physics_process for movement with collisions.
- To spin a node continuously: in _process(delta), do rotation_degrees.y += speed * delta. Expose tunable values with @export var speed: float = 90.0.
- Input: Input.is_action_pressed("ui_left"), Input.get_axis("move_left","move_right").
- Signals: signal_manage op="connect" links a signal from source node to a method on target node.
- Newlines in content must be literal \\n (escaped). Indentation uses tabs (\\t), not spaces.
- autoload_manage adds global singletons accessible from any script via their name.`,
    docs: [
      `SCRIPT: Adding a movement script to a CharacterBody3D.
Step 1: script_create path="res://scripts/player.gd", content="extends CharacterBody3D\\n\\nconst SPEED = 5.0\\nconst JUMP_VELOCITY = 4.5\\n\\nfunc _physics_process(delta: float) -> void:\\n\\tvar direction = Input.get_vector(\\"move_left\\", \\"move_right\\", \\"move_forward\\", \\"move_back\\")\\n\\tif direction:\\n\\t\\tvelocity.x = direction.x * SPEED\\n\\t\\tvelocity.z = direction.y * SPEED\\n\\telse:\\n\\t\\tvelocity.x = move_toward(velocity.x, 0, SPEED)\\n\\t\\tvelocity.z = move_toward(velocity.z, 0, SPEED)\\n\\tif not is_on_floor():\\n\\t\\tvelocity += get_gravity() * delta\\n\\tif Input.is_action_just_pressed(\\"ui_accept\\") and is_on_floor():\\n\\t\\tvelocity.y = JUMP_VELOCITY\\n\\tmove_and_slide()".
Step 2: script_attach path="/Node3D/Player", script_path="res://scripts/player.gd".`,

      `SCRIPT: Simple rotating object script.
script_create path="res://scripts/rotator.gd", content="extends Node3D\\n\\n@export var speed: float = 90.0\\n\\nfunc _process(delta: float) -> void:\\n\\trotation_degrees.y += speed * delta".
script_attach path="/Node3D/Ball", script_path="res://scripts/rotator.gd".
The @export keyword makes "speed" editable in the Godot Inspector.`,

      `SCRIPT: Connecting a signal between two nodes.
signal_manage op="connect", params={"source_path":"/Node3D/Button","signal":"pressed","target_path":"/Node3D","method":"_on_button_pressed"}.
The method _on_button_pressed must exist in the target node's script.
To add the method: script_patch the target script with the new function.`,

      `SCRIPT: Adding an autoload (global singleton).
autoload_manage op="add", params={"name":"GameManager","path":"res://scripts/game_manager.gd"}.
Any script can then access it as: GameManager.some_method() or GameManager.some_variable.
Create the script first with script_create before adding it as autoload.`,

      `SCRIPT: Patching an existing script (adding a method without rewriting).
script_patch anchor="# END" (or any unique string in the file), insert="\\nfunc take_damage(amount: int) -> void:\\n\\thealth -= amount\\n\\tif health <= 0:\\n\\t\\tqueue_free()".
script_patch is safer than script_create when the file already has logic you want to keep.`,
    ],
  },

  // ── SCENE ──────────────────────────────────────────────────────────────────
  scene: {
    label: "Scene",
    description: "Open/save scenes, run the project, manage camera, audio, and filesystem.",
    tools: ["scene_open", "scene_save", "scene_manage", "project_run", "project_manage", "camera_manage", "audio_manage", "filesystem_manage"],
    systemPrompt: `SCENE MODE KNOWLEDGE (Godot 4.6):
- scene_save: saves the currently open scene to disk. No params needed. Always call after making changes.
- scene_open: opens a .tscn file by res:// path. Switches the active scene in the editor.
- project_run: runs the project from the editor. mode="main" runs the main scene, mode="current" runs the open scene.
- project_manage op="stop" stops a running project. op="settings_get" / op="settings_set" reads/writes project.godot settings.
- camera_manage: create and configure Camera3D or Camera2D. op="create", op="configure" (fov, projection, near, far), op="follow_2d", op="get", op="list".
- audio_manage: create AudioStreamPlayer nodes and assign streams. op="player_create", op="player_set_stream", op="play", op="stop", op="list".
- filesystem_manage: op="read_text" reads a file, op="write_text" writes a file, op="search" finds files by pattern, op="reimport" forces re-import of an asset.
- scene_manage op="create" creates a new .tscn file. op="save_as" saves current scene to a new path. op="get_roots" lists all open scene roots.
- Camera FOV default is 75. Near clip 0.05, far clip 4000.`,
    docs: [
      `SCENE: Saving and running the project.
scene_save → saves current scene.
project_run mode="current" → runs the currently open scene.
project_run mode="main" → runs from the main scene defined in project settings.
project_manage op="stop" → stops the running project.`,

      `SCENE: Configuring the Camera3D.
camera_manage op="configure", params={"path":"/Node3D/Camera3D","fov":60,"projection":"perspective"}.
To follow a target in 3D: position the camera with node_set_property and point it using rotation_degrees.
Common FOV values: 60 (cinematic), 75 (default), 90 (wide/FPS).`,

      `SCENE: Adding background music.
Step 1: node_create type="AudioStreamPlayer", name="Music", parent_path="/Node3D".
Step 2: audio_manage op="player_set_stream", params={"path":"/Node3D/Music","stream_path":"res://audio/music.ogg"}.
Step 3: node_set_property path="/Node3D/Music", property="autoplay", value=true.
Step 4: scene_save.`,

      `SCENE: Reading and writing project files.
filesystem_manage op="read_text", params={"path":"res://data/config.json"} → returns file content.
filesystem_manage op="write_text", params={"path":"res://data/config.json","content":"{\"level\":1}"} → writes file.
filesystem_manage op="search", params={"pattern":"*.gd"} → finds all GDScript files in project.`,

      `SCENE: Creating a new scene from scratch.
scene_manage op="create", params={"root_type":"Node3D","name":"Level2","path":"res://scenes/level2.tscn"}.
Then add nodes to it with node_create using parent_path="/Level2".
scene_save when done.`,
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
