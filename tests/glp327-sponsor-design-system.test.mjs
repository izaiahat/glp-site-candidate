// GLP-327: the sponsor rate card, /providers/ Sponsored panel and paid promo page
// must be site pages, not standalone designs. They may use only shared site
// components from the site-p3.css source layers, the site's own document
// renderer and shared shell, and no <style> block, inline style or colour value.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderRateCard, renderPromo } from "../src/paid-promo.mjs";
import { renderSponsorPlacementCandidate } from "../src/sponsor-placement-candidate.mjs";
import { pageDocument } from "../src/phase3-page-graph.mjs";
import { addSharedRuntime } from "../scripts/build-staging.mjs";

const css = (file) => readFileSync(new URL(`../assets/css-src/${file}`, import.meta.url), "utf8");
// The exact layers assemble-css.mjs composes into site-p3.css.
const SITE_P3_LAYERS = ["00-foundation.css", "01-primitives.css", "02-shell.css", "11-phase3.css", "12-phase3-closure.css", "30-provider-detail.css", "47-funnel-v2.css", "90-compat.css", "99-action-aurora.css"];
const assembler = readFileSync(new URL("../artifacts/ultracode/tools/assemble-css.mjs", import.meta.url), "utf8");
const siteCss = SITE_P3_LAYERS.map(css).join("\n");
// Unstyled hook classes (p3-wrap-*, table-disclosure) are allowed only when the
// existing Phase 3 renderer already emits them on provider pages.
const rendererClasses = new Set([...readFileSync(new URL("../src/phase3-page-graph.mjs", import.meta.url), "utf8").matchAll(/class="([^"$]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
const surfaces = {
  "rate card": renderRateCard(),
  "/providers/ panel": renderSponsorPlacementCandidate("/providers/", { preview: true }),
  "paid promo": renderPromo(),
};
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab|color-mix|color)\(|linear-gradient|radial-gradient/i;

test("site-p3.css is assembled from the layers this test checks", () => {
  for (const layer of SITE_P3_LAYERS) assert.ok(assembler.includes(layer), layer);
});

for (const [name, html] of Object.entries(surfaces)) {
  test(`${name}: no standalone styling or new colour values`, () => {
    assert.doesNotMatch(html, /<style\b/i);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.doesNotMatch(html, /<link\b[^>]*stylesheet/i);
    assert.doesNotMatch(html.replace(/href="[^"]*"/g, ""), COLOUR);
  });
  test(`${name}: every class is an existing shared site component`, () => {
    const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
    assert.ok(classes.size > 3);
    const missing = [...classes].filter((c) => !rendererClasses.has(c) && !new RegExp(`\\.${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(siteCss));
    assert.deepEqual(missing, []);
  });
}

test("sponsor pages go through the site document renderer and shared shell with site-p3.css", () => {
  // Shell output for an empty page on the same route family is the baseline:
  // the sponsor pages may carry no style block or stylesheet beyond it.
  const baseline = addSharedRuntime(pageDocument({ route: "/sponsors/baseline/", title: "t", description: "d", body: "" }));
  const shellStyles = new Set(baseline.match(/<style\b[\s\S]*?<\/style>/gi) || []);
  for (const [route, page] of [["/sponsors/rates/", renderRateCard()], ["/sponsors/example-provider/", renderPromo()]]) {
    assert.match(page, new RegExp(`<main class="p3-page" data-phase3-route="${route}"`));
    const built = addSharedRuntime(page);
    assert.deepEqual([...built.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map((m) => m[1]), ["/assets/site-p3.css"]);
    assert.match(built, /<nav class="gcs-nav" aria-label="Primary">/);
    assert.match(built, /<footer class="gcs-footer">/);
    assert.match(built, /<a class="skip-link" href="#main">/);
    for (const style of built.match(/<style\b[\s\S]*?<\/style>/gi) || []) assert.ok(shellStyles.has(style), `non-shell style block: ${style.slice(0, 80)}`);
    assert.match(built, /<meta name="robots" content="noindex/);
  }
});

test("the only GLP-327 CSS addition is panel spacing in the shared source, with no colour", () => {
  const phase3 = css("11-phase3.css");
  const rules = phase3.match(/[^{}]*data-sponsored-placement[^{}]*\{[^}]*\}/g) || [];
  assert.equal(rules.length, 1);
  assert.match(rules[0], /\{\s*margin-bottom:\s*clamp\([^)]*\);\s*\}/);
  assert.doesNotMatch(rules[0].replace(/\/\*[\s\S]*?\*\//g, ""), COLOUR);
});
