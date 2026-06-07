// main.mjs
// ─────────────────────────────────────────────────────────────────────────────
// QVAC MCP Agent — REPL interactivo de terminal
// ─────────────────────────────────────────────────────────────────────────────

import readline from "readline";
import chalk    from "chalk";
import figlet   from "figlet";
import boxen    from "boxen";

import { startModel, stopModel, getModelId } from "./core/model.mjs";
import { connect, callTool, disconnect }      from "./core/mcp.mjs";
import { runInstruction, clearHistory, setThinkMode, getThinkMode, requestCancel, setMode, getMode, setDebug, getDebug } from "./core/agent.mjs";
import { MODES, ACTIVE_MODES }                from "./core/modes.mjs";
import { initRag, closeRag }                  from "./core/rag.mjs";
import { config }                             from "./config/config.mjs";

// ── Estado global ─────────────────────────────────────────────────────────────
let _isInferring  = false;   // true mientras el agente está procesando
let _currentRunId = null;    // requestId activo para cancelar
let _rl           = null;    // readline interface global
let _isClosing    = false;   // true cuando el agente se está cerrando

// ── Status bar fija en la parte superior ─────────────────────────────────────
function drawStatusBar(status = "listo") {
  const model   = config.model.src?.name ?? "custom";
  const mcp     = `${config.mcp.host}:${config.mcp.port}`;
  const think   = getThinkMode() ? "think" : "fast";
  const modeName = getMode();
  const cmds    = "/mode /debug /escena /think /nothink /reset /ayuda /salir";
  const statusColor = status === "listo"
    ? chalk.green("● listo")
    : status === "pensando"
    ? chalk.yellow("⠸ pensando...")
    : chalk.red("⚠ " + status);

  const bar =
    chalk.bgCyan.black.bold(" QVAC MCP ") +
    chalk.bgBlack.white(` modelo: ${chalk.bold(model)} `) +
    chalk.bgBlack.gray(`│ mcp: ${mcp} `) +
    chalk.bgBlack.white(`│ modo: ${chalk.bold.magenta(modeName)} `) +
    chalk.bgBlack.white(`│ think: ${chalk.bold(think === "think" ? chalk.yellow("on") : chalk.green("off"))} `) +
    chalk.bgBlack.white(`│ ${statusColor} `) +
    chalk.bgBlack.gray(`│ ${cmds} `);

  process.stdout.write("\x1b[s");           // guardar cursor
  process.stdout.write("\x1b[1;1H");        // ir a línea 1, columna 1
  process.stdout.write("\x1b[2K");          // limpiar línea
  process.stdout.write(bar);
  process.stdout.write("\x1b[u");           // restaurar cursor
}

// ── Banner ASCII ──────────────────────────────────────────────────────────────
function showBanner() {
  console.clear();
  process.stdout.write("\n");
  const title = figlet.textSync("QVAC MCP", { font: "Standard" });
  console.log(chalk.cyan(title));
  console.log(chalk.dim("  Local AI Agent for MCP Servers · QVAC Hackathon 2026"));
  console.log(chalk.dim(`  ${config.ui.hashtag}  ·  Apache-2.0\n`));
}

// ── Spinner animado ───────────────────────────────────────────────────────────
const FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let _spinnerTimer = null;
let _spinnerIdx   = 0;

function startSpinner() {
  _spinnerIdx = 0;
  _spinnerTimer = setInterval(() => {
    process.stdout.write(
      `\r ${chalk.cyan(FRAMES[_spinnerIdx++ % FRAMES.length])} ${chalk.dim("pensando...")}   `
    );
  }, 80);
}

function stopSpinner() {
  if (_spinnerTimer) {
    clearInterval(_spinnerTimer);
    _spinnerTimer = null;
    process.stdout.write("\r" + " ".repeat(30) + "\r");
  }
}

// ── Separador visual ──────────────────────────────────────────────────────────
function printSeparator() {
  const w = process.stdout.columns || 80;
  console.log(chalk.dim("─".repeat(Math.min(w, 80))));
}

// ── Comandos especiales ───────────────────────────────────────────────────────
async function handleCommand(cmd) {
  const c = cmd.trim().toLowerCase();

  if (c === "/salir" || c === "/exit" || c === "/quit") {
    console.log(chalk.dim("\n Cerrando agente..."));
    _rl.close();
    disconnect();
    await closeRag();
    await stopModel();
    process.exit(0);
  }

  if (c === "/escena" || c === "/scene") {
    startSpinner();
    const h = await callTool("scene_get_hierarchy", { depth: 4, limit: 60 });
    stopSpinner();
    if (h?.nodes) {
      printSeparator();
      console.log(chalk.bold.cyan(" Jerarquía actual:"));
      h.nodes.forEach(n =>
        console.log(
          chalk.dim("  " + n.path.padEnd(35)) +
          chalk.yellow("(" + n.type + ")")
        )
      );
      printSeparator();
    }
    return;
  }

  if (c === "/limpiar" || c === "/clear") {
    showBanner();
    drawStatusBar("listo");
    return;
  }

  if (c === "/debug" || c === "/capas") {
    const on = !getDebug();
    setDebug(on);
    if (on) {
      console.log(chalk.green(" ✓ Panel de capas ACTIVADO.") + chalk.dim(" Verás modo, tools y RAG antes de cada respuesta.\n"));
    } else {
      console.log(chalk.dim(" ✓ Panel de capas desactivado.\n"));
    }
    drawStatusBar("listo");
    return;
  }

  if (c === "/think") {
    setThinkMode(true);
    console.log(chalk.green(" ✓ Modo thinking ACTIVADO.") + chalk.dim(" El modelo razonará (más lento, mejor en tareas complejas).\n"));
    return;
  }

  if (c.startsWith("/modo") || c.startsWith("/mode")) {
    const arg = c.split(/\s+/)[1];   // "/modo transform" → "transform"
    if (!arg) {
      // Sin argumento: mostrar modos disponibles y el actual.
      console.log(chalk.bold.cyan("\n Modos disponibles:"));
      for (const m of ACTIVE_MODES) {
        const marker = m === getMode() ? chalk.green(" ● ") : chalk.dim(" ○ ");
        console.log(marker + chalk.white(m.padEnd(12)) + chalk.dim(MODES[m].description));
      }
      console.log(chalk.dim("\n Uso: /mode <name>  (e.g. /mode material)\n"));
      return;
    }
    if (setMode(arg)) {
      console.log(chalk.green(` ✓ Modo activo: ${MODES[arg].label}.`) + chalk.dim(` ${MODES[arg].description}\n`));
      drawStatusBar("listo");
    } else {
      console.log(chalk.red(` ✗ Modo desconocido: "${arg}".`) + chalk.dim(` Disponibles: ${ACTIVE_MODES.join(", ")}\n`));
    }
    return;
  }

  if (c === "/nothink") {
    setThinkMode(false);
    console.log(chalk.green(" ✓ Modo thinking DESACTIVADO.") + chalk.dim(" Respuestas rápidas (/no_think).\n"));
    return;
  }

  if (c === "/reset") {
    clearHistory();
    console.log(chalk.green(" ✓ Historial limpiado.\n"));
    return;
  }

  if (c === "/ayuda" || c === "/help") {
    printSeparator();
    console.log(
      chalk.bold.cyan(" Comandos disponibles:\n") +
      chalk.cyan("  /mode    ") + chalk.dim("change domain: transform, material, animation, ui, script, scene (e.g. /mode material)\n") +
      chalk.cyan("  /debug   ") + chalk.dim("show/hide the layers panel (mode, tools, RAG) before each answer\n") +
      chalk.cyan("  /escena  ") + chalk.dim("jerarquía actual de Godot\n") +
      chalk.cyan("  /think   ") + chalk.dim("activar razonamiento del modelo (lento)\n") +
      chalk.cyan("  /nothink ") + chalk.dim("desactivar razonamiento (rápido, por defecto)\n") +
      chalk.cyan("  /reset   ") + chalk.dim("limpiar historial de conversación\n") +
      chalk.cyan("  /limpiar ") + chalk.dim("limpiar pantalla\n") +
      chalk.cyan("  /ayuda   ") + chalk.dim("este menú\n") +
      chalk.cyan("  /salir   ") + chalk.dim("cerrar el agente\n") +
      chalk.dim("\n  Ctrl+C durante inferencia → cancela sin salir")
    );
    printSeparator();
    return;
  }

  console.log(chalk.yellow(` Comando desconocido: ${cmd}`));
  console.log(chalk.dim(" Escribe /ayuda para ver los comandos.\n"));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  showBanner();

  console.log(chalk.bold(" Iniciando...\n"));
  try {
    await startModel((p) => {
      process.stdout.write(
        "\r " + chalk.cyan("⠸") + " Cargando modelo... " +
        chalk.bold((p.percentage?.toFixed(0) ?? "??") + "%   ")
      );
    });
    process.stdout.write("\r" + " ".repeat(50) + "\r");
    console.log(chalk.green(" ✓ Modelo cargado"));
  } catch (err) {
    console.error(chalk.red(" ✗ Error cargando modelo: " + err.message));
    process.exit(1);
  }

  try {
    const { serverInfo, tools } = await connect();
    console.log(chalk.green(
      " ✓ " + serverInfo.name + " v" + serverInfo.version +
      " conectado — " + tools.length + " herramientas"
    ));
  } catch (err) {
    console.error(chalk.red(" ✗ Error conectando al MCP: " + err.message));
    console.error(chalk.dim("   ¿Está Godot abierto con el plugin activo?"));
    await stopModel();
    process.exit(1);
  }

  // Inicializar RAG (carga embeddings + ingiere docs la primera vez).
  // Best-effort: si falla, el agente sigue funcionando sin RAG.
  if (config.rag?.enabled) {
    try {
      console.log(chalk.dim("\n Inicializando RAG (docs de Godot + tools)..."));
      await initRag();
      console.log(chalk.green(" ✓ RAG listo"));
    } catch (err) {
      console.error(chalk.yellow(" ⚠ RAG no disponible: " + err.message));
      console.error(chalk.dim("   El agente seguirá sin recuperación de docs."));
    }
  }

  console.log(chalk.dim("\n Modelo: " + (config.model.src?.name ?? "custom")));
  console.log(chalk.dim(" MCP:    " + config.mcp.host + ":" + config.mcp.port));
  console.log(chalk.dim(" Logs:   " + config.logs.dir + "/" + config.logs.file));

  printSeparator();
  console.log(chalk.dim(
    " Escribe instrucciones en lenguaje natural. " +
    chalk.cyan("Ctrl+C") + chalk.dim(" durante inferencia cancela sin salir.")
  ));
  printSeparator();

  _rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    terminal: true,
  });

  // ── Ctrl+C: cancelar inferencia O salir ──────────────────────────────────
  _rl.on("SIGINT", async () => {
    if (_isInferring) {
      // Pedimos cancelación al agente: terminará la iteración actual y no
      // empezará otra, volviendo limpio al prompt. (La inferencia en curso
      // puede tardar unos segundos más en cerrar; es esperado.)
      requestCancel();
      stopSpinner();
      process.stdout.write("\n");
      console.log(chalk.yellow(" ⚠ Cancelando... (terminando paso actual)"));
      _isInferring = false;
      // No re-imprimimos el prompt aquí: runInstruction terminará y el
      // flujo normal de prompt() se encargará. Evita prompts duplicados.
    } else {
      console.log(chalk.dim("\n\n Cerrando agente..."));
      _isClosing = true;          // evita que prompt() se vuelva a invocar
      _rl.close();
      disconnect();
      await closeRag();
      await stopModel();
      process.exit(0);
    }
  });

  const prompt = () => {
    if (_isClosing || !_rl) return;   // no pedir input si ya cerramos
    _rl.question(chalk.bold.cyan("\nyou › "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.startsWith("/")) {
        await handleCommand(trimmed);
        prompt();
        return;
      }

      _isInferring = true;
      let stopped  = false;

      drawStatusBar("pensando");
      startSpinner();

      try {
        const respuesta = await runInstruction(
          trimmed,
          (token) => {
            if (!stopped) {
              stopSpinner();
              stopped = true;
              process.stdout.write("\n");
            }
            process.stdout.write(chalk.white(token));
          },
          (toolName, args) => {
            if (!stopped) {
              stopSpinner();
              stopped = true;
            }
            const short = JSON.stringify(args ?? {}).slice(0, 70);
            console.log(
              chalk.yellow("\n  → " + toolName.padEnd(25)) +
              chalk.dim(short)
            );
          },
          // onDebug: panel compacto de capas (solo si /debug está activo)
          (info) => {
            stopSpinner();
            const rag = info.ragTop.length
              ? info.ragTop.map(r => `${chalk.green(r.score)} ${chalk.dim(r.name)}`).join("  ")
              : chalk.dim("(none)");
            console.log(
              chalk.bgMagenta.black.bold(" CAPAS ") +
              chalk.bgBlack.white(` mode: ${chalk.bold(info.mode)} `) +
              chalk.bgBlack.gray(`│ think: ${info.think} `) +
              chalk.bgBlack.white(`│ tools: ${info.toolCount} `) +
              chalk.bgBlack.white(`│ RAG: ${info.ragHits} hits `)
            );
            console.log(chalk.dim("        RAG top: ") + rag);
          }
        );

        if (!stopped) stopSpinner();

        if (respuesta) {
          printSeparator();
          console.log(chalk.green(" ✓ ") + chalk.white(respuesta));
          printSeparator();
        }

      } catch (err) {
        if (!stopped) stopSpinner();
        if (!err.message?.includes("cancel")) {
          console.error(chalk.red("\n ✗ Error: " + err.message));
        }
      }

      _isInferring  = false;
      _currentRunId = null;
      drawStatusBar("listo");
      prompt();
    });
  };

  drawStatusBar("listo");
  prompt();
}

main().catch(async (err) => {
  console.error(chalk.red("\nError fatal: " + err.message));
  disconnect();
  await closeRag();
  await stopModel();
  process.exit(1);
});
