// Rasterize the brand favicon SVG into the PNG fallback set the shell links.
//
// renderer:shell (ULTRACODE 2026-08-21). The shared head links
// /assets/brand/favicon.svg first (modern browsers) and falls back to PNGs for
// legacy tab icons, Apple touch, and large-icon consumers. No image library is
// installed on this host (no sharp/resvg/cairosvg/rsvg-convert), but the repo
// already carries Playwright + a pinned Chromium for its browser tests, so the
// rasterization uses that engine: deterministic for a given Chromium build,
// fully local, no network.
//
// Outputs (committed alongside the SVG sources in assets/brand/, copied to
// public/assets/brand/ by build-staging's brand-asset copy step):
//   favicon-32.png        32×32, transparent corners (tab icon fallback)
//   favicon-512.png       512×512, transparent corners (large icon)
//   apple-touch-icon.png  180×180 on a solid #07100d full-bleed square —
//                         iOS composites its own corner mask and renders
//                         transparent corners as black, so the tile background
//                         extends to the edges here.
//
// Run manually after any favicon.svg change:
//   node scripts/build-brand-favicons.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = path.join(ROOT, "assets", "brand");

const svg = await readFile(path.join(BRAND, "favicon.svg"), "utf8");
// Full-bleed variant for the Apple touch icon: the same artwork over a solid
// square so iOS's masked corners never show black.
const svgFullBleed = svg.replace(/<defs>/, '<defs><style>svg{background:#07100d}</style>');

const targets = [
  { file: "favicon-32.png", size: 32, source: svg, omitBackground: true },
  { file: "favicon-512.png", size: 512, source: svg, omitBackground: true },
  { file: "apple-touch-icon.png", size: 180, source: svgFullBleed, omitBackground: false },
];

const browser = await chromium.launch();
try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
    const doc = `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${target.size}px;height:${target.size}px}</style></head><body>${target.source}</body></html>`;
    await page.setContent(doc, { waitUntil: "load" });
    const bytes = await page.screenshot({ omitBackground: target.omitBackground, clip: { x: 0, y: 0, width: target.size, height: target.size } });
    await writeFile(path.join(BRAND, target.file), bytes);
    await page.close();
    console.log(`${target.file}: ${bytes.length} bytes`);
  }
} finally {
  await browser.close();
}
