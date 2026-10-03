// Assemble the full stylesheet plus route-family runtime bundles from the same
// ordered CSS sources. The full file remains the validator/fallback authority;
// bundles only remove unrelated template layers from render-blocking delivery.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const SRC = path.join(ROOT, "assets", "css-src");
const files = readdirSync(SRC).filter(f => f.endsWith(".css")).sort();
const layers = Object.fromEntries(files.map((file) => [file, readFileSync(path.join(SRC, file), "utf8")]));
const out = files.map(f => `/* ===== ${f} ===== */\n` + layers[f]).join("\n\n");
writeFileSync(path.join(ROOT, "assets", "site.css"), out);
console.log(`assembled site.css from ${files.length} layers, ${out.length} bytes:`, files.join(", "));

const COMMON = ["00-foundation.css", "01-primitives.css", "02-shell.css"];
const ACTION_AURORA = "99-action-aurora.css";
const bundles = {
  "site-home.css": [...COMMON, "10-home.css", "31-review-intake.css", ACTION_AURORA],
  "site-money.css": [...COMMON, "20-money.css", ACTION_AURORA],
  "site-review.css": [...COMMON, "30-review.css", "31-review-intake.css", ACTION_AURORA],
  // Paid landing pages use the editorial shell but render the shared Funnel V2
  // decision module. Keep its component layer in this bundle as well as p3.
  "site-editorial.css": [...COMMON, "40-editorial.css", "11-phase3.css", "12-phase3-closure.css", "47-funnel-v2.css", ACTION_AURORA],
  "site-tools.css": [...COMMON, "50-tools.css", "55-quiz.css", ACTION_AURORA],
  "site-trust.css": [...COMMON, "80-trust.css", ACTION_AURORA],
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #3): dedicated
  // bundle for the p3 revenue family (brand pages, /providers/*, /pharmacies/*,
  // bulk, self-pay), which previously loaded the full site.css monolith
  // render-blocking. Layer choice verified by class-use grep across every p3
  // template: the phase3 layers carry the family's own components and
  // 90-compat carries the unscoped shared generics these pages actually render
  // (.panel/.evidence-line/.inline-capture*/.capture-*/.gcs-note/
  // .provider-logo--light and the footer brand classes).
  "site-p3.css": [...COMMON, "11-phase3.css", "12-phase3-closure.css", "30-provider-detail.css", "47-funnel-v2.css", "90-compat.css", ACTION_AURORA],
};

// Family stylesheets are only linked from server-classified routes. Replace
// expensive full-tree relational selectors used solely for route detection
// with the deterministic template marker stamped by addSharedRuntime(). Keep
// component-state :has() selectors intact (checked controls, adjacent bands,
// conditional facts blocks): those describe live relationships, not routing.
const bundleScopeRewrites = {
  "site-home.css": [
    ["main:has(> .cs-hero-seq)", 'body[data-cs-template="home"] main'],
    [".home-hero-band:has(> .cs-aurora-field)", ".home-hero-band"],
  ],
  "site-review.css": [
    ["body.cs-scrolled:has(#bottom-line)", 'body.cs-scrolled[data-cs-template="review"]'],
    ["body:has(#bottom-line)", 'body[data-cs-template="review"]'],
    ["html:has(#bottom-line)", 'html[data-cs-template="review"]'],
  ],
  "site-editorial.css": [
    ["main:has(> nav.library-index)", 'main[data-cs-template="library"]'],
    ["main:has(> section.authored-pages)", 'main[data-cs-template="author"]'],
    ["html:has(nav.library-index)", 'html[data-cs-template="library"]'],
    ["html:has(main.guide-shell)", 'html[data-cs-template="guide"]'],
  ],
  "site-tools.css": [
    ["body:has(#cost-form)", 'body[data-cs-template="calculator"]'],
    ["body:has(.price-index-dataset-note)", 'body[data-cs-template="price-index"]'],
  ],
  "site-trust.css": [
    ["body:has(> main > h1)", 'body[data-cs-template="trust"]'],
  ],
  // Phase-4 gate remediation 2026-08-27: 90-compat rides inside site-p3.css for
  // its shared generics, but its review/price-index/trust route-detection
  // :has() probes would make the style engine walk the biggest DOMs on the site
  // (providers/pharmacies hubs) for templates that are never served from this
  // bundle. Rewrite exactly those route probes to the deterministic template
  // marker (which never matches on a p3 page); component-state :has() rules
  // (checked facets, live consent banner) stay intact.
  "site-p3.css": [
    ["body:has(.review-depth)", 'body[data-cs-template="review"]'],
    ["body:has(main section.affiliate-status)", 'body[data-cs-template="review"]'],
    ["body:has(main section#bottom-line)", 'body[data-cs-template="review"]'],
    ["body:has(.price-index-dataset-note)", 'body[data-cs-template="price-index"]'],
    ["body:has(> main > h1)", 'body[data-cs-template="trust"]'],
  ],
};

function optimizeBundleScopes(name, input) {
  let output = input;
  for (const [relational, deterministic] of bundleScopeRewrites[name] || []) {
    if (!output.includes(relational)) throw new Error(`css_bundle_scope_missing:${name}:${relational}`);
    output = output.replaceAll(relational, deterministic);
  }
  return output;
}

function minifyCss(input) {
  // WS-A-004 F01. Test: tests/ws-a-004-css-buffer.test.mjs. Blast radius:
  // all seven generated CSS bundles; output must remain byte-identical.
  // Buffer characters to avoid repeated whole-string reallocations.
  const output = [];
  let quote = null;
  let escaped = false;
  let pendingSpace = false;
  // A pending space before `:` can be a descendant combinator before a
  // pseudo-class/function (`.panel :is(...)`). Removing it changes selector
  // meaning. Declaration colons do not have pending whitespace in valid CSS.
  const noSpaceBefore = new Set(["{", "}", ";", ",", ">"]) ;
  const noSpaceAfter = new Set(["{", "}", ":", ";", ",", ">"]) ;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quote) {
      output.push(character);
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index += 1;
      index += 1;
      pendingSpace = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (pendingSpace && output.length && !noSpaceAfter.has(output.at(-1))) output.push(" ");
      pendingSpace = false;
      quote = character;
      output.push(character);
      continue;
    }
    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output.length && !noSpaceAfter.has(output.at(-1)) && !noSpaceBefore.has(character)) output.push(" ");
    pendingSpace = false;
    output.push(character);
  }
  if (quote) throw new Error("css_minifier_unterminated_string");
  return output.join("").trim();
}

for (const [name, bundleLayers] of Object.entries(bundles)) {
  for (const layer of bundleLayers) if (!(layer in layers)) throw new Error(`css_bundle_layer_missing:${name}:${layer}`);
  const css = minifyCss(optimizeBundleScopes(name, bundleLayers.map((layer) => layers[layer]).join("\n")));
  writeFileSync(path.join(ROOT, "assets", name), `${css}\n`);
  console.log(`assembled ${name} from ${bundleLayers.length} layers, ${css.length + 1} bytes:`, bundleLayers.join(", "));
}
