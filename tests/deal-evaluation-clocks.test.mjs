import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDealArtifacts, resolveDealEvaluationClocks, validateDeals } from '../src/deal-ingestion.mjs';
import config from '../data/deals.json' with { type: 'json' };

const preservedNow = '2026-08-08T23:52:45.888Z';
const acceptedAt = '2026-09-14T19:27:04.300Z';
const zepbound = 'zepbound-commercially-uncovered-single-dose-pen-2026';
const card = (html, id) => html.match(new RegExp(`<article[^>]*data-offer-id="${id}"[\\s\\S]*?</article>`))?.[0];

test('authenticated map advances the accepted offer and preserves every unaccepted offer render', () => {
  const original = JSON.stringify(config);
  const evaluationClocks = resolveDealEvaluationClocks(config, { preservedNow });
  const { html, manifest } = buildDealArtifacts(config, { evaluationClocks });
  assert.equal(evaluationClocks[zepbound].evaluated_at, acceptedAt);
  assert.match(card(html, zepbound), /13 prescription fills per calendar year/);
  assert.match(card(html, zepbound), /KwikPen[^<]*11 prescription fills per calendar year/);
  assert.match(card(html, zepbound), /https:\/\/zepbound.lilly.com\/savings/);
  assert.ok(card(html, zepbound).includes(acceptedAt));
  assert.doesNotMatch(card(html, zepbound), /\bfalse\b/);
  for (const offer of config.offers.filter(offer => offer.id !== zepbound)) {
    assert.deepEqual(evaluationClocks[offer.id], { evaluated_at: preservedNow, basis: 'preserved', acceptance: null });
    assert.ok(card(html, offer.id).includes(offer.checked_at));
    assert.ok(card(html, offer.id).includes(offer.source.scrape_id));
    const oldHtml = readFileSync('/home/ubuntu/business/site-system/flagship-v2/releases/sealed-d2w-release2-current-20260911T152308Z/public/tools/glp-1-savings-offer-monitor/index.html', 'utf8');
    assert.equal(card(html, offer.id), card(oldHtml, offer.id));
  }
  const wegovy = card(html, 'wegovy-self-pay-dose-pricing-2026');
  assert.match(wegovy, /Current price terms[\s\S]*\$149<\/strong> per month — Wegovy 4 mg/);
  assert.match(wegovy, /Scheduled transition[\s\S]*\$199<\/strong> per month — Wegovy 4 mg/);
  assert.equal(manifest.evaluated_at, preservedNow);
  assert.equal(manifest.evaluation_mode, 'per_offer');
  assert.deepEqual(manifest.offer_evaluation_clocks, evaluationClocks);
  assert.equal(manifest.record_count, config.offers.length);
  assert.deepEqual(manifest.active_record_ids, config.offers.map(offer => offer.id));
  assert.ok(Object.values(manifest.html_facts).every(count => count === 0));
  assert.equal(JSON.stringify(config), original);
  console.log(JSON.stringify({ per_offer_readback: manifest.offer_evaluation_clocks, active_record_count: manifest.active_record_count }));
});

test('cloned, edited, incomplete and wrong-input clock maps cannot self-authorize', () => {
  const map = resolveDealEvaluationClocks(config, { preservedNow });
  for (const forged of [structuredClone(map), { ...map }, {}]) {
    assert.throws(() => buildDealArtifacts(config, { evaluationClocks: forged }), /offer_evaluation_clocks_unauthenticated/);
  }
  const forged = structuredClone(map);
  forged['wegovy-self-pay-dose-pricing-2026'].evaluated_at = acceptedAt;
  assert.throws(() => buildDealArtifacts(config, { evaluationClocks: forged }), /offer_evaluation_clocks_unauthenticated/);
  const changed = structuredClone(config);
  changed.offers[0].checked_at = acceptedAt;
  assert.throws(() => buildDealArtifacts(changed, { evaluationClocks: map }), /offer_evaluation_clocks_config_mismatch/);
  assert.throws(() => buildDealArtifacts(config, { evaluationClocks: map, now: acceptedAt }), /offer_evaluation_clocks_scalar_conflict/);
});

test('existing scalar caller and freshness refusal semantics remain intact', () => {
  const { html, manifest } = buildDealArtifacts(config, { now: acceptedAt });
  assert.equal(manifest.evaluated_at, acceptedAt);
  assert.equal(manifest.evaluation_mode, undefined);
  assert.equal(manifest.offer_evaluation_clocks, undefined);
  assert.match(card(html, 'wegovy-self-pay-dose-pricing-2026'), /Current price terms[\s\S]*\$199<\/strong> per month — Wegovy 4 mg/);
  assert.throws(() => buildDealArtifacts(config, { now: preservedNow }), /offer_evidence_future:zepbound/);
  assert.throws(() => validateDeals(config, { now: '2026-08-01T00:00:00Z' }), /offer_evidence_future/);
  assert.throws(() => validateDeals(config, { now: '2026-09-18T00:00:00Z' }), /offer_evidence_stale/);
});
