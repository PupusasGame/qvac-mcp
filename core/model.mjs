import { loadModel, unloadModel, profiler, close } from "@qvac/sdk";
import { config }                           from "../config/config.mjs";
import { appendLog }                        from "./logger.mjs";

let _modelId = null;

export async function startModel(onProgress) {
  profiler.enable();

  const src = config.model.src ?? config.model.path;
  console.log(`\nCargando modelo desde:\n  ${typeof src === "object" ? src.name : src}\n`);

  _modelId = await loadModel({
    modelSrc:    src,
    modelType:   config.model.type,
    modelConfig: { ctx_size: config.model.ctxSize, tools: config.model.tools },
    onProgress:  onProgress ?? ((p) => {
      process.stdout.write(`\r  Cargando... ${p.percentage?.toFixed(0) ?? "?"}%`);
    }),
  });

  process.stdout.write("\r  Modelo cargado ✓                    \n");
  appendLog({ event: "model_load", modelId: _modelId });
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
