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
import { getTools }   from "./mcp.mjs";
import { appendLog }  from "./logger.mjs";
import { GODOT_DOCS } from "./godot-docs.mjs";
import { allModeDocs } from "./modes.mjs";

let _embModelId = null;
let _ready      = false;
let _lastSearch = [];   // diagnósticos de la última búsqueda RAG (para panel debug)

// Construye el corpus a ingerir: descripciones COMPLETAS de las tools MCP
// (sin el truncado a 600 que aplica el agente) + el corpus curado de Godot.
function _buildCorpus() {
  const tools = getTools();

  const toolDocs = tools.map(t => {
    const schema = t.inputSchema ? JSON.stringify(t.inputSchema) : "{}";
    const desc   = t.description ?? "";
    // El nombre de la tool va al frente Y repetido en una línea de propósito,
    // para que el embedding capture claramente "de qué trata" este documento.
    // Sin chunking, cada tool es UN documento completo e indivisible.
    return `TOOL: ${t.name}\nPURPOSE: ${t.name} — ${desc.split("\n")[0]}\n\nFULL DESCRIPTION:\n${desc}\n\nPARAMETERS SCHEMA: ${schema}`;
  });

  // Docs específicos por modo (casos curados, etiquetados [MODE:xxx]).
  const modeDocs = allModeDocs();

  // Los docs curados de clases Godot son opcionales (config.rag.includeGodotDocs).
  const base = [...toolDocs, ...modeDocs];
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
export async function searchDocs(query, allowedTools = null) {
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

    // Filtro de modo: cada documento empieza con "TOOL: <nombre>". Conservamos
    // solo los de tools permitidas en el modo activo. Los docs de Godot (que no
    // empiezan con TOOL:) se conservan siempre como conocimiento de apoyo.
    if (allowedTools) {
      raw = raw.filter(r => {
        const first = (r.content ?? "").split("\n")[0];
        const m = first.match(/^TOOL:\s*(\S+)/);
        if (!m) return true;                       // no es un doc de tool → conservar
        return allowedTools.includes(m[1]);        // es de tool → solo si está permitida
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
