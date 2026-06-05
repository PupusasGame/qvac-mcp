// godot-docs.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Corpus curado de documentación de Godot 4.6 para el RAG.
// Cada entrada es un documento independiente que se ingiere en el workspace.
// Se enfoca en las clases y tipos que el agente toca con más frecuencia, con
// énfasis en el FORMATO de los valores (que es donde el modelo se equivoca).
//
// Ampliar este array es la forma de darle más conocimiento al agente.
// ─────────────────────────────────────────────────────────────────────────────

export const GODOT_DOCS = [
  // ── Tipos de valor (lo más crítico para evitar errores de formato) ──────────
  `Godot type Vector3: a 3D vector with float fields x, y, z. When setting a Vector3 property via the editor API, the value MUST be a JSON object like {"x":0,"y":45,"z":0}. Never use an array [0,45,0] and never wrap it in a string. Used by position, rotation, rotation_degrees, scale, and many 3D properties.`,

  `Godot type Vector2: a 2D vector with float fields x, y. Set it as a JSON object {"x":10,"y":20}. Used by 2D node positions, scales, and sizes (Node2D, Control).`,

  `Godot type Color: an RGBA color with float fields r, g, b, a, each from 0.0 to 1.0. Set it as a JSON object {"r":1,"g":0,"b":0,"a":1} for opaque red. Used by modulate, albedo_color, and material colors. 0.5 is half intensity; a is alpha (1 = opaque, 0 = transparent).`,

  `Godot type Transform3D: a 3D transform combining a Basis (rotation/scale) and an origin (Vector3 position). Usually you set position, rotation, and scale separately rather than the whole transform. Prefer node.position, node.rotation_degrees, and node.scale.`,

  // ── Rotación: radianes vs grados (fuente común de confusión) ────────────────
  `Godot rotation properties. A Node3D has two related properties: "rotation" is in RADIANS (Vector3), and "rotation_degrees" is in DEGREES (Vector3). To rotate 45 degrees around an axis, prefer rotation_degrees with the matching field, e.g. {"x":45,"y":0,"z":0} rotates 45 degrees around the X axis. The X axis is typically the horizontal pitch axis, Y is the vertical yaw axis, Z is the roll axis. rotation_order controls the order Euler angles are applied.`,

  // ── Clases de nodos comunes ─────────────────────────────────────────────────
  `Godot class Node3D: base class for all 3D objects. Key properties: position (Vector3, local position), rotation (Vector3 radians), rotation_degrees (Vector3 degrees), scale (Vector3, default {"x":1,"y":1,"z":1}), visible (bool), global_position (Vector3 world space). All 3D nodes inherit these.`,

  `Godot class MeshInstance3D: a Node3D that displays a 3D mesh. Inherits all Node3D transform properties (position, rotation_degrees, scale, visible). Key properties: mesh (the Mesh resource), material_override (Material applied over the whole mesh), cast_shadow (int), gi_mode (int). To change a MeshInstance3D's color, set material_override or modify its material's albedo_color.`,

  `Godot class Camera3D: a Node3D that defines the viewpoint. Key properties: fov (float, field of view in degrees, default 75), near (float clip), far (float clip), projection (int: 0 perspective, 1 orthogonal), current (bool, whether this is the active camera), position and rotation_degrees (inherited from Node3D).`,

  `Godot class Node: the base class for everything in the scene tree. Key properties: name (String), process_mode (int). Nodes form a tree; each has a path like /root/Main/Player. Use the node path to target a node in editor operations.`,

  `Godot class WorldEnvironment: applies an Environment resource to the scene (sky, ambient light, fog, tonemap). It has no transform. Key property: environment (the Environment resource).`,

  `Godot class DirectionalLight3D: a Node3D that emits parallel light like the sun. Key properties: light_energy (float brightness), light_color (Color), shadow_enabled (bool), rotation_degrees (Vector3, controls light direction).`,

  `Godot class OmniLight3D: a Node3D point light radiating in all directions. Key properties: light_energy (float), light_color (Color), omni_range (float radius), position (Vector3).`,

  // ── 2D (por si el proyecto incluye escenas 2D) ──────────────────────────────
  `Godot class Node2D: base class for 2D objects. Key properties: position (Vector2), rotation (float radians), rotation_degrees (float degrees), scale (Vector2 default {"x":1,"y":1}), modulate (Color), visible (bool), z_index (int). Note: in 2D, rotation_degrees is a single float, not a Vector.`,

  `Godot class Sprite2D: a Node2D that displays a texture. Key properties: texture (the image resource), modulate (Color tint), flip_h (bool), flip_v (bool), centered (bool), position (Vector2).`,

  // ── Materiales ──────────────────────────────────────────────────────────────
  `Godot class StandardMaterial3D: the common 3D material. Key properties: albedo_color (Color, the base color as {"r":..,"g":..,"b":..,"a":..}), metallic (float 0-1), roughness (float 0-1), emission_enabled (bool), emission (Color). To recolor a MeshInstance3D, set its material's albedo_color.`,
];
