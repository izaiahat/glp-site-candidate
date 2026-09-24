// Build-time advance-width table for the wordmark typeface.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator defect): a provider with no logo asset rendered its name
// as raw text inside a fixed-size chip at a fixed 0.9rem. Long names ("Sprout
// Health") overflowed and broke across lines mid-word, so the chip looked
// broken on the compare page. Fixing it by hand-picking a smaller size only
// moves the break to the next long name.
//
// The fix has to be a MEASUREMENT: to auto-step a font size until the name
// provably fits, the build needs the real advance widths of the real typeface.
// This script measures them once, from the actual shipped Manrope woff2, with
// the actual weight the wordmark renders at, and writes them to
// `data/wordmark-font-metrics.json`. `src/provider-wordmark.mjs` then fits any
// name deterministically with no browser at build time.
//
//   node scripts/measure-wordmark-font-metrics.mjs            # rewrite the table
//   node scripts/measure-wordmark-font-metrics.mjs --check     # fail if stale
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "data/wordmark-font-metrics.json");

//: The wordmark renders at the display family, weight 800 (Manrope's variable
//: upper bound; `font-weight:900` clamps to it), which is what must be measured.
const FAMILY = "Manrope";
const WEIGHT = 800;
const EM = 100;
//: Latin-1 printable range: every character a provider display name can carry.
const CHARS = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCodePoint(0x20 + i))
  .concat(["É", "é", "í", "ñ", "ó", "ú", "à", "è", "’", "–", "—"]);

async function measure() {
  // The headed Chrome singleton uses a Unix socket below TMPDIR, which can
  // exceed sun_path under a scoped report root. Use the already-required
  // Playwright headless engine, without moving fixtures outside task scope.
  const browser = await chromium.launch({ headless: true, args: ["--font-render-hinting=none"] });
  try {
    const font = path.join(ROOT, "assets/fonts/manrope-latin-var.woff2");
    const fontBytes = await readFile(font);
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8">
<style>@font-face{font-family:"${FAMILY}";src:url("data:font/woff2;base64,${fontBytes.toString("base64")}") format("woff2-variations");font-weight:400 800;font-display:block}</style>
<pre id="out">pending</pre>
<script>
const chars = ${JSON.stringify(CHARS)};
(async () => {
  await document.fonts.load('${WEIGHT} ${EM}px "${FAMILY}"');
  await document.fonts.ready;
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = '${WEIGHT} ${EM}px "${FAMILY}"';
  const advances = {};
  for (const ch of chars) advances[ch] = Math.round(ctx.measureText(ch).width * 1000) / 1000;
  const probe = ctx.measureText("Sprout Health");
  document.getElementById("out").textContent = JSON.stringify({
    advances,
    kerned_probe: { text: "Sprout Health", width: Math.round(probe.width * 1000) / 1000 },
    ascent: Math.round(probe.fontBoundingBoxAscent * 1000) / 1000,
    descent: Math.round(probe.fontBoundingBoxDescent * 1000) / 1000,
  });
})();
</script>`);
    await page.waitForFunction(() => document.getElementById("out").textContent !== "pending", null, { timeout: 8000 });
    const raw = JSON.parse(await page.locator("#out").textContent());
    return raw;
  } finally {
    await browser.close();
  }
}

const raw = await measure();
const payload = {
  schema: "glp-wordmark-font-metrics-v1",
  family: FAMILY,
  weight: WEIGHT,
  em_units: EM,
  measured_by: "scripts/measure-wordmark-font-metrics.mjs (headless Chrome, shipped woff2)",
  // The sum of per-character advances is what the fitter can compute; the
  // kerned probe records how far a real shaped run drifts from that sum, so the
  // fitter's safety margin is measured rather than guessed.
  kerning_drift_ratio: Math.round(
    (raw.kerned_probe.width / Array.from(raw.kerned_probe.text)
      .reduce((sum, ch) => sum + (raw.advances[ch] ?? 0), 0)) * 10000) / 10000,
  kerned_probe: raw.kerned_probe,
  ascent_ratio: Math.round((raw.ascent / EM) * 10000) / 10000,
  descent_ratio: Math.round((raw.descent / EM) * 10000) / 10000,
  advances: raw.advances,
};
const body = JSON.stringify(payload, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const current = await readFile(OUT, "utf8").catch(() => "");
  if (current !== body) {
    console.error("wordmark_font_metrics_stale: run node scripts/measure-wordmark-font-metrics.mjs");
    process.exit(1);
  }
} else {
  await writeFile(OUT, body);
}
console.log(JSON.stringify({
  status: "PASS", family: FAMILY, weight: WEIGHT,
  characters: Object.keys(payload.advances).length,
  kerning_drift_ratio: payload.kerning_drift_ratio,
}));
