import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEvidenceInputs, validateMysteryShop, renderMysteryShop, computeEvidenceSha256 } from '../src/mystery-shop.mjs';
import { buildAlertIntents, validatePriceTracker } from '../src/price-tracker.mjs';
import { resolveDealEvaluationClocks, buildDealArtifacts } from '../src/deal-ingestion.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL('../' + file, import.meta.url)));
const tracker = read('data/price-tracker.json');
const deal = read('data/deals.json');
const manifest = read('artifacts/ops/wave4-deal-ingestion-manifest.json');
const day = 86400000;
const shift = (value, days) => new Date(Date.parse(value) + days * day).toISOString();
const alert = record => ({ previous: [record], current: [record], subscriptions: [] });

test('each raw accepted alert row has its own positive, stale and future clock controls', () => {
  for (const record of tracker.records) {
    assert.deepEqual(buildAlertIntents(alert(record), {now: record.checked_at}), []);
    assert.throws(() => buildAlertIntents(alert(record), {now: shift(record.checked_at, 46)}), /alert_record_freshness_invalid/);
    assert.throws(() => buildAlertIntents(alert(record), {now: shift(record.checked_at, -1)}), /alert_record_freshness_invalid/);
  }
});

test('page qualification does not refresh raw alerts or create a common valid batch clock', () => {
  const pageNow = new Date(Math.max(...tracker.records.map(row => Date.parse(row.checked_at)))).toISOString();
  assert.equal(validatePriceTracker(tracker, {now: pageNow}).status, 'PASS');
  const historical = tracker.records.find(row => row.provider_id === 'weightwatchers');
  assert.equal(historical.checked_at, '2026-08-02T01:41:56.582193Z');
  const lower = Math.max(...tracker.records.map(row => Date.parse(row.checked_at)));
  const upper = Math.min(...tracker.records.map(row => Date.parse(row.checked_at) + 45 * day));
  assert.ok(lower > upper, 'no common raw freshness interval exists');
  assert.throws(() => buildAlertIntents(alert(historical), {now: pageNow}), /alert_record_freshness_invalid/);
  // Retain the historical August future negative without rewriting source dates.
  assert.throws(() => buildAlertIntents(alert({...historical, checked_at:'2026-08-03T00:00:00Z'}), {now: historical.checked_at}), /alert_record_freshness_invalid/);
});

test('accepted config and ledger must remain paired with reader identity', () => {
  const input = loadEvidenceInputs(root), now = input.ledger.generated_at_utc;
  assert.equal(validateMysteryShop(input.config, input.ledger, {now}).accepted_firecrawl_captures, 3);
  assert.throws(() => validateMysteryShop(input.config, structuredClone(input.ledger), {now}), /evidence_ledger_binding_invalid/);
  assert.throws(() => validateMysteryShop(read('data/mystery-shop.json'), input.ledger, {now}), /evidence_ledger_binding_invalid/);
  assert.throws(() => validateMysteryShop(read('data/mystery-shop.json'), read('data/wave4-source-capture-ledger.json'), {now:'2026-08-02T02:00:00Z'}), /accepted_capture_pin_invalid:ro-weight-loss-pricing-20260802:scrape_id/);
});

test('explicit mystery render time governs qualification even when ambient clock has expired', () => {
  const input = loadEvidenceInputs(root), now = input.ledger.generated_at_utc;
  const saved = Date.now;
  Date.now = () => Date.parse(shift(now, 100));
  try {
    const html = renderMysteryShop(input.config, input.ledger, {now});
    assert.match(html, /data-renewal-qualification/);
    assert.match(html, /Historical quote — not current renewal pricing/);
  } finally { Date.now = saved; }
  assert.throws(() => renderMysteryShop(input.config, input.ledger, {now:shift(now, 46)}), /evidence_ledger_generated_at_freshness_invalid/);
  assert.throws(() => renderMysteryShop(input.config, input.ledger, {now:shift(now, -1)}), /evidence_ledger_generated_at_freshness_invalid/);
});

test('qualified historical observation still rejects invalid, future, after-qualification and ancient dates', () => {
  const input = loadEvidenceInputs(root), now = input.ledger.generated_at_utc;
  const id = input.config.observations.findIndex(row => row.provider_id === 'weightwatchers');
  for (const [value, code] of [
    ['not-a-timestamp', 'observation_timestamp_invalid'],
    [shift(now, 1), 'observation_timestamp_invalid'],
    ['1970-01-01T00:00:00Z', 'observation_qualification_lineage_invalid'],
    [now, 'observation_after_qualification_invalid'],
  ]) {
    const config = structuredClone(input.config), row = config.observations[id];
    row.observed_at = value;
    row.evidence_sha256 = computeEvidenceSha256(config, row, input.ledger.records.find(capture => capture.capture_id === row.capture_id));
    assert.throws(() => validateMysteryShop(config, input.ledger, {now}), error => error.message === code);
  }
});

test('per-offer clocks retain historical and accepted material identities and refuse serialization', () => {
  const clocks = resolveDealEvaluationClocks(deal, {preservedNow:manifest.evaluated_at});
  const built = buildDealArtifacts(deal, {evaluationClocks:clocks});
  assert.deepEqual(built.manifest.offer_evaluation_clocks, manifest.offer_evaluation_clocks);
  assert.match(built.html, /13 prescription fills per calendar year/);
  assert.equal(deal.offers.find(row => row.id.startsWith('zepbound-')).fill_limit.count, 11);
  assert.throws(() => buildDealArtifacts(deal, {evaluationClocks:structuredClone(clocks)}), /offer_evaluation_clocks_unauthenticated/);
});

test('lastmod fixtures authenticate predecessor clocks rather than restamping the current catalog', () => {
  const source = readFileSync(new URL('./lastmod-declared-routes.test.mjs', import.meta.url), 'utf8');
  // GLP73 replaced the fictional common-baseline fixture with the retained
  // predecessor and native preparer. That fixture no longer has either a
  // CARRIER_FIXTURE_BASELINE constant or an invented integration release date.
  assert.match(source, /await prepareLastmod\(root\)/);
  assert.match(source, /assert\.equal\(sha256\(manifestBytes\), pointer\.manifest\.sha256\)/);
  assert.match(source, /assert\.equal\(sha256\(bytes\), rows\.get\(relative\)/);
  assert.doesNotMatch(source, /const CARRIER_FIXTURE_BASELINE|GLP_RELEASE_DATE:\s*RELEASE/);
  const prefix='data/predecessors/content-base/';
  const pointer=read(prefix+'current-content-base.json');
  const manifestBytes=readFileSync(new URL('../'+prefix+'deployment-manifest.json',import.meta.url));
  assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),pointer.manifest.sha256);
  const manifest=JSON.parse(manifestBytes);
  const provenance=readFileSync(new URL('../'+prefix+'release/data/page-content-provenance.json',import.meta.url));
  assert.equal(createHash('sha256').update(provenance).digest('hex'),manifest.release_rows.find(row=>row.path==='data/page-content-provenance.json').sha256);
});

// This is an isolated pure-selector check, not authority minting: it evaluates the actual
// selector body with supplied arrays, never inserts a private WeakMap entry or validates a ledger.
test('qualification selector rejects raw duplicates including malformed second claimants', () => {
  const source = readFileSync(new URL('../src/mystery-shop.mjs', import.meta.url), 'utf8');
  const body = source.match(/function selectQualifications\(ledger\) \{([\s\S]*?)\n\}/)[1];
  const select = Function('materialQualificationsFor', 'ledger', body);
  const q = {material:{observation_id:'ww',capture_id:'ww-capture'},fetched_at:'2026-09-14T00:00:00Z'};
  assert.equal(select(() => [q], {}).get('ww'), q);
  assert.throws(() => select(() => [q, structuredClone(q)], {}), /observation_qualification_ambiguous/);
  assert.throws(() => select(() => [q, {material:{observation_id:'ww'}}], {}), /observation_qualification_ambiguous/);
  assert.throws(() => select(() => [{material:{observation_id:'ww'}}], {}), /observation_qualification_malformed/);
});
