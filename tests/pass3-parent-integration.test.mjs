import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CSS_BUNDLE_LAYERS } from "../src/css-build-freshness.mjs";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("Pass 3 parent integration builds, indexes, versions, and copies the compact matcher runtime", async () => {
  const build = await read("scripts/build-staging.mjs");
  assert.match(build, /import \{ renderMatchesCustomized \} from "\.\.\/src\/matches-customized\.mjs"/);
  assert.match(build, /write\("matches\/customized\/index\.html", addSharedRuntime\(/);
  assert.match(build, /\/\(\?:quiz\|tools\|matches\)\\\//);
  assert.match(build, /route === "\/matches\/customized\/" \? "matcher"/);
  assert.match(build, /"\/matches\/customized\/",/);
  assert.match(build, /url: "\/matches\/customized\/"/);
  for (const runtime of ["motion.js", "quiz-page.js", "matches-customized.js", "review-intake.js"]) {
    assert.match(build, new RegExp(`readFile\\(path\\.join\\(ROOT, "assets", "${runtime.replace(".", "\\.")}"\\)\\)`));
  }
  for (const runtime of ["quiz-page.js", "matches-customized.js", "review-intake.js"]) {
    assert.match(build, new RegExp(`write\\("assets/${runtime.replace(".", "\\.")}"`));
  }
});

test("Pass 3 route bundles and freshness metadata use the same Phase 3, quiz, and review-intake layers", async () => {
  const assembler = await read("artifacts/ultracode/tools/assemble-css.mjs");
  for (const layers of Object.values(CSS_BUNDLE_LAYERS)) assert.equal(layers.at(-1), "99-action-aurora.css");
  assert.deepEqual(CSS_BUNDLE_LAYERS["site-home.css"].slice(-3, -1), ["10-home.css", "31-review-intake.css"]);
  assert.deepEqual(CSS_BUNDLE_LAYERS["site-review.css"].slice(-3, -1), ["30-review.css", "31-review-intake.css"]);
  assert.deepEqual(CSS_BUNDLE_LAYERS["site-editorial.css"].slice(-4, -1), ["11-phase3.css", "12-phase3-closure.css", "47-funnel-v2.css"]);
  assert.deepEqual(CSS_BUNDLE_LAYERS["site-tools.css"].slice(-3, -1), ["50-tools.css", "55-quiz.css"]);
  assert.ok(CSS_BUNDLE_LAYERS["site-p3.css"].includes("47-funnel-v2.css"));
  assert.match(assembler, /const ACTION_AURORA = "99-action-aurora\.css"/);
  assert.match(assembler, /"site-review\.css": \[\.\.\.COMMON, "30-review\.css", "31-review-intake\.css", ACTION_AURORA\]/);
  assert.match(assembler, /"site-editorial\.css": \[\.\.\.COMMON, "40-editorial\.css", "11-phase3\.css", "12-phase3-closure\.css", "47-funnel-v2\.css", ACTION_AURORA\]/);
  assert.match(assembler, /"site-tools\.css": \[\.\.\.COMMON, "50-tools\.css", "55-quiz\.css", ACTION_AURORA\]/);
  assert.match(assembler, /"site-p3\.css": \[[^\]]*"47-funnel-v2\.css"/);
});

test("Pass 3 related product closure prevents inherited hero geometry from widening card tracks", async () => {
  const css = await read("assets/css-src/12-phase3-closure.css");
  assert.match(css, /\.p3-product-related-card \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.p3-product-related-card > \* \{[\s\S]*min-width: 0;[\s\S]*max-width: 100%/);
  assert.match(css, /\.p3-product-related-card > \.p3-product-visual \{[\s\S]*width: 100%;[\s\S]*margin: 0;/);
});

test("review intake ships one route bundle and is re-finalized after generic review depth", async () => {
  const build = await read("scripts/build-staging.mjs");
  const renderer = await read("src/pass2-review-hub.mjs");
  assert.match(renderer, /<script type="module" src="\/assets\/review-intake\.js" data-review-intake-runtime><\/script>/);
  assert.doesNotMatch(renderer, /data-review-intake-style|href="\/assets\/site\.css"/);
  assert.match(build, /import \{ applyWave2Repairs, finalizeReviewIntakeRoute \} from "\.\/wave2-repairs\.mjs"/);
  assert.ok(build.indexOf("finalizeReviewIntakeRoute({ publicDir: PUBLIC })") > build.indexOf("enforceReviewDepth(PUBLIC"));
  assert.match(build, /review-intake-finalization\.json/);
});
