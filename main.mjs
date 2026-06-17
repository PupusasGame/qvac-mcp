#!/usr/bin/env node
// main.mjs
// ─────────────────────────────────────────────────────────────────────────────
// QVAC MCP Agent — interactive terminal REPL
// ─────────────────────────────────────────────────────────────────────────────

import readline from "readline";
import chalk    from "chalk";
import figlet   from "figlet";
import boxen    from "boxen";

import { theme } from "./ui/theme.mjs";

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

// ── Fixed status bar at the top ──────────────────────────────────────────────
function drawStatusBar(status = "ready") {
  const model    = config.model.src?.name ?? "custom";
  const mcp      = `${config.mcp.host}:${config.mcp.port}`;
  const think    = getThinkMode() ? "think" : "fast";
  const modeName = getMode();
  const cmds     = "/mode /debug /scene /think /nothink /reset /help /exit";
  const statusColor = status === "ready"
    ? theme.ok("● ready")
    : status === "thinking"
    ? theme.warn("⠸ QVAC running...")
    : theme.error("⚠ " + status);

  const bar =
    chalk.bgRgb(0, 200, 255).black.bold(" QVAC MCP ") +
    chalk.bgBlack.white(` model: ${chalk.bold(model)} `) +
    chalk.bgBlack.gray(`│ mcp: ${mcp} `) +
    chalk.bgBlack.white(`│ `) + chalk.bgRgb(16, 220, 120).black.bold(` MODE: ${modeName.toUpperCase()} `) + chalk.bgBlack.white(` `) +
    chalk.bgBlack.white(`│ think: ${chalk.bold(think === "think" ? theme.warn("on") : theme.ok("off"))} `) +
    chalk.bgBlack.white(`│ ${statusColor} `) +
    chalk.bgBlack.gray(`│ ${cmds} `);

  process.stdout.write("\x1b[s");           // save cursor
  process.stdout.write("\x1b[1;1H");        // go to line 1, col 1
  process.stdout.write("\x1b[2K");          // clear line
  process.stdout.write(bar);
  process.stdout.write("\x1b[u");           // restore cursor
}

// ── ASCII banner ──────────────────────────────────────────────────────────────
function showBanner() {
  console.clear();
  process.stdout.write("\n");
  const title = figlet.textSync("QVAC MCP", { font: "Standard" });
  console.log(theme.brandBlock(title));
  console.log(theme.dim("  Local AI Agent for MCP Servers · QVAC Hackathon 2026"));
  console.log(theme.dim(`  ${config.ui.hashtag}  ·  Apache-2.0\n`));
}

// ── Animated spinner (with timer + cycling brand colors) ─────────────────────
const FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let _spinnerTimer = null;
let _spinnerIdx   = 0;
let _spinnerStart = 0;

function startSpinner() {
  _spinnerIdx   = 0;
  _spinnerStart = Date.now();
  _spinnerTimer = setInterval(() => {
    const i = _spinnerIdx++;
    const elapsed = ((Date.now() - _spinnerStart) / 1000).toFixed(1);
    const frame = theme.brand(FRAMES[i % FRAMES.length]);
    // Brand badge: announce it's the QVAC SDK answering locally — green badge,
    // so a viewer (and the judges) see this is local QVAC inference, not the cloud.
    const badge = chalk.bgRgb(16, 220, 120).black.bold(" QVAC SDK ");
    process.stdout.write(
      `\r ${frame} ${badge} ${theme.dim("running locally")} ${theme.teal(elapsed + "s")}   `
    );
  }, 80);
}

function stopSpinner() {
  if (_spinnerTimer) {
    clearInterval(_spinnerTimer);
    _spinnerTimer = null;
    process.stdout.write("\r" + " ".repeat(50) + "\r");
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

  if (c === "/exit" || c === "/quit") {
    console.log(theme.dim("\n Shutting down agent..."));
    _rl.close();
    disconnect();
    await closeRag();
    await stopModel();
    process.exit(0);
  }

  if (c === "/scene") {
    startSpinner();
    const h = await callTool("scene_get_hierarchy", { depth: 4, limit: 60 });
    stopSpinner();
    if (h?.nodes) {
      printSeparator();
      console.log(chalk.bold.cyan(" Current scene hierarchy:"));
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

  if (c === "/clear") {
    showBanner();
    drawStatusBar("ready");
    return;
  }

  if (c === "/debug") {
    const on = !getDebug();
    setDebug(on);
    if (on) {
      console.log(chalk.green(" ✓ Layers panel ENABLED.") + chalk.dim(" You will see mode, tools and RAG before each answer.\n"));
    } else {
      console.log(chalk.dim(" ✓ Layers panel disabled.\n"));
    }
    drawStatusBar("ready");
    return;
  }

  if (c === "/think") {
    setThinkMode(true);
    console.log(chalk.green(" ✓ Thinking mode ENABLED.") + chalk.dim(" The model will reason (slower, better for complex tasks).\n"));
    return;
  }

  if (c.startsWith("/modo") || c.startsWith("/mode")) {
    const arg = c.split(/\s+/)[1];   // "/modo transform" → "transform"
    if (!arg) {
      // Sin argumento: mostrar modos disponibles y el actual.
      console.log(chalk.bold.cyan("\n Available modes:"));
      for (const m of ACTIVE_MODES) {
        const marker = m === getMode() ? chalk.green(" ● ") : chalk.dim(" ○ ");
        console.log(marker + chalk.white(m.padEnd(12)) + chalk.dim(MODES[m].description));
      }
      console.log(chalk.dim("\n Usage: /mode <name>  (e.g. /mode material)\n"));
      return;
    }
    if (setMode(arg)) {
      console.log(chalk.green(` ✓ Active mode: ${MODES[arg].label}.`) + chalk.dim(` ${MODES[arg].description}\n`));
      drawStatusBar("ready");
    } else {
      console.log(chalk.red(` ✗ Unknown mode: "${arg}".`) + chalk.dim(` Available: ${ACTIVE_MODES.join(", ")}\n`));
    }
    return;
  }

  if (c === "/nothink") {
    setThinkMode(false);
    console.log(chalk.green(" ✓ Thinking mode DISABLED.") + chalk.dim(" Fast responses (/no_think).\n"));
    return;
  }

  if (c === "/reset") {
    clearHistory();
    console.log(chalk.green(" ✓ History cleared.\n"));
    return;
  }

  if (c === "/help") {
    printSeparator();
    console.log(
      chalk.bold.cyan(" Available commands:\n") +
      chalk.cyan("  /mode    ") + chalk.dim("change domain: transform, material, animation, ui, script, scene (e.g. /mode material)\n") +
      chalk.cyan("  /debug   ") + chalk.dim("show/hide the layers panel (mode, tools, RAG) before each answer\n") +
      chalk.cyan("  /scene   ") + chalk.dim("current Godot scene hierarchy\n") +
      chalk.cyan("  /think   ") + chalk.dim("enable model reasoning (slower)\n") +
      chalk.cyan("  /nothink ") + chalk.dim("disable reasoning (fast, default)\n") +
      chalk.cyan("  /reset   ") + chalk.dim("clear conversation history\n") +
      chalk.cyan("  /clear   ") + chalk.dim("clear the screen\n") +
      chalk.cyan("  /help    ") + chalk.dim("this menu\n") +
      chalk.cyan("  /exit    ") + chalk.dim("shut down the agent\n") +
      chalk.dim("\n  Ctrl+C during inference → cancels without exiting")
    );
    printSeparator();
    return;
  }

  console.log(chalk.yellow(` Unknown command: ${cmd}`));
  console.log(chalk.dim(" Type /help to see commands.\n"));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  showBanner();

  console.log(chalk.bold(" Starting up...\n"));
  try {
    await startModel((p) => {
      process.stdout.write(
        "\r " + chalk.cyan("⠸") + " Loading model... " +
        chalk.bold((p.percentage?.toFixed(0) ?? "??") + "%   ")
      );
    });
    process.stdout.write("\r" + " ".repeat(50) + "\r");
    console.log(chalk.green(" ✓ Model loaded"));
  } catch (err) {
    console.error(chalk.red(" ✗ Error loading model: " + err.message));
    process.exit(1);
  }

  try {
    const { serverInfo, tools } = await connect();
    console.log(chalk.green(
      " ✓ " + serverInfo.name + " v" + serverInfo.version +
      " connected — " + tools.length + " tools"
    ));
  } catch (err) {
    console.error(chalk.red(" ✗ Error connecting to MCP: " + err.message));
    console.error(chalk.dim("   Is Godot open with the plugin active?"));
    await stopModel();
    process.exit(1);
  }

  // Inicializar RAG (carga embeddings + ingiere docs la primera vez).
  // Best-effort: si falla, el agente sigue funcionando sin RAG.
  if (config.rag?.enabled) {
    try {
      console.log(chalk.dim("\n Initializing RAG (Godot docs + tips)..."));
      await initRag();
      console.log(chalk.green(" ✓ RAG ready"));
    } catch (err) {
      console.error(chalk.yellow(" ⚠ RAG unavailable: " + err.message));
      console.error(chalk.dim("   The agent will continue without doc retrieval."));
    }
  }

  console.log(chalk.dim("\n Model: " + (config.model.src?.name ?? "custom")));
  console.log(chalk.dim(" MCP:    " + config.mcp.host + ":" + config.mcp.port));
  console.log(chalk.dim(" Logs:   " + config.logs.dir + "/" + config.logs.file));

  printSeparator();
  console.log(chalk.dim(
    " Type instructions in natural language. " +
    chalk.cyan("Ctrl+C") + chalk.dim(" cancels during inference without exiting.")
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
      console.log(theme.dim("\n\n Shutting down agent..."));
      _isClosing = true;          // evita que prompt() se vuelva a invocar
      _rl.close();
      disconnect();
      await closeRag();
      await stopModel();
      process.exit(0);
    }
  });

  const prompt = () => {
    if (_isClosing || !_rl) return;   // don't ask for input if already closing
    const modeLabel = theme.green(`[mode ${getMode()}]`);
    _rl.question(`\n${modeLabel} ${chalk.bold.cyan("you ›")} `, async (input) => {
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

      drawStatusBar("thinking");
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
          // onDebug: compact layers panel (only when /debug is active)
          (info) => {
            stopSpinner();
            const rag = info.ragTop.length
              ? info.ragTop.map(r => `${chalk.green(r.score)} ${chalk.dim(r.name)}`).join("  ")
              : chalk.dim("(none)");
            console.log(
              chalk.bgMagenta.black.bold(" LAYERS ") +
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
      drawStatusBar("ready");
      prompt();
    });
  };

  drawStatusBar("ready");
  prompt();
}

main().catch(async (err) => {
  console.error(chalk.red("\nError fatal: " + err.message));
  disconnect();
  await closeRag();
  await stopModel();
  process.exit(1);
});
