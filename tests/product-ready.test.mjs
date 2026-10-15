import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { candidateExportShellFindings } from "../src/candidate-export-policy.mjs";
import { assertCurrentAnalyticsCache } from "./helpers/analytics-cache-contract.mjs";
import { assertCurrentProductAnalyticsPrivacy } from './helpers/product-analytics-privacy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OPS = path.join(ROOT, "artifacts", "ops");
const contentBasePointer = JSON.parse(await readFile('/home/ubuntu/business/reports/glp-clinic-scout/seo-machine/current-content-base.json', "utf8"));
const CUMULATIVE = path.join(contentBasePointer.release_root, "public");
const INDEX = "index,follow,max-image-preview:large";
// These five OAuth HTML files are byte-frozen to the deployed/cumulative app.
// Their favicon <img> lacks width/height, so the preservation boundary is the
// explicit exception. Any byte drift, extra exception, or extra image still fails.
// Re-pinned 2026-08-28: the five OAuth compliance pages retain their frozen
// content and purpose-routed email aliases, while their footer identity now
// uses SITE-BUILD-SOP.md's exact first-party legal entity stamp.
const OAUTH_FROZEN_IMAGE_DIMENSION_EXCEPTIONS = Object.freeze({
  "google-ads-api/index.html": "1dea2aad5b189f341efe19794478c88f31d07123b3ffb4877469fcf96f8b5890",
  "google-ads-api/404.html": "68d6a5c45afbb456bac28af149fa47fdda6bd9d7641aba90b0193ab350a64db5",
  "google-ads-api/privacy/index.html": "04eab8b43a179687512a79f8802dba3d239c9ea11d2363b9e9952265b1c1be51",
  "google-ads-api/terms/index.html": "c0c281b4d68ee730d8bbcf461598f6ec3946b553f63b7a346023912438d43921",
  "google-ads-api/support/index.html": "d0edbfff156e823a68191f3161355edd16782f73188ba4cff561efc8072d1849",
});

async function read(relative) {
  return readFile(path.join(PUBLIC, relative), "utf8");
}

async function readOps(relative) {
  return readFile(path.join(OPS, relative), "utf8");
}

function routeFile(route) {
  if (route === "/") return "index.html";
  return path.join(route.replace(/^\//, ""), "index.html");
}

async function treeHashes(root) {
  const output = {};
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else output[relative] = createHash("sha256").update(await readFile(absolute)).digest("hex");
    }
  }
  await walk(root);
  return output;
}

test("sitemap contains only indexable focused GLP routes", async () => {
  const sitemap = await read("sitemap.xml");
  const routes = [...sitemap.matchAll(/<loc>https:\/\/glpclinicscout\.com([^<]*)<\/loc>/g)].map((match) => match[1]);
  assert.equal(new Set(routes).size, routes.length);
  // SHED-301: a route listed as a redirect SOURCE in _redirects is unreachable —
  // the reader gets the 301, never the bytes — so it cannot be an indexable
  // canonical even when its shipped record self-describes as indexable.
  const redirectSources = new Set((await read("_redirects")).trim().split("\n").map((line) => line.split(" ")[0]));
  const publicFiles = Object.keys(await treeHashes(PUBLIC)).filter((relative) => relative === "index.html" || relative.endsWith("/index.html"));
  const indexableCanonicals = [];
  for (const relative of publicFiles) {
    const html = await read(relative);
    if (!html.includes(`<meta name="robots" content="${INDEX}">`)) continue;
    const canonical = html.match(/<link rel="canonical" href="https:\/\/glpclinicscout\.com([^"#?]*)">/)?.[1];
    if (canonical && !redirectSources.has(canonical)) indexableCanonicals.push(canonical);
  }
  assert.deepEqual([...routes].sort(), [...new Set(indexableCanonicals)].sort());
  for (const route of routes) {
    const html = await read(routeFile(route));
    assert.match(html, new RegExp(`<meta name="robots" content="${INDEX}">`), route);
  }
});

test("focused GLP publication policy holds other verticals and every directory route", async () => {
  const blog = JSON.parse(await readOps("blog-system.json"));
  const sitemap = await read("sitemap.xml");
  assert.equal(blog.focused_vertical, "GLP-1");
  assert.ok(blog.articles.filter((article) => article.vertical === "GLP-1").length >= 37);
  assert.equal(blog.articles.filter((article) => article.vertical !== "GLP-1").length, 20);
  // Consolidation 2026-08-15: these GLP routes 301 to their canonical and are
  // deliberately absent from the sitemap while their pages remain built.
  const CONSOLIDATED = new Set([
    "/guides/healthrx-vs-agelessrx/", "/guides/wellorithm-vs-enhance-md/",
    "/guides/cheapest-glp1/", "/guides/compare-online-glp-1-provider-fees/",
    "/guides/glp-1-program-total-cost-comparison/",
  ]);
  for (const article of blog.articles) {
    if (article.vertical === "GLP-1") {
      assert.equal(article.noindex, false, article.canonical_path);
      if (CONSOLIDATED.has(article.canonical_path)) {
        assert.ok(!sitemap.includes(`https://glpclinicscout.com${article.canonical_path}`), article.canonical_path);
        continue;
      }
      const html = await read(routeFile(article.canonical_path));
      assert.ok(sitemap.includes(`https://glpclinicscout.com${article.canonical_path}`), article.canonical_path);
      assert.match(html, /content="index,follow,max-image-preview:large"/, article.canonical_path);
    } else {
      const html = await read(routeFile(article.canonical_path));
      assert.equal(article.noindex, true, article.canonical_path);
      assert.ok(!sitemap.includes(`https://glpclinicscout.com${article.canonical_path}`), article.canonical_path);
      assert.match(html, /content="noindex,nofollow/, article.canonical_path);
    }
  }
  assert.ok(!sitemap.includes("/clinics/"));
  assert.equal(JSON.parse(await readOps("g9-route-retirement.json")).non_success_semantics, "STATIC_MISSING_PATH_404");
  await assert.rejects(() => read("clinics/new-york-ny/index.html"), /ENOENT/);
  await assert.rejects(() => read("directory/index.html"), /ENOENT/);
});

test("homepage leads into the usable private fit funnel", async () => {
  const home = await read("index.html");
  // Fable design pass 2026-08-20: the CTA row carries a data-hero-step hook for the
  // hero entrance sequence, so the selector reads the class and tolerates attributes
  // rather than pinning the exact opening tag.
  const hero = home.match(/<div class="gcs-home-actions"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
  // REBUILD 2026-08-20 (B-26 homepage, CR-8 CTA doctrine): this used to pin the
  // exact button LABELS ("See the best programs", "Find my match"). The labels are
  // now governed by the CTA doctrine and will keep moving; the thing that must
  // never move is that the hero opens BOTH funnels with a readable label on each.
  // So the assertion holds the destinations and the label quality, not the wording.
  const heroLabel = (href) => hero.match(new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]+)<`))?.[1] ?? "";
  assert.ok(heroLabel("/providers/?sort=cheapest").trim().length > 3, "hero must open the cheapest-first provider hub with a readable label");
  // Design pass 2026-08-26 (home spec fix #7): the fit funnel's hero CTA now
  // routes to the CANONICAL quiz (/quiz/provider-fit/), not the compact
  // matcher. The served tree may carry the predecessor route until the next
  // build lands, so both satisfy the two-funnel doctrine here.
  const fitLabel = heroLabel("/quiz/provider-fit/") || heroLabel("/matches/customized/");
  assert.ok(fitLabel.trim().length > 3, "hero must open the fit funnel with a readable label");
  assert.ok(!home.includes('href="/directory/"'));
  assert.ok(!home.includes("City pages"));
  assert.ok(!home.includes("Look for local care evidence"));
  // The trust tile distinguishes all tracked programs from the evidence-qualified
  // comparison cards. Both counts come from the build's governed derivations.
  const buildReport = JSON.parse(
    await readFile(path.join(ROOT, "artifacts", "ops", "build-report.json"), "utf8"),
  );
  const liveProviderCount = buildReport.live_programs;
  const comparisonCount = buildReport.surface_derivations.price_state_tallies.COMPARISON_CARD_COUNT;
  assert.ok(Number.isInteger(liveProviderCount) && liveProviderCount > 0);
  assert.ok(Number.isInteger(comparisonCount) && comparisonCount > 0 && comparisonCount <= liveProviderCount);
  assert.match(home, new RegExp(`Programs with comparison cards</dt><dd>${comparisonCount}</dd>`));
  assert.match(home, new RegExp(`${liveProviderCount}</strong><span>programs tracked, ${comparisonCount} with comparison cards`));
  assert.match(home, /Open the free cost calculator/);
  const quiz = await read("quiz/provider-fit/index.html");
  assert.match(quiz, /data-release="release-ready"/);
  assert.match(quiz, /data-phase4-questions/);
  assert.match(quiz, /data-phase4-results/);
  assert.match(quiz, /Your Top Picks/);
  assert.match(quiz, /data-explore-providers/);
  assert.match(quiz, /data-edit-answers/);
  assert.doesNotMatch(quiz, /id="lead-form"|action="\/api\/leads"/);
});

test("calculator and GLP guides expose working internal conversion paths", async () => {
  const calculator = await read("tools/glp-1-cost-calculator/index.html");
  assert.match(calculator, /data-release="release-ready"/);
  assert.match(calculator, /GLP-1 monthly cost calculator|Estimate first-month/);
  assert.match(calculator, /action="\/api\/content-upgrade"/);
  const calculatorCapture = calculator.match(/<form[^>]+action="\/api\/content-upgrade"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(calculatorCapture, /<input type="hidden" name="consent_version" value="glp-content-upgrade-v2-20260801">/);
  assert.match(calculatorCapture, /class="capture-consent-note"[\s\S]*?By submitting your email,[\s\S]*?Privacy Policy[\s\S]*?Unsubscribe anytime/i);
  assert.doesNotMatch(calculatorCapture, /type="checkbox"|name="email_consent"/);
  assert.ok(calculatorCapture.indexOf("capture-consent-note") < calculatorCapture.indexOf('type="submit"'));
  const guide = await read("guides/what-is-glp-1/index.html");
  assert.equal((guide.match(/class="panel evidence-line guide-next-step"/g) || []).length, 2);
  assert.match(guide, /action="\/api\/content-upgrade"/);
  for (const route of ["/tools/glp-1-cost-calculator/", "/providers/", "/quiz/provider-fit/"]) assert.ok(guide.includes(`href="${route}"`));
});

test("affiliate join fields and organic capture remain while remote analytics matches the declared stage", async () => {
  const html = await read("reviews/trt-nation/index.html");
  const anchors = [...html.matchAll(/<a[^>]+data-analytics-event="affiliate_click"[^>]*>/g)].map((match) => match[0]);
  assert.ok(anchors.length > 0);
  for (const anchor of anchors) {
    for (const field of ["data-program", "data-merchant", "data-page-slug", "data-link-position", "data-variant", "data-subid"]) assert.ok(anchor.includes(`${field}="`), `${field}: ${anchor}`);
    if (anchor.includes('data-link-mode="server-redirect"')) {
      assert.match(anchor, /href="\/go\/trt-nation\?s=reviews\.rv2&amp;v=a"/);
      assert.match(anchor, /data-subid="reviews\.rv2"/);
    } else assert.match(anchor, /data-subid="[a-z0-9-]+-(?:intro|pros|pricing|conclusion)-\d{6}"/);
  }
  const runtime = await read("assets/analytics.js");
  for (const event of ["affiliate_click", "comparison_table_view", "cost_calculator_used", "calculator_submit", "scroll_75"]) assert.ok(runtime.includes(event), event);
  // GLP44 permits property-free coarse progression only after explicit choice.
  // Exercise emitted bytes through both consent and last-mile SDK boundaries;
  // the original blanket-name oracle remains on authenticated pre-GLP44 bytes.
  assertCurrentProductAnalyticsPrivacy(runtime);
  assert.ok(runtime.includes("subid"));
  // An independently declared run stage is the oracle; neither the page nor
  // the build's self-reported stage can select its own expected policy.
  const expectedStage = process.env.GCS_RELEASE_STAGE;
  assert.ok(["candidate", "production-seal"].includes(expectedStage), "set GCS_RELEASE_STAGE explicitly for this authorized test run");
  const reportBytes = await readFile(path.join(OPS, "build-report.json"));
  const reportSha256 = createHash("sha256").update(reportBytes).digest("hex");
  if (process.env.GCS_BUILD_REPORT_SHA256) assert.equal(reportSha256, process.env.GCS_BUILD_REPORT_SHA256, "declared exact build-report bytes");
  const report = JSON.parse(reportBytes);
  assert.equal(report.release_stage, expectedStage, `build-report ${reportSha256}: declared run stage mismatch`);
  const providersBytes = await readFile(path.join(PUBLIC, "providers/index.html"));
  assert.match(report.export_policy_surface_sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash("sha256").update(providersBytes).digest("hex"), report.export_policy_surface_sha256, `build-report ${reportSha256}: emitted providers bytes mismatch`);
  assert.deepEqual(candidateExportShellFindings(html, {stage: expectedStage}), []);
  const wrongAnalyticsStage = html.replace(/GCS_ANALYTICS=\{enabled:(true|false),consent:'unknown'/, (_, flag) => `GCS_ANALYTICS={enabled:${flag === 'true' ? 'false' : 'true'},consent:'unknown'`);
  assert.notEqual(wrongAnalyticsStage, html, 'negative control must mutate real bytes in the declared stage');
  assert.ok(candidateExportShellFindings(wrongAnalyticsStage, {stage: expectedStage}).includes("analytics_wrong_stage"));
  const wrongPolicy = html.replace(/("stage":")(candidate|production-seal)(")/, (_, a, stage, b) => `${a}${stage === "candidate" ? "production-seal" : "candidate"}${b}`);
  assert.notEqual(wrongPolicy, html, 'negative control must mutate the exact policy stamp');
  assert.ok(candidateExportShellFindings(wrongPolicy, {stage: expectedStage}).includes("explicit_policy_missing_or_duplicate_or_wrong_stage"));
  // O28 removed the explicit checkbox. Money-page forms now bind consent to a
  // clear pre-submit note while retaining the exact hidden consent version.
  const captureForms = html.match(/<form[^>]+action="\/api\/content-upgrade"[\s\S]*?<\/form>/g) || [];
  assert.ok(captureForms.length > 0, "money page must retain a content-upgrade form");
  for (const form of captureForms) {
    assert.match(form, /<input type="hidden" name="consent_version" value="glp-content-upgrade-v2-20260801">/);
    assert.match(form, /class="capture-consent-note"[\s\S]*?By submitting your email,[\s\S]*?Privacy Policy[\s\S]*?Unsubscribe anytime/i);
    assert.doesNotMatch(form, /type="checkbox"|name="email_consent"/);
    assert.ok(form.indexOf("capture-consent-note") < form.indexOf('type="submit"'));
  }
  assert.doesNotMatch(html, /name="(?:bmi|weight|current_med\w*|diagnosis|medical_history|quiz_answers)"/i);
});

test("OAuth app bytes and security headers stay exact while versioned assets gain durable caching", async () => {
  // Preserved OAuth pages may differ from the predecessor only through two
  // deliberate, deterministic rewrites: purpose-routed email aliases and the
  // SITE-BUILD-SOP exact first-party legal entity stamp.
  const aliasMap = JSON.parse(await readFile(path.join(ROOT, "data/email-alias-map.json"), "utf8"));
  const aliasFor = (route) => aliasMap.route_purposes.find((rule) => new RegExp(rule.match).test(route)).allowed[0];
  const now = await treeHashes(path.join(PUBLIC, "google-ads-api"));
  const base = await treeHashes(path.join(CUMULATIVE, "google-ads-api"));
  assert.deepEqual(Object.keys(now).sort(), Object.keys(base).sort());
  const rewritten = [];
  for (const relative of Object.keys(now)) {
    if (now[relative] === base[relative]) continue;
    const route = `/google-ads-api/${relative.replace(/index\.html$/, "")}`;
    const alias = aliasFor(route);
    const nowText = await readFile(path.join(PUBLIC, "google-ads-api", relative), "utf8");
    const baseText = await readFile(path.join(CUMULATIVE, "google-ads-api", relative), "utf8");
    const expectedText = baseText
      .replaceAll(`ops@${aliasMap.domain}`, `${alias}@${aliasMap.domain}`)
      .replace(
        "<div>A first-party application operated by Tilton Group LLC.</div><div>2108 N St, Ste N, Sacramento, CA 95816</div>",
        "<div>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</div>",
      );
    assert.equal(nowText, expectedText,
      `${relative}: changed by something other than the email-alias or legal-stamp rewrite`);
    assert.doesNotMatch(nowText, /ops@glpclinicscout\.com/);
    rewritten.push(relative);
  }
  // The rewrite is idempotent: once a base carries the corrected aliases and
  // entity stamp there is nothing left to rewrite. An older base may differ on
  // all five HTML pages, but on no other OAuth asset.
  assert.ok(rewritten.length === 0
    || JSON.stringify(rewritten.sort()) === JSON.stringify(["404.html", "index.html", "privacy/index.html", "support/index.html", "terms/index.html"]),
    `unexpected rewritten set: ${rewritten}`);
  // The invariant that actually matters, checked on every page either way.
  for (const relative of Object.keys(now)) {
    if (!relative.endsWith(".html")) continue;
    assert.doesNotMatch(await readFile(path.join(PUBLIC, "google-ads-api", relative), "utf8"),
      /ops@glpclinicscout\.com/, `${relative} publishes the internal alias`);
  }
  const dimensionExceptions = [];
  for (const [relative, expectedHash] of Object.entries(OAUTH_FROZEN_IMAGE_DIMENSION_EXCEPTIONS)) {
    const bytes = await readFile(path.join(PUBLIC, relative));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, relative);
    const html = bytes.toString("utf8");
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    const missingDimensions = images.filter((image) => !/\bwidth=/.test(image) || !/\bheight=/.test(image));
    assert.equal(images.length, 1, relative);
    assert.equal(missingDimensions.length, 1, relative);
    assert.match(missingDimensions[0], /src="\/google-ads-api\/assets\/favicon\.svg"/);
    dimensionExceptions.push(relative);
  }
  assert.deepEqual(dimensionExceptions.sort(), Object.keys(OAUTH_FROZEN_IMAGE_DIMENSION_EXCEPTIONS).sort());
  const headers = await read("_headers");
  const preserved = await readFile(path.join(CUMULATIVE, "_headers"), "utf8");
  const oauthBlock = (text) => {
    const start = text.indexOf("# GLP Google OAuth app path");
    assert.notEqual(start, -1, "OAuth header block marker");
    return text.slice(start).split(/\n# /, 1)[0].trimEnd();
  };
  assert.equal(oauthBlock(headers), oauthBlock(preserved));
  for (const name of ["X-Frame-Options: DENY", "X-Content-Type-Options: nosniff", "Strict-Transport-Security:", "Content-Security-Policy:"]) assert.ok(headers.includes(name), name);
  for (const asset of ["/assets/site.css", "/assets/site-*.css", "/assets/site.js", "/assets/consent.js"]) {
    assert.ok(headers.includes(`${asset}\n  Cache-Control: public, max-age=31536000, immutable`), asset);
  }
  // The old five-asset assertion remains on authenticated historical headers
  // in carrier-analytics-emission.test.mjs. Current analytics has a mutable
  // no-store alias and a source-addressed immutable asset; neither may drift.
  const source = await readFile(path.join(ROOT, "assets/analytics.js"));
  const filename = `analytics.${createHash("sha256").update(source).digest("hex").slice(0, 16)}.js`;
  assertCurrentAnalyticsCache(headers, source,
    await readFile(path.join(PUBLIC, "assets/analytics.js")),
    await readFile(path.join(PUBLIC, "assets", filename)));
});

// 2026-08-18: sticky-cta-follow.json joins the pinned set. It is the receipt of
// the behaviour probe that proves the sticky provider CTA tracks the reader; the
// probe's screenshots deliberately do NOT live here, because binary evidence has
// no business inside a deploy closure.
test("internal ops receipts stay outside the public deploy closure", async () => {
  const internalOps = ["aeo-surface-stage.json",
    "data-attribute-invariants.json", // D2j hard build gate; remains private and inventory-pinned.
    "approved-53-coverage-gate.json",
    "paid-quiz-build.json", // W3/W4 local seam receipt: still forbidden in PUBLIC.
    "lastmod-runtime-predecessor.json", // Registered provenance input; never public.
    "approved-provider-link-monetization.json", "build-report.json", "batch-gate.json", "blog-system.json", "carrier-article-stage-manifest.json", "email-system.json", "g9-route-retirement.json", "indexnow-manifest.json", "network-verification-manifest.json", "phase3-page-graph.json", "price-index-manifest.json", "resend-email-machine.json", "review-depth-manifest.json", "review-intake-finalization.json", "sticky-cta-follow.json", "wave4-deal-ingestion-manifest.json", "wave4-mystery-shop-manifest.json", "wave4-original-data-manifest.json", "wave4-price-tracker-manifest.json", "worker-manifest.staging.json"];
  const publicFiles = await readdir(PUBLIC);
  assert.deepEqual(publicFiles.filter((name) => internalOps.includes(name)), []);
  // The build wipes and re-emits artifacts/ops, so this is an exact inventory of what
  // the BUILD produces. The pre-seal deploy-completeness sensor writes its receipt into
  // the same directory AFTER the build, by runbook step 3, so its receipts are named
  // and excluded here rather than loosening the inventory: an unexpected build receipt
  // still fails, and nothing about the public-leak assertion above changes.
  const sensorReceipt = /-offline-sensor\.json$/;
  const emitted = (await readdir(OPS)).filter((name) => !sensorReceipt.test(name));
  assert.deepEqual(emitted.sort(), internalOps.sort());
  assert.deepEqual(publicFiles.filter((name) => sensorReceipt.test(name)), []);
});

test("build receipt records email activation while provider sharing remains held", async () => {
  const report = JSON.parse(await readOps("build-report.json"));
  const gate = JSON.parse(await readOps("batch-gate.json"));
  assert.equal(report.status, "PASS_PRODUCT_READY_PROVIDER_DEPLOY_HELD");
  assert.equal(report.email_sends_authorized, true);
  assert.equal(report.oauth_surface_preserved, true);
  assert.equal(gate.status, "PRODUCT_READY_PROVIDER_DEPLOY_HELD");
  assert.equal(gate.fable_design_pass, "PASS_FABLE_FINAL_ACCEPTED_P1_REPAIRED");
  assert.equal(gate.email_sends_authorized, true);
  assert.equal(gate.provider_sharing_authorized, false);
});
