import http         from "http";
import { config }   from "../config/config.mjs";
import { appendLog } from "./logger.mjs";

// ── Estado interno de sesión 
let _sessionId  = null;   // mcp-session-id que devuelve el servidor
let _requestId  = 1;      // counter JSON-RPC
let _tools      = [];     // lista de tools descubiertas via tools/list

// ── Llamada base JSON-RPC sobre HTTP ─
function _call(method, params = {}, withId = true) {
  return new Promise((resolve, reject) => {

    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      ...(withId ? { id: _requestId++ } : {}),
    });

    const headers = {
      "Content-Type":   "application/json",
      "Accept":         "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(body),
    };

    if (_sessionId) headers["mcp-session-id"] = _sessionId;

    const options = {
      hostname: config.mcp.host,
      port:     config.mcp.port,
      path:     config.mcp.path,
      method:   "POST",
      headers,
    };

    const req = http.request(options, (res) => {

      if (res.headers["mcp-session-id"]) {
        _sessionId = res.headers["mcp-session-id"];
      }

      let raw = "";
      res.on("data",  (chunk) => (raw += chunk));
      res.on("end", () => {
        
        const match = raw.match(/^data:\s*(\{.*\})\s*$/m);

        if (match) {
          try {
            resolve(JSON.parse(match[1]));
          } catch (e) {
            reject(new Error(`Error parseando respuesta MCP: ${e.message}\nRaw: ${raw}`));
          }
        } else {
          
          resolve(null);
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`Error conectando al MCP server (${config.mcp.host}:${config.mcp.port}): ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

// ── Conectar e inicializar sesión ─

export async function connect() {
  
  const initRes = await _call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities:    {},
    clientInfo:      { name: "qvac-mcp-agent", version: config.ui.version },
  });

  if (initRes?.error) {
    throw new Error(`MCP initialize falló: ${initRes.error.message}`);
  }

  const serverInfo = initRes?.result?.serverInfo;
  console.log(`  MCP conectado: ${serverInfo?.name} v${serverInfo?.version}`);

  
  await _call("notifications/initialized", {}, false);

  
  const sessions = await callTool("session_manage", { op: "list" });

  if (!sessions?.sessions?.length) {
    throw new Error("No hay sesiones de Godot activas. Abre Godot con el plugin Godot AI.");
  }

  const sessionId = sessions.sessions[0].session_id;
  await callTool("session_activate", { session_id: sessionId });
  console.log(`  Sesión Godot activada: ${sessionId}`);

  
  await _discoverTools();

  appendLog({
    event:      "mcp_connect",
    server:     `${config.mcp.host}:${config.mcp.port}`,
    serverInfo,
    toolCount:  _tools.length,
    sessionId,
  });

  return { serverInfo, tools: _tools };
}

// ── Descubrir herramientas via tools/list ─

async function _discoverTools() {
  const res = await _call("tools/list", {});

  if (res?.result?.tools) {
    _tools = res.result.tools;
    console.log(`  Herramientas descubiertas: ${_tools.length}`);
  } else {
    console.warn("  No se pudieron descubrir herramientas via tools/list");
    _tools = [];
  }
}

// ── Ejecutar una herramienta ─
export async function callTool(name, args = {}) {
  const start = Date.now();

  const res = await _call("tools/call", { name, arguments: args });

  const durationMs = Date.now() - start;
  const content    = res?.result?.content?.[0]?.text;
  const isError    = res?.result?.isError ?? false;

  // Intentar parsear el resultado como JSON
  let parsed = content;
  if (typeof content === "string") {
    try { parsed = JSON.parse(content); } catch { parsed = content; }
  }

  appendLog({
    event:      "tool_call",
    tool:       name,
    args,
    result:     parsed,
    isError,
    durationMs,
  });

  if (isError) {
    // No lanzamos el error — lo retornamos para que el agente lo maneje
    // El modelo necesita saber qué falló para corregirse
    return { error: parsed, isError: true };
  }

  return parsed;
}

// ── Obtener lista de herramientas descubiertas ─

export function getTools() {
  return _tools;
}

// ── Obtener session-id actual ─
export function getSessionId() {
  return _sessionId;
}

// ── Desconectar ─
export function disconnect() {
  _sessionId = null;
  _requestId = 1;
  _tools     = [];
  appendLog({ event: "mcp_disconnect" });
}
