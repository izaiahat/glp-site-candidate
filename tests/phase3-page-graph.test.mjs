import assert from "node:assert/strict";
import { detailPrograms, optionCProgramIds } from './helpers/d2w-s9-contracts.mjs';
import { governedBulkCohorts } from './browser/governed-cohort.mjs';
import { javascriptProviderMarkup } from './helpers/d2p-noscript.mjs';
import { JSDOM } from 'jsdom';
import { assertCurrentCardPrice } from './helpers/current-card-price.mjs';
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPhase3PageGraph,
  PHASE3_INSIGHTS_EXCLUSIONS,
  phase3PageGraphContract,
  renderPhase3FilterControls,
  renderPhase3InsightsPage,
  renderPhase3ProductPicture,
  renderPhase3RelatedInsightsShelf,
  upgradeInsightsArticle,
  validatePhase3Graph,
} from "../src/phase3-page-graph.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const SITE = "https://glpclinicscout.com";

const graph = JSON.parse(await readFile(path.join(ROOT, "data/phase3-page-graph.json"), "utf8"));
const carrierCatalogs = await Promise.all(["content-batch.json", "content-national-wow-additions.json"].map(async (file) =>
  JSON.parse(await readFile(path.join(ROOT, "data/blog", file), "utf8"))));
// Match build-staging.mjs articleVertical and its complete GLP guide input.
const carrierOtherVertical = /(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/;
const carrierArticles = carrierCatalogs.flatMap((catalog) => catalog.articles).filter((article) =>
  String(article.canonical_path || "").startsWith("/guides/") && !carrierOtherVertical.test(article.canonical_path));
const carrierInsightArticles = carrierArticles.filter((article) =>
  !PHASE3_INSIGHTS_EXCLUSIONS.has(article.canonical_path));
const registry = JSON.parse(await readFile(path.join(ROOT, "data/program-registry.json"), "utf8"));
const pharmacyInput = JSON.parse(await readFile(path.join(ROOT, "data/phase3-pharmacy-render-input.json"), "utf8"));

const CANONICAL_HUBS = ["/providers/", "/self-pay/", "/bulk/", "/insights/", "/pharmacies/"];
const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];
const DOSES_BY_MEDICATION = {
  "compounded-semaglutide-injection": ["0.25", "0.5", "1", "1.7", "2.4"],
  "compounded-tirzepatide-injection": ["2.5", "5", "7.5", "10", "12.5", "15"],
};
const DOSES = DOSES_BY_MEDICATION["compounded-tirzepatide-injection"];

function normalizeRoute(route) {
  const pathname = new URL(route, SITE).pathname;
  if (pathname === "/") return pathname;
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function fileForRoute(route) {
  const parts = normalizeRoute(route).split("/").filter(Boolean);
  return path.join(PUBLIC, ...parts, "index.html");
}

async function routeExists(route) {
  try {
    await access(fileForRoute(route));
    return true;
  } catch {
    return false;
  }
}

async function readRoute(route) {
  return readFile(fileForRoute(route), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`, "i"))?.[1] ?? null;
}

function tags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function dataValues(html, name) {
  return [...html.matchAll(new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`, "gi"))].map((match) => match[1]);
}

// Ruling reports/ops/glp38-20260915/FABLE-RULING-20260917-candidate-test-debt.md (T12, WO-11):
// the requirement is the grid's presence and role, so require the expected class TOKEN inside a
// real class attribute. A composed attribute ("listing-grid p3-provider-grid") satisfies it; a
// different grid ("p3-pharmacy-grid") still does not.
function hasClassToken(html, token) {
  return [...html.matchAll(/class="([^"]*)"/g)].some((match) => match[1].trim().split(/\s+/).includes(token));
}

function assertCanonicalDocument(html, route) {
  const normalized = normalizeRoute(route);
  assert.match(html, new RegExp(`<link\\s+rel="canonical"\\s+href="${escapeRegExp(`${SITE}${normalized}`)}">`, "i"));
  assert.match(html, new RegExp(`\\bdata-phase3-route="${escapeRegExp(normalized)}"`));
  assert.match(html, /<meta\s+name="robots"\s+content="index,follow,max-image-preview:large">/i);
}

function assertPaidLandingDocument(html, route) {
  const normalized = normalizeRoute(route);
  assert.match(html, new RegExp(`<link\\s+rel="canonical"\\s+href="${escapeRegExp(`${SITE}${normalized}`)}">`, "i"));
  assert.match(html, new RegExp(`\\bdata-phase3-route="${escapeRegExp(normalized)}"`));
  assert.match(html, /<meta\s+name="robots"\s+content="noindex,nofollow,noarchive,nosnippet,max-image-preview:large">/i);
  assert.doesNotMatch(html, /type="email"|name="email"/i);
}

function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
}

function parseRedirects(raw) {
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.replace(/\s+#.*$/, "").trim();
    if (!clean) continue;
    const [from, to, status] = clean.split(/\s+/);
    if (from && to && status) rows.push({ from: normalizeRoute(from), to: normalizeRoute(to), status });
  }
  return rows;
}

function verifiedRelationships(entry) {
  return (entry.provider_relationships || []).filter(
    (relationship) => relationship?.status === "verified" && relationship.program_id && relationship.source_url,
  );
}

function filterValues(html, key) {
  return tags(html, "button")
    .filter((tag) => attribute(tag, "data-filter") === key)
    .map((tag) => attribute(tag, "data-value"));
}

import { ownedArticles } from './fixtures/owned-phase3-articles.mjs';

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(child);
  }
  return files;
}

test("Lane E graph contract binds every destination family, dynamic duration rule, and wrap hook", async () => {
  assert.equal(validatePhase3Graph(graph, pharmacyInput), true);
  assert.deepEqual(phase3PageGraphContract.durationPolicyByBrand["wegovy-pill"], [1, 3, 6, 12]);
  assert.deepEqual(phase3PageGraphContract.durationPolicyByBrand.wegovy, []);
  for (const family of ["providers-hub", "provider-detail", "self-pay", "bulk-hub", "brand-product", "compounded-category", "bulk-intent", "insights-index", "pharmacy-hub", "pharmacy-detail", "pharmacy-reverse"]) {
    assert.ok(phase3PageGraphContract.pageFamilies.includes(family), family);
  }
  const source = await readFile(path.join(ROOT, "src/phase3-page-graph.mjs"), "utf8");
  for (const hook of phase3PageGraphContract.wrapHooks) assert.ok(source.includes(hook), hook);
  assert.equal(phase3PageGraphContract.copiedCompetitorClaims, false);
  assert.equal(phase3PageGraphContract.inventedPrices, false);

  const invalid = structuredClone(graph);
  invalid.brand_pages.find((page) => page.slug === "wegovy-pill").route = "/wegovy/";
  assert.throws(() => validatePhase3Graph(invalid, pharmacyInput), /phase3_wegovy_dynamic_family_invalid|phase3_route_collision/);
});

test("all five branded renders state the representative-editorial disclosure and never claim retail photography", () => {
  for (const page of graph.brand_pages) {
    const html = renderPhase3ProductPicture(page, { loading: "eager" });
    assert.match(html, new RegExp(`phase3-product-${escapeRegExp(page.slug)}-640\\.avif`));
    assert.match(html, new RegExp(`phase3-product-${escapeRegExp(page.slug)}-1024\\.webp`));
    assert.match(html, new RegExp(`phase3-product-${escapeRegExp(page.slug)}-1024\\.jpg`));
    assert.match(html, /data-representative-editorial-visual/);
    assert.match(html, /Representative editorial visualization generated for Clinic Scout; not retail-package photography and not supplied by the manufacturer\./);
    assert.match(html, new RegExp(`branded representative editorial visualization for ${escapeRegExp(page.name)}`, "i"));
    assert.doesNotMatch(html, /unbranded editorial product render/i);
  }
});

test("brand controls cross-route by molecule and expose duration only for Wegovy Pill", () => {
  for (const page of graph.brand_pages) {
    const html = renderPhase3FilterControls(page, [], {}, graph);
    assert.match(html, /data-filter-template="brand-product"/);
    assert.match(html, new RegExp(`data-product-route="${escapeRegExp(page.route)}"`));
    assert.deepEqual(filterValues(html, "type"), ["brand", "compounded", "microdose"]);
    assert.match(html, /data-cross-route-options/);
    const compound = page.ingredient.includes("tirzepatide") ? "compounded-tirzepatide" : "compounded-semaglutide";
    assert.match(html, new RegExp(`(?:data-route|href)="/lp/best-providers/${compound}/\\?drug=`));
    const expectedMedication = page.ingredient.includes("tirzepatide")
      ? ["MOUNJARO", "ZEPBOUND"]
      : ["WEGOVY_PILL", "WEGOVY", "OZEMPIC"];
    assert.deepEqual(filterValues(html, "treatment"), expectedMedication);
    if (page.slug === "wegovy-pill") {
      assert.match(html, /data-duration-policy="monthly-3-6-12"/);
      assert.deepEqual(filterValues(html, "duration"), ["1", "3", "6", "12"]);
      assert.match(html, />Monthly<\/button>/);
    } else {
      assert.match(html, /data-duration-policy="none"/);
      assert.deepEqual(filterValues(html, "duration"), []);
    }
  }
});

test("compounded and fixed-duration routes share the complete listing-control grammar", () => {
  for (const page of graph.compounded_pages) {
    const html = renderPhase3FilterControls(page, [], {}, graph);
    assert.match(html, /data-filter-template="compounded-listing"/);
    assert.deepEqual(filterValues(html, "treatment"), ["SEMAGLUTIDE", "TIRZEPATIDE"]);
    assert.deepEqual(filterValues(html, "type"), ["compounded", "brand", "microdose"]);
    assert.deepEqual(filterValues(html, "plan"), ["both", "1", "3", "more"]);
    assert.deepEqual(filterValues(html, "duration"), ["all", "6", "starter", "step-up"]);
    assert.deepEqual(filterValues(html, "dose"), ["all", ...DOSES_BY_MEDICATION[page.medication_id]]);
    assert.deepEqual(filterValues(html, "sort"), ["cheapest", "best"]);
    assert.deepEqual(dataValues(html, "data-state"), STATE_CODES);
    assert.match(html, /data-cross-route-options/);
    assert.match(html, /data-filter-route/);
  }

  for (const page of graph.bulk_pages) {
    const html = renderPhase3FilterControls(page, [], {}, graph, { fixedDuration: page.duration_months });
    assert.match(html, new RegExp(`data-duration-policy="fixed-${page.duration_months}"`));
    assert.deepEqual(filterValues(html, "treatment"), ["SEMAGLUTIDE", "TIRZEPATIDE"]);
    assert.deepEqual(filterValues(html, "plan"), ["both", "1", "3", "more"]);
    assert.deepEqual(filterValues(html, "duration"), ["all", "6", "starter", "step-up"]);
    assert.match(html, /data-state-open/);
  }
});

test("quiz-only Best match stays fail-closed without a persisted health-answer profile", async () => {
  for (const page of graph.compounded_pages) {
    const html = renderPhase3FilterControls(page, [], {}, graph);
    assert.match(html, /data-filter="sort" data-value="best"[^>]*disabled[^>]*aria-disabled="true"/);
  }

  const runtime = await readFile(path.join(ROOT, "assets/site.js"), "utf8");
  const quizRuntime = await readFile(path.join(ROOT, "assets/quiz-page.js"), "utf8");
  assert.match(runtime, /gcs\.quiz\.provider-fit\.preferences\.v1/);
  assert.match(quizRuntime, /function saveCompletedPreferences\(\) \{[\s\S]*?clearSavedQuiz\(\);/);
  assert.doesNotMatch(quizRuntime, /localStorage\.setItem/);
  assert.match(runtime, /const quizMatches = new Set\(\);/);
  assert.doesNotMatch(runtime, /quizMatches\.add|profile\?\.schema|quizProfile\?\.schema|bestSort\.disabled = false/);
  assert.match(runtime, /if \(sort === 'best'\)[\s\S]*quizMatches\.has/);
  assert.match(runtime, /Number\(!Number\.isFinite\(leftPrice\)\) - Number\(!Number\.isFinite\(rightPrice\)\)/);
  assert.match(quizRuntime, /location\.assign\(`\/matches\/customized\/\?\$\{query\.toString\(\)\}`\)/);
});

test("Insights uses three featured-plus-three cycles per full page and stable numbered pagination", () => {
  const articles = ownedArticles(24);
  const first = renderPhase3InsightsPage(articles, 1, 12);
  assert.match(first, /class="p3-insights-hero"/);
  assert.equal(countMatches(first, /data-insights-feature/g), 3);
  assert.equal(countMatches(first, /data-insights-supporting-row/g), 3);
  assert.equal(countMatches(first, /class="cs-card p3-story"/g), 9);
  assert.match(first, /data-stable-pagination/);
  assert.match(first, /aria-current="page">1<\/span>/);
  assert.match(first, /href="\/insights\/page\/2\/" aria-label="Insights page 2"/);
  assert.match(first, /rel="next" href="\/insights\/page\/2\/"/);
  for (const article of articles.slice(0, 12)) assert.equal(countMatches(first, new RegExp(`href="${escapeRegExp(article.canonical_path)}"`, "g")), 1);

  const second = renderPhase3InsightsPage(articles, 2, 12);
  assert.match(second, /rel="prev" href="\/insights\/"/);
  assert.match(second, /aria-current="page">2<\/span>/);
  assert.match(second, /<span aria-disabled="true">Next<\/span>/);

  const longIndex = renderPhase3InsightsPage(ownedArticles(108), 5, 12);
  assert.match(longIndex, /class="p3-pagination-gap"/);
});

test("brand/listing related shelves point to three owned article destinations and the Insights index", () => {
  const articles = ownedArticles(5);
  const page = { slug: "wegovy", research_route: articles[2].canonical_path };
  const html = renderPhase3RelatedInsightsShelf(page, articles);
  assert.match(html, /data-related-insights-shelf/);
  assert.equal(countMatches(html, /class="cs-card p3-story"/g), 3);
  assert.match(html, new RegExp(`href="${escapeRegExp(articles[2].canonical_path)}"`));
  assert.match(html, /href="\/insights\/">Read more Insights<\/a>/);
});

test("Insights article upgrades expose complete anatomy and wrapping-safe related/action hooks", () => {
  const articles = ownedArticles(5);
  const article = {
    ...articles[0],
    medical_advice_disclaimer: "This guide does not determine treatment fit.",
    author: { bio_path: "/authors/clinic-scout-editorial-team/", display_name: "Clinic Scout Editorial Team", clinical_credentials_claimed: false },
  };
  const base = '<main><nav class="breadcrumbs"><a href="/guides/">Guides</a></nav><section class="guide-hero"><h1>Owned title</h1></section><nav class="guide-toc"><a href="#one">One</a></nav><section id="one"><h2>Body</h2></section></main>';
  const html = upgradeInsightsArticle(base, article, articles.slice(1));
  assert.match(html, /data-phase3-article="true" data-insights-article-anatomy="hero-body-sources-related-author"/);
  assert.match(html, /href="\/insights\/">Insights<\/a>/);
  assert.match(html, /class="p3-article-share p3-wrap-actions" data-wrap-actions/);
  assert.match(html, /data-author-block/);
  assert.equal(countMatches(html, /data-wrap-card/g), 3);
  assert.match(html, /class="p3-keep-reading"/);
  assert.doesNotMatch(html, /class="guide-toc"/);
});

test("GLP34 configured brand listings retain the self-pay destination", async () => {
  const [pricingMatrix, programRegistry] = await Promise.all([
    readFile(path.join(ROOT, "data/provider-pricing-matrix.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "data/program-registry.json"), "utf8").then(JSON.parse),
  ]);
  const built = buildPhase3PageGraph({ graph, pharmacyInput, pricingMatrix, programRegistry,
    homeSpec: { rows: [] }, articles: carrierArticles, couponOffersByProgram: {} });
  assert.ok(graph.brand_pages.length > 0);
  for (const page of graph.brand_pages) {
    const matches = built.pages.filter(candidate => candidate.route === page.route);
    assert.equal(matches.length, 1, page.route);
    assert.match(matches[0].html, /href="\/self-pay\/"/, page.route);
  }
});

test("GLP34 shared listings expose one live count in their introduction", async () => {
  const [pricingMatrix, programRegistry] = await Promise.all([
    readFile(path.join(ROOT, "data/provider-pricing-matrix.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "data/program-registry.json"), "utf8").then(JSON.parse),
  ]);
  const built = buildPhase3PageGraph({ graph, pharmacyInput, pricingMatrix, programRegistry,
    homeSpec: { rows: [] }, articles: carrierArticles, couponOffersByProgram: {} });
  const listings = built.pages.filter(page => page.html.includes('class="listing__intro"'));
  assert.ok(listings.length > 0);
  for (const { route, html } of listings) {
    assert.equal((html.match(/data-(?:filter|pharmacy)-result(?=[\s>])/g) || []).length, 1, route);
    assert.match(html, /<header class="listing__intro">[\s\S]*?<span class="listing__count" data-(?:filter|pharmacy)-result aria-live="polite" aria-atomic="true">/, route);
    assert.doesNotMatch(html, /class="listing__result-count"/, route);
  }
});

test("the in-memory Lane E builder covers every product, listing, detail, pharmacy, and Insights destination without writes", async () => {
  const [pricingMatrix, programRegistry] = await Promise.all([
    readFile(path.join(ROOT, "data/provider-pricing-matrix.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "data/program-registry.json"), "utf8").then(JSON.parse),
  ]);
  const built = buildPhase3PageGraph({
    graph,
    pharmacyInput,
    pricingMatrix,
    programRegistry,
    homeSpec: { rows: [] },
    articles: carrierArticles,
    couponOffersByProgram: {},
  });
  assert.equal(built.pages.length, graph.expected_indexable_routes);
  assert.equal(built.report.insight_pages, Math.max(1, Math.ceil(carrierInsightArticles.length / 12)));
  assert.equal(built.report.family_counts["brand-product"], 5);
  assert.equal(built.report.family_counts["compounded-category"], 2);
  assert.equal(built.report.family_counts["bulk-intent"], 2);
  assert.equal(built.report.family_counts["provider-detail"], detailPrograms(programRegistry, graph).length);
  assert.deepEqual(built.pages.filter(page => page.family === 'provider-detail').map(page => page.route).sort(), detailPrograms(programRegistry, graph).map(p => `/providers/${p.program_id}/`).sort());
  assert.equal(built.report.family_counts["pharmacy-detail"], 90);
  assert.equal(built.report.deploys, 0);
  const byRoute = new Map(built.pages.map((page) => [page.route, page]));

  for (const page of graph.brand_pages) {
    const html = byRoute.get(page.route)?.html || "";
    assert.match(html, /data-product-family-switcher/);
    assert.match(html, /data-cross-route-options/);
    assert.match(html, /data-related-insights-shelf/);
    assert.match(html, /data-with-without-insurance/);
    assert.match(html, /href="\/self-pay\/"/);
    assert.ok(countMatches(html, /data-representative-editorial-visual/g) >= 4);
    if (page.slug === "wegovy-pill") assert.deepEqual(filterValues(html, "duration"), ["1", "3", "6", "12"]);
    else assert.deepEqual(filterValues(html, "duration"), []);
  }
  for (const page of [...graph.compounded_pages, ...graph.bulk_pages]) {
    const html = byRoute.get(page.route)?.html || "";
    assert.match(html, /data-filter-template="compounded-listing"/);
    assert.match(html, /data-three-column-results/);
    assert.match(html, /data-filter-empty/);
    assert.match(html, /data-related-insights-shelf/);
  }
  const selfPay = byRoute.get("/self-pay/")?.html || "";
  // Ruling FABLE-RULING-20260917-candidate-test-debt.md (T11, WO-11): investigated by running this
  // builder — no destination is missing (every family and every asserted route is built). The
  // asserted hook was RENAMED: /self-pay/ now renders through the one active listing composition
  // (src/phase3-page-graph.mjs renderConfiguredListing/listingDocument), whose results region is
  // <section id="provider-results" ... data-three-column-results>; the legacy selfPayDocument that
  // carried data-self-pay-options is retained only as migration reference and is never called.
  // The three-lowest-row count stays exactly 3: data-phase3-provider-grid shares the card
  // attribute's prefix, so the card attribute is matched on its own boundary.
  assert.match(selfPay, /<section id="provider-results"[^>]*\bdata-three-column-results\b/);
  assert.equal(countMatches(selfPay, /\bdata-phase3-provider(?=[\s>])/g), 3);
  const insights = byRoute.get("/insights/")?.html || "";
  assert.equal(countMatches(insights, /data-insights-feature/g), 3);
  assert.match(insights, /data-stable-pagination/);
  assert.match(byRoute.get("/providers/")?.html || "", /data-provider-filters/);
  assert.match(byRoute.get("/pharmacies/")?.html || "", /data-wrap-card/);
  // 2026-08-27: nu-image went live with bound prices (live-head merge); drhouse is now the unbound-state exemplar.
  assert.match(byRoute.get("/providers/drhouse/")?.html || "", /No current source-dated price row is bound/);
});

test("Phase 3 serves the five canonical hubs and all five canonical brand pages", async () => {
  assert.equal(graph.brand_pages.length, 5);
  assert.equal(new Set(graph.brand_pages.map((page) => page.route)).size, 5);

  const hubHtml = new Map();
  for (const route of CANONICAL_HUBS) {
    const html = await readRoute(route);
    assertCanonicalDocument(html, route);
    hubHtml.set(route, html);
  }

  assert.match(hubHtml.get("/providers/"), /Provider (?:directory|comparison)/);
  // Ruling FABLE-RULING-20260917-candidate-test-debt.md (T12, WO-11): STALE_FIXTURE by ruling —
  // the exact class STRING was asserted, the mandate is the grid's presence and role. Each hub
  // still has to serve its own grid class token; the grid checks themselves are unchanged.
  assert.ok(hasClassToken(hubHtml.get("/self-pay/"), "p3-provider-grid"), "/self-pay/ lacks the p3-provider-grid class token");
  assert.ok(hasClassToken(hubHtml.get("/bulk/"), "p3-intent-grid"), "/bulk/ lacks the p3-intent-grid class token");
  assert.ok(hasClassToken(hubHtml.get("/insights/"), "p3-insights-hero"), "/insights/ lacks the p3-insights-hero class token");
  assert.ok(hasClassToken(hubHtml.get("/pharmacies/"), "p3-pharmacy-grid"), "/pharmacies/ lacks the p3-pharmacy-grid class token");

  for (const page of graph.brand_pages) {
    const html = await readRoute(page.route);
    assertCanonicalDocument(html, page.route);
    assert.match(html, new RegExp(`<h1[^>]*>${escapeRegExp(page.name)}<\\/h1>`, "i"));
    for (const sibling of graph.brand_pages) {
      assert.match(html, new RegExp(`href="${escapeRegExp(sibling.route)}\\?drug=`), `${page.route} does not link ${sibling.route} with preserved medication intent`);
    }
    assert.match(html, /href="\/self-pay\/"/);
  }
});

test('static Phase 3 counts retain distinct browser effect oracles for reset and no-JS readback', async () => {
  // Bind existing browser assertions; a passing Node test does not prove interactions ran.
  const [p68, gap] = await Promise.all([
    readFile(path.join(ROOT, 'tests/browser/p68-regressions.spec.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'tests/browser/phase3-gap-acceptance.spec.mjs'), 'utf8'),
  ]);
  const bulk = p68.slice(p68.indexOf('test("P68 bulk status announces the selected molecule"'));
  assert.match(bulk, /for \(const duration of \["3-month", "6-month"\]\)/);
  assert.match(bulk, /for \(const drug of \["SEMAGLUTIDE", "TIRZEPATIDE"\]\)/);
  assert.match(bulk, /await plan\.click\(\);[\s\S]*?await dose\.click\(\);[\s\S]*?toHaveCount\(0\)/);
  assert.match(bulk, /await empty\.locator\('\[data-filter-reset\]'\)\.click\(\);[\s\S]*?toHaveText\('Active filters: none\.'\)/);
  assert.match(bulk, /const resetCohort = governedBulkCohorts\('SEMAGLUTIDE'[\s\S]*?toEqual\(\[\.\.\.resetCohort\.unpriced\]\.sort\(\)\)/);
  const noJs = gap.slice(gap.indexOf('test("mapped C numeric empty, keyboard reset, and no-JS cohorts remain separate"'));
  assert.match(noJs, /javaScriptEnabled: false/);
  assert.match(noJs, /fallback\.locator\('#provider-results \[data-phase3-provider\]'\)/);
  assert.match(noJs, /fallback\.locator\('\[data-unpublished-provider-section\] \[data-phase3-provider\]'\)/);
  assert.match(gap, /async function assertPriceCardFacts\([\s\S]*?governedCardFacts\(id\)[\s\S]*?rows\.nth\(index\)\.locator\("dd > span"\)/);
});

test("Pass-2 G-2 through G-8 and O-35 repairs are present in generated bytes", async () => {
  const providers = javascriptProviderMarkup(await readRoute("/providers/"));
  const providerCards = tags(providers, "article").filter((tag) => /\sdata-phase3-provider(?:\s|>)/.test(tag));
  const renderedIds = providerCards.map((tag) => attribute(tag, "data-program"));
  const expectedIds = optionCProgramIds();
  const optionCExpected = expectedIds.length;
  assert.deepEqual([...renderedIds].sort(), expectedIds.sort());
  assert.equal(renderedIds.length, optionCExpected, "Option C must render every governed provider except the declared detail-only rows");
  assert.equal(new Set(renderedIds).size, optionCExpected, "provider cards must not repeat");
  // Ruling reports/ops/glp38-20260915/FABLE-RULING-20260917-candidate-test-debt.md (T13, WO-11),
  // amended by the Fable ruling of 2026-09-17: STALE_FIXTURE. expectedIds is now DERIVED in
  // tests/helpers/d2w-s9-contracts.mjs (the evidence population intersected with card-eligible
  // registry records) instead of carrying two ids no producer may emit. The deepEqual above stays
  // strict on that derived set, so a card-eligible provider missing from the render still fails.
  // POSITIVE CONTROLS - these are why the intersection is not a way to hide a defect:
  // a held provider and a declared alias must never render a comparison card.
  const heldControl = registry.programs.find((program) => program.program_id === "telos-rx");
  assert.equal(heldControl?.commercial_state, "held", "telos-rx is no longer held; re-derive this control before trusting it");
  assert.equal(renderedIds.includes("telos-rx"), false, "a held provider rendered a comparison card");
  const aliasControl = registry.programs.find((program) => program.review_slug === "shed");
  assert.equal(aliasControl?.profiles?.["glp-clinic-scout"]?.surfaces?.compare, false, "the Shed alias is no longer compare-off; re-derive this control before trusting it");
  assert.equal(renderedIds.includes("shed"), false, "a declared alias rendered a second card for one merchant");
  for (const excluded of ["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review", "g-plan", "jrnys-review", "medvi-review"]) {
    assert.equal(renderedIds.includes(excluded), false, `${excluded} must remain detail-only`);
    await readRoute(`/providers/${excluded}/`);
  }
  // 2026-08-27: nu-image facts are now BOUND (live-head merge) — assert one presence without the unbound disclaimer.
  assert.match(providers, /data-program="nu-image-medical-review"/i);
  assert.doesNotMatch(providers, /nu-image-medical-review[\s\S]{0,2000}?facts remain unbound in this candidate/i);

  const mounjaro = await readRoute("/mounjaro/");
  const insurance = mounjaro.match(/<section\b[^>]*class="[^"]*p3-insurance[^"]*"[\s\S]*?<\/section>/i)?.[0] || "";
  assert.match(insurance, /Without insurance/i);
  assert.match(insurance, /With insurance/i);
  assert.match(insurance, /data-insurance-complete/);
  const relatedProducts = mounjaro.match(/<section\b[^>]*class="[^"]*p3-product-related[^"]*"[\s\S]*?<\/section>/i)?.[0] || "";
  assert.equal(countMatches(relatedProducts, /<picture\b/gi), 3);
  assert.equal(countMatches(relatedProducts, /<img\b[^>]*width="1024"[^>]*height="1024"/gi), 3);

  const category = await readRoute("/lp/best-providers/compounded-semaglutide/");
  assert.match(category, /data-filter="dose" data-value="0\.25"/);
  assert.doesNotMatch(category, /class="p3-dose-grid"|UNKNOWN_NO_SOURCE|Not published/);

  for (const route of ["/3-month/", "/6-month/"]) {
    const bulk = await readRoute(route);
    // A2: this supporting-line status counts only eligible numeric results,
    // not the independently accessible records without a comparable price.
    const declared = bulk.match(/<span class="listing__count"[^>]*\bdata-filter-result\b[^>]*>(\d+) comparable price results<\/span>/i);
    assert.ok(declared, `${route}: active numeric listing result line missing`);
    assert.equal(countMatches(bulk, /class="listing__count"[^>]*\bdata-filter-result\b/g), 1, `${route}: duplicate live status`);
    const numeric = bulk.match(/<section id="provider-results"[\s\S]*?<\/section>/)?.[0] || "";
    const numericCards = tags(numeric, "article").filter((tag) => /\sdata-phase3-provider(?:\s|>)/.test(tag));
    const expected = governedBulkCohorts("SEMAGLUTIDE", Number(route.slice(1).split("-")[0]));
    assert.deepEqual(numericCards.map((tag) => attribute(tag, "data-program")).sort(), expected.numeric.sort(), `${route}: numeric cohort`);
    assert.equal(Number(declared[1]), numericCards.length, `${route}: numeric result status contradicts served cards`);
    const unpriced = bulk.match(/<section\b[^>]*data-unpublished-provider-section[\s\S]*?<\/section>/)?.[0] || "";
    if (expected.unpriced.length) assert.match(unpriced, /Records without a comparable price/, `${route}: unpriced cohort missing`);
    else assert.equal(unpriced, '', `${route}: unexpected unpriced section`);
    const unpricedCards = tags(unpriced, "article").filter((tag) => /\sdata-phase3-provider(?:\s|>)/.test(tag));
    assert.deepEqual(unpricedCards.map((tag) => attribute(tag, "data-program")).sort(), expected.unpriced.sort(), `${route}: unpriced cohort`);
    for (const card of unpricedCards) {
      assert.equal(attribute(card, "data-price-state"), "unpublished", `${route}: unpriced status lost`);
      assert.equal(attribute(card, "data-price"), "", `${route}: unpriced record claims a numeric price`);
    }
    if (!numericCards.length && unpricedCards.length) {
      assert.match(numeric, /No comparable price matches those filters\. Records without a comparable price are listed separately below\./);
      assert.match(numeric, /Active filters: none\./);
      assert.match(numeric, /data-filter-reset/);
    }
  }

  const article = await readRoute("/guides/trimi-vs-yourera/");
  assert.match(article, /data-author-block/);
  assert.match(article, /Curated and evidence-reviewed by <a href="\/authors\/clinic-scout-editorial-team\/">/);
  assert.match(article, /data-faq-disclosure/);
  assert.equal(countMatches(article.match(/data-faq-disclosure[\s\S]*?<\/section>/i)?.[0] || "", /<details\b/gi), 2);

  const pharmacies = await readRoute("/pharmacies/");
  assert.match(pharmacies, /data-pharmacy-additive/);
  assert.equal(countMatches(pharmacies, /data-pharmacy-card(?=[\s>])/g), 75);
  // STALE_FIXTURE under the same D35 mandate as T15's per-card dates (authority
  // reports/ops/glp38-20260915/operator-note-closeout-register.json row D35 note_verbatim:
  // "GLOBAL copy overhaul: simple, short, benefit-led, zero evidence-jargon"). The pharmacy card
  // contract still publishes both facts on all 75 cards, under the shortened labels the overhaul
  // mandates: <dt>Facility location</dt> -> <dt>Location</dt>, <dt>Published services</dt> ->
  // <dt>Services</dt>. The exact count of 75 is unchanged, and the old jargon labels must not come
  // back, so their absence is asserted too.
  assert.equal(countMatches(pharmacies, /<dt>Location<\/dt>/g), 75);
  assert.equal(countMatches(pharmacies, /<dt>Services<\/dt>/g), 75);
  assert.doesNotMatch(pharmacies, /<dt>Facility location<\/dt>|<dt>Published services<\/dt>/);
  assert.doesNotMatch(pharmacies, /<dt>Compounded with<\/dt>|UNKNOWN_NO_SOURCE|>Not published</);
  const redRock = await readRoute("/pharmacies/red-rock/");
  const relatedPharmacies = redRock.match(/<section\b[^>]*data-related-pharmacies[^>]*>[\s\S]*?<\/section>/i)?.[0] || "";
  assert.equal(countMatches(relatedPharmacies, /href="\/pharmacies\//g), 3);
  for (const route of ["/pharmacies/strive/compare-providers/", "/pharmacies/the-pharmacy-hub/compare-providers/"]) {
    const reverse = await readRoute(route);
    assert.match(reverse, /Verified source relationship/);
    assert.match(reverse, /href="https:\/\/enhance\.md\/faq"/);
    assert.match(reverse, /href="\/providers\/enhance-md\/"/);
  }

  const insights = await readRoute("/insights/");
  const insightImages = tags(insights, "img").filter((tag) => /guide-/.test(attribute(tag, "src") || ""));
  assert.ok(insightImages.length > 0);
  assert.equal(new Set(insightImages.map((tag) => attribute(tag, "src"))).size, insightImages.length, "G-8 repeats primary article art");
  assert.equal(insightImages.every((tag) => attribute(tag, "width") === "1600" && attribute(tag, "height") === "900" && attribute(tag, "srcset")), true);
  assert.equal(countMatches(insights, /type="image\/avif"/g), insightImages.length);
  assert.equal(countMatches(insights, /type="image\/webp"/g), insightImages.length);

  const o35 = graph.canonical_served_equivalents.o35_mounjaro_coupon;
  assert.equal(o35.requested_route, "/guides/mounjaro-coupon/");
  assert.equal(o35.served_route, "/guides/mounjaro-coupon/");
  const canonicalEquivalent = await readRoute(o35.served_route);
  assert.match(canonicalEquivalent, /<link rel="canonical" href="https:\/\/glpclinicscout\.com\/guides\/mounjaro-coupon\/">/);
});

test("D47 and D48 ship the insurance input contract, three FAQs, and related shelf on every brand page", async () => {
  for (const page of graph.brand_pages) {
    const html = await readRoute(page.route);
    const wizard = html.match(/<section\b[^>]*class="[^"]*p3-insurance[^"]*"[\s\S]*?<\/section>/i)?.[0];
    assert.ok(wizard, `${page.route}: insurance wizard missing`);
    assert.match(wizard, /\bdata-insurance-wizard\b/);

    const inputs = tags(wizard, "input");
    const slider = inputs.find((tag) => attribute(tag, "type") === "range");
    assert.ok(slider, `${page.route}: insurance slider missing`);
    assert.equal(attribute(slider, "name"), "coverage");
    assert.equal(attribute(slider, "min"), "0");
    assert.equal(attribute(slider, "max"), "3");
    assert.equal(attribute(slider, "step"), "1");
    assert.equal(attribute(slider, "value"), "0");

    const labelMarkup = wizard.match(/<div class="p3-progress-labels"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    assert.deepEqual([...labelMarkup.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map(match => match[1]), ["Not covered / unsure", "Probably not", "Probably", "Covered"]);
    assert.doesNotMatch(wizard, /name="(?:progress|oop_max|oop_spent)"|Plan progress|Not started|Early|Most met/);

    const numberInputs = inputs.filter((tag) => attribute(tag, "type") === "number");
    // Ruling reports/ops/glp38-20260915/FABLE-RULING-20260917-candidate-test-debt.md (T14,
    // WO-11): STALE_FIXTURE, repaired to the current mandate. Authority
    // reports/ops/glp38-20260915/operator-note-closeout-register.json row D47 note_verbatim:
    // "estimated monthly out-of-pocket input + common-copay quick picks ($0/$25/$50/$75)".
    // The estimated monthly out-of-pocket input is required; D48 checks remain below.
    assert.deepEqual(numberInputs.map((tag) => attribute(tag, "name")), ["monthly_oop"]);
    assert.deepEqual(dataValues(wizard, "data-copay"), ["0", "25", "50", "75"]);
    assert.match(wizard, /<output\b[^>]*data-insurance-result[^>]*>/i);
    assert.match(wizard, /does not verify coverage, prior authorization, eligibility, or the price a pharmacy will charge/i);

    // Ruling reports/ops/glp38-20260915/FABLE-RULING-20260917-candidate-test-debt.md (T14, WO-11):
    // second STALE_FIXTURE clause on this test, reached only once the first was repaired. The three
    // D48 accordions are served by the ACTIVE brand composition - listingDrugPanel's
    // <div class="listing__drug-faq"> inside <section class="listing__drug-panel"> - while the
    // legacy <section class="p3-accordions"> belongs to the retired brand page function that
    // src/phase3-page-graph.mjs keeps only as migration reference and never calls. Authority
    // reports/ops/glp38-20260915/operator-note-closeout-register.json row D48 note_verbatim:
    // "Product-page FAQ accordions on the card (What is X / How does it work / Benefits)".
    // The exact count of three accordions and three summaries is unchanged.
    const accordions = html.match(/<div\b[^>]*class="[^"]*listing__drug-faq[^"]*"[\s\S]*?<\/div>/i)?.[0];
    assert.ok(accordions, `${page.route}: FAQ section missing`);
    assert.equal(countMatches(accordions, /<details\b/gi), 3, `${page.route}: expected exactly three FAQ accordions`);
    assert.equal(countMatches(accordions, /<summary\b/gi), 3, `${page.route}: expected exactly three FAQ summaries`);

    const related = html.match(/<section\b[^>]*class="[^"]*p3-related[^"]*"[\s\S]*?<\/section>/i)?.[0];
    assert.ok(related, `${page.route}: related shelf missing`);
    const siblingRoutes = graph.brand_pages.filter((item) => item.route !== page.route).map((item) => item.route);
    const relatedBrandLinks = dataValues(related, "href")
      .map((href) => href.replaceAll("&amp;", "&"))
      .filter((href) => siblingRoutes.some((route) => href.startsWith(`${route}?`)));
    assert.equal(relatedBrandLinks.length, 3, `${page.route}: related shelf must contain three sibling brands`);
    for (const href of relatedBrandLinks) {
      const params = new URL(href, SITE).searchParams;
      assert.ok(params.get("drug") && params.get("form") && params.get("sort") === "cheapest", `${page.route}: sibling intent was not preserved`);
    }
  }
});

test('F06 D35 current producer retains exact price witnesses without LP card dates', async () => {
  const pricingMatrix = JSON.parse(await readFile(path.join(ROOT, 'data/provider-pricing-matrix.json'), 'utf8'));
  const built = buildPhase3PageGraph({ graph, pharmacyInput, pricingMatrix, programRegistry: registry,
    homeSpec: { rows: [] }, articles: carrierArticles, couponOffersByProgram: {} });
  const assertDates = doc => {
    const cards = [...doc.querySelectorAll('.p3-provider-card')];
    assert.ok(cards.length);
    for (const card of cards) assert.equal(card.querySelectorAll('time').length, 0, 'LP per-card checked dates forbidden by D35');
    const dates = [...doc.querySelectorAll('[data-source-checked]')].map(e => e.dataset.sourceChecked).sort();
    assert.ok(dates.length);
    assert.equal(doc.querySelector('[data-prices-checked-date]')?.textContent, `${dates[0]} – ${dates.at(-1)}`, 'route window encompasses every source');
  };
  for (const config of graph.compounded_pages) {
    const page = built.pages.find(p => p.route === config.route);
    const dom = new JSDOM(javascriptProviderMarkup(page.html));
    const doc = dom.window.document;
    assertDates(doc);
    for (const card of doc.querySelectorAll('.p3-provider-card:not([data-unpublished-price-card])')) {
      const meds = card.dataset.medications.split(/\s+/);
      const entry = Object.values(pricingMatrix.providers).find(e => e.program_id === card.dataset.program);
      assert.ok(entry);
      assert.equal(card.querySelector('.p3-provenance')?.textContent, 'Reported information', 'reported provenance remains explicit');
      assertCurrentCardPrice(card.outerHTML, entry.medications.filter(r => meds.includes(r.medication_id)), { showDate: false });
    }
    const first = doc.querySelector('.p3-provider-card');
    first.insertAdjacentHTML('beforeend', '<time datetime="2026-09-01">2026-09-01</time>');
    assert.throws(() => assertDates(doc), /per-card checked dates/);
    dom.window.close();
  }
});

test("D49-D51 serve the complete category filter matrix, state override, and evidence-bound aurora cards", async () => {
  assert.equal(graph.compounded_pages.length, 2);

  for (const page of graph.compounded_pages) {
    const html = await readRoute(page.route);
    assertPaidLandingDocument(html, page.route);
    assert.match(html, /\bdata-provider-filters\b/);
    assert.match(html, /\bdata-state-heading\b/, `${page.route}: dynamic state H1 hook missing`);

    const buttons = tags(html, "button");
    const valuesFor = (filter) => buttons
      .filter((tag) => attribute(tag, "data-filter") === filter)
      .map((tag) => attribute(tag, "data-value"));

    assert.deepEqual(valuesFor("type"), ["compounded", "brand", "microdose"]);
    assert.deepEqual(valuesFor("plan"), ["both", "1", "3", "more"]);
    assert.deepEqual(valuesFor("duration"), ["all", "6", "starter", "step-up"]);
    assert.deepEqual(valuesFor("dose"), ["all", ...DOSES_BY_MEDICATION[page.medication_id]]);
    assert.deepEqual(valuesFor("sort"), ["cheapest", "best"]);

    assert.match(html, /\bdata-state-open\b/);
    assert.match(html, /role="listbox"[^>]*aria-label="Choose state"/i);
    assert.match(html, /\bdata-state-search\b/);
    assert.deepEqual(dataValues(html, "data-state"), STATE_CODES);

    const allCards = [...html.matchAll(/<article\b[^>]*class="[^"]*p3-provider-card[^"]*"[\s\S]*?<\/article>/gi)].map((match) => match[0]);
    // Ruling reports/ops/glp38-20260915/FABLE-RULING-20260917-candidate-test-debt.md (T15, WO-11):
    // third clause on this test, reached only once the state-heading product defect was fixed. The
    // active listing renderer appends the unpublished-price card class alongside the source-backed
    // cards (src/phase3-page-graph.mjs unpublishedProviderCards). Those rows deliberately publish
    // no price and no dose - fabricating either would violate the evidence rule that missing
    // evidence is unknown, not zero - so the D51 evidence-bound contract below belongs to the
    // source-backed class. Nothing is skipped silently: every excluded row must be explicitly
    // marked AND must claim neither a price nor a dose.
    const cards = allCards.filter((card) => !/\bdata-unpublished-price-card\b/.test(card));
    const unpublishedCards = allCards.filter((card) => /\bdata-unpublished-price-card\b/.test(card));
    assert.equal(cards.length + unpublishedCards.length, allCards.length, `${page.route}: a served card is neither source-backed nor marked unpublished`);
    for (const card of unpublishedCards) {
      assert.doesNotMatch(card, /\bdata-price="[^"]+"/, `${page.route}: an unpublished card published a price`);
      assert.doesNotMatch(card, /\bdata-dose="[^"]+"/, `${page.route}: an unpublished card published a dose`);
    }
    assert.ok(cards.length > 0, `${page.route}: no source-backed provider card was served`);
    for (const card of cards) {
      assert.match(card, /class="p3-card-aurora"/);
      assert.match(card, /\bdata-dose="[^"]+"/);
      const price = Number(attribute(card.match(/<article\b[^>]*>/i)[0], "data-price"));
      assert.ok(Number.isFinite(price) && price >= 0, `${page.route}: invalid governed card price`);
      // STALE_FIXTURE clause found while clearing T15's state-heading product defect
      // (ruling reports/ops/glp38-20260915/FABLE-RULING-20260917-candidate-test-debt.md, T15/WO-11).
      // Authority reports/ops/glp38-20260915/operator-note-closeout-register.json row D35
      // note_verbatim: 'GLOBAL copy overhaul ... ("capture hashed", per-card checked-dates all
      // die)'. Per-card checked dates are retired in the producer; the provenance requirement is
      // not dropped, it moves to the machine-readable data-source-checked attribute.
      assert.doesNotMatch(card, /<time\b[^>]*datetime="\d{4}-\d{2}-\d{2}"/);
      assert.match(card, /\bdata-source-checked="\d{4}-\d{2}-\d{2}"/);
      assert.match(card, /data-provider-card-contract="option-c"/);
      assert.equal(countMatches(card, /<dt>/g), 3);
      for (const label of ["Medications offered", "Total monthly cost", "Cancellation"]) assert.match(card, new RegExp(`<dt>${label}<\\/dt>`));
      assert.match(card, /data-citation="inline_fact_source"/);
      assert.doesNotMatch(card, /Dose-level price check|Not published|UNKNOWN_NO_SOURCE|p3-dose-grid/);
    }
  }
});

test("the bulk hub serves exactly four query intents backed by two durable canonical pages", async () => {
  assert.equal(graph.bulk_pages.length, 2);
  assert.equal(graph.bulk_intents.length, 4);

  const hub = await readRoute("/bulk/");
  const expectedHrefs = graph.bulk_intents.map((intent) => intent.href);
  const intentGrid = hub.match(/<div\b[^>]*class="[^"]*p3-intent-grid[^"]*"[^>]*>[\s\S]*?<\/div>/i)?.[0];
  assert.ok(intentGrid, "bulk intent grid missing");
  const servedHrefs = tags(intentGrid, "a").map((tag) => attribute(tag, "href").replaceAll("&amp;", "&")).filter((href) => expectedHrefs.includes(href));
  assert.deepEqual(servedHrefs, expectedHrefs);
  assert.equal(new Set(servedHrefs).size, 4);

  const contract = graph.bulk_intents.map((intent) => {
    const url = new URL(intent.href, SITE);
    const expectedKeys = normalizeRoute(url.pathname) === "/3-month/" ? ["drug", "form", "plan", "sort"] : ["drug", "form", "duration", "sort"];
    assert.deepEqual([...url.searchParams.keys()], expectedKeys);
    return `${normalizeRoute(url.pathname)}?${url.searchParams.toString()}`;
  });
  assert.deepEqual(contract, [
    "/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest",
    "/3-month/?drug=TIRZEPATIDE&form=COMPOUNDED&plan=3&sort=cheapest",
    "/6-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&duration=6&sort=cheapest",
    "/6-month/?drug=TIRZEPATIDE&form=COMPOUNDED&duration=6&sort=cheapest",
  ]);

  for (const page of graph.bulk_pages) {
    const html = await readRoute(page.route);
    assertCanonicalDocument(html, page.route);
    // Ruling FABLE-RULING-20260917-candidate-test-debt.md (T16, WO-11): STALE_FIXTURE by ruling.
    // The four-intent / two-canonical-page contract above is served and stays exact; only the
    // legacy hooks and literals of the retired bulkPage renderer are repaired to the active
    // archetype-A listing renderer. Medication chooser: the "treatment" chip group. Grid hook:
    // data-phase3-provider-grid. Bundle-math wording: the listing renderer's own boundary copy.
    assert.match(html, /data-filter-group="treatment"/);
    assert.deepEqual(filterValues(html, "treatment"), ["SEMAGLUTIDE", "TIRZEPATIDE"]);
    assert.match(html, /\bdata-phase3-provider-grid\b/);
    assert.match(html, /The cited provider wording controls; Clinic Scout does not invent bundle math\./);
    const durationCards = [...html.matchAll(/<article\b[^>]*\bdata-duration="([^"]*)"/g)];
    // The source-derived 6-month cohort can be empty; do not confuse a static
    // card count with the browser reset and no-JS effects asserted above.
    const expected = governedBulkCohorts('SEMAGLUTIDE', page.duration_months);
    assert.equal(durationCards.length, expected.numeric.length + expected.unpriced.length, `${page.route}: served duration cohort drift`);
    for (const card of durationCards) {
      assert.ok(card[1].split(/\s+/).includes(String(page.duration_months)), `${page.route}: served card duration "${card[1]}" excludes ${page.duration_months}`);
    }
  }
});

test("Insights index pages expose the featured-card rhythm and every linked article is upgraded in served bytes", async () => {
  const sitemap = parseSitemap(await readFile(path.join(PUBLIC, "sitemap.xml"), "utf8"));
  const insightIndexRoutes = sitemap
    .map((url) => normalizeRoute(url.pathname))
    .filter((route) => route === "/insights/" || /^\/insights\/page\/\d+\/$/.test(route))
    .sort((left, right) => {
      const pageNumber = (route) => route === "/insights/" ? 1 : Number(route.match(/\d+/)[0]);
      return pageNumber(left) - pageNumber(right);
    });
  assert.ok(insightIndexRoutes.length > 0, "Insights index is absent from the sitemap");

  const articleRoutes = [];
  for (const route of insightIndexRoutes) {
    const html = await readRoute(route);
    assertCanonicalDocument(html, route);
    assert.match(html, /\bdata-subscribe-open\b/);
    assert.match(html, /class="p3-pagination"/);

    const cycles = [...html.matchAll(/<section\b[^>]*class="[^"]*p3-insight-cycle[^"]*"[\s\S]*?<\/section>/gi)].map((match) => match[0]);
    assert.ok(cycles.length > 0, `${route}: no editorial cycle served`);
    for (const cycle of cycles) {
      const cycleAnchors = tags(cycle, "a");
      assert.equal(cycleAnchors.filter((tag) => (attribute(tag, "class") || "").split(/\s+/).includes("p3-feature-story")).length, 1);
      assert.ok(cycleAnchors.filter((tag) => (attribute(tag, "class") || "").split(/\s+/).includes("p3-story")).length <= 3);
    }

    for (const anchorTag of tags(html, "a")) {
      const classes = attribute(anchorTag, "class") || "";
      if (/\bp3-(?:feature-story|story)\b/.test(classes)) articleRoutes.push(normalizeRoute(attribute(anchorTag, "href")));
    }
  }

  assert.ok(articleRoutes.length > 0, "Insights indexes do not link any articles");
  assert.equal(new Set(articleRoutes).size, articleRoutes.length, "an article appears more than once across Insights pages");
  for (const route of articleRoutes) {
    assert.ok(await routeExists(route), `${route}: Insights card target is a 404`);
    const html = await readRoute(route);
    assert.match(html, /<main\b[^>]*data-phase3-article="true"/i, `${route}: article upgrade marker missing`);
    assert.match(html, /href="\/insights\/">Insights<\/a>/);
    assert.match(html, /class="p3-article-share"/);
    assert.match(html, /class="p3-keep-reading"/);
    assert.doesNotMatch(html, /<nav\b[^>]*class="[^"]*guide-toc/i);
  }
});

test("all 90 pharmacy detail pages remain served while the default grid contains 75 qualified cards", async () => {
  const { pageSeoCopy } = await import("../src/page-seo-copy.mjs");
  assert.equal(pharmacyInput.entry_count, 90);
  assert.equal(pharmacyInput.entries.length, 90);
  assert.equal(new Set(pharmacyInput.entries.map((entry) => entry.route)).size, 90);

  const hub = await readRoute("/pharmacies/");
  assert.equal(countMatches(hub, /data-pharmacy-card(?=[\s>])/g), 75);

  for (const entry of pharmacyInput.entries) {
    const detail = await readRoute(entry.route);
    assertCanonicalDocument(detail, entry.route);
    assert.match(detail, /"@type":"Pharmacy"/);
    assert.match(
      detail,
      new RegExp(
        `<h1 class="p3-wrap-title" data-wrap-text>${escapeRegExp(escapeHtml(pageSeoCopy(entry.route)?.h1 || entry.display_name))}<\\/h1>`,
      ),
    );
    assert.match(detail, new RegExp(`${entry.evidence_summary.citation_count} citations`));
    assert.match(detail, new RegExp(`${entry.unverified_fields.length} explicit unknowns`));

    const relationships = verifiedRelationships(entry);
    const reverseRoute = `${entry.route}compare-providers/`;
    if (relationships.length) {
      assert.match(detail, new RegExp(`href="${escapeRegExp(reverseRoute)}"`));
      const reverse = await readRoute(reverseRoute);
      assertCanonicalDocument(reverse, reverseRoute);
      assert.equal(countMatches(reverse, /Verified source relationship/g), relationships.length);
      for (const relationship of relationships) {
        assert.match(reverse, new RegExp(`href="${escapeRegExp(relationship.source_url)}"`));
        assert.match(reverse, new RegExp(`href="/providers/${escapeRegExp(relationship.program_id)}/"`));
      }
    } else {
      assert.doesNotMatch(detail, /href="[^"]*compare-providers\/"/);
      assert.equal(await routeExists(reverseRoute), false, `${reverseRoute}: unsourced reverse page was published`);
    }
  }
});

test("D54 redirects resolve to served canonical targets with no retired files, chains, cycles, or sitemap orphans", async () => {
  assert.equal(graph.retired_evidence_wall_redirects.length, 12);
  const rawRedirects = await readFile(path.join(PUBLIC, "_redirects"), "utf8");
  const redirects = parseRedirects(rawRedirects);
  const redirectMap = new Map(redirects.map((row) => [row.from, row]));

  for (const [fromValue, toValue] of [...graph.retired_evidence_wall_redirects, ...graph.legacy_redirects].filter(([from]) => from !== "/best/online-glp-1-providers/")) {
    const from = normalizeRoute(fromValue);
    const to = normalizeRoute(toValue);
    const row = redirectMap.get(from);
    assert.ok(row, `${from}: redirect entry missing`);
    assert.equal(row.to, to, `${from}: wrong redirect target`);
    assert.equal(row.status, "301", `${from}: redirect must be permanent`);
  }

  for (const [fromValue] of graph.retired_evidence_wall_redirects) {
    assert.equal(await routeExists(fromValue), false, `${fromValue}: retired D54 HTML still exists`);
  }

  for (const row of redirects) {
    const seen = new Set([row.from]);
    let target = row.to;
    while (redirectMap.has(target)) {
      assert.equal(seen.has(target), false, `redirect cycle: ${[...seen, target].join(" -> ")}`);
      seen.add(target);
      target = redirectMap.get(target).to;
    }
    assert.equal(await routeExists(target), true, `${row.from}: final redirect target ${target} is a 404`);
  }
});

// GLP-38 W18/WO-11 ("no dropped routes"): a route may leave this site only by a
// RULING, never by attrition. The eight routes W18 reported as "absent from the
// built tree though the page graph lists them" were all declared redirect
// sources - D54 delete-ours plus the /guides -> /insights editorial merge - but
// nothing in the graph carried the ruling that retired them, so a genuine
// producer drop and a deliberate retirement looked identical from the artifact.
// retirement_receipts closes that: every declared retirement names its ruling,
// and an unreceipted or orphaned one fails here.
test("every declared route retirement carries its ruling receipt and none is still emitted as a page", async () => {
  const receipts = graph.retirement_receipts;
  assert.ok(receipts && typeof receipts === "object", "graph.retirement_receipts is missing");
  const declared = new Map([...graph.retired_evidence_wall_redirects, ...graph.legacy_redirects]);
  const [pricingMatrix, programRegistry] = await Promise.all([
    readFile(path.join(ROOT, "data/provider-pricing-matrix.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "data/program-registry.json"), "utf8").then(JSON.parse),
  ]);
  const retirementBuild = buildPhase3PageGraph({
    graph,
    pharmacyInput,
    pricingMatrix,
    programRegistry,
    homeSpec: { rows: [] },
    articles: carrierArticles,
    couponOffersByProgram: {},
  });
  const emitted = new Set(retirementBuild.pages.map((page) => page.route));

  for (const [from, to] of declared) {
    const receipt = receipts[from];
    assert.ok(receipt, `${from}: retired with no receipt in graph.retirement_receipts`);
    assert.equal(receipt.target, to, `${from}: receipt target ${receipt.target} != declared redirect target ${to}`);
    assert.ok(String(receipt.ruling || "").length > 0, `${from}: receipt names no ruling`);
    assert.ok(Array.isArray(receipt.ruling_pointers) && receipt.ruling_pointers.length > 0, `${from}: receipt cites no ruling pointer`);
    assert.equal(emitted.has(from), false, `${from}: receipted as retired yet the producer still emits it as a page`);
    assert.equal(await routeExists(from), false, `${from}: receipted as retired yet a physical page shadows the redirect`);
  }

  for (const route of Object.keys(receipts)) {
    assert.equal(declared.has(route), true, `${route}: retirement receipt with no matching declaration - the retirement was undone or the declaration dropped`);
  }
});

test("sitemap includes Phase 3 canonicals and the governed review hub, while excluding redirects, query variants, and submission/search routes", async () => {
  const xml = await readFile(path.join(PUBLIC, "sitemap.xml"), "utf8");
  const urls = parseSitemap(xml);
  const routes = urls.map((url) => normalizeRoute(url.pathname));
  const routeSet = new Set(routes);
  assert.equal(routeSet.size, routes.length, "duplicate sitemap loc");
  assert.equal(urls.some((url) => url.search), false, "query intent leaked into sitemap");
  assert.equal(countMatches(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g), urls.length);

  const verifiedReverseRoutes = pharmacyInput.entries
    .filter((entry) => verifiedRelationships(entry).length > 0)
    .map((entry) => `${entry.route}compare-providers/`);
  const required = [
    ...CANONICAL_HUBS,
    ...graph.brand_pages.map((page) => page.route),
    ...graph.bulk_pages.map((page) => page.route),
    ...pharmacyInput.entries.map((entry) => entry.route),
    ...verifiedReverseRoutes,
  ];
  for (const route of required) assert.equal(routeSet.has(normalizeRoute(route)), true, `${route}: missing from sitemap`);
  for (const page of graph.compounded_pages) {
    assert.equal(routeSet.has(normalizeRoute(page.route)), false, `${page.route}: paid LP leaked into sitemap`);
    assertPaidLandingDocument(await readRoute(page.route), page.route);
  }

  const redirectRows = parseRedirects(await readFile(path.join(PUBLIC, "_redirects"), "utf8"));
  for (const { from } of redirectRows) assert.equal(routeSet.has(from), false, `${from}: redirect source leaked into sitemap`);

  const nonVerifiedReverseRoutes = pharmacyInput.entries
    .filter((entry) => verifiedRelationships(entry).length === 0)
    .map((entry) => `${entry.route}compare-providers/`);
  for (const route of nonVerifiedReverseRoutes) {
    assert.equal(routeSet.has(normalizeRoute(route)), false, `${route}: unsourced comparison leaked into sitemap`);
  }

  assert.equal(routeSet.has("/reviews/"), true, "/reviews/: governed review directory missing from sitemap");
  assert.equal(await routeExists("/reviews/"), true, "/reviews/: governed review directory was not published");
  assert.equal(routeSet.has("/reviews/submit/"), false, "/reviews/submit/: moderation intake leaked into sitemap");
  assert.equal(await routeExists("/reviews/submit/"), true, "/reviews/submit/: governed moderation intake is missing");
  assert.match(await readRoute("/reviews/submit/"), /<meta name="robots" content="noindex,follow,noarchive,nosnippet">/);
  for (const route of ["/reviews/new/", "/reviews/search/"]) {
    assert.equal(routeSet.has(route), false, `${route}: public patient-review surface leaked into sitemap`);
    assert.equal(await routeExists(route), false, `${route}: public patient-review surface was published`);
  }
});

test("served Phase 3 HTML publishes neither patient-review schema nor unsupported rating schema", async () => {
  const aggregateRating = /"@type"\s*:\s*"AggregateRating"|"aggregateRating"\s*:/i;
  const phase3ReviewOrRating = /"@type"\s*:\s*"Review"|"(?:reviewRating|ratingValue|bestRating|worstRating)"\s*:/i;
  const files = await htmlFiles(PUBLIC);
  assert.ok(files.length > 0);
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const relative = path.relative(PUBLIC, file);
    assert.doesNotMatch(html, aggregateRating, `${relative}: unsupported aggregate rating schema`);
    if (/\bdata-phase3-(?:route|article)=/.test(html)) {
      assert.doesNotMatch(html, phase3ReviewOrRating, `${relative}: Phase 3 review/rating schema is unsupported`);
    }
  }
});

test("served paid comparison routes retain Phase 3 art while staying on the lean request path", async () => {
  for (const page of graph.compounded_pages) {
    const html = await readRoute(page.route);
    const shelf = html.match(/<section\b[^>]*data-related-insights-shelf[\s\S]*?<\/section>/i)?.[0] || "";
    assert.match(html, /href="\/assets\/site-editorial\.css\?v=/);
    assert.doesNotMatch(html, /href="\/assets\/site\.css\?v=/);
    assert.equal(countMatches(shelf, /<picture class="p3-story-picture"/g), 3);
    assert.equal(countMatches(shelf, /<img src="\/assets\/images\/guide-[^"]+-800\.avif"/g), 3);
    assert.doesNotMatch(shelf, /<source\b|\bsrcset=/);
    assert.doesNotMatch(shelf, /<img\b[^>]*\bsrc="[^"]+-1600\./i);
  }
});

test("served money surfaces place the source and affiliate disclosure above the first price", async () => {
  for (const route of [
    "/lp/best-providers/compounded-semaglutide/",
    "/self-pay/",
    "/wegovy/",
    "/3-month/",
  ]) {
    const html = await readRoute(route);
    const body = html.slice(html.indexOf("<body"));
    const disclosure = body.search(/class="[^"]*p3-source-disclosure[^"]*affiliate-note[^"]*"/);
    const firstPrice = body.search(/\$\s?\d/);
    assert.ok(disclosure >= 0, `${route} lacks its served disclosure`);
    assert.ok(firstPrice >= 0, `${route} lacks a served price row`);
    assert.ok(disclosure < firstPrice, `${route} puts price evidence before its disclosure`);
    assert.match(body, /Price-source links go directly to the provider page Clinic Scout checked/);
  }
  const css = await readFile(path.join(PUBLIC, "assets/site.css"), "utf8");
  assert.match(css, /\.p3-source-disclosure\s*\{/);
});

test("canonical provider details serve the W18 mobile action-bar contract", async () => {
  const registry = JSON.parse(await readFile(path.join(ROOT, "data/program-registry.json"), "utf8"));
  for (const program of detailPrograms(registry, graph)) {
    const route = `/providers/${program.program_id}/`;
    const html = await readRoute(route);
    assert.equal(countMatches(html, /data-provider-sticky(?:\s|>)/g), 1, route);
    assert.match(html, new RegExp(`data-provider-sticky data-program="${escapeRegExp(program.program_id)}"`));
    assert.match(html, new RegExp(`href="/quiz/provider-fit/\\?source=provider-sticky&amp;provider=${escapeRegExp(program.program_id)}" data-provider-sticky-primary`));
  }
  const css = await readFile(path.join(PUBLIC, "assets/site.css"), "utf8");
  assert.match(css, /\.p3-provider-sticky\s*\{/);
  assert.match(css, /min-height:\s*81px/);
  assert.match(css, /position:\s*fixed/);
});

