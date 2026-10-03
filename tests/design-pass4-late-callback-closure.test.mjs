import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { optionCProgramIds } from './helpers/d2w-s9-contracts.mjs';
import { assertCurrentCardPrice } from './helpers/current-card-price.mjs';
import { readFileSync } from 'node:fs';
const currentPricing = JSON.parse(readFileSync(new URL('../data/provider-pricing-matrix.json', import.meta.url))).providers;
import { governedBulkCohorts, governedBrandCohorts, governedCardFacts, governedCompoundedUnknownIds, governedProviderIds } from './browser/governed-cohort.mjs';

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => readFile(path.join(ROOT, relative), "utf8");
const count = (text, pattern) => (text.match(pattern) || []).length;
const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const cardId = (card) => card.match(/data-program="([^"]+)"/)?.[1];
function assertFactsAndActions(card, id, route, ledger, offers, content, issued, moneyRows, { priced }) {
  const rows = [...card.matchAll(/<div><dt>([^<]+)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)].map(row => {
    const plain = row[2].match(/^<span>([\s\S]*?)<\/span>([\s\S]*)$/);
    return [row[0], row[1], plain?.[1] ?? row[2], plain?.[2] ?? ''];
  });
  assert.deepEqual(rows.map((row) => row[1]), ['Medications offered', 'Total monthly cost', 'Cancellation'], `${route}/${id}: fact labels`);
  if (priced) {
    const facts = governedCardFacts(id);
    assert.deepEqual([rows[0][2], rows[2][2]], [facts.medication, facts.cancellation].map(escapeHtml), `${route}/${id}: source-derived non-price facts`);
    const meds = card.match(/data-medications="([^"]*)"/)?.[1].split(/\s+/) || [];
    const priceRows = Object.values(currentPricing).find(p => p.program_id === id)?.medications.filter(p => meds.includes(p.medication_id)) || [];
    assert.ok(priceRows.length, `${route}/${id}: current price evidence required`);
    assertCurrentCardPrice(card, priceRows);
    const source = content.find((row) => row.program_id === id);
    assert.ok(source?.source_url && source.research_cancellation?.source_url, `${route}/${id}: numeric citation inputs`);
    for (const [index, row] of rows.entries()) {
      if (index === 1) continue; // independently joined to current matrix above
      const expectedUrl = index === 2 ? source.research_cancellation.source_url : source.source_url;
      const expectedDate = index === 2 ? source.research_cancellation.verified_as_of : source.research_first_month_price?.verified_as_of;
      assert.ok(expectedDate && row[3].includes(`data-source-checked="${expectedDate}"`), `${route}/${id}: wrong fact date`);
      assert.ok(row[3].includes(`href="${escapeHtml(expectedUrl)}"`), `${route}/${id}: wrong fact source URL`);
    }
  } else {
    assert.equal(rows[1][2], 'Price not yet substantiated for this product/plan — check the provider\'s current terms');
    assert.equal(rows[2][2], 'Check the provider\'s cancellation terms.');
    const medicationIds = card.match(/data-medications="([^"]+)"/)?.[1].split(/\s+/) || [];
    const matchedOffers = offers.filter((offer) => offer.program_id === id && medicationIds.includes(offer.medication_id));
    const expectedMedication = matchedOffers.map((offer) => escapeHtml(offer.label)).join('; ')
      + (route === 'wegovy-pill' && medicationIds.every((medication) => medication.startsWith('compounded-')) ? ' (not Wegovy Pill)' : '');
    assert.equal(rows[0][2], expectedMedication, `${route}/${id}: unpriced medication wording`);
    const evidence = matchedOffers
      .flatMap((offer) => offer.evidence || []);
    assert.ok(evidence.some((source) => rows[0][3].includes(`data-source-checked="${source.checked_date}"`)
      && rows[0][3].includes(`href="${escapeHtml(source.source_url)}"`)), `${route}/${id}: medication source URL/date not bound to offer evidence`);
  }
  const review = ledger.find((row) => row.program_id === id)?.review_path;
  assert.ok(review?.startsWith('/reviews/'), `${route}/${id}: missing first-party review source`);
  assert.ok(card.includes(`href="${review}" data-card-review`), `${route}/${id}: wrong review action`);
  const conversion = card.match(/<a\b[^>]*data-analytics-event="affiliate_click"[^>]*>/)?.[0];
  if (conversion) {
    assert.match(conversion, /rel="[^"]*sponsored[^\"]*"/, `${route}/${id}: sponsorship`);
    const href = conversion.match(/href="([^"]+)"/)?.[1];
    if (href?.startsWith('/go/')) {
      assert.ok(href.startsWith(`${ledger.find((row) => row.program_id === id)?.go?.route}?`), `${route}/${id}: wrong governed go action`);
    } else {
      const allowed = new Set(moneyRows.filter((row) => row.program_id === id).map((row) => escapeHtml(row.affiliate_href)).filter(Boolean));
      const issuedLinks = new Set(issued.filter(Boolean).map((record) => escapeHtml(record.provider_issued_url)).filter(Boolean));
      assert.ok(allowed.has(href) && issuedLinks.has(href), `${route}/${id}: direct action not bound to issued link and money-page row`);
    }
  } else assert.match(card, /data-affiliate-unavailable[^>]*>[\s\S]*?Enrollment link pending verification/, `${route}/${id}: unavailable action`);
}

test("late callback source cleanup and capture proof bind to the canonical bytes", async () => {
  const [build, contentUpgrade, editorialCss, capture] = await Promise.all([
    read("scripts/build-staging.mjs"),
    read("src/content-upgrade.mjs"),
    read("assets/css-src/40-editorial.css"),
    read("scripts/capture-design-pass-evidence.mjs"),
  ]);
  assert.doesNotMatch(build, /reviewSheetStyle|const reviewSheet\s*=|legacy_v1/);
  assert.match(build, /const reviewSheetV2\s*=/);
  assert.match(contentUpgrade, /Start with \$\{esc\(breakdown\.affiliateOffer\.merchant\)\}/);
  assert.doesNotMatch(contentUpgrade, /See current \$\{esc\(breakdown\.affiliateOffer\.merchant\)\} terms/);
  assert.match(editorialCss, /\.capture-honeypot\s*\{[\s\S]*?left:\s*-10000px/);
  assert.match(capture, /name:\s*"bulk-hub",\s*route:\s*"\/bulk\/"/);
  assert.match(capture, /manifest\.current_byte_hashes/);
});

test("fixed-duration and brand cards enforce Option C with one primary conversion lane", async () => {
  const routes = ["3-month", "6-month", "ozempic", "wegovy", "wegovy-pill", "mounjaro", "zepbound"];
  const ledger = JSON.parse(await read('data/program-registry.json')).programs;
  const offers = JSON.parse(await read('data/unpublished-offer-evidence.json')).offers;
  const content = JSON.parse(await read('data/program-content-ledger.json')).programs;
  const issued = [
    ...Object.values(JSON.parse(await read('data/approved-program-evidence-snapshot.json')).tracking_by_program),
    ...JSON.parse(await read('data/affiliate-wire-in-approvals.json')).programs.map((row) => row.tracking),
  ];
  const moneyRows = JSON.parse(await read('data/money-page-specs.json')).pages.flatMap((page) => page.rows || []);
  for (const route of routes) {
    const raw = await read(`public/${route}/index.html`);
    const html = javascriptProviderMarkup(raw);
    const noJsCards = new Map([...raw.matchAll(/<noscript>\s*(<article\b[^>]*data-provider-noscript-card[^>]*>[\s\S]*?<\/article>)\s*<\/noscript>/g)]
      .map((match) => [match[1].match(/data-program="([^"]+)"/)?.[1], match[1]]));
    const numeric = html.match(/<section id="provider-results"[\s\S]*?<\/section>/)?.[0] || "";
    assert.ok(numeric, `${route}: numeric results region missing`);
    const cards = [...numeric.matchAll(/<article class="p3-provider-card\b[\s\S]*?<\/article>/g)].map((match) => match[0]);
    const status = html.match(/<span class="listing__count"[^>]*data-filter-result[^>]*>(\d+) comparable price results<\/span>/)?.[1];
    assert.ok(status !== undefined, `${route}: live numeric status missing`);
    assert.equal(Number(status), cards.length, `${route}: result count must not include non-priced cards`);
    assert.equal(count(html, /class="listing__count"[^>]*data-filter-result/g), 1, `${route}: duplicate live status`);
    const unpriced = html.match(/<section\b[^>]*data-unpublished-provider-section[\s\S]*?<\/section>/)?.[0] || "";
    const otherCards = [...unpriced.matchAll(/<article class="p3-provider-card\b[\s\S]*?<\/article>/g)].map((match) => match[0]);
    const expected = route.includes("month")
      ? governedBulkCohorts("SEMAGLUTIDE", Number.parseInt(route, 10))
      : governedBrandCohorts(`brand-${route}`);
    if (route !== "wegovy-pill") {
      assert.deepEqual(cards.map((card) => card.match(/data-program="([^"]+)"/)?.[1]).sort(), expected.numeric.sort(), `${route}: governed numeric cohort`);
      assert.deepEqual(otherCards.map((card) => card.match(/data-program="([^"]+)"/)?.[1]).sort(), expected.unpriced.sort(), `${route}: governed non-price cohort`);
    }
    if (!cards.length && otherCards.length) {
      assert.match(numeric, /No comparable price matches those filters\. Records without a comparable price are listed separately below\./);
      assert.match(numeric, /Active filters: none\./);
      assert.match(numeric, /data-filter-reset/);
    }
    for (const shell of cards) {
      const id = cardId(shell);
      const card = noJsCards.get(id) || shell;
      if (shell.includes('data-provider-lazy-index')) assert.ok(noJsCards.has(id), `${route}: deferred card lacks no-JS facts`);
      assert.equal(count(card, /data-provider-card-contract="option-c"/g), 1, route);
      for (const label of ["Medications offered", "Total monthly cost", "Cancellation"])
        assert.equal(count(card, new RegExp(`<dt>${label}<\\/dt>`, "g")), 1, route);
      const conversions = count(card, /data-analytics-event="affiliate_click"/g);
      const unavailable = count(card, /data-affiliate-unavailable/g);
      assert.equal(conversions + unavailable, 1, `${route}: one verified conversion or explicit unavailable state`);
      if (unavailable) assert.match(card, /Enrollment link pending verification/);
      assert.match(card, /data-card-review/, `${route}: internal review action missing`);
      assert.doesNotMatch(card, /data-bulk-comparison-ledger|data-brand-cost-ledger|data-insurance-provider\b|p3-dose-grid|UNKNOWN_NO_SOURCE|>Not published/);
      assertFactsAndActions(card, id, route, ledger, offers, content, issued, moneyRows, { priced: true });
    }
    for (const card of otherCards) {
      assert.match(card, /data-unpublished-price-card/);
      assert.match(card, /data-price-state="unpublished"/);
      assert.match(card, /data-price=""/);
      assert.doesNotMatch(card, /data-price="\d|data-bulk-comparison-ledger|UNKNOWN_NO_SOURCE/);
      assert.match(card, /data-card-review|href="\/providers\//, `${route}: non-priced record lost its detail action`);
      assertFactsAndActions(card, cardId(card), route, ledger, offers, content, issued, moneyRows, { priced: false });
    }
    assert.doesNotMatch(html, /href="\/quiz\/provider-fit\/\?provider=/);
    if (route.includes("month")) {
      assert.equal(count(html, /data-mode="bulk"/g), cards.length + otherCards.length, route);
      assert.equal(count(html, new RegExp(`data-product-visual="bulk-${route}"`, "g")), 1, route);
    }
  }
});

test("compounded state-unknown rows are separated and the provider directory enforces Option C", async () => {
  for (const drug of ["semaglutide", "tirzepatide"]) {
    const compounded = await read(`public/lp/best-providers/compounded-${drug}/index.html`);
    const remainderAt = compounded.indexOf("data-state-unverified-remainder");
    assert.ok(remainderAt > 0, drug);
    const main = compounded.slice(0, remainderAt);
    const remainder = compounded.slice(remainderAt).match(/^[\s\S]*?<\/section>/)?.[0] || "";
    assert.equal(count(main, /data-state-mode="unknown"/g), 0, drug);
    assert.ok(count(main, /data-phase3-provider(?=[\s>])/g) > 0, drug);
    const unknown = [...remainder.matchAll(/<article\b[^>]*data-phase3-provider(?=[\s>])[^>]*>/g)].map((match) => match[0]);
    assert.deepEqual(unknown.map((tag) => tag.match(/data-program="([^"]+)"/)?.[1]).sort(), governedCompoundedUnknownIds(drug), drug);
    assert.ok(unknown.length > 0, `${drug}: unknown owner missing`);
    for (const card of unknown) assert.match(card, /data-state-mode="unknown"/, `${drug}: false verified availability`);
    assert.match(remainder, /State availability not established/);
    assert.match(remainder, /A published price is not confirmation of access or treatment eligibility/);
  }

  const providers = javascriptProviderMarkup(await read("public/providers/index.html"));
  const payloadScript = providers.match(/<script\b[^>]*data-provider-card-payloads[^>]*>[\s\S]*?<\/script>/i)?.[0] || "";
  const payloadInline = payloadScript.match(/>([\s\S]*?)<\/script>/i)?.[1]?.trim() || "[]";
  const payloadSource = payloadScript.match(/\bdata-src="([^"]+)"/i)?.[1] || "";
  const deferredPayload = JSON.parse(payloadSource && payloadInline === "[]"
    ? await read(`public/${payloadSource.replace(/^\//, "")}`)
    : payloadInline);
  const providerMarkup = `${providers}${deferredPayload.join("")}`;
  const cards = new Set([...providers.matchAll(/data-phase3-provider\b[^>]*data-program="([^"]+)"/g)].map((match) => match[1]));
  const expectedIds = optionCProgramIds();
  assert.deepEqual([...expectedIds].sort(), governedProviderIds().sort(), "governed source cohorts disagree");
  const optionCExpected = expectedIds.length;
  assert.deepEqual([...cards].sort(), expectedIds.sort());
  assert.equal(cards.size, optionCExpected);
  assert.equal(count(providerMarkup, /data-provider-card-contract="option-c"/g), optionCExpected);
  assert.equal(count(providerMarkup, /<dt>Medications offered<\/dt>/g), optionCExpected);
  assert.equal(count(providerMarkup, /<dt>Total monthly cost<\/dt>/g), optionCExpected);
  assert.equal(count(providerMarkup, /<dt>Cancellation<\/dt>/g), optionCExpected);
  assert.doesNotMatch(providerMarkup, /class="p3-dose-grid"|UNKNOWN_NO_SOURCE|>Not published</);
  assert.doesNotMatch(providers, /data-provider-record=|Browse \d+ additional governed provider records/);
  for (const program of ["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review", "g-plan", "jrnys-review", "medvi-review"]) assert.equal(cards.has(program), false);
});

test("bulk hub previews and Wegovy Pill non-empty duration default are shipped", async () => {
  const [bulk, site] = await Promise.all([read("public/bulk/index.html"), read("assets/site.js")]);
  assert.equal(count(bulk, /class="p3-intent-preview"/g), 4);
  assert.equal(count(bulk, /source-backed provider row/g), 4);
  assert.doesNotMatch(bulk, /phase3-product--|data-representative-editorial-visual/);
  assert.match(site, /\['all', 'Any published duration'\]/);
});
import { javascriptProviderMarkup } from './helpers/d2p-noscript.mjs';
