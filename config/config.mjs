import 'dotenv/config';
export const config = {

  // ── Modelo ─
  model: {
    // Ruta absoluta al archivo .gguf
    path: process.env.MODEL_PATH ?? "./modelo.gguf",

    // Tipo de modelo, contexto y tokens
    type: "llamacpp-completion",
    ctxSize: 4096,
    maxTokens: 512,
  },

  // ── MCP Server ─
  // Datos del servidor MCP.
  // Por defecto a Godot
  mcp: {
    host: "127.0.0.1",
    port: 8000,
    path: "/mcp",
  },

  // ── Logs de rendimiento ─

  logs: {
    dir: "./logs",
    file: "inference.jsonl",
  },

  // ── UI / identidad ─

  ui: {
    projectName: "QVAC MCP Agent",
    hashtag:     "#QvacMCP",
    version:     "0.1.0",
  },

};
