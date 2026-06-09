import { loadModel, unloadModel, profiler, close } from "@qvac/sdk";
import { config }                           from "../config/config.mjs";
import { appendLog }                        from "./logger.mjs";

let _modelId = null;

export async function startModel(onProgress) {
  profiler.enable();

  const src = config.model.src ?? config.model.path;
  console.log(`\nCargando modelo desde:\n  ${typeof src === "object" ? src.name : src}\n`);

  // Construimos modelConfig de forma incremental. Los flags base siempre van;
  // los de TurboQuant (cache-type-k / cache-type-v) SOLO se añaden si están
  // definidos en config.model. Así, si los comentas en config, el modelo carga
  // exactamente como antes (sin TurboQuant), sin tener que tocar este archivo.
  const modelConfig = {
    ctx_size: config.model.ctxSize,
    tools:    config.model.tools,
  };

  // ── TurboQuant (SDK 0.12.0+) ───────────────────────────────────────────────
  // Compresión del KV-cache (hasta 5x menos memoria). Model-agnostic: funciona
  // con cualquier GGUF (8B, 20B, etc). Requiere Vulkan y SDK >= 0.12.0.
  // El SDK espera las claves con guiones: "cache-type-k" / "cache-type-v".
  if (config.model.cacheTypeK) modelConfig["cache-type-k"] = config.model.cacheTypeK;
  if (config.model.cacheTypeV) modelConfig["cache-type-v"] = config.model.cacheTypeV;

  _modelId = await loadModel({
    modelSrc:    src,
    modelType:   config.model.type,
    modelConfig,
    onProgress:  onProgress ?? ((p) => {
      process.stdout.write(`\r  Cargando... ${p.percentage?.toFixed(0) ?? "?"}%`);
    }),
  });

  process.stdout.write("\r  Modelo cargado ✓                    \n");

  // Logueamos qué config se usó realmente (útil para confirmar que TurboQuant
  // entró en efecto en una corrida dada).
  appendLog({ event: "model_load", modelId: _modelId, modelConfig });
  return _modelId;
}

export function getModelId() {
  if (!_modelId) throw new Error("El modelo no está cargado. Llama startModel() primero.");
  return _modelId;
}

export async function stopModel() {
  if (!_modelId) return;
  appendLog({
    event:           "model_unload",
    modelId:         _modelId,
    profilerSummary: profiler.exportSummary(),
    profilerJSON:    profiler.exportJSON(),
  });
  profiler.disable();
  await unloadModel({ modelId: _modelId });
  _modelId = null;
  await close();
  console.log("\nModelo descargado. RAM liberada.");
}
