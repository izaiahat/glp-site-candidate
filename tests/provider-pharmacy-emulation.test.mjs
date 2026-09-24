// GLPWinner-emulation pass — provider detail + pharmacy hub/detail markup
// pins (PAGE-SPECS-20260826/provider-pharmacy spec §5 F1/F2/F4/F5/F7/F10/F12).
// In-memory renders only: these pins bind the SOURCE renderers so the next
// `npm run build` cannot regress the emulation anatomy. Honesty, tracking, and
// a11y assertions here may be extended but never weakened.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPhase3PageGraph } from "../src/phase3-page-graph.mjs";
import { isTypedPrice } from "../src/typed-price-labels.mjs";
import { detailPrograms } from './helpers/d2w-s9-contracts.mjs';

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const graph = JSON.parse(await readFile(path.join(ROOT, "data/phase3-page-graph.json"), "utf8"));
const carrierCatalogs = await Promise.all(["content-batch.json", "content-national-wow-additions.json"].map(async (file) =>
  JSON.parse(await readFile(path.join(ROOT, "data/blog", file), "utf8"))));
// Match build-staging.mjs articleVertical and its complete GLP guide input.
const carrierOtherVertical = /(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/;
const carrierArticles = carrierCatalogs.flatMap((catalog) => catalog.articles).filter((article) =>
  String(article.canonical_path || "").startsWith("/guides/") && !carrierOtherVertical.test(article.canonical_path));
const pharmacyInput = JSON.parse(await readFile(path.join(ROOT, "data/phase3-pharmacy-render-input.json"), "utf8"));
const pricingMatrix = JSON.parse(await readFile(path.join(ROOT, "data/provider-pricing-matrix.json"), "utf8"));
const programRegistry = JSON.parse(await readFile(path.join(ROOT, "data/program-registry.json"), "utf8"));
const detailCss = await readFile(path.join(ROOT, "assets/css-src/30-provider-detail.css"), "utf8");
const phaseCss = await readFile(path.join(ROOT, "assets/css-src/11-phase3.css"), "utf8");

const ownedArticles = (count) => Array.from({ length: count }, (_, index) => ({
  canonical_path: `/guides/lane-e-owned-guide-${index + 1}/`,
  h1: `Clinic Scout owned guide ${index + 1}`,
  meta_description: `Source-checked owned description ${index + 1}.`,
  direct_answer: `Bound editorial answer ${index + 1}.`,
  vertical: "GLP-1",
}));

const built = buildPhase3PageGraph({
  graph,
  pharmacyInput,
  pricingMatrix,
  programRegistry,
  homeSpec: { rows: [] },
  articles: carrierArticles,
  couponOffersByProgram: {},
});
const byRoute = new Map(built.pages.map((page) => [page.route, page.html]));
const countMatches = (html, pattern) => (html.match(pattern) || []).length;
const verifiedRelationships = (entry) => (entry.provider_relationships || []).filter((row) => row?.status === "verified" && row.program_id && row.source_url);

// Plan cards vs the empty state are chosen by the PRODUCER's own predicate, not by a
// second one invented here: src/phase3-page-graph.mjs:992 keeps the rows where
// `isTypedPrice(row) || Number.isFinite(row.ongoing_usd)` and renders plan cards when any
// survive (:1022), the empty state at :1023 otherwise. A labelled advertised-starting-price
// row is a source-dated row under the honest-pricing contract, so it counts as priced here
// too; only a provider with NO source-dated row at all takes the empty state.
const pricedProgramIds = new Set(Object.values(pricingMatrix.providers || {})
  .filter((entry) => (entry.medications || []).some((row) => isTypedPrice(row) || Number.isFinite(row.ongoing_usd)))
  .map((entry) => entry.program_id));

// Ruling item 8: the exact-dose-ladder totals are COMPUTED from the matrix, never hardcoded.
// data/provider-pricing-matrix.json carries no dose_pricing today because the S8 pricing-waiver
// rulings mademed:0:compounded-semaglutide-injection and mademed:2:compounded-tirzepatide-injection
// moved MadeMed's exact ladders to PENDING (data/pricing-waivers/S8-rulings.json), so "only exact
// source-reported ladders render" is satisfied 0-of-0. The retirement guard below is NOT
// tautological: a historical exact ladder may only disappear WITH its own PENDING waiver receipt,
// so a ladder dropped silently - without a ruling naming it - still fails this test.
const s8Rulings = JSON.parse(await readFile(path.join(ROOT, "data/pricing-waivers/S8-rulings.json"), "utf8"));
const exactLadderRows = (entry) => (entry?.medications || []).filter((row) =>
  row.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE" && row.dose_pricing.render_action === "RENDER");
const liveLadders = Object.values(pricingMatrix.providers || {}).flatMap((entry) =>
  exactLadderRows(entry).map((row) => ({ program_id: entry.program_id, medication_id: row.medication_id, tiers: (row.dose_pricing.tiers || []).length })));
const expectedDoseGrids = liveLadders.length;
const expectedDoseSlots = liveLadders.reduce((total, row) => total + row.tiers, 0);
const historicalLadders = s8Rulings.filter((ruling) =>
  ruling.baseline_row?.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE"
  && ruling.baseline_row.dose_pricing.render_action === "RENDER");
const walkedDetailPrograms = new Set(detailPrograms(programRegistry, graph).map((program) => program.program_id));

test("provider detail renders Treatments and only exact source-reported dose ladders", () => {
  let doseGrids = 0;
  let doseRows = 0;
  for (const program of detailPrograms(programRegistry, graph)) {
    const html = byRoute.get(`/providers/${program.program_id}/`);
    assert.ok(html, `${program.program_id}: detail page missing`);
    assert.match(html, /class="p3-page p3-detail-page"/);
    assert.match(html, /<h2 [^>]*>Treatments<\/h2>|<h2>Treatments<\/h2>/);
    if (pricedProgramIds.has(program.program_id)) {
      assert.match(html, /data-provider-plans/, program.program_id);
      assert.match(html, /class="p3-plan-grid" data-plan-grid/, program.program_id);
      assert.ok(countMatches(html, /data-plan-card/g) >= 1, program.program_id);
      const exactRows = Object.values(pricingMatrix.providers || {})
        .find((entry) => entry.program_id === program.program_id)
        ?.medications?.filter((row) => row.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE" && row.dose_pricing.render_action === "RENDER") || [];
      const expectedDoseRows = exactRows.reduce((total, row) => total + row.dose_pricing.tiers.length, 0);
      assert.equal(countMatches(html, /<details class="p3-dose-grid"[^>]* open>/g), exactRows.length, `${program.program_id}: detail-only exact dose grids`);
      assert.equal(countMatches(html, /data-dose-row=/g), expectedDoseRows, `${program.program_id}: exact source-reported dose rows`);
      if (!exactRows.length) assert.doesNotMatch(html, /class="p3-dose-head"/, `${program.program_id}: no reserved dose grid`);
      doseGrids += exactRows.length;
      doseRows += expectedDoseRows;
      // price provenance stays attached (keep-list: Checked date + source quote)
      assert.match(html, /Price rows checked <time/, program.program_id);
      // typed price provenance stays ATTACHED (ruling item 7): one source anchor per priced
      // row plus the captured-wording disclosure that carries the quote. The retired
      // <summary>Price source</summary> shape is NOT accepted as an alternative.
      assert.ok(countMatches(html, />Price source<\/a>/g) >= 1, `${program.program_id}: typed price-source anchor`);
      assert.ok(countMatches(html, /Captured wording<\/summary>/g) >= 1, `${program.program_id}: captured-wording disclosure`);
    } else {
      assert.match(html, /No current source-dated price row is bound\./, program.program_id);
    }
  }
  // Ruling item 8: computed totals + the receipted retirement guard (never a hardcoded count).
  assert.ok(historicalLadders.length >= 1, "S8-rulings.json must still carry the historical exact-ladder receipts");
  for (const ruling of historicalLadders) {
    const stillLive = liveLadders.some((row) => row.program_id === ruling.provider_id
      && row.medication_id === ruling.baseline_row.medication_id);
    if (stillLive) continue;
    assert.equal(ruling.status, "PENDING", `${ruling.row_id}: exact ladder retired without a PENDING S8 waiver ruling`);
    assert.ok(String(ruling.candidate_provider?.unavailable_reason || "").trim().length > 0,
      `${ruling.row_id}: a retired exact ladder needs its unavailable_reason receipt`);
  }
  for (const row of liveLadders) {
    assert.ok(walkedDetailPrograms.has(row.program_id),
      `${row.program_id}: exact-ladder program is outside the walked detail set, so the totals below would not see it`);
  }
  assert.equal(doseGrids, expectedDoseGrids);
  assert.equal(doseRows, expectedDoseSlots);
});

test("provider detail two-track layout: sticky rail with byte-identical affiliate CTA and cross-link shelves", () => {
  for (const program of detailPrograms(programRegistry, graph)) {
    const html = byRoute.get(`/providers/${program.program_id}/`);
    assert.match(html, /class="p3-detail-layout" data-detail-layout/, program.program_id);
    assert.equal(countMatches(html, /data-provider-rail/g), 1, program.program_id);
    // rail modules
    assert.match(html, /Verified pharmacy relationships/, program.program_id);
    assert.match(html, /Related provider records/, program.program_id);
    assert.match(html, /href="\/pharmacies\/">Browse compounding pharmacies/, program.program_id);
    assert.match(html, /href="\/providers\/\?sort=cheapest">Browse all providers/, program.program_id);
    // legacy heading strings preserved for the late-audit contract
    assert.match(html, /At a glance/, program.program_id);
    assert.match(html, /Editorial tradeoffs/, program.program_id);
    assert.match(html, /Clinic Scout patient reviews/, program.program_id);
    assert.match(html, /Share your experience/, program.program_id);
    assert.match(html, /Submissions are checked before publication/, program.program_id);
    assert.match(html, new RegExp(`/reviews/submit/\\?entity=${encodeURIComponent(program.display_name)}&amp;type=provider`), program.program_id);
    assert.match(html, /Methodology and evidence boundary/, program.program_id);
    // the affiliate CTA (or its honest unavailable state) is rendered from ONE
    // string: hero + rail + mobile bar. Never fewer than 3 occurrences, and
    // every live anchor keeps rel + tracking attributes byte-identical.
    const liveAnchors = html.match(/<a class="cs-btn cs-palette-action" href="[^"]+" rel="sponsored noopener nofollow" data-analytics-event="affiliate_click" data-program="[^"]+"[^>]*>Get started<\/a>/g) || [];
    const unavailable = countMatches(html, /data-affiliate-unavailable/g);
    assert.equal(liveAnchors.length + unavailable, 3, `${program.program_id}: hero+rail+bar CTA count`);
    if (liveAnchors.length) {
      assert.equal(new Set(liveAnchors).size, 1, `${program.program_id}: affiliate CTA strings must be byte-identical`);
    }
    // W18/v3 sticky contract unchanged
    assert.equal(countMatches(html, /data-provider-sticky(?:\s|>)/g), 1, program.program_id);
    assert.match(html, new RegExp(`href="/quiz/provider-fit/\\?source=provider-sticky&amp;provider=${program.program_id}" data-provider-sticky-primary`));
  }
});

test("pharmacy hub puts visitor controls before methodology and omits placeholder clutter", () => {
  const hub = byRoute.get("/pharmacies/");
  assert.match(hub, /class="p3-page[^"]* p3-pharm-hub"/);
  assert.match(hub, /listing__intro/);
  const bodyHtml = hub.slice(hub.indexOf("<body"));
  const controlsAt = bodyHtml.indexOf("data-pharmacy-filters");
  const cardsAt = bodyHtml.indexOf("data-pharmacy-card");
  const methodAt = bodyHtml.indexOf("p3-pharmacy-method");
  assert.ok(controlsAt > -1 && controlsAt < cardsAt, "pharmacy controls must precede results");
  assert.ok(cardsAt < methodAt, "pharmacy methodology must follow the visitor task");
  // The evidence boundary remains, but it follows the finder.
  assert.match(hub, /503A pharmacy compounds individual prescriptions/);
  assert.match(hub, /503 pathway labels describe oversight, not quality/);
  // toolbar keeps all five wired controls (site.js hub runtime contract)
  for (const control of ["data-pharmacy-search", "data-pharmacy-class", "data-pharmacy-med", "data-pharmacy-additive", "data-pharmacy-state"]) {
    assert.match(hub, new RegExp(control));
  }
  assert.match(hub, /p3-pharmacy-filters--toolbar/);
  // Pharmacy-card count is a monotonic floor: the directory grows.
  const pharmacyCardCount = countMatches(hub, /data-pharmacy-card(?=[\s>])/g);
  assert.ok(pharmacyCardCount >= 75, `expected at least 75 pharmacy cards, saw ${pharmacyCardCount}`);
  assert.equal(countMatches(hub, /data-pharmacy-card-contract="option-c"/g), pharmacyCardCount);
  const cards = hub.match(/<a href="\/pharmacies\/[^"]+\/" class="cs-card p3-pharmacy-card"[\s\S]*?<\/a>/g) || [];
  assert.equal(cards.length, pharmacyCardCount);
  for (const card of cards) {
    assert.match(card, /<dt>Location<\/dt>/);
    assert.match(card, /<dt>Services<\/dt>/);
    assert.match(card, /class="p3-card-evidence-line">View profile and sources →<\/p>/);
    assert.equal(countMatches(card, /<dt>/g), 2);
    assert.doesNotMatch(card, /<dt>(?:Provider relationship|Consumer price|Rating|GLP-1 relevance|State coverage|Legal identity|503A pathway|503B pathway|Regulatory action|Compounded with)<\/dt>/);
  }
  for (const placeholder of [
    "Research in progress",
    "None verified",
    "Rating not collected",
    "Additive evidence not captured",
    "Consumer price not published",
    "State footprint not verified",
    "GLP-1 relevance not verified",
  ]) assert.doesNotMatch(hub, new RegExp(placeholder), placeholder);
  assert.doesNotMatch(hub, /No complete regulator-verified state footprint is published in the bound research\./);
  assert.match(hub, /<span class="listing__count" data-pharmacy-result aria-live="polite" aria-atomic="true">75 pharmacy records/);
});

test("pharmacy detail: reader-job order, conversion path, review module, mobile bar", () => {
  for (const entry of pharmacyInput.entries) {
    const html = byRoute.get(entry.route);
    assert.ok(html, `${entry.slug}: detail missing`);
    assert.match(html, /class="p3-page p3-pharm-detail"/, entry.slug);
    // reader-job modules precede deep evidence: compounded-with before actions
    // (search body bytes only — the meta description also names these modules)
    const bodyHtml = html.slice(html.indexOf("<body"));
    const compoundedAt = bodyHtml.indexOf("Compounded with");
    const complianceAt = bodyHtml.indexOf("503 pathway evidence");
    const providersAt = bodyHtml.indexOf("Telehealth providers");
    const historyAt = bodyHtml.indexOf("Actions stay dated and bounded.");
    const sourcesAt = bodyHtml.indexOf("Sources and exact captured wording");
    assert.ok(compoundedAt > -1 && compoundedAt < complianceAt, `${entry.slug}: compounded-with must lead`);
    assert.ok(complianceAt < providersAt, `${entry.slug}: compliance before providers`);
    assert.ok(providersAt < historyAt, `${entry.slug}: providers module before deep evidence`);
    assert.ok(historyAt < sourcesAt, entry.slug);
    // conversion path is honest: reverse comparison only when verified
    const relationships = verifiedRelationships(entry);
    if (relationships.length) {
      assert.match(html, new RegExp(`href="${entry.route.replaceAll("/", "\\/")}compare-providers\\/"`), entry.slug);
      assert.match(html, /Compare providers using this pharmacy/, entry.slug);
      for (const relationship of relationships) {
        assert.match(html, new RegExp(`href="/providers/${relationship.program_id}/"`), entry.slug);
      }
    } else {
      assert.doesNotMatch(html, /href="[^"]*compare-providers\/"/, entry.slug);
      assert.match(html, /No telehealth-provider relationship is verified in the sources we checked\./, entry.slug);
    }
    // structured location records must never stringify to garbage
    assert.doesNotMatch(html, /\[object Object\]/, entry.slug);
    // review module: honest empty state + moderated submit CTA (F10)
    assert.match(html, /Patient reviews/, entry.slug);
    assert.match(html, /No Clinic Scout patient reviews are published for this pharmacy\./, entry.slug);
    assert.match(html, /\/reviews\/submit\/\?entity=.*&amp;type=pharmacy/, entry.slug);
    // mobile bar + runtime (F7/D13): evidence-state slot, See providers action
    assert.equal(countMatches(html, /data-pharmacy-bar(?:\s|>)/g), 1, entry.slug);
    assert.match(html, new RegExp(`${entry.evidence_summary.citation_count} citations · ${entry.unverified_fields.length} unknowns`), entry.slug);
    assert.match(html, />See providers</, entry.slug);
    assert.match(html, /data-pharmacy-bar-runtime/, entry.slug);
    // rewritten advantage panel: reader-benefit framing, no benchmark brag
    assert.match(html, /What this page verifies for you/, entry.slug);
    assert.doesNotMatch(html, /beat the captured comparison profile/, entry.slug);
    assert.doesNotMatch(html, /Benchmark status:/, entry.slug);
    // pinned browser-spec selectors survive the reorder
    for (const marker of ["p3-pharmacy-hero", "p3-classification-grid", "p3-detail-grid", "p3-action-grid", "p3-unknowns", "p3-source-rail", "data-related-pharmacies"]) {
      assert.match(html, new RegExp(marker), `${entry.slug}: ${marker}`);
    }
    // related shelf keeps exactly three pharmacy links inside its section
    const relatedSection = html.match(/<section[^>]*data-related-pharmacies[^>]*>[\s\S]*?<\/section>/)?.[0] || "";
    assert.equal(countMatches(relatedSection, /href="\/pharmacies\//g), 3, entry.slug);
  }
});

test("Option C provider cards use the four-field evidence contract and reverse cards keep their accepted layout", () => {
  const providers = byRoute.get("/providers/");
  const deferredPayload = JSON.parse(providers.match(/<script type="application\/json" data-provider-card-payloads>([\s\S]*?)<\/script>/)?.[1] || "[]");
  const providerCardMarkup = `${providers}${deferredPayload.join("")}`;
  // Provider-card count is a monotonic floor: onboarding grows it.
  const providerCardCount = countMatches(providers, /data-phase3-provider(?=[\s>])/g);
  assert.ok(providerCardCount >= 35, `expected at least 35 provider cards, saw ${providerCardCount}`);
  assert.equal(countMatches(providerCardMarkup, /data-provider-card-contract="option-c"/g), providerCardCount);
  assert.equal(countMatches(providerCardMarkup, /<dt>Medications offered<\/dt>/g), providerCardCount);
  assert.equal(countMatches(providerCardMarkup, /<dt>Total monthly cost<\/dt>/g), providerCardCount);
  assert.equal(countMatches(providerCardMarkup, /<dt>Cancellation<\/dt>/g), providerCardCount);
  assert.doesNotMatch(providerCardMarkup, /class="p3-card-headline-price"|class="p3-card-price-matrix"|Price sources and dose evidence|class="p3-dose-grid"|UNKNOWN_NO_SOURCE/);
  for (const excluded of ["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review"]) {
    assert.doesNotMatch(providers, new RegExp(`data-program="${excluded}"`));
  }
  assert.match(phaseCss, /\.p3-card-ledger\.p3-card-contract/);
  assert.match(phaseCss, /\.p3-filterbar\s*\{[^}]*position:\s*sticky[^}]*top:\s*90px/s);
  assert.match(phaseCss, /\.p3-filterbar\[data-pharmacy-reverse-filters\]\s*\{[^}]*position:\s*relative[^}]*top:\s*auto/s);

  for (const entry of pharmacyInput.entries) {
    if (!verifiedRelationships(entry).length) continue;
    const html = byRoute.get(`${entry.route}compare-providers/`);
    assert.match(html, /class="cs-card p3-reverse-card"/, entry.slug);
    assert.match(html, /class="p3-provider-identity/, entry.slug);
    assert.match(html, /class="p3-reverse-price/, entry.slug);
    assert.match(html, /class="cs-arrowlink"[^>]*data-citation="comparison_source_ledger"/, entry.slug);
    assert.match(html, /class="cs-btn cs-btn--quiet"[^>]*>Open provider details<\/a>/, entry.slug);
    assert.match(html, /class="cs-btn cs-palette-action"[^>]*>Check my fit<\/a>/, entry.slug);
  }
});

test("sticky-bar CSS contract tokens exist for both provider and pharmacy bars", () => {
  for (const token of [".p3-pharmacy-bar", ".p3-pharmacy-bar.is-released", "min-height: 81px", "z-index: 40", "position: absolute"]) {
    assert.ok(detailCss.includes(token), token);
  }
  // reduced-motion honesty: the continuous CTA glow has an explicit kill
  assert.match(detailCss, /html\[data-motion="reduced"\][^{]*cs-palette-action::before\s*\{[^}]*animation: none !important/);
});
