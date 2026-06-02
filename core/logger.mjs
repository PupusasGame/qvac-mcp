import fs   from "fs";
import path from "path";
import { config } from "../config/config.mjs";

// ── Escribir un evento al log ─
export function appendLog(data) {
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

// ── Leer todos los eventos del log ─
export function readLog() {
  try {
    const logFile = path.join(config.logs.dir, config.logs.file);
    if (!fs.existsSync(logFile)) return [];

    return fs.readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (err) {
    console.error("[log error]", err.message);
    return [];
  }
}

// ── Limpiar el log ─
export function clearLog() {
  try {
    const logFile = path.join(config.logs.dir, config.logs.file);
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
  } catch (err) {
    console.error("[log error]", err.message);
  }
}
