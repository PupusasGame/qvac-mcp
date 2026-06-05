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
  },
  mcp: {
    host: "127.0.0.1",
    port: 8000,
    path: "/mcp",
  },
  rag: {
    enabled:        true,
    embeddingsSrc:  EMBEDDINGGEMMA_300M_Q8_0,  // 2048 tokens ctx; 
    embeddingsType: "llamacpp-embedding",      
    workspace:      "godot-docs-v2",   // v2: re-ingesta con EmbeddingGemma + sin chunking
    topK:           5,
    includeGodotDocs: false, 
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
