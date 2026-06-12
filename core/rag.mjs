// rag.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Capa RAG: da al agente conocimiento de la API de Godot y de las tools MCP
// recuperándolo bajo demanda, en vez de hardcodearlo en el system prompt.
//
// Flujo:
//   initRag()      → carga el modelo de embeddings; si el workspace no existe,
//                    ingiere el corpus (tool descriptions + Godot docs).
//   searchDocs(q)  → devuelve los topK fragmentos más relevantes a la consulta.
//   closeRag()     → cierra el workspace y descarga el modelo de embeddings.
// ─────────────────────────────────────────────────────────────────────────────

import {
  loadModel,
  unloadModel,
  ragIngest,
  ragSearch,
  ragListWorkspaces,
  ragCloseWorkspace,
} from "@qvac/sdk";

import { config }     from "../config/config.mjs";
import { allContractDocs } from "./tool-contracts.mjs";
import { appendLog }  from "./logger.mjs";
import { GODOT_DOCS } from "./godot-docs.mjs";
import { allModeDocs } from "./modes.mjs";

let _embModelId = null;
let _ready      = false;
let _lastSearch = [];   // diagnósticos de la última búsqueda RAG (para panel debug)

// Construye el corpus a ingerir. SOLO conocimiento NUESTRO y curado:
//   • contractDocs: la descripción curada de cada tool, por modo (de tool-contracts.mjs).
//   • modeDocs:     los ejemplos curados de cada modo (de modes.mjs), etiquetados [MODE:xxx].
// NO ingerimos el inputSchema/description CRUDO de Godot: es ruidoso y pobre, y es
// justo lo que tool-contracts.mjs reemplaza. Indexar el crudo ensuciaba el índice
// con ~40 docs genéricos ("params/node/path") que el embedder confundía con todo.
// Resultado: índice pequeño y limpio, todo del mismo vocabulario que usa el agente.
function _buildCorpus() {
  const contractDocs = allContractDocs();   // nuestras descripciones curadas, por modo
  const modeDocs     = allModeDocs();        // ejemplos curados, por modo

  const base = [...contractDocs, ...modeDocs];

  // Docs de clases Godot: conocimiento de apoyo opcional (sin prefijo de modo, se
  // conservan siempre en el filtro). Útiles para preguntas de API que no cubren
  // los contratos. Controlado por config.rag.includeGodotDocs.
  if (config.rag?.includeGodotDocs) {
    return [...base, ...GODOT_DOCS];
  }
  return base;
}

// Inicializa RAG. Idempotente: si el workspace ya existe, no re-ingiere.
export async function initRag(onProgress) {
  if (!config.rag?.enabled) return false;

  // 1. Cargar el modelo de embeddings (segundo modelo, junto al LLM).
  _embModelId = await loadModel({
    modelSrc:  config.rag.embeddingsSrc,
    modelType: config.rag.embeddingsType,
    onProgress: onProgress ?? ((p) =>
      process.stdout.write(`\r  Cargando embeddings... ${p.percentage?.toFixed(0) ?? "?"}%`)),
  });

  // 2. ¿Ya existe el workspace en disco? Si sí, no re-ingestamos.
  let exists = false;
  try {
    const workspaces = await ragListWorkspaces();
    exists = workspaces.some(w => w.name === config.rag.workspace);
  } catch { /* si falla el listado, intentamos ingerir igual */ }

  if (!exists) {
    const documents = _buildCorpus();
    appendLog({ event: "rag_ingest_start", workspace: config.rag.workspace, docCount: documents.length });

    await ragIngest({
      modelId:   _embModelId,
      workspace: config.rag.workspace,
      documents,
      chunk:     false,  // SIN trocear: cada tool es un documento íntegro.
                         // El chunking automático rompía las tools en pedazos
                         // que perdían el nombre y el contexto, degradando la
                         // recuperación. Cada tool trata un tema coherente, así
                         // que un documento = un embedding funciona mejor.
      onProgress: (stage, current, total) =>
        process.stdout.write(`\r  Ingiriendo docs [${stage}] ${current}/${total}   `),
    });

    appendLog({ event: "rag_ingest_done", workspace: config.rag.workspace, docCount: documents.length });
    process.stdout.write("\r  Documentación ingerida ✓                      \n");
  } else {
    appendLog({ event: "rag_workspace_reused", workspace: config.rag.workspace });
  }

  _ready = true;
  return true;
}

// Busca los fragmentos más relevantes para una consulta. Devuelve un array de
// strings (el contenido de cada fragmento). Si RAG no está listo o el workspace
// no existe, devuelve [] sin lanzar (ragSearch devuelve [] en ese caso).
export async function searchDocs(query, allowedTools = null, activeMode = null) {
  if (!_ready || !_embModelId) return [];

  try {
    // Si hay filtro de modo, pedimos más resultados antes de filtrar para no
    // quedarnos cortos tras descartar los que no son del modo.
    const baseTopK = config.rag.topK ?? 5;
    const fetchK   = allowedTools ? baseTopK * 4 : baseTopK;

    const results = await ragSearch({
      modelId:   _embModelId,
      workspace: config.rag.workspace,
      query,
      topK:      fetchK,
    });

    let raw = results ?? [];

    // Filtro de modo. En el corpus nuevo, TODO doc curado lleva el prefijo
    // "[MODE:<nombre>]" en su primera línea — tanto los contratos de tool
    // ("[MODE:input] CONTRACT input_map_manage:") como los ejemplos
    // ("[MODE:input] INPUT: Set up WASD..."). Los docs de Godot no llevan prefijo
    // (apoyo, siempre se conservan). Conservamos un doc si: es del modo activo,
    // O es doc de Godot sin prefijo.
    if (allowedTools) {
      raw = raw.filter(r => {
        const first = (r.content ?? "").split("\n")[0];
        const modeMatch = first.match(/^\[MODE:\s*(\S+?)\]/);
        if (modeMatch) {
          return activeMode ? modeMatch[1] === activeMode : true;
        }
        return true;   // sin prefijo de modo → doc de Godot, se conserva
      }).slice(0, baseTopK);
    }

    const chunks = raw.map(r => r.content).filter(Boolean);

    const diagnostics = raw.map((r, i) => ({
      rank:    i + 1,
      score:   r.score ?? r.similarity ?? r.distance ?? null,
      preview: (r.content ?? "").slice(0, 120),
    }));

    _lastSearch = diagnostics;   // para el panel de debug en consola

    appendLog({
      event:     "rag_search",
      query,
      mode:      allowedTools ? "filtered" : "all",
      hits:      chunks.length,
      retrieved: diagnostics,
    });

    return chunks;
  } catch (err) {
    appendLog({ event: "rag_search_error", query, error: err?.message ?? String(err) });
    return [];
  }
}

// Devuelve los diagnósticos (rank, score, preview) de la última búsqueda RAG,
// para que el REPL pueda mostrar un resumen compacto en modo debug.
export function getLastSearch() { return _lastSearch; }

export function isRagReady() { return _ready; }

// Limpia: cierra el workspace y descarga el modelo de embeddings.
export async function closeRag() {
  if (!config.rag?.enabled) return;
  try {
    await ragCloseWorkspace({ workspace: config.rag.workspace });
  } catch { /* silencioso */ }
  try {
    if (_embModelId) await unloadModel({ modelId: _embModelId });
  } catch { /* silencioso */ }
  _embModelId = null;
  _ready      = false;
}
