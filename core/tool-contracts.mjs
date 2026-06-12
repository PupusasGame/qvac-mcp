// tool-contracts.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Contratos CURADOS de cada herramienta, ADAPTADOS POR MODO.
// Cada entrada tiene DOS apoyos que se complementan (no se repiten):
//   • description: qué hace + el contrato real, con placeholders <ASI>. (El "cómo".)
//   • schema:      la FORMA estructural mínima para el function calling. (El andamio.)
//
// Por qué reemplazamos el inputSchema crudo de Godot:
//   El que entrega Godot al SDK es ruidoso y POBRE (p.ej. params:additionalProperties
//   sin estructura), y no controlamos qué recibe el modelo. Aquí pasamos un esquema
//   mínimo NUESTRO: limpio, conocido, y suficiente para guiar la llamada. El detalle
//   fino vive en la description (texto claro), no en JSON técnico.
//
// Convenciones de description:
//   • Placeholders en MAYÚSCULAS entre <>: <NODE_PATH>, <NAME>, <VALUE>.
//   • Rangos de ejemplo marcados como tal: <0-1 example range>.
//
// Fuente de verdad: contratos verificados en Reporte_de_operaciones (Antigravity)
//   + casos de éxito de nuestros logs. Actualizar aquí cuando se descubra más.
// ─────────────────────────────────────────────────────────────────────────────

// Esquemas reutilizables (mínimos, limpios). Son el andamio, no el detalle.
const S = {
  // Tools "_manage": op + params (params es un objeto; su detalle va en la description).
  opParams: {
    type: "object",
    properties: {
      op:     { type: "string",  description: "the operation to perform" },
      params: { type: "object",  description: "operation arguments (see description)" },
    },
    required: ["op"],
  },
  // node_set_property: path + property + value (value puede ser objeto, string o número).
  setProperty: {
    type: "object",
    properties: {
      path:     { type: "string", description: "scene path of the node" },
      property: { type: "string", description: "property name" },
      value:    { description: "new value (object/string/number per the property)" },
    },
    required: ["path", "property", "value"],
  },
  // node_create: type + name + parent_path.
  createNode: {
    type: "object",
    properties: {
      type:        { type: "string", description: "node type, e.g. MeshInstance3D" },
      name:        { type: "string", description: "name for the new node" },
      parent_path: { type: "string", description: "parent path; \"\" = scene root" },
    },
    required: ["type", "name"],
  },
  // node_find: query.
  find: {
    type: "object",
    properties: { query: { type: "string", description: "name or type to search" } },
    required: ["query"],
  },
};

export const CONTRACTS = {
  // ── TRANSFORM ──────────────────────────────────────────────────────────────
  transform: {
    node_create: {
      description:
`Create a node. Args (direct): type=<NODE_TYPE>, name=<NAME>, parent_path=<PARENT_PATH>.
parent_path is relative to the scene root; "" means the root itself.
After creation the node's path is <PARENT_PATH>/<NAME>.`,
      schema: S.createNode,
    },
    node_set_property: {
      description:
`Set a property on a node. Args (direct): path=<NODE_PATH>, property=<PROP>, value=<VALUE>.
Transform props and their value shape:
  position / rotation_degrees / scale -> {"x":<N>,"y":<N>,"z":<N>}
  mesh -> <RES_PATH> (path to a .tres mesh resource on disk)
SCALE PER-AXIS: scale always needs all three x,y,z. To change ONE axis, read the current
scale first and keep the others. "scale Y by 2, keep the rest" with current {1,1,1} -> {"x":1,"y":2,"z":1}.
To shrink, use values BELOW 1 (e.g. 0.5), never negative (negative flips/mirrors the mesh).`,
      schema: S.setProperty,
    },
    node_manage: {
      description:
`Edit existing nodes. Args: op + params.
ops: duplicate, rename, delete, reparent, move.
Example: op="duplicate", params={"path":<NODE_PATH>}. The copy is usually named <NAME>Copy.`,
      schema: S.opParams,
    },
    node_find: {
      description:
`Find nodes in the scene. Args: query=<TEXT> (a name or type). Returns matching node paths.`,
      schema: S.find,
    },
    filesystem_manage: {
      description:
`Read/write project files. Args: op + params.
To create a mesh resource: op="write_text", params={"path":"res://meshes/<NAME>.tres","content":<TRES_TEXT>}.
A mesh .tres content looks like: [gd_resource type="<MESH_TYPE>" format=3] then a [resource] line.
Mesh types: BoxMesh, SphereMesh, PlaneMesh, CylinderMesh, CapsuleMesh, PrismMesh, TorusMesh.`,
      schema: S.opParams,
    },
    batch_execute: {
      description:
`Run several plugin commands atomically (all-or-nothing; rolls back on any failure).
Args: commands=[ {command:<PLUGIN_CMD>, params:{...}}, ... ].
IMPORTANT: inside a batch use PLUGIN command names, not MCP tool names:
  create_node (not node_create), set_property (not node_set_property).`,
      schema: {
        type: "object",
        properties: { commands: { type: "array", description: "list of {command, params}" } },
        required: ["commands"],
      },
    },
  },

  // ── MATERIAL ───────────────────────────────────────────────────────────────
  material: {
    material_manage: {
      description:
`Set how a mesh looks. Args: op + params (params is a NESTED object).
Color/look a node directly:
  op="apply_to_node", params={"node_path":<NODE_PATH>, "params":{ <MATERIAL_PROPS> }}
  (note the inner "params" holding the material properties)
Material props and shapes:
  albedo_color -> {"r":<0-1>,"g":<0-1>,"b":<0-1>,"a":<0-1>}  (0-1 is the value range, not 0-255)
  metallic -> <0-1>,  roughness -> <0-1>,  emission -> {"r":<0-1>,"g":<0-1>,"b":<0-1>}
Alpha (a) below 1 makes it semi-transparent.
ops: apply_to_node, apply_preset, set_param, set_shader_param, assign, create, get, list.`,
      schema: S.opParams,
    },
    node_set_property: {
      description:
`Assign an existing material/resource file to a node. Args (direct): path=<NODE_PATH>, property=<PROP>, value=<VALUE>.
  property="material_override", value=<RES_PATH> (a .tres material file on disk) -> puts that material on the node.`,
      schema: S.setProperty,
    },
    filesystem_manage: {
      description:
`Write shader and material files. Args: op + params.
SHADER FLOW (order matters — create the file BEFORE anything references it):
  1) Write the shader file FIRST, on ONE line (no line breaks):
     op="write_text", params={"path":"res://shaders/<NAME>.gdshader","content":"shader_type spatial; void fragment() { ALBEDO = vec3(0.0,1.0,1.0); }"}
     Write the whole shader on a SINGLE line with "; " between statements. NEVER put \\n or tabs in content — they break the call. GLSL compiles fine on one line.
  2) THEN write a ShaderMaterial .tres that links it:
     op="write_text", params={"path":"res://materials/<NAME>.tres","content":<TRES_TEXT>}
     the .tres declares type="ShaderMaterial" and an ext_resource pointing at the .gdshader.
  3) THEN assign the .tres to the node with node_set_property property="material_override".
Never reference a .gdshader that you have not written yet.`,
      schema: S.opParams,
    },
  },

  // ── ANIMATION ──────────────────────────────────────────────────────────────
  animation: {
    animation_manage: {
      description:
`Create and control animations. Args: op + params.
Create the player first (it does NOT need to exist beforehand):
  op="player_create", params={"parent_path":<PARENT_PATH>, "name":"AnimationPlayer"}
Presets (easiest, one call each). The target node uses target_path (ABSOLUTE scene path):
  op="preset_pulse", params={"player_path":<PLAYER_PATH>, "target_path":<NODE_PATH>, "to_scale":<N example 1.2>, "duration":<SECONDS>, "animation_name":<NAME>}
  op="preset_fade"/"preset_slide"/"preset_shake" follow the same shape.
Play it:
  op="play", params={"player_path":<PLAYER_PATH>, "animation_name":<NAME>}
  use op="set_autoplay" to run on scene start instead.`,
      schema: S.opParams,
    },
    animation_create: {
      description:
`Create an empty animation clip in a player. Args: params={"player_path":<PLAYER_PATH>, "name":<NAME>, "length":<SECONDS>}.
Prefer the animation_manage presets for simple effects; use this for custom clips.`,
      schema: S.opParams,
    },
    node_create: {
      description:
`Create a node. Args (direct): type=<NODE_TYPE>, name=<NAME>, parent_path=<PARENT_PATH> ("" = root).
Used here mainly if a target node for the animation does not exist yet.`,
      schema: S.createNode,
    },
  },

  // ── UI ─────────────────────────────────────────────────────────────────────
  ui: {
    node_create: {
      description:
`Create a UI (Control) node. Args (direct): type=<UI_TYPE>, name=<NAME>, parent_path=<PARENT_PATH>.
UI types: Label, Button, Panel, VBoxContainer, HBoxContainer, LineEdit, TextureRect.
After creation the node's path is <PARENT_PATH>/<NAME> (include the parent in later calls).`,
      schema: S.createNode,
    },
    node_set_property: {
      description:
`Set a UI property. Args (direct): path=<NODE_PATH>, property=<PROP>, value=<VALUE>.
Common props: text -> <STRING>;  visible -> <true|false>;  custom_minimum_size -> {"x":<N>,"y":<N>}.`,
      schema: S.setProperty,
    },
    ui_manage: {
      description:
`Configure UI layout/anchoring. Args: op + params.
Anchor a control: op="set_anchor_preset", params={"path":<NODE_PATH>, "preset":<PRESET>}.
Valid presets: top_left, top_right, center_top, center, center_bottom, bottom_left, bottom_right, full_rect, center_left, center_right (there is no plain "top").`,
      schema: S.opParams,
    },
    node_manage: {
      description: `Edit existing UI nodes. Args: op + params. ops: duplicate, rename, delete, reparent.`,
      schema: S.opParams,
    },
    theme_manage: {
      description:
`Set colors/fonts on a control. Args: op + params.
ops: set_color, set_font_size. params include path=<NODE_PATH> plus the value.`,
      schema: S.opParams,
    },
    signal_manage: {
      description:
`Connect a node signal to a method. Args: op + params.
op="connect", params={"path":<SOURCE_NODE_PATH>, "signal":<SIGNAL_NAME>, "target":<RECEIVER_NODE_PATH>, "method":<METHOD_NAME>}.
"path" is the node that emits the signal; "target" is the node whose method runs. Example signal for a Button: "pressed".`,
      schema: S.opParams,
    },
  },

  // ── SCRIPT ─────────────────────────────────────────────────────────────────
  script: {
    script_create: {
      description:
`Create a GDScript file. Args: params={"path":"res://scripts/<NAME>.gd", "content":<GDSCRIPT_TEXT>}.
GDScript content uses real syntax: extends <CLASS>, func _ready():, Vector3(<x>,<y>,<z>) (that is GDScript code, not JSON).`,
      schema: S.opParams,
    },
    script_attach: {
      description:
`Attach a script file to a node. Args: params={"node_path":<NODE_PATH>, "script_path":"res://scripts/<NAME>.gd"}.`,
      schema: S.opParams,
    },
    script_patch: {
      description: `Find-and-replace text in an existing script. Args: params={"path":"res://scripts/<NAME>.gd", "old_text":<EXACT_TEXT_TO_FIND>, "new_text":<REPLACEMENT>}. Replaces the exact old_text with new_text (e.g. change a default value or add a line).`,
      schema: S.opParams,
    },
    script_manage: {
      description: `Inspect or manage scripts. Args: op + params.
op="find_symbols", params={"path":"res://scripts/<NAME>.gd"} returns the script's extends, functions, exports and signals with their line numbers — useful before patching.`,
      schema: S.opParams,
    },
    signal_manage: {
      description:
`Connect a signal to a method. Args: op="connect", params={"path":<SOURCE_NODE_PATH>, "signal":<SIGNAL_NAME>, "target":<RECEIVER_NODE_PATH>, "method":<METHOD_NAME>}. "path" emits, "target" receives.`,
      schema: S.opParams,
    },
    autoload_manage: {
      description: `Register an autoload (global singleton). Args: op + params.
op="add", params={"name":<SINGLETON_NAME>, "path":"res://scripts/<NAME>.gd", "singleton":true} registers it (saved to project.godot).
op="list" returns the current autoloads. The name becomes a global accessible from any script.`,
      schema: S.opParams,
    },
  },

  // ── SCENE ──────────────────────────────────────────────────────────────────
  scene: {
    scene_save: {
      description: `Save the current scene to disk. No params needed for the current scene.`,
      schema: { type: "object", properties: {} },
    },
    scene_open: {
      description: `Open a scene file. Args: params={"path":"res://<NAME>.tscn"}.`,
      schema: S.opParams,
    },
    scene_manage: {
      description: `Manage scenes (new, instance, list). Args: op + params.`,
      schema: S.opParams,
    },
    project_run: {
      description: `Run the project. Args: none (or params={"scene":<RES_PATH>} to run a specific scene).`,
      schema: { type: "object", properties: { params: { type: "object" } } },
    },
    project_manage: {
      description: `Project settings. Args: op + params (settings_get / settings_set with key and value).`,
      schema: S.opParams,
    },
    camera_manage: {
      description: `Configure a Camera3D. Args: op + params (set position/look-at/fov on a camera node).`,
      schema: S.opParams,
    },
    audio_manage: {
      description: `Add/configure audio. Args: op + params (player_create, set_stream, play).`,
      schema: S.opParams,
    },
    filesystem_manage: {
      description:
`Read/write project files. Args: op + params.
Write any text file: op="write_text", params={"path":"res://<PATH>", "content":<TEXT>}.`,
      schema: S.opParams,
    },
    node_create: {
      description: `Create a node. Args (direct): type=<NODE_TYPE>, name=<NAME>, parent_path=<PARENT_PATH> ("" = root).`,
      schema: S.createNode,
    },
    node_set_property: {
      description: `Set a node property. Args (direct): path=<NODE_PATH>, property=<PROP>, value=<VALUE>.`,
      schema: S.setProperty,
    },
  },

  // ── INPUT ────────────────────────────────────────────────────────────────────
  input: {
    input_map_manage: {
      description:
`Define input actions and bind keys to them (for player controls like WASD). Args: op + params.
Add an action: op="add_action", params={"action":<ACTION_NAME>}. (deadzone defaults to 0.5.)
Bind a key to it: op="bind_event", params={"action":<ACTION_NAME>, "event_type":"key", "keycode":<KEY>}.
<KEY> is the letter/name of the key as a string: "W", "A", "S", "D", "Space", "Enter".
Actions and bindings are saved to project.godot. Add the action first, then bind one or more keys to it.`,
      schema: S.opParams,
    },
  },

  // ── EFFECTS ──────────────────────────────────────────────────────────────────
  effects: {
    particle_manage: {
      description:
`Create particle emitters and apply ready-made looks. Args: op + params.
Create an emitter: op="create", params={"parent_path":<PARENT_PATH>, "name":<NAME>, "type":"gpu_3d"}.
  This makes a GPUParticles3D node with its draw + process materials set up automatically.
Apply a ready look: op="apply_preset", params={"parent_path":<PARENT_PATH>, "name":<NAME>, "type":"gpu_3d", "preset":<PRESET>}.
  Verified preset: "fire". apply_preset creates the node itself, so point parent_path/name at where you want it.`,
      schema: S.opParams,
    },
    resource_manage: {
      description:
`Create reusable resource files: gradients, noise textures, environments (great for visual flair). Args: op + params.
Gradient texture: op="gradient_texture_create", params={"resource_path":"res://<NAME>.tres", "stops":[<STOPS>]}.
Noise texture:    op="noise_texture_create",    params={"resource_path":"res://<NAME>.tres"}. (FastNoiseLite, simplex_smooth.)
Environment:      op="environment_create",      params={"resource_path":"res://<NAME>.tres", "preset":"default"}.
Each writes a .tres file to disk (persistent — not undoable). Assign it afterwards where it's needed.`,
      schema: S.opParams,
    },
  },

  // ── BATCH ────────────────────────────────────────────────────────────────────
  batch: {
    batch_execute: {
      description:
`Build many nodes atomically (all-or-nothing). Args: commands=[ {command:<PLUGIN_CMD>, params:{...}} ].
KEY: use the key "command" (not "tool") and PLUGIN names: create_node, set_property, duplicate_node
(NOT node_create / node_set_property). Each params holds the same fields the single tool takes.
Nodes created earlier in the list can be referenced by later commands. Set mesh to a .tres path
written beforehand. Rolls back everything if any command fails.`,
      schema: {
        type: "object",
        properties: { commands: { type: "array", description: "list of {command, params}" } },
        required: ["commands"],
      },
    },
    filesystem_manage: {
      description:
`Write resource files needed by the batch (run BEFORE the batch). Args: op + params.
Mesh: op="write_text", params={"path":"res://meshes/<NAME>.tres","content":"[gd_resource type=\\"BoxMesh\\" format=3]\\n[resource]"}.`,
      schema: S.opParams,
    },
    scene_get_hierarchy: {
      description: `Read the current scene tree to know existing node paths before building. No args needed.`,
      schema: { type: "object", properties: {} },
    },
  },
};

// Devuelve {description, schema} curado para una tool en un modo, o null si no hay.
export function contractFor(modeName, toolName) {
  return CONTRACTS[modeName]?.[toolName] ?? null;
}

// Emite los contratos curados como documentos RAG, etiquetados por modo.
// Cada doc lleva el prefijo "[MODE:<modo>] CONTRACT <tool>:" para que:
//   • el embedding capture claramente de qué tool y modo trata, y
//   • el filtro por modo de searchDocs lo conserve/descple igual que los docs[].
// Esto reemplaza a los toolDocs CRUDOS de Godot: indexamos NUESTRA descripción
// limpia (la misma que recibe el modelo), no el inputSchema ruidoso del server.
export function allContractDocs() {
  const out = [];
  for (const [modeName, tools] of Object.entries(CONTRACTS)) {
    for (const [toolName, contract] of Object.entries(tools)) {
      const desc = contract?.description ?? "";
      out.push(`[MODE:${modeName}] CONTRACT ${toolName}:\n${desc}`);
    }
  }
  return out;
}
