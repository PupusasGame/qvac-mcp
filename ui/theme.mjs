// ui/theme.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Central theme for the QVAC MCP console: palette, brand gradient, and small
// color helpers. Everything here uses chalk 24-bit truecolor (no extra deps).
// Keeping it in one module means the banner, spinner and status bar all share
// the same green→cyan identity.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from "chalk";

// ── Brand palette ────────────────────────────────────────────────────────────
// The QVAC MCP identity runs from a fresh green to a bright cyan/sky blue.
export const palette = {
  green:  [ 16, 220, 120 ],   // #10dc78  — gradient start
  teal:   [  0, 210, 180 ],   // #00d2b4  — midpoint
  cyan:   [  0, 200, 255 ],   // #00c8ff  — gradient end (sky blue)
  dim:    [ 110, 120, 130 ],  // muted gray for secondary text
  warn:   [ 240, 190,  70 ],  // amber for "thinking"/warnings
  error:  [ 240,  90,  90 ],  // red for errors
  ok:     [ 16, 220, 120 ],   // green for success
};

// rgb helper — chalk truecolor for a [r,g,b] triple
export const rgb = ([r, g, b]) => chalk.rgb(r, g, b);

// Linear interpolation between two [r,g,b] colors, t in 0..1
function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Sample the brand gradient (green → teal → cyan) at t in 0..1.
export function gradientAt(t) {
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  if (t <= 0.5) return lerp(palette.green, palette.teal, t / 0.5);
  return lerp(palette.teal, palette.cyan, (t - 0.5) / 0.5);
}

// Apply the brand gradient horizontally across a single line of text.
export function gradientLine(text) {
  const chars = [...text];
  const n = Math.max(chars.length - 1, 1);
  return chars
    .map((ch, i) => (ch === " " ? ch : rgb(gradientAt(i / n))(ch)))
    .join("");
}

// Apply the brand gradient to a multi-line block (e.g. figlet output),
// sweeping left→right consistently across every line.
export function gradientBlock(block) {
  const lines = block.split("\n");
  const width = Math.max(...lines.map((l) => l.length), 1);
  return lines
    .map((line) => {
      const chars = [...line];
      return chars
        .map((ch, i) => (ch === " " ? ch : rgb(gradientAt(i / (width - 1 || 1)))(ch)))
        .join("");
    })
    .join("\n");
}

// ── Named style helpers ──────────────────────────────────────────────────────
export const theme = {
  green:  rgb(palette.green),
  teal:   rgb(palette.teal),
  cyan:   rgb(palette.cyan),
  dim:    rgb(palette.dim),
  warn:   rgb(palette.warn),
  error:  rgb(palette.error),
  ok:     rgb(palette.ok),
  brand:  gradientLine,
  brandBlock: gradientBlock,
};

export default theme;
