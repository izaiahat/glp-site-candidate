import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { applyWave2P1Surfaces } from "../src/wave2-p1-surfaces.mjs";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start) + start.length));

test("PASS 2 home builder keeps the text wordmark and medication routes/art distinct", async () => {
  const source = await read("scripts/build-staging.mjs");
  const shell = between(source, "function addSharedRuntime", "function directCalculatorWorkspace");
  const home = between(source, "function renderHomePage(", "function renderHomePageLegacy(");
  assert.match(shell, /const brand = `<a class="gcs-brand"[^`]+<span>Clinic <span class="cs-grad-words">Scout/);
  assert.doesNotMatch(shell.match(/const brand = [^;]+;/)?.[0] || "", /<img/);
  // D36 requires re-entry replay; keep the existing entrance-coverage floor.
  assert.match(home, /\.replaceAll\('data-motion-once="true"', 'data-motion-once="false"'\)/);
  assert.ok((home.match(/data-motion-once="true"/g) || []).length >= 16);
  assert.doesNotMatch(home, /Tap to check/);
  // Design pass 2026-08-26 (home spec fix #7): the hero CTA routes to the
  // canonical quiz, not the compact matcher.
  assert.match(home, /href="\/quiz\/provider-fit\/">See your matches/);
  assert.doesNotMatch(home, /href="\/matches\/customized\/"/);
  for (const route of ["/lp/best-providers/compounded-semaglutide/", "/lp/best-providers/compounded-tirzepatide/", "/ozempic/", "/wegovy/", "/mounjaro/", "/zepbound/", "/wegovy-pill/"]) assert.match(source, new RegExp(route.replaceAll("/", "\\/")));
  for (const stem of ["med-rail-semaglutide", "med-rail-tirzepatide", "phase3-product-ozempic", "phase3-product-wegovy", "phase3-product-mounjaro", "phase3-product-zepbound", "phase3-product-wegovy-pill"]) assert.match(source, new RegExp(stem));
  assert.match(home, /providerMark\(card\)/);
  assert.match(home, /data-motion-loop/);
});

test("PASS 2 hero medication derivatives referenced by the rail exist", async () => {
  const stems = [
    ["med-rail-semaglutide", [640, 1280]], ["med-rail-tirzepatide", [640, 1280]],
    ["phase3-product-ozempic", [640, 1024]], ["phase3-product-wegovy", [640, 1024]],
    ["phase3-product-mounjaro", [640, 1024]], ["phase3-product-zepbound", [640, 1024]],
    ["phase3-product-wegovy-pill", [640, 1024]],
  ];
  await Promise.all(stems.flatMap(([stem, widths]) => widths.map((width) => access(new URL(`../assets/derivatives/${stem}-${width}.avif`, import.meta.url)))));
});

test("PASS 2 interaction contracts cover transient risk cards, restrained review sheet, and immediate search navigation", async () => {
  const site = await read("assets/site.js");
  assert.match(site, /event\.detail === 0 \|\| touchLike/);
  assert.match(site, /card\.addEventListener\('mouseleave'/);
  assert.match(site, /sheet\.classList\.add\('is-open'\)/);
  assert.match(site, /sheet\.classList\.remove\('is-open'\)/);
  assert.doesNotMatch(site, /cs-search-flight/);
  assert.match(site, /hit\.href = entry\.url/);
  assert.doesNotMatch(site, /window\.location\.assign\(link\.href\)/);
  assert.match(site, /values\.email_consent = true/);
  assert.doesNotMatch(site, /Get ready for prior authorization/);
});

test("PASS 2 CSS keeps the first screen compact and review form readable", async () => {
  const [homeCss, phase3Css] = await Promise.all([read("assets/css-src/10-home.css"), read("assets/css-src/11-phase3.css")]);
  assert.match(homeCss, /min-height: min\(760px, calc\(100svh - 72px\)\)/);
  assert.match(homeCss, /cs-home2-med-viewport::before/);
  // Design pass 2026-08-26 (home spec fix #1): overlay med cards — ~539px tall
  // full-bleed art with the title/qualifier/pill ON the image. The 25vw desktop
  // pitch preserves three full cards plus a real next-card peek at 1440px.
  assert.match(homeCss, /flex-basis: min\(326px, calc\(100vw - 58px\)\)/);
  assert.match(homeCss, /height: clamp\(460px, 37\.5vw, 539px\)/);
  assert.match(homeCss, /\.cs-home-med \{ flex: 0 0 clamp\(320px, 25vw, 384px\); \}/);
  assert.match(homeCss, /\.cs-home-med__scrim/);
  assert.match(homeCss, /\.cs-home-med__pill/);
  assert.match(homeCss, /cs-review-sheet\.is-open \.cs-review-sheet__panel/);
  assert.match(homeCss, /\.cs-review-sheet__panel h2[^}]+color: #f2f8f4/s);
  assert.match(homeCss, /\.cs-review-sheet__panel \.p5-review-intake__card[^}]+background: #0c1815/s);
  assert.doesNotMatch(homeCss, /contain-intrinsic-size:\s*auto\s+760px/);
  assert.match(phase3Css, /padding: clamp\(22px, 3\.5vw, 46px\)/);
});

test("PASS 3 motion keeps one Lenis/GSAP owner and only the operator-mandated H17 entrance", async () => {
  const [motion, build] = await Promise.all([read("assets/motion.js"), read("scripts/build-staging.mjs")]);
  assert.match(motion, /autoRaf: false/);
  assert.match(motion, /lagSmoothing\(500, 33\)/);
  assert.match(motion, /function initH17\(\)/);
  // Motion v2 (operator 2026-08-26): H17 is a split timeline — art and copy
  // enter from opposite sides at 0.7s; the site-wide vocabulary is live.
  assert.match(motion, /defaults: \{ duration: 0\.7, ease: "power3\.out" \}/);
  assert.match(motion, /function initVocabulary\(\)/);
  assert.match(motion, /once: true/);
  assert.doesNotMatch(motion, /function gatedLoop|loopObserver|data-motion-loop/);
  const shell = between(build, "function addSharedRuntime", "function directCalculatorWorkspace");
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #8): SplitText was
  // dropped from the shared shell (proven unused on 249 pages); the binding
  // order pin now covers the plugins actually shipped.
  const order = ["gsap.min.js", "ScrollTrigger.min.js", "lenis.min.js", "motion.js"].map((name) => shell.indexOf(name));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("PASS 2 subscribe surfaces make submission itself the consent event", async () => {
  const build = await read("scripts/build-staging.mjs");
  const subscribe = between(build, "const subscribeSheet =", "const footer =");
  assert.doesNotMatch(subscribe, /type="checkbox"/);
  assert.match(subscribe, /By signing up/);
  assert.match(subscribe, /consent_version/);

  const sample = "<!doctype html><html><head><link rel=\"canonical\" href=\"https://glpclinicscout.com/tools/glp-1-cost-calculator/\"></head><body><main><section class=\"cost-workspace\"><form id=\"cost-form\"></form><aside id=\"cost-result\"><p>Result</p></aside></section></main></body></html>";
  const output = applyWave2P1Surfaces(sample, "tools/glp-1-cost-calculator/index.html");
  assert.match(output, /data-p1-capture-surface/);
  assert.doesNotMatch(output, /type="checkbox" name="email_consent"/);
  assert.match(output, /payload\.email_consent='true'/);
  assert.match(output, /name="consent_version"/);
});

test("PASS 2 calculator source keeps the split workspace viewport-fit before shared shell assembly", async () => {
  // DESIGN PASS 2026-08-26 (calculator-tools spec fix #2): the renderer now
  // ships a VISIBLE hero (headline + published-price anchor | form card), so
  // the pass2 transform no longer strips a duplicate hero — it guards the
  // split workspace and injects the viewport-fit compaction styles.
  const build = await read("scripts/build-staging.mjs");
  assert.match(build, /function directCalculatorWorkspace/);
  assert.match(build, /calculator_workspace_missing/);
  assert.match(build, /const costCalculatorHtml = directCalculatorWorkspace\(/);
  assert.match(build, /data-pass2-calculator/);
});
