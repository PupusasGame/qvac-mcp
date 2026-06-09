import 'dotenv/config';

import { QWEN3_8B_INST_Q4_K_M, QWEN3_1_7B_INST_Q4, EMBEDDINGGEMMA_300M_Q8_0 } from "@qvac/sdk";

export const config = {
  model: {
    src: process.env.QVAC_MODEL === "small" 
      ? QWEN3_1_7B_INST_Q4 
      : QWEN3_8B_INST_Q4_K_M,          
    type:     "llamacpp-completion",
    ctxSize:  8192,
    maxTokens: 2048,
    tools:    true,    
    
    // ── TurboQuant: compresión del KV-cache (SDK 0.12.0+) ──────────────
    // Reduce hasta 5x la memoria del KV-cache. Activable con CUALQUIER
    // modelo GGUF (8B, 20B, etc). Útil sobre todo cuando el contexto crece
    // y satura la VRAM (la degradación de velocidad que vimos en sesiones
    // largas). Requiere Vulkan (NVIDIA/AMD/Intel en Linux) y SDK >= 0.12.0.
    // Para DESACTIVARlo, comenta estas dos líneas.
    //cacheTypeK: "tbq4_0",
    //cacheTypeV: "pq4_0",              
  },
  mcp: {
    host: "127.0.0.1",
    port: 8000,
    path: "/mcp",
  },
  rag: {
    enabled:        true,
    embeddingsSrc:  EMBEDDINGGEMMA_300M_Q8_0,  // 2048 tokens ctx; ATADO al workspace
    embeddingsType: "llamacpp-embedding",       // nombre nuevo (evita el warning de alias)
    workspace:      "godot-docs-v7",   // v2: re-ingesta con EmbeddingGemma + sin chunking
    topK:           5,
    includeGodotDocs: true,   // primer test: solo tools. Poner true para añadir docs curados.
  },
  logs: {
    dir:  "./logs",
    file: "inference.jsonl",
  },
  ui: {
    projectName: "QVAC MCP Agent",
    hashtag:     "#QvacMCP",
    version:     "0.1.0",
  },
};
