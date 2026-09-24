import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, ROOT), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const ROUTES = [
  ["home", "public/index.html", /cs-home2-hero/],
  ["brand product", "public/ozempic/index.html", /p3-product-hero/],
  ["compounded category", "public/lp/best-providers/compounded-semaglutide/index.html", /p3-category-hero/],
  ["bulk", "public/3-month/index.html", /p3-bulk-hero/],
  ["insights index", "public/insights/index.html", /p3-insights-hero/],
  ["insights article", "public/guides/what-is-glp-1/index.html", /guide-shell/],
  ["pharmacies", "public/pharmacies/index.html", /data-pharmacy-filters/],
  ["pharmacy detail", "public/pharmacies/hallandale/index.html", /p3-pharmacy-hero/],
  ["provider cards", "public/lp/best-providers/compounded-semaglutide/index.html", /p3-provider-grid/],
  ["provider detail", "public/providers/found-health/index.html", /data-provider-sticky/],
  ["quiz", "public/quiz/provider-fit/index.html", /data-phase4-quiz/],
];

test("W18 served route matrix covers every standing mobile template", async () => {
  for (const [family, relative, marker] of ROUTES) {
    const html = await read(relative);
    assert.match(html, marker, `${family} missing its served template marker`);
    assert.match(html, /\/assets\/site\.js/, `${family} missing the shared served runtime`);
    assert.match(html, /\/assets\/site(?:-[a-z0-9-]+)?\.css/, `${family} missing a served stylesheet`);
  }
});

test("W18 runtime and CSS contracts are present in public, not only authoring files", async () => {
  const [sourceRuntime, servedRuntime, servedCss, servedHomeCss, servedEditorialCss, servedToolsCss] = await Promise.all([
    readFile(new URL("assets/site.js", ROOT)),
    readFile(new URL("public/assets/site.js", ROOT)),
    read("public/assets/site.css"),
    read("public/assets/site-home.css"),
    read("public/assets/site-editorial.css"),
    read("public/assets/site-tools.css"),
  ]);
  assert.equal(sha256(servedRuntime), sha256(sourceRuntime), "public/assets/site.js is stale");
  for (const marker of ["W18 mobile parity", "cs-mobile-card-table", "cs-mobile-filter-trigger", "cs-quiz-result-viewport", "data-provider-sticky"]) {
    assert.match(servedRuntime.toString(), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `served runtime missing ${marker}`);
  }
  assert.match(servedCss, /height:\s*100dvh/);
  assert.match(servedHomeCss, /touch-action:\s*pan-y/);
  assert.match(servedCss, /max-height:\s*min\(78dvh,\s*680px\)/);
  assert.match(servedEditorialCss, /overflow:\s*visible/);
  assert.match(servedToolsCss, /flex:\s*0 0 min\(312px,\s*calc\(100vw - 78px\)\)/);
  assert.match(servedToolsCss, /\.qz-choice-grid/,
    "CSS minification changed the quiz descendant selector");
  assert.match(servedToolsCss, /\.qz-results/,
    "CSS minification changed the Phase 4 result selector");
});

test("W18 freshness gate rejects source-newer-than-served mobile assets", async () => {
  const pairs = [
    ["assets/site.js", "public/assets/site.js"],
    ["assets/css-src/02-shell.css", "public/assets/site.css"],
    ["assets/css-src/10-home.css", "public/assets/site-home.css"],
    ["assets/css-src/11-phase3.css", "public/assets/site.css"],
    ["assets/css-src/40-editorial.css", "public/assets/site-editorial.css"],
    ["assets/css-src/50-tools.css", "public/assets/site-tools.css"],
  ];
  for (const [source, served] of pairs) {
    const [sourceStat, servedStat] = await Promise.all([stat(new URL(source, ROOT)), stat(new URL(served, ROOT))]);
    assert.ok(servedStat.mtimeMs >= sourceStat.mtimeMs, `${served} is older than ${source}`);
  }
});

test("W18 source contracts cover sheets, cards, sticky footer release, swipe, targets, and overflow", async () => {
  const [runtime, shell, home, phase3, editorial, tools] = await Promise.all([
    read("assets/site.js"),
    read("assets/css-src/02-shell.css"),
    read("assets/css-src/10-home.css"),
    read("assets/css-src/11-phase3.css"),
    read("assets/css-src/40-editorial.css"),
    read("assets/css-src/50-tools.css"),
  ]);
  assert.match(runtime, /panel\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(runtime, /setupFilterSheet/);
  assert.match(runtime, /cell\.dataset\.label/);
  assert.match(runtime, /Keep provider actions fixed until the pre-footer\/footer boundary enters/);
  assert.match(runtime, /footer\.getBoundingClientRect\(\)\.top <= window\.innerHeight/);
  assert.match(runtime, /classList\.toggle\(\s+'is-released'/);
  assert.doesNotMatch(runtime, /data-scroll-direction/);
  assert.match(runtime, /event\.pointerType === 'mouse'/);
  assert.doesNotMatch(runtime, /cs-quiz-result-skeleton/);
  assert.match(runtime, /const setupResultRail = \(\) =>/);
  assert.match(runtime, /const reveal = \(\) =>/);
  assert.match(shell, /height: 100dvh/);
  assert.match(shell, /overflow-x: clip/);
  assert.match(shell, /min-block-size: 44px/);
  assert.match(home, /touch-action: pan-y/);
  assert.match(phase3, /max-height: min\(78dvh, 680px\)/);
  assert.match(phase3, /\.p3-provider-sticky\.is-released\s*\{[^}]*position: absolute;/s);
  assert.match(editorial, /overflow: visible/);
  assert.match(tools, /flex: 0 0 min\(312px, calc\(100vw - 78px\)\)/);
});

test("OPUS F9 remains fail-closed and D23 restores the six-choice home grid", async () => {
  const [newsletter, newsletterTests, build, servedHome] = await Promise.all([
    read("src/newsletter-subscribe.mjs"),
    read("tests/newsletter-subscribe.test.mjs"),
    read("scripts/build-staging.mjs"),
    read("public/index.html"),
  ]);
  assert.match(newsletter, /canonicalContactStatements/);
  assert.match(newsletter, /funnelStage: "newsletter"/);
  assert.match(newsletter, /marketingConsent: true/);
  assert.match(newsletter, /if \(!resendContactsEnabled\(env\)\)/);
  assert.match(newsletter, /sends_started: false/);
  assert.doesNotMatch(newsletter, /sends_started: true/);
  assert.match(newsletterTests, /makes no provider call while the gate is held/);
  assert.match(newsletterTests, /sends_started/);
  for (const intent of ["Compounded semaglutide", "Compounded tirzepatide", "Ozempic", "Wegovy pill", "Mounjaro", "Zepbound"]) {
    assert.match(build, new RegExp(`\\["${intent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(servedHome, new RegExp(`>${intent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));
  }
  // Design pass 2026-08-26 (home spec fix #7): seven chips including Wegovy.
  // The served tree may still carry the six-chip predecessor until the next
  // build lands, so bind the count to the builder's own data map.
  const quickRows = ((build.match(/const quickLinks = \[([\s\S]*?)\]\.map/) || [])[1]?.match(/\["/g) || []).length;
  assert.equal(quickRows, 7, "hero quick-link data map must carry all seven medication routes");
  assert.ok([quickRows, 6].includes((servedHome.match(/class="cs-home-quick"/g) || []).length));
});

test("coupon confirmation stays source-backed and mobile-ready without inventing an offer", async () => {
  const [coupons, runtime, moneyCss] = await Promise.all([
    read("data/coupon-offers.json"),
    read("public/assets/site.js"),
    read("public/assets/site-money.css"),
  ]);
  const data = JSON.parse(coupons);
  assert.deepEqual(data.offers, [], "W18 must not invent a coupon to exercise the toast");
  assert.match(runtime, /data-coupon-copy/);
  assert.match(runtime, /Coupon code copied/);
  assert.match(moneyCss, /\.cs-coupon-toast/);
});
