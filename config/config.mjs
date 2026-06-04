import 'dotenv/config';
import { QWEN3_8B_INST_Q4_K_M } from "@qvac/sdk";

export const config = {
  model: {
    src:  QWEN3_8B_INST_Q4_K_M,    // ← modelo oficial QVAC con tool calling
    type:     "llamacpp-completion",
    ctxSize:  4096,
    maxTokens: 2048,
    tools:    true,                  
  },
  mcp: {
    host: "127.0.0.1",
    port: 8000,
    path: "/mcp",
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
