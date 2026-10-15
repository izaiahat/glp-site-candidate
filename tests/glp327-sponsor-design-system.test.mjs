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
    assert.match(built, /<nav class="gcs-nav" aria-label="Primary" data-sponsor-header>/);
    assert.doesNotMatch(built, /cs-search-toggle|cs-menu-toggle|cs-navgroup|id="cs-drawer"/);
    assert.match(built, /href="\/providers\/">Compare providers<\/a>/);
    assert.match(built, /<footer class="gcs-footer">/);
    assert.match(built, /<a class="skip-link" href="#main">/);
    for (const style of built.match(/<style\b[\s\S]*?<\/style>/gi) || []) assert.ok(shellStyles.has(style), `non-shell style block: ${style.slice(0, 80)}`);
    assert.match(built, /<meta name="robots" content="noindex/);
  }
});

// The earlier "single spacing rule" assertion was a placeholder constraint;
// the operator's 2026-10-03 layout rework needs real composition CSS. This is
// the safety contract for it: shared source only, scoped to sponsor hooks,
// shared tokens only, and nothing that can recolour, hide or restyle type.
test("GLP-327 composition CSS lives in the shared source, scoped to sponsor hooks and built from shared tokens", () => {
  const phase3 = css("11-phase3.css");
  const marker = "/* GLP-327 sponsor surfaces";
  assert.equal(phase3.split(marker).length, 2, "one GLP-327 block in 11-phase3.css");
  const block = phase3.slice(phase3.indexOf(marker)).replace(/\/\*[\s\S]*?\*\//g, "");
  const otherLayers = SITE_P3_LAYERS.filter((file) => file !== "11-phase3.css").map(css).join("\n");
  assert.ok(!otherLayers.includes("data-sponsor"), "no sponsor rules outside the GLP-327 block");
  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.replace(/@media[^{]*$/, "").trim(), body }));
  assert.ok(rules.length >= 10);
  for (const { selector, body } of rules) {
    for (const part of selector.split(/,(?![^(]*\))/)) assert.match(part, /\[data-sponsor(?:ed-placement|-[a-z-]+)\]/, `unscoped selector: ${part.trim()}`);
    assert.doesNotMatch(body, COLOUR, `colour literal in ${selector}`);
    assert.doesNotMatch(body, /!important|font-family|opacity|filter|mix-blend|visibility|display:\s*none|text-shadow|box-shadow|background|animation|transition/i, `non-composition declaration in ${selector}`);
    for (const [, prop, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) {
      if (/(^|-)color$/.test(prop) || prop === "border" || prop.startsWith("border-") && !/radius|width|style/.test(prop)) {
        assert.match(value, /var\(--[a-z0-9-]+\)/, `${prop} must use a shared token in ${selector}`);
      }
      if (prop === "content") assert.equal(value.trim(), '" "');
    }
  }
  for (const [, token] of block.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
    assert.ok(new RegExp(`${token}\\s*:`).test(otherLayers + phase3.slice(0, phase3.indexOf(marker))), `${token} is not a shared token`);
  }
});
