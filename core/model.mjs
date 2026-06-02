import { loadModel, unloadModel, profiler } from "@qvac/sdk";
import { config }                           from "../config/config.mjs";
import { appendLog }                        from "./logger.mjs";

let _modelId = null;

// ── Cargar modelo ─
export async function startModel(onProgress) {

  profiler.enable();

  console.log(`\nCargando modelo desde:\n  ${config.model.path}\n`);

  _modelId = await loadModel({
    modelSrc:    config.model.path,
    modelType:   config.model.type,
    modelConfig: { ctx_size: config.model.ctxSize },

    onProgress: onProgress ?? ((p) => {
      process.stdout.write(`\r  Cargando... ${p.percentage?.toFixed(0) ?? "?"}%`);
    }),
  });

  process.stdout.write("\r  Modelo cargado ✓                    \n");

  appendLog({
    event:     "model_load",
    modelPath: config.model.path,
    modelId:   _modelId,
  });

  return _modelId;
}

// ── Obtener modelId ─
export function getModelId() {
  if (!_modelId) throw new Error("El modelo no está cargado. Llama startModel() primero.");
  return _modelId;
}

// ── Descargar modelo ─
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

  console.log("\nModelo descargado. RAM liberada.");
}
