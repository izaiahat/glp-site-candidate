import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizedTaxonomySha256, reconcileTherapeuticTaxonomyWireIn } from '../src/therapeutic-taxonomy.mjs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url));
const registry = JSON.parse(read('data/program-registry.json'));
const policies = JSON.parse(read('scripts/therapeutic-taxonomy-refresh-policies.json'));
const id = 'care-bare-rx-glp1-review';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('Care Bare corrects only active brand projections and does not erase historical quotation', () => {
  const program = registry.programs.find(row => row.program_id === id);
  const profile = registry.provider_dynamic_profiles.profiles[id];
  const taxonomy = registry.therapeutic_taxonomy.programs[id];
  for (const tags of [program.research_dynamic_profile.taxonomy, profile.taxonomy, taxonomy]) {
    assert.deepEqual(tags.brand_name_tags, []);
    assert.deepEqual(tags.molecule_tags, ['semaglutide', 'tirzepatide']);
    assert.deepEqual(tags.delivery_form_tags, ['injectable', 'oral']);
    assert.deepEqual(tags.treatment_type_tags, ['compounded']);
  }
  assert.ok(!profile.evidence_bindings.some(binding => binding.fields?.includes('taxonomy.brand_name_tags')));
  assert.ok(!taxonomy.evidence_bindings.some(binding => binding.evidence_sha256 === '68baad60813dacfd9096bd4c5adf49da9fd6d6432d0d2405733af032a890793d'));
  assert.ok(profile.evidence_bindings.some(binding => binding.evidence_text?.includes('(Mounjaro®) in stock')));
  assert.deepEqual(Object.keys(policies[id]), ['sources']);
  assert.deepEqual(policies[id].sources.map(source => source.url), [
    'https://www.carebarerx.com/products/weight-loss-medications', 'https://www.carebarerx.com/home2',
  ]);
  assert.deepEqual(policies[id].sources.flatMap(source => Object.keys(source.quotes.brand_name_tags || {})), []);
});

test('Care Bare active medication summaries omit the brand association without changing source quotations', () => {
  const corrected = 'Semaglutide and tirzepatide; injectable and oral options are described, including compounded options';
  const ledger = JSON.parse(read('data/program-content-ledger.json'));
  const money = JSON.parse(read('data/money-page-specs.json'));
  const contract = JSON.parse(read('data/provider-page-contracts.json'));
  assert.equal(ledger.programs.find(row => row.program_id === id).meds_offered, corrected);
  const rows = money.pages.flatMap(page => page.rows.filter(row => row.program_id === id));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.meds_offered === corrected));
  assert.equal(contract.providers.find(row => row.program_id === id).row_contract.medications, corrected);
  assert.ok(registry.provider_dynamic_profiles.profiles[id].evidence_bindings.some(binding => binding.evidence_text?.includes('(Mounjaro®) in stock')));
  for (const path of ['data/s32-predecessor-content-ledger.json', 'data/d2w-release2-price-predecessor-ledger.json', 'data/price-index-frozen-content-ledger.json']) {
    assert.match(read(path).toString(), /Mounjaro by name/);
  }
});

test('Novi changes only the five approved image extensions, not its tags or offer context', () => {
  const quotes = policies['novi-weight-loss-glp-1'].quotes;
  const all = Object.values(quotes).flatMap(value => Object.values(value));
  assert.equal(all.length, 5);
  assert.ok(all.every(quote => quote.includes('.avif)') && !quote.includes('.png)')));
  assert.deepEqual(Object.keys(quotes.molecule_tags), ['semaglutide', 'tirzepatide']);
  assert.deepEqual(Object.keys(quotes.brand_name_tags), ['wegovy', 'mounjaro', 'zepbound']);
});

test('unchanged native structural reconciler accepts registry at original dates and seal', () => {
  const dates = [registry.therapeutic_taxonomy.sealed_as_of, registry.therapeutic_taxonomy.programs[id].verified_as_of,
    registry.provider_dynamic_profiles.profiles[id].verified_as_of];
  assert.equal(registry.therapeutic_taxonomy.programs[id].normalized_sha256,
    normalizedTaxonomySha256(registry.therapeutic_taxonomy.programs[id]));
  reconcileTherapeuticTaxonomyWireIn({ registry, profileId: 'glp-clinic-scout',
    pages: JSON.parse(read('data/money-page-specs.json')).pages,
    quizConfig: JSON.parse(read('data/quiz-config.json')), asOf: new Date('2026-09-27T12:00:00Z') });
  assert.deepEqual([registry.therapeutic_taxonomy.sealed_as_of, registry.therapeutic_taxonomy.programs[id].verified_as_of,
    registry.provider_dynamic_profiles.profiles[id].verified_as_of], dates);
});

test('frozen F17 input pin still refuses this unaccepted registry byte sequence', () => {
  const fixture = JSON.parse(read('tests/fixtures/glp41-approved-input-successor.json'));
  const input = 'data/program-registry.json';
  const nodeSource = read('tests/glp41-material-contracts.test.mjs').toString();
  const start = nodeSource.indexOf("test('F17 approved registry successor binds exact prior and current bytes'");
  const end = nodeSource.indexOf("\ntest('F34", start);
  assert.ok(start >= 0 && end > start);
  const guard = new Function('test', 'assert', 'read', 'sha', nodeSource.slice(start, end));
  assert.equal(fixture.inputs[input].after_sha256, '612814c63d7276d2affe721a7e63664d02703c2554d049a4db25ee61ee05560d');
  assert.notEqual(sha(read(input)), fixture.inputs[input].after_sha256);
  assert.throws(() => guard((_name, check) => check(), assert, path => read(path), sha), { code: 'ERR_ASSERTION' });
});
