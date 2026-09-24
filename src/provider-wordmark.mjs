// One uniform wordmark treatment for every provider with no captured logo.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator defect): a provider without a logo asset rendered its
// display name as raw text inside a fixed chip at a fixed `font-size:.9rem`
// with `overflow-wrap:anywhere`. Long names ("Sprout Health") overflowed the
// chip and broke mid-word across two lines, so the compare page showed a
// visibly broken tile next to clean logo chips. Hand-picking a smaller size
// only moves the break to the next long name, and picking a different size per
// surface makes the treatment inconsistent - which is the other half of the
// complaint.
//
// WHAT THIS DOES
// --------------
// Fits the name: one line, never wrapped, at the largest integer pixel size
// that PROVABLY fits the chip's inner box, computed from the real advance
// widths of the real shipped typeface (`data/wordmark-font-metrics.json`,
// measured by scripts/measure-wordmark-font-metrics.mjs). Every surface calls
// this same function with its own chip box, so the typography is identical
// everywhere and the size is the only thing that varies - and it varies for a
// measured reason.
//
// The fit is a computation, not a guess, so it cannot silently regress: a new
// provider with a 30-character name gets a smaller size automatically, and
// tests/provider-wordmark.test.mjs asserts the fitted line width stays inside
// the box for every live no-logo provider on every placement.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The measured metrics, loaded once from the shipped table.
 *
 * A renderer must be able to fit a wordmark on its own: the build normally
 * pre-computes fits (src/provider-chip.mjs), but a caller that renders one
 * money-page row directly - a test, a preview, a future surface - would
 * otherwise hit an unfitted wordmark, which is the defect this replaced.
 */
let cachedMetrics = null;
export function defaultMetrics() {
  if (!cachedMetrics) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    cachedMetrics = JSON.parse(readFileSync(path.join(here, "../data/wordmark-font-metrics.json"), "utf8"));
  }
  return cachedMetrics;
}

/**
 * Chip geometry per placement, in CSS px.
 *
 * These are the boxes the WORDMARK_CSS below PINS with a two-class selector
 * (`.provider-logo.provider-logo--wordmark`, specificity 0-2-0), so they beat
 * both the shared `assets/site.css` rules and the per-page inline rules no
 * matter which order the cascade resolves them in. That is what makes the fit
 * provable: the box the fitter measures against is the box that ships.
 */
export const WORDMARK_CHIPS = Object.freeze({
  card: { width: 136, height: 58, padX: 10, padY: 6 },
  intent: { width: 136, height: 58, padX: 10, padY: 6 },
  decision: { width: 136, height: 58, padX: 10, padY: 6 },
  quiz: { width: 136, height: 58, padX: 10, padY: 6 },
  verdict: { width: 156, height: 68, padX: 10, padY: 6 },
  // The comparison table's chip is the tightest box on the site (and it grows,
  // never shrinks, on narrow viewports), so fitting THIS one fits both widths.
  table: { width: 78, height: 40, padX: 6, padY: 4 },
});

/** Never larger than this: a wordmark must not out-shout a real logo. */
export const MAX_WORDMARK_PX = 17;
/** Never smaller than this: below it the name stops being readable at all. */
export const MIN_WORDMARK_PX = 9;
/** Leave a sliver of breathing room so a sub-pixel rounding can never clip. */
export const FIT_SAFETY = 0.97;

function advanceOf(metrics, char) {
  const table = metrics.advances || {};
  // An unmetered character (an emoji or CJK glyph in a display name) is charged
  // the widest Latin advance we measured, so an unknown never under-estimates.
  return table[char] ?? Math.max(...Object.values(table));
}

/** Width of `text` at `1px` font-size, in px, from the measured advance table. */
export function textWidthPerPx(metrics, text) {
  if (!metrics || metrics.schema !== "glp-wordmark-font-metrics-v1" || !metrics.advances) {
    throw new Error("wordmark_font_metrics_invalid");
  }
  const sum = Array.from(String(text)).reduce((total, ch) => total + advanceOf(metrics, ch), 0);
  // `kerning_drift_ratio` is the measured ratio between a real shaped run and
  // the naive advance sum; applying it makes the estimate track the renderer
  // instead of assuming zero kerning.
  return (sum * (metrics.kerning_drift_ratio || 1)) / (metrics.em_units || 100);
}

/** Every way `name` can be split across at most two lines at WORD boundaries. */
function lineSplits(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const options = [[String(name).trim()]];
  for (let cut = 1; cut < words.length; cut += 1) {
    options.push([words.slice(0, cut).join(" "), words.slice(cut).join(" ")]);
  }
  return options;
}

function sizeForLines(metrics, lines, chip) {
  const boxWidth = (chip.width - chip.padX * 2) * FIT_SAFETY;
  const boxHeight = (chip.height - chip.padY * 2) * FIT_SAFETY;
  const lineHeight = ((metrics.ascent_ratio || 1) + (metrics.descent_ratio || 0.25)) * 1.02;
  const widest = Math.max(...lines.map((line) => textWidthPerPx(metrics, line)));
  if (widest <= 0) return MAX_WORDMARK_PX;
  return Math.min(boxWidth / widest, boxHeight / (lineHeight * lines.length), MAX_WORDMARK_PX);
}

/**
 * Fit `name` into `placement`'s chip: one line where it fits, otherwise a
 * WORD-boundary break onto a second line — never a mid-word break, which is
 * the "wrapping breakage" the operator saw. Among the candidate layouts the
 * one that yields the largest legible size wins; a single line wins ties, so a
 * name only ever wraps when wrapping genuinely reads better.
 *
 * Pure and deterministic: same name + same metrics in, same layout out.
 *
 * @returns {{px: number, lines: string[], clipped: boolean}}
 */
export function fitWordmark(metrics, name, placement = "card") {
  const chip = WORDMARK_CHIPS[placement];
  if (!chip) throw new Error(`wordmark_placement_unknown:${placement}`);
  let best = null;
  for (const lines of lineSplits(name)) {
    const raw = sizeForLines(metrics, lines, chip);
    const px = Math.max(MIN_WORDMARK_PX, Math.floor(raw));
    const candidate = { px, lines, raw };
    if (!best || candidate.raw > best.raw + 1e-9) best = candidate;
  }
  const widest = Math.max(...best.lines.map((line) => textWidthPerPx(metrics, line))) * best.px;
  return {
    px: best.px,
    lines: best.lines,
    // True only when even MIN_WORDMARK_PX across two lines cannot hold the
    // name. Reported rather than hidden, so a pathological display name is a
    // named defect instead of a silently clipped chip.
    clipped: widest > chip.width - chip.padX * 2,
  };
}

/** Largest integer px size at which `name` fits `placement`'s chip. */
export function fitWordmarkPx(metrics, name, placement = "card") {
  return fitWordmark(metrics, name, placement).px;
}

/** Rendered width of the widest fitted line — what the fit test asserts. */
export function fittedLineWidth(metrics, name, placement = "card") {
  const fit = fitWordmark(metrics, name, placement);
  return Math.max(...fit.lines.map((line) => textWidthPerPx(metrics, line))) * fit.px;
}

/**
 * The inner width a fitted line must stay inside for `placement`.
 * A name only overflows here when it is so long that MIN_WORDMARK_PX bottoms
 * out — which the test reports as a real, named defect rather than hiding it.
 */
export function innerWidth(placement = "card") {
  const chip = WORDMARK_CHIPS[placement];
  if (!chip) throw new Error(`wordmark_placement_unknown:${placement}`);
  return chip.width - chip.padX * 2;
}

/** The one shared stylesheet block for the wordmark, used by every surface. */
export const WORDMARK_CSS = [
  // Pin the box the fitter measured. Two classes so neither site.css nor a
  // page's inline chip rule can resize it out from under the computed size.
  ".provider-logo.provider-logo--wordmark{width:136px;height:58px;min-width:136px;min-height:58px;padding:6px 10px;display:grid;place-items:center;overflow:hidden;background:#f4f7fa;border:1px solid #dbe3ec;border-radius:12px}",
  ".provider-logo.provider-logo--wordmark.provider-logo--verdict{width:156px;height:68px;min-width:156px;min-height:68px}",
  ".table-wrap.responsive-table .provider-logo.provider-logo--wordmark,.provider-logo.provider-logo--wordmark.provider-logo--table{width:78px;height:40px;min-width:78px;min-height:40px;max-width:78px;padding:4px 6px}",
  // One typographic treatment everywhere: display face, single weight, tight
  // tracking, centred, never wrapped by the browser (the build already chose
  // where the line breaks, at a word boundary).
  ".provider-logo.provider-logo--wordmark .provider-wordmark{display:block;max-width:100%;overflow:hidden;"
  + "font-family:var(--gcs-display,var(--font-display,inherit));font-weight:800;font-style:normal;"
  + "line-height:1.2;letter-spacing:-.015em;text-align:center;white-space:nowrap;text-overflow:clip;"
  + "color:var(--gcs-ink,var(--color-ink-950,#10233b))}",
  ".provider-logo.provider-logo--wordmark .provider-wordmark span{display:block;white-space:nowrap}",
].join("");
