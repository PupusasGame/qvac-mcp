import { startModel, stopModel } from "./core/model.mjs";

console.log("=== Prueba de carga de modelo ===\n");

try {
  const modelId = await startModel();
  console.log("modelId recibido:", modelId);

  await stopModel();
  console.log("\n✓ Prueba completada. Revisa logs/inference.jsonl");

} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
}
