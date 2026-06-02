import { loadModel, unloadModel, profiler } from "@qvac/sdk";
import { config }                           from "../config/config.mjs";
import fs                                   from "fs";
import path                                 from "path";

let _modelId = null;

// ── Cargar modelo ─
export async function startModel(onProgress) {

  // Activar el profiler antes de cargar.
  // Sin opciones — enable() acepta ProfilerRuntimeOptions opcional.
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

  _appendLog({ event: "model_load", modelPath: config.model.path, modelId: _modelId });

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

  const summary    = profiler.exportSummary();
  const jsonExport = profiler.exportJSON();

  _appendLog({
    event:          "model_unload",
    modelId:        _modelId,
    profilerSummary: summary,
    profilerJSON:   jsonExport,
  });

  profiler.disable();

  await unloadModel({ modelId: _modelId });
  _modelId = null;

  console.log("\nModelo descargado. RAM liberada.");
}

// ── Log interno ─
//Una línea JSON por evento.
function _appendLog(data) {
  try {
    const logDir  = config.logs.dir;
    const logFile = path.join(logDir, config.logs.file);

    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const line = JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n";
    fs.appendFileSync(logFile, line, "utf8");
  } catch (err) {
    console.error("[log error]", err.message);
  }
}
