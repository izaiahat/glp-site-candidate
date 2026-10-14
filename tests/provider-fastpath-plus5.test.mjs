import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { historicalUnscoredBlock } from './fixtures/historical-unscored-copy.mjs';
import { currentCalculatorExpectation } from "./fixtures/c02-calculator-inputs.mjs";
import { buildCostCalculatorData, costCalculatorDropdownProviders } from "../src/cost-calculator.mjs";
import { buildProviderReviewSpecs, renderProviderReviewPage } from "../src/provider-review.mjs";
import { scoreProvider } from "../src/money-page.mjs";
import { loadGoSelection } from "../src/go-runtime-selection.mjs";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";

const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportRoot = new URL("file:///home/ubuntu/business/reports/glp-clinic-scout/provider-fastpath-plus5-synergy-pricing-20260730/");
const siteRoot = new URL("../", import.meta.url);

const money = await readJson("../data/money-page-specs.json");
const pages = await readJson("../data/provider-page-contracts.json");
const fastpath = await readJson("../data/provider-fastpath-contract.json");
const identity = await readJson("../data/identity-registry.json");
const calculatorConfig = await readJson("../data/cost-calculator.json");
const registry = await readJson("../data/program-registry.json");
const pricing = await readJson("../data/provider-pricing-matrix.json");

test("fast-path contracts remain bound to the frozen PASS-2 research packet", async () => {
  const frozen = await readFile(new URL("provider-fastpath-contracts.json", reportRoot));
const pricing = await readJson("../data/provider-pricing-matrix.json");
  const local = await readFile(new URL("data/provider-page-contracts.json", siteRoot));
  assert.equal(sha256(frozen), fastpath.source_contract_sha256);
  assert.equal(sha256(local), fastpath.current_contract_sha256);
  assert.deepEqual(pages.providers.map((provider) => provider.program_id), fastpath.providers.map((provider) => provider.program_id));
  assert.equal(new Set(fastpath.providers.map((provider) => provider.program_id)).size, 50); // 2026-08-27 live-head merge: +nu-image
  // measured left the active set 2026-08-13 (operator rejected the Awin 126727
  // terms) and rejoined it on 2026-08-31 when he rescinded that rejection. Its
  // /go authority stays WITHHELD, so it is active on the provider-issued
  // DIRECT link - the same form every other live provider uses today.
  // 2026-08-18: trt-nation joined the active set when the bridge lifted its
  // AFF-TRT-001 content-fit hold against a receipted link-click QA on the
  // weight-loss deep link.
  const activeIds = new Set(["mademed", "telos-rx", "strut-health", "drhouse", "biltrx", "orderlymeds", "mydrhank", "gobymeds", "live-vital-launch", "coreage-rx-glp-1-1632", "bodybuilding-com-glp-1-longevity-review", "skinnyrx-1-glp-weight-loss-provider-review", "rxspan-md-telehealth-program-review", "pallas-health-review", "wellmedr-review", "dudemeds-review", "trt-nation", "nu-image-medical-review", "synergy-rx-review", "breeze-meds-review", "care-bare-rx-glp1-review", "altrx-glp1-us-cps", "novi-weight-loss-glp-1", "curex-glp-1", "ro-wegovy-glp1-quiz-us-cpl", "eden-xentraffic-offer-3051", "futurhealth-wegovy-pillform", "lttl-glp-landing-page-2", "enhanced-tirzepatide-funnel-b", "sunlight-glp1", "joinskinny-semaglutide-glp-1-us", "levelsrx-extra-cpa-home-page", "refills", "tmates-xentraffic-offer-3154", "trimrx-xentraffic-offer-3014", "yucca-health-xentraffic-offer-3117", "longevity-meds-glp-1-review", "snagrx", "humecare-data-driven-glp-1-weight-loss-system", "measured", "g-plan", "jrnys-review", "medvi-review", "rightwell-review", "willow-review", "ivim-health-review", "tyde-wellness-review", "feelgood-review", "instarx-review"]); // 2026-08-27 live-head merge
  // Historical packet membership is not current commercial activation. Only
  // registry-live members can stay ACTIVE; the Telos evidence record is retained.
  const liveRegistryIds = new Set(registry.programs.filter(p => p.commercial_state === 'live'
    && p.profiles?.['glp-clinic-scout']?.vertical_fit === true
    && p.profiles?.['glp-clinic-scout']?.wired === true).map(p => p.program_id));
  assert.deepEqual([...activeIds].filter(id => !liveRegistryIds.has(id)), ['telos-rx']);
  for (const provider of fastpath.providers) {
    const bytes = await readFile(new URL(provider.logo.source_path, siteRoot));
    assert.equal(sha256(bytes), provider.logo.sha256, provider.program_id);
    if (activeIds.has(provider.program_id) && liveRegistryIds.has(provider.program_id)) {
      assert.equal(provider.route_state, "LIVE_EDITORIAL_AFFILIATE_ACTIVE");
      assert.equal(provider.affiliate_cta_state, "ACTIVE_PROVIDER_ISSUED_DIRECT");
    } else {
      assert.equal(provider.route_state, "READY_EDITORIAL_LINK_DARK");
      assert.match(provider.affiliate_cta_state, /^HOLD_/);
    }
  }
});

test("provider-review specs cover the registry projection with three explicit hard holds", () => {
  const reviews = buildProviderReviewSpecs(money.pages, pages, fastpath, registry, "glp-clinic-scout");
  assert.equal(reviews.length, fastpath.expected_provider_review_count);
  assert.equal(new Set(reviews.map((review) => review.path)).size, reviews.length);
  const added = reviews.filter((review) => review.fastpath_contract);
  // Membership, not order: a fast-path provider that already had a comparison row
  // keeps that row's slot, so the order is the comparison order now.
  assert.deepEqual(new Set(added.map((review) => review.program_id)), new Set(["mademed", "telos-rx", "live-vital-launch", "strut-health", "trt-nation", "measured", "drhouse", "biltrx", "orderlymeds", "mydrhank", "gobymeds", "coreage-rx-glp-1-1632", "bodybuilding-com-glp-1-longevity-review", "skinnyrx-1-glp-weight-loss-provider-review", "rxspan-md-telehealth-program-review", "pallas-health-review", "wellmedr-review", "dudemeds-review", "nu-image-medical-review", "synergy-rx-review", "breeze-meds-review", "care-bare-rx-glp1-review", "altrx-glp1-us-cps", "novi-weight-loss-glp-1", "curex-glp-1", "ro-wegovy-glp1-quiz-us-cpl", "eden-xentraffic-offer-3051", "futurhealth-wegovy-pillform", "lttl-glp-landing-page-2", "enhanced-tirzepatide-funnel-b", "sunlight-glp1", "joinskinny-semaglutide-glp-1-us", "levelsrx-extra-cpa-home-page", "refills", "tmates-xentraffic-offer-3154", "trimrx-xentraffic-offer-3014", "yucca-health-xentraffic-offer-3117", "longevity-meds-glp-1-review", "snagrx", "humecare-data-driven-glp-1-weight-loss-system", "g-plan", "jrnys-review", "medvi-review", "rightwell-review", "willow-review", "ivim-health-review", "tyde-wellness-review", "feelgood-review", "instarx-review", "retaclinic-review"])); // 2026-08-27 live-head merge
  for (const review of added) {
    const html = renderProviderReviewPage(review, identity);
    if (html.includes('data-affiliate-state="held"')) {
      assert.match(html, /data-link-dark="true"/);
      assert.match(html, /data-affiliate-state="held"/);
      assert.doesNotMatch(html, /data-link-mode="transparent-direct"|track\.revoffers\.com|www\.dpbolvw\.net|www\.awin1\.com|href="\/go\//);
    } else {
      assert.match(html, /data-link-dark="false"/);
      assert.match(html, /data-affiliate-state="active"/);
      const selected = loadGoSelection().programs[review.program_id];
      if (selected?.status === "VERIFIED") {
        assert.ok(html.includes(`href="${selected.route}?s=reviews.rv2&amp;v=a"`));
        assert.match(html, /data-link-mode="server-redirect"/);
        assert.equal(GO_RUNTIME_MANIFEST.programs[selected.program_id].tracking.base_url, selected.issued_link);
      } else {
        assert.match(html, /data-link-mode="transparent-direct"/);
        assert.doesNotMatch(html, /href="\/go\//);
      }
    }
    // 2026-08-06 cluster 1: built here WITHOUT the content ledger, so no derived
    // criteria reach the row - which is exactly the honest-unscored path. It must
    // be a named, explained state, never a bare "Score pending" placeholder. The
    // scored path (ledger supplied, as the build supplies it) is asserted below.
    assert.match(html, /class="score score-unscored">Not scored</);
    // The old missing-information implication is historical-only. Keep its
    // exact regex on authentic old source, and require today's neutral explanation.
    assert.match(historicalUnscoredBlock(review.row, review.provider), /class="score-basis">[^<]*has not published enough of the five criteria/);
    assert.match(html, /class="score-basis">No comparable editorial score is assigned to [^<]+\. This is not a claim that provider information is unpublished\. <a href="\/how-we-rate\/">How we rate<\/a>\.<\/p>/);
    assert.doesNotMatch(html, /class="score-basis">[^<]*(?:has not published enough|insufficient information|missing information)/i);
    assert.doesNotMatch(html, /Score pending|Pending evidence|pending score/i);
    assert.doesNotMatch(html, /(?<![\d.])0(?:\.0)?\/10/);
    assert.ok(html.includes(`Checked ${review.fastpath_integration.checked_as_of || fastpath.checked_as_of}`), `checked-date:${review.program_id}`);
  }
});

test("a fast-path review binds the merit score the comparison table publishes", async () => {
  // The 2026-08-06 defect: /reviews/measured/ said "Score pending evidence" while
  // the same build ranked Measured 7.6/10 on /best/online-glp-1-providers/. The
  // derived criteria live on the content ledger and the fast-path row is built
  // from the provider contract, so the binding has to be explicit.
  const ledger = await readJson("../data/program-content-ledger.json");
  const { applyMeritScores } = await import("../src/merit-ranking.mjs");
  const { comparablePriceProviderIds } = await import("../src/provider-dynamic-profiles.mjs");
  applyMeritScores(ledger.programs, {
    comparablePriceIds: comparablePriceProviderIds(registry, "glp-clinic-scout", {
      asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
    }),
  });
  const reviews = new Map(buildProviderReviewSpecs(money.pages, pages, fastpath, registry, "glp-clinic-scout", ledger.programs)
    .map((review) => [review.program_id, review]));
  const measured = renderProviderReviewPage(reviews.get("measured"), identity);
  const expectedMeasuredScore = scoreProvider(reviews.get("measured").row);
  assert.ok(Number.isFinite(expectedMeasuredScore));
  assert.ok(measured.includes(`class="score">${(expectedMeasuredScore / 10).toFixed(1)}/10</p>`));
  assert.doesNotMatch(measured, /Score pending|Pending evidence/i);
  assert.match(measured, /class="score-basis">Evidence-completeness score/);
  // A criterion the provider publishes nothing for says so, rather than printing
  // a "0.0/10" that reads as a quality judgement.
  assert.doesNotMatch(measured, /(?<![\d.])0(?:\.0)?\/10/);
});

function factualSection(html, id) {
  const section = html.match(new RegExp(`<(?:section|details|aside)[^>]*id="${id}"[^>]*>[\\s\\S]*?</(?:section|details|aside)>`))?.[0];
  assert.ok(section, `missing factual section: ${id}`);
  return section;
}

function assertFactualCitation(html, field, url, date) {
  const section = factualSection(html, field);
  const ids = [...section.matchAll(/href="#(source-\d+)"/g)].map(match => match[1]);
  const entries = ids.map(id => html.match(new RegExp(`<li id="${id}">[\\s\\S]*?</li>`))?.[0] || '');
  assert.ok(entries.some(entry => entry.includes(`href="${url}"`) && new RegExp(`<small>(?:Checked|current as of) ${date}</small>`).test(entry)), `${field}: ${url} observed ${date}`);
}

function assertMadeMedFacts(html) {
  const pricing = factualSection(html, 'pricing');
  assert.match(pricing, /injectable semaglutide quarterly plan[\s\S]*\$239\/month equivalent, billed \$717 every 3 months/);
  assert.match(pricing, /not monthly payments or a standalone first-month charge/);
  assert.match(pricing, /\$39 doctor visit fee is retained if no prescription is issued, not charged on every prescribed order/);
  assert.match(pricing, /standalone consultation price remain unknown/i);
  const cancellation = factualSection(html, 'cancellation');
  assert.match(cancellation, /effective at the end of the current billing period; no prorated refunds/);
  assert.doesNotMatch(cancellation, /no inline|do not state cancellation|defer to a separate Returns Policy/i);
  const accreditation = factualSection(html, 'accreditation');
  assert.match(accreditation, /terms name AbsoluteRx among partner pharmacies/);
  assert.match(accreditation, /actual dispensing pharmacy and its 503A\/503B category are not established/i);
  assert.match(accreditation, /displays a LegitScript badge\/link[\s\S]*status was not independently checked/);
  assert.match(accreditation, /no third-party accreditation is treated as verified/i);
  assert.doesNotMatch(accreditation, /No LegitScript certification claim appears|independently verified accreditation/i);
  const eligibility = factualSection(html, 'eligibility');
  assert.match(eligibility, /clinician determines eligibility[\s\S]*no prescription is guaranteed/i);
  assert.match(eligibility, /Exact state and formulation-specific availability is UNKNOWN/);
  assert.match(eligibility, /these captures do not establish a complete state list/);
  assert.doesNotMatch(eligibility, /United States only|all adults qualify|BMI of/i);
  const shipping = factualSection(html, 'shipping');
  assert.match(shipping, /injectable semaglutide page reports doctor review within 24 hours and overnight shipping/);
  assert.match(shipping, /UNKNOWN total order-to-delivery time[\s\S]*not a delivery guarantee or an oral-product estimate/);
  const product = 'https://mademed.com/rx/injectable-semaglutide/';
  for (const field of ['pricing', 'shipping', 'accreditation', 'eligibility']) assertFactualCitation(html, field, product, '2026-09-09');
  for (const field of ['cancellation', 'accreditation', 'eligibility']) assertFactualCitation(html, field, 'https://mademed.com/terms/', '2026-09-09');
  assertFactualCitation(html, 'regulatory', 'https://www.fda.gov/drugs/drug-alerts-and-statements/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss', '2026-08-06');
}

test("field-level citations and provider-specific holds remain visible and ordered safely", () => {
  const reviews = new Map(buildProviderReviewSpecs(money.pages, pages, fastpath, registry, "glp-clinic-scout").map((review) => [review.program_id, review]));
  const mademed = renderProviderReviewPage(reviews.get("mademed"), identity);
  // New independent disposition dated 2026-09-22; source observations stay 2026-09-09.
  assertMadeMedFacts(mademed);
  const mutations = [
    ['quarterly amount', '$239/month equivalent, billed $717 every 3 months', '$239 first charge'],
    ['unqualified teaser', '$239/month equivalent, billed $717 every 3 months', '$199/month'],
    ['universal fee', '$39 doctor visit fee is retained if no prescription is issued, not charged on every prescribed order', '$39 is charged on every order'],
    ['old cancellation', 'effective at the end of the current billing period; no prorated refunds', 'terms contain no inline cancellation terms'],
    ['verified badge', 'status was not independently checked', 'independently verified accreditation'],
    ['shipping citation', 'href="https://mademed.com/rx/injectable-semaglutide/"', 'href="https://mademed.com/treatments/"'],
    ['source observation', 'Checked 2026-09-09', 'Checked 2026-09-22'],
    ['state certainty', 'Exact state and formulation-specific availability is UNKNOWN', 'All states are available'],
  ];
  for (const [name, before, after] of mutations) {
    assert.ok(mademed.includes(before), `mutation target missing: ${name}`);
    assert.throws(() => assertMadeMedFacts(mademed.replaceAll(before, after)), undefined, name);
  }
  assertMadeMedFacts(mademed.replace('</main>', '<p>Historical teaser: $199/month; not a current payment.</p></main>'));
});

test("Telos field-level citations remain visible", () => {
  const reviews = new Map(buildProviderReviewSpecs(money.pages, pages, fastpath, registry, "glp-clinic-scout").map((review) => [review.program_id, review]));
  const telos = renderProviderReviewPage(reviews.get("telos-rx"), identity);
  assert.match(telos, /free 48-hour shipping/);
  assert.match(telos, /LegitScript Certified badge[\s\S]*href="#source-/);
  assert.doesNotMatch(telos, /7-10 business days/);

});

test("Strut FDA warning precedes the active commercial action independently of prose pins", () => {
  const reviews = new Map(buildProviderReviewSpecs(money.pages, pages, fastpath, registry, "glp-clinic-scout").map((review) => [review.program_id, review]));
  const strut = renderProviderReviewPage(reviews.get("strut-health"), identity);
  const warningAt = strut.indexOf("FDA warning letter");
  const ctaAt = strut.indexOf('data-affiliate-state="active"');
  assert.ok(warningAt >= 0 && ctaAt > warningAt, "Strut warning must precede the active commercial action");
  assert.match(strut, /warning-letters\/strut-health-llc-dba-strut-721448-02202026/);
});

function assertStrutFacts(html) {
  const shipping = factualSection(html, 'shipping');
  assert.match(shipping, /injections ship within 7 business days after order approval via 2-Day delivery service/);
  assert.match(shipping, /Other compounded new orders generally ship within 2-3 business days after approval, with delivery within 2 business days of shipment/);
  assert.match(shipping, /Orders are not shipped on weekends/);
  assert.match(shipping, /not a guaranteed consultation-to-delivery window/);
  const cancellation = factualSection(html, 'cancellation');
  assert.match(cancellation, /at least 48 hours before the next refill processes/);
  assert.match(cancellation, /processed refill cannot be cancelled and refunded/);
  const eligibility = factualSection(html, 'eligibility');
  assert.match(eligibility, /all U\.S\. states except Arkansas[\s\S]*September 2024/);
  assert.match(eligibility, /September 9, 2026 captured terms do not establish a complete current state\/formulation list; state-expansion evidence remains UNKNOWN/);
  assertFactualCitation(html, 'shipping', 'https://support.struthealth.com/hc/en-us/articles/4415354181787-After-I-place-an-order-when-will-my-order-ship', '2026-09-09');
  assertFactualCitation(html, 'cancellation', 'https://support.struthealth.com/hc/en-us/articles/4413534799131-Can-I-cancel-my-subscription', '2026-09-09');
  assertFactualCitation(html, 'eligibility', 'https://www.struthealth.com/faq', '2026-08-06');
  assertFactualCitation(html, 'eligibility', 'https://www.struthealth.com/terms-and-conditions', '2026-09-09');
  assertFactualCitation(html, 'regulatory-warning', 'https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/strut-health-llc-dba-strut-721448-02202026', '2026-08-06');
}

test("Strut shipping and cancellation prose", () => {
  const reviews = new Map(buildProviderReviewSpecs(money.pages, pages, fastpath, registry, "glp-clinic-scout").map((review) => [review.program_id, review]));
  const strut = renderProviderReviewPage(reviews.get("strut-health"), identity);
  assertStrutFacts(strut);
  for (const [before, after] of [
    ['injections ship within 7 business days after order approval via 2-Day delivery service', 'medication typically arrives within 2 business days'],
    ['at least 48 hours before the next refill processes', '48 hours after the next refill processes'],
    ['except Arkansas', 'including Arkansas'],
    ['September 2024', 'September 2026'],
    ['state-expansion evidence remains UNKNOWN', 'state expansion is verified'],
    ['Orders are not shipped on weekends', 'Orders ship every day'],
    ['not a guaranteed consultation-to-delivery window', 'a guaranteed nine-day delivery window'],
    ['href="https://support.struthealth.com/hc/en-us/articles/4413534799131-Can-I-cancel-my-subscription"', 'href="https://www.struthealth.com/faq"'],
  ]) {
    assert.ok(strut.includes(before), `mutation target missing: ${before}`);
    assert.throws(() => assertStrutFacts(strut.replaceAll(before, after)));
  }
});

test("built MadeMed and Strut preserve the dispositioned facts and field citations", async () => {
  assertMadeMedFacts(await readFile(new URL('public/reviews/mademed/index.html', siteRoot), 'utf8'));
  assertStrutFacts(await readFile(new URL('public/reviews/strut-health/index.html', siteRoot), 'utf8'));
});

test("TRT Nation commercial action remains weight-loss specific", () => {
  const reviews = new Map(buildProviderReviewSpecs(money.pages, pages, fastpath, registry, "glp-clinic-scout").map((review) => [review.program_id, review]));
  // 2026-08-18 content-fit LIFT. The invariant this block has always protected -
  // a page that reviews the GLP weight-loss program must never carry the
  // testosterone carrier - is unchanged below. What changed is that the page now
  // carries the VERIFIED weight-loss deep link instead of nothing.
  const trt = renderProviderReviewPage(reviews.get("trt-nation"), identity);
  assert.match(trt, /data-link-dark="false"/);
  assert.match(trt, /data-affiliate-state="active"/);
  const selected=loadGoSelection().programs['trt-nation'];
  assert.equal(selected.status,'VERIFIED');
  assert.equal(GO_RUNTIME_MANIFEST.programs['trt-nation'].tracking.base_url,selected.issued_link);
  assert.equal(selected.issued_link,'https://www.tkqlhce.com/click-101822575-17115008?url=https%3A%2F%2Ftrtnation.com%2Fweight-loss-therapy%2F');
  assert.match(trt, /href="\/go\/trt-nation\?s=reviews\.rv2&amp;v=a"/);
  assert.match(trt, /weight-loss-therapy/);
  assert.doesNotMatch(trt, /dpbolvw|17100444|testosterone-replacement-therapy/);
  assert.match(trt, /except Alabama, Alaska, Arkansas, Missouri, and Hawaii/);
  assert.match(trt, /within 1–3 business days after prescription approval/);assert.match(trt,/not a guaranteed weight-loss-specific or intake-to-delivery deadline/);
  assert.doesNotMatch(trt, /3-5 business days/);
});

test("calculator dropdown membership is exactly the registry calculator surface, exception for exception", async () => {
  // 2026-08-06 cluster 1: the dropdown is built from the PROJECTED money pages,
  // the same way the build builds it, so a merchant declared an alias of another
  // (Katalys 1516 "SHED" = Awin `shedrx` "Shed") is absent by construction rather
  // than appearing a second time under a different casing.
  const { deriveIdentityGroups } = await import("../src/provider-identity.mjs");
  const { projectMoneyPagesFromRegistry } = await import("../src/program-registry.mjs");
  const ledger = await readJson("../data/program-content-ledger.json");
  const { aliasIds, aliasKeys } = deriveIdentityGroups(registry, "glp-clinic-scout", ledger.programs);
  const declaredAliases = registry.programs.filter(p => p.profiles?.['glp-clinic-scout']?.canonical_identity?.role === 'alias').map(p => p.program_id);
  assert.deepEqual([...aliasIds].sort(), declaredAliases.sort());
  assert.ok(aliasIds.has('telos-rx-review'));
  assert.ok(aliasIds.has('katalys-1516'));
  const projectedPages = projectMoneyPagesFromRegistry(registry, "glp-clinic-scout", money.pages, ledger.programs);
  const expectedInput = currentCalculatorExpectation(registry, pricing);
  const data = buildCostCalculatorData(calculatorConfig, projectedPages, pages, fastpath, registry, "glp-clinic-scout", aliasKeys, pricing);
  const { eligible, excluded } = costCalculatorDropdownProviders(data);
  const canonicalIds = new Set(expectedInput.inventory);
  assert.equal(data.providers.length, canonicalIds.size);
  assert.deepEqual(new Set(data.providers.map((provider) => provider.program_id)), canonicalIds);
  // Keep every canonical editorial identity; only comparable, permitted rows autofill.
  assert.deepEqual(eligible.map((provider) => provider.program_id).sort(), expectedInput.eligible);
  assert.deepEqual(excluded.map((provider) => provider.program_id).sort(), expectedInput.excluded);
  const eligibleIds = new Set(eligible.map((provider) => provider.program_id));
  for (const id of ["strut-health", "biltrx", "orderlymeds", "mydrhank", "sprout-health", "shedrx", "measured", "coreage-rx-glp-1-1632", "bodybuilding-com-glp-1-longevity-review", "skinnyrx-1-glp-weight-loss-provider-review", "rxspan-md-telehealth-program-review", "pallas-health-review", "wellmedr-review", "dudemeds-review", "synergy-rx-review", "breeze-meds-review", "care-bare-rx-glp1-review", "altrx-glp1-us-cps", "novi-weight-loss-glp-1", "curex-glp-1", "ro-wegovy-glp1-quiz-us-cpl", "eden-xentraffic-offer-3051", "futurhealth-wegovy-pillform", "lttl-glp-landing-page-2", "enhanced-tirzepatide-funnel-b", "sunlight-glp1", "joinskinny-semaglutide-glp-1-us", "levelsrx-extra-cpa-home-page", "refills", "tmates-xentraffic-offer-3154", "trimrx-xentraffic-offer-3014", "yucca-health-xentraffic-offer-3117", "longevity-meds-glp-1-review", "snagrx", "humecare-data-driven-glp-1-weight-loss-system", "g-plan", "jrnys-review", "medvi-review", "rightwell-review", "willow-review", "ivim-health-review", "tyde-wellness-review", "feelgood-review", "instarx-review", "retaclinic-review"]) assert.ok(canonicalIds.has(id), id);
  assert.equal(canonicalIds.has("trt-nation"), true, "a live-eligible provider must remain in the inventory");
  // One merchant, one option: the alias row never reaches the dropdown, and no
  // two options share a case-insensitive brand key.
  assert.equal(eligibleIds.has("shed"), false, "alias row must not be a second Shed option");
  const brandKeys = eligible.map((provider) => provider.provider.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  assert.equal(new Set(brandKeys).size, brandKeys.length, `duplicate brand in dropdown: ${brandKeys}`);
  assert.deepEqual(data.suppressed_alias_overrides, []);
  assert.equal(data.providers.find((provider) => provider.program_id === "strut-health").first_month_base_usd, null);
  assert.equal(data.providers.find((provider) => provider.program_id === "biltrx").recurring_month_base_usd, null);
  assert.equal(eligibleIds.has("strut-health"), false);
  // Synergy RX was the dropdown's "published prices, no comparable cadence" case.
  // Katalys paused it on 2026-08-17 and the registry row was removed, so it must
  // be absent from the calculator entirely rather than present-but-empty.
  assert.equal(eligible.some((provider) => provider.program_id === "synergy-rx"), false);
  assert.equal(data.providers.some((provider) => provider.program_id === "synergy-rx"), false);
});
