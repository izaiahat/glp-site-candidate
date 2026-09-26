import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadCarrierArticles, assertCarrierArticleOutput} from '../src/carrier-article-retention.mjs';
import {loadAffiliateLinkMap} from '../src/affiliate-link-map.mjs';
import {COST_AFFILIATE_EMAIL_MANIFEST} from '../src/cost-affiliate-email-manifest.generated.mjs';
import {checkDispositions} from '../scripts/ci-release-gate.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(new URL('../'+path, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('D1 every original requirement has exactly one reviewed disposition', () => {
  const manifest = JSON.parse(read('ops/release-dispositions.json'));
  const quarantine = JSON.parse(read('ops/test-quarantine.json'));
  assert.equal(checkDispositions(manifest, quarantine).rows, 26);
  assert.throws(() => checkDispositions({...manifest, rows:manifest.rows.slice(1)}, quarantine), /disposition_denominator/);
  const duplicate = structuredClone(manifest); duplicate.rows[1] = duplicate.rows[0];
  assert.throws(() => checkDispositions(duplicate, quarantine), /disposition_duplicate/);
});

test('D1 a material repair cannot be silently moved to quarantine', () => {
  const manifest = JSON.parse(read('ops/release-dispositions.json'));
  const quarantine = JSON.parse(read('ops/test-quarantine.json'));
  const changed = structuredClone(manifest); changed.rows.find(row => row.id === 'F25').bucket = 'c';
  assert.throws(() => checkDispositions(changed, quarantine), /disposition_missing_or_changed/);
  quarantine.diagnostics.push({id:'F25', reason:'Pretend price evidence is cosmetic'});
  assert.throws(() => checkDispositions(manifest, quarantine), /material_quarantine:F25/);
});

test('F17 approved registry successor binds exact prior and current bytes', () => {
  const pins = JSON.parse(read('tests/fixtures/glp41-approved-input-successor.json'));
  assert.deepEqual(Object.keys(pins.inputs), ['data/program-registry.json']);
  const pin = pins.inputs['data/program-registry.json'];
  assert.equal(pin.before_sha256, 'bd74cce7b25ccc1b754f26b70be51a8f96afb8356e8a53c3e919985c9d8500b6');
  assert.equal(sha(read('data/program-registry.json')), pin.after_sha256);
  assert.notEqual(pin.before_sha256, pin.after_sha256);
  assert.notEqual(sha(Buffer.concat([read('data/program-registry.json'), Buffer.from('tampered')])), pin.after_sha256);
});

test('F34 final emitted carrier articles retain the exact authenticated body and stage bytes', () => {
  const retained = loadCarrierArticles(root);
  assert.equal(retained.size, 2);
  for (const [path, article] of retained) {
    const bytes = read('public/'+path);
    // The registered release policy owns stage; this does not change any
    // consent assertion or permit changing frozen article/source bytes.
    assertCarrierArticleOutput(article, bytes);
    assert.throws(() => assertCarrierArticleOutput(article, Buffer.concat([bytes, Buffer.from('tampered')])), /carrier_article_output_drift/);
  }
});

test('F35 generated email manifest includes every approved link independently of calculator price eligibility', () => {
  const expected = Object.values(loadAffiliateLinkMap('calculator')).filter(row => row.live && row.affiliate_href);
  const actual = COST_AFFILIATE_EMAIL_MANIFEST.programs;
  assert.ok(expected.length > 0);
  assert.deepEqual(actual.map(row => row.program_id).sort(), expected.map(row => row.program_id).sort());
  for (const row of expected) assert.equal(actual.find(item => item.program_id === row.program_id).affiliate_href, row.affiliate_href);
  const matrix = JSON.parse(read('data/provider-pricing-matrix.json')).providers;
  assert.ok(expected.some(row => !matrix[row.program_id]?.medications.some(price => Number.isFinite(price.month_1_usd) && Number.isFinite(price.ongoing_usd))), 'approved display-only or unpriced links cannot be omitted from email manifest');
});
