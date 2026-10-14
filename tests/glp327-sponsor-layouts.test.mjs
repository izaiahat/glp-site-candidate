// GLP-327 layout acceptance. Operator rejection 2026-10-03: the styling
// matched the site but giant empty headings wasted the first screen, price,
// offer and CTA were buried, and the /providers/ Sponsored slot was invisible
// on mobile. One regression per layout, plus the committed fold geometry.
import {paymentFixture} from './fixtures/sponsor-payment.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { renderRateCard, renderPromo } from "../src/paid-promo.mjs";
import * as graphModule from "../src/phase3-page-graph.mjs";
import { loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";

const json = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const headings = (html) => [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => match[1]);
const section = (html, hook) => { const start = html.indexOf(hook); assert.ok(start >= 0, hook); return html.slice(start, html.indexOf("</section>", start)); };
const inOrder = (html, needles) => {
  const at = needles.map((needle) => { const index = html.indexOf(needle); assert.ok(index >= 0, `missing: ${needle}`); return index; });
  at.forEach((index, i) => i && assert.ok(index > at[i - 1], `out of order: ${needles[i - 1]} before ${needles[i]}`));
};

test("rate card: a short title, then price, terms, both deliverables, renewal, booking CTA and no-paid-ranking disclosure before any secondary terms", () => {
  const html = renderRateCard();
  assert.deepEqual(headings(html), ["Sponsor placements"]);
  assert.doesNotMatch(html, /p3-index-hero|<h1[^>]*>Visibility/);
  const offer = section(html, "data-sponsor-offer");
  for (const text of ["$750", " / 30 days", "$250 setup + $500 placement and reporting",
    "One Sponsored directory panel.",
    "One sponsored provider intro page.",
    "Same-scope renewal: $500 / 30 days.", "No automatic renewal or recurring charge.",
    'href="mailto:partners@glpclinicscout.com" data-sponsor-booking-cta>Discuss a placement</a>',
    "Independent rankings do not change. Sponsorship does not buy a score, favorable review or SEO backlink."]) assert.ok(offer.includes(text), text);
  inOrder(html, ["data-sponsor-offer", "data-sponsor-example", "data-sponsor-details", "data-sponsor-disclaimer"]);
  // Secondary terms are all preserved below the offer; financial terms stay
  // visible and only the explanatory audience note uses an accordion.
  const details = html.slice(html.indexOf("data-sponsor-details"));
  for (const text of ["Approved provider identity, factual creative and one approved CTA", "One copy correction round, plus required safety corrections", "720 consecutive hours from verified activation",
    "Delivery report within five business days of term close; separately labeled aggregate diagnostics only when supported.", "No traffic, leads, sales or SEO guarantee. Subject to available inventory and final review.",
    "US providers only.", "Payment is confirmed after a reviewed order and readiness checks, before activation.", "Prices before any applicable tax; final tax-inclusive quote must be agreed.",
    "Full refund if no conforming placement launches; refund or mutually agreed equivalent extension for undelivered time.", "We do not have a verified audience size or sponsor impression estimate for this proposal. Site visits are not ad impressions."]) assert.ok(details.includes(text), text);
  assert.ok(details.indexOf("Full refund if no conforming placement launches") < details.indexOf("<details"), "financial terms are not collapsed");
  assert.match(details, /<details class="cs-details" data-sponsor-audience><summary>Audience and reporting<\/summary><p>We do not have/);
});

test("paid promo: one provider identity, concise paid intro, primary action and ad disclosure lead; fact slots never carry facts", () => {
  const html = renderPromo();
  assert.deepEqual(headings(html), ["Example Provider"]);
  assert.doesNotMatch(html, /data-sponsor-placement-candidate|p3-detail-rail|p3-index-hero/, "no duplicated identity rail or oversized hero");
  assert.equal((html.match(/<(?:h[1-6]|strong)\b[^>]*>Example Provider<\//g) || []).length, 1);
  const lead = section(html, "data-sponsor-lead");
  inOrder(lead, ['<span class="p3-chip p3-chip--status">Sponsored</span>', "<h1", '<p class="lede">Example page.',
    '<button class="cs-btn cs-palette-action" type="button" disabled aria-disabled="true">View provider information</button>',
    "Template only. No provider is being promoted."]);
  assert.match(html, /Independent rankings do not change/);
  inOrder(html, ["data-sponsor-lead", "data-sponsor-facts", "data-sponsor-promo-checks", 'href="/providers/">Compare providers independently', "data-sponsor-disclaimer"]);
  const slots = [...html.matchAll(/<div data-sponsor-fact-slot><dt>([^<]+)<\/dt><dd>([^<]+)<\/dd><\/div>/g)];
  assert.deepEqual(slots.map(([, label]) => label), ["Program summary", "Published price", "Eligibility and states", "Current offer"]);
  for (const [, , slot] of slots) assert.match(slot, /^Awaiting /);
  assert.doesNotMatch(html, /\$\d|\d\s*%|verified provider|licensed (?:provider|clinician)/i);
  const start = Date.now() - 3600000;
  assert.throws(() => renderPromo({ ...paymentFixture(), provider: "Example", slug: "example", operator_approval: "reviewed", partner_creative_approval: "reviewed", eligibility_approved: true, inventory_reserved: true, held: false, us_provider: true, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 720 * 3600000).toISOString(), destination: "https://example.com/" }, { preview: false }), /authenticated payment required/, "fixture JSON cannot authorize live rendering");
});

test("/providers/ preview: compact intro and collapsed extended filters put the slot before independent results; records, order and disclosures unchanged", () => {
  const render = (on) => {
    const previous = process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW;
    if (on) process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW = "1"; else delete process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW;
    try {
      const graph = json("phase3-page-graph.json"), programRegistry = json("program-registry.json");
      return graphModule.renderConfiguredListing("E", { route: "/providers/", slug: "providers", name: "Compare weight loss providers" }, {
        graph, pharmacyInput: json("phase3-pharmacy-render-input.json"), pricingMatrix: json("provider-pricing-matrix.json"), registry: graphModule.phase3Registry(graph, programRegistry), coupons: {},
        doseCapture: graphModule.loadPass2DoseCapture(), logoManifest: graphModule.loadProviderLogoManifest(), articles: [], goAuthority: loadGoPromotionAuthority(),
      });
    } finally { if (previous === undefined) delete process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW; else process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW = previous; }
  };
  const off = render(false), on = render(true);
  assert.doesNotMatch(off, /data-sponsor/, "sponsorship off renders the original composition");
  const results = (html) => html.slice(html.indexOf('<section id="provider-results"'));
  assert.equal(results(on), results(off), "results grid, lazy payloads, source disclosure and runtime are byte-identical");
  const registryScope = off.match(/<p data-provider-registry-scope>[\s\S]*?<\/p>/)[0];
  const atf = off.match(/<section class="p3-atf-price"[\s\S]*?<\/section>/)[0];
  const commission = off.match(/<div class="table-disclosure p3-source-disclosure affiliate-note">[\s\S]*?<\/div>/)[0];
  for (const piece of [registryScope, atf, commission]) assert.ok(on.includes(piece), piece.slice(0, 60));
  inOrder(on, ["data-sponsor-preview-intro", "data-sponsor-preview-filters", "data-sponsor-placement-candidate", "data-sponsor-preview-results-lead", "We may earn a commission from sponsored links.", "data-provider-registry-scope", "data-atf-result", '<section id="provider-results"']);
  // Same controls; only the extended groups move behind a native disclosure.
  const before = (html) => html.slice(0, html.indexOf('<section id="provider-results"'));
  const pairs = (html) => [...before(html).matchAll(/data-filter="([^"]+)" data-value="([^"]+)"/g)].map(([, key, value]) => `${key}=${value}`).sort();
  assert.deepEqual(pairs(on), pairs(off));
  const more = on.match(/<details class="cs-details" data-sponsor-preview-more-filters><summary>Filters<\/summary>[\s\S]*?<\/details>/)[0];
  for (const key of ["treatment", "type", "plan", "duration", "dose"]) assert.match(more, new RegExp(`data-filter-group="${key}"`));
  assert.match(more, /data-filter-group="sort"/);
  assert.match(more, /data-state-native/);
  assert.match(more, /data-provider-search-reset>Reset/);
  assert.doesNotMatch(more, /data-state-open/, "one native state selector, not duplicate custom/native choices");
  assert.equal((on.match(/data-state-native/g) || []).length, 1);
  assert.match(before(on), /data-sponsor-preview-intro><h1/);
});

test("clutter regression: one closed filter row and genuinely early commercial actions, not merely below 844px", () => {
  const result = JSON.parse(readFileSync(new URL("../reports/ops/sponsor-clean-layout-20261003/copy/observer-successor-20261008/captures/CAPTURE.json", import.meta.url), "utf8"));
  for (const c of result.checks) {
    assert.equal(c.interactions.status, "PASS", `${c.surface}/${c.viewport}`);
    if (c.surface === "providers-sponsored-panel") {
      assert.ok(c.dom.directoryControls.extendedFiltersCollapsed);
      assert.equal(c.dom.directoryControls.nativeStateCount, 1);
      assert.equal(c.dom.directoryControls.customStateCount, 0);
      assert.ok(c.dom.directoryControls.filterHeight <= 64);
      assert.ok(c.interactions.assertions.length >= (c.viewport === "mobile" ? 8 : 6));
    }
    if (c.viewport !== "mobile") continue;
    if (c.surface === "providers-sponsored-panel") { assert.ok(c.dom.directoryControls.panelTop <= 220); assert.ok(c.dom.fold.cta.bottom <= 500); }
    if (c.surface === "rate-card") { assert.ok(c.dom.fold.price.top <= 180); assert.ok(c.dom.fold.cta.bottom <= 460); }
    if (c.surface === "paid-promo") assert.ok(c.dom.fold.cta.bottom <= 340);
  }
  for (const html of [renderRateCard(), renderPromo()]) assert.doesNotMatch(html, /breadcrumbs|Paid provider introduction|data-sponsor-title|p3-index-hero/);
});

test("committed captures prove the fold, h1 limits and overflow for all six frames", () => {
  const result = JSON.parse(readFileSync(new URL("../reports/ops/sponsor-clean-layout-20261003/copy/observer-successor-20261008/captures/CAPTURE.json", import.meta.url), "utf8"));
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.gateFindings, []);
  for (const [file, sha] of Object.entries(result.sourceHashes)) {
    let source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"), sha, `current native capture source: ${file}`);
  }
  const required = { "rate-card": ["label", "price", "terms", "deliverables", "renewal", "cta", "disclosure"], "paid-promo": ["label", "identity", "intro", "cta", "disclosure"], "providers-sponsored-panel": ["label", "identity", "cta"] };
  assert.deepEqual(result.checks.map((check) => `${check.surface}:${check.viewport}:${check.width}x${check.height}`).sort(),
    Object.keys(required).flatMap((surface) => [`${surface}:desktop:1440x1000`, `${surface}:mobile:390x844`]).sort());
  for (const check of result.checks) {
    const where = `${check.surface} ${check.viewport}`;
    assert.equal(check.status, "PASS", where);
    assert.deepEqual(Object.keys(check.dom.fold).sort(), [...required[check.surface]].sort(), where);
    for (const [key, rect] of Object.entries(check.dom.fold)) assert.ok(rect.visible && rect.top >= 0 && rect.bottom <= check.height && rect.right <= check.width, `${where} ${key}`);
    assert.ok(check.dom.viewport.scrollY === 0, `${where} measured unscrolled`);
    assert.ok(check.dom.h1.length && check.dom.h1.every((h) => h.fontSize <= (check.viewport === "desktop" ? 48 : 32)), `${where} h1`);
    assert.ok(check.dom.scrollWidth <= check.width + 1, `${where} overflow`);
    assert.deepEqual(check.a11y, [], `${where} axe`);
    if (check.surface === "providers-sponsored-panel" && check.pageImageScope === "full page") {
      assert.equal(check.fullPagePaintAudit?.method, "native-expanded-viewport");
      assert.deepEqual(check.fullPagePaintAudit.skippedAutoNodes, [], `${where} no unpainted auto-contained cards`);
      if (check.viewport === "desktop") assert.ok(check.fullPagePaintAudit.autoNodeCount > 0, `${where} audited actual deferred card nodes`);
      else assert.ok(check.fullPagePaintAudit.autoNodeCount >= 0);
      assert.ok(check.fullPagePaintAudit.height >= check.fullPagePaintAudit.autoNodeMaxBottom, `${where} all deferred nodes inside native paint viewport`);
    }
    assert.match(check.viewportImage, /-viewport\.png$/);
    for (const image of [check.viewportImage, check.pageImage]) assert.ok(existsSync(new URL(`../${image}`, import.meta.url)), image);
  }
});
