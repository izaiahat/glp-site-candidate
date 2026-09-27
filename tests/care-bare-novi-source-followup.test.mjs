import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import { bindCareFastpath } from '../scripts/bind-care-fastpath-contract.mjs';
import { createHash } from 'node:crypto';
import { normalizedTaxonomySha256, reconcileTherapeuticTaxonomyWireIn } from '../src/therapeutic-taxonomy.mjs';
import { normalizedProfileSha256, validateProviderDynamicProfiles, deriveDynamicFacetCounts } from '../src/provider-dynamic-profiles.mjs';

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
  const assessment = profile.evidence_bindings[1];
  assert.deepEqual(assessment.fields, ['taxonomy.brand_name_tags', 'verified_as_of']);
  assert.deepEqual(program.research_dynamic_profile.evidence_bindings[0].fields.includes('taxonomy.brand_name_tags'), true);
  assert.equal(profile.normalized_sha256, normalizedProfileSha256(profile));
  assert.equal(profile.normalized_sha256, '0332df9dbd6a0443ea4c01bf4508fa2fc0292d8de01dbd82e58a84eb1628288a');
  const validated = validateProviderDynamicProfiles(registry, 'glp-clinic-scout', {asOf: new Date('2026-09-27T12:00:00Z')});
  assert.equal(validated.profiles.size, 57);
  assert.deepEqual(validated.counts, deriveDynamicFacetCounts(validated.profiles));
  assert.equal(validated.counts.mounjaro, 7);
  // The old parenthetical quote is history, not an affirmative current offering.
  assert.ok(assessment.evidence_text.includes('(Mounjaro®) in stock'));
  assert.deepEqual(profile.taxonomy.brand_name_tags, []);
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

test('Care fastpath paired binding changes only the contract digest and refuses wrong contract bytes', () => {
  const old='6f64b4de008cfd9808f1007d9eb80a64f5eb7b6c7444b5ea2de2eaaff777db55';
  const accepted='edcbabb72522b0884f6d6ac97a813b6bf7afc2bb63bf4302c42162a0d03ffef6';
  const contract=read('data/provider-page-contracts.json');
  const final=read('data/provider-fastpath-contract.json');
  assert.equal(sha(contract), accepted);
  assert.equal(JSON.parse(final).current_contract_sha256,sha(contract)); // native validator line 100
  const prior=final.toString().replace(`"current_contract_sha256": "${accepted}"`,`"current_contract_sha256": "${old}"`);
  assert.notEqual(prior,final.toString());
  const scratchRoot=process.env.TMPDIR || new URL('../artifacts/test-work/',import.meta.url).pathname;
  fs.mkdirSync(scratchRoot,{recursive:true});
  const scratch=fs.mkdtempSync(join(scratchRoot,'care-fastpath-'));
  const data=join(scratch,'data');fs.mkdirSync(data);
  const contractPath=join(data,'provider-page-contracts.json');
  const fastpathPath=join(data,'provider-fastpath-contract.json');
  try {
    fs.writeFileSync(contractPath,contract);
    fs.writeFileSync(fastpathPath,prior);
    const receipt=bindCareFastpath(scratch);
    assert.deepEqual([receipt.status,receipt.from,receipt.to],['BOUND',old,accepted]);
    assert.deepEqual(fs.readFileSync(fastpathPath),final);
    assert.deepEqual(fs.readFileSync(contractPath),contract);
    assert.equal(bindCareFastpath(scratch).status,'ALREADY_BOUND');
    fs.writeFileSync(fastpathPath,prior);
    fs.appendFileSync(contractPath,' ');
    assert.throws(()=>bindCareFastpath(scratch),/care_fastpath_contract_not_accepted/);
    assert.equal(fs.readFileSync(fastpathPath,'utf8'),prior);
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
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

test('F17 adopts accepted Care registry and refuses preserved predecessor and unapproved bytes', () => {
  const fixture = JSON.parse(read('tests/fixtures/glp41-approved-input-successor.json'));
  const input = 'data/program-registry.json';
  const nodeSource = read('tests/glp41-material-contracts.test.mjs').toString();
  const start = nodeSource.indexOf("test('F17 approved registry successor binds exact prior and current bytes'");
  const end = nodeSource.indexOf("\ntest('F34", start);
  assert.ok(start >= 0 && end > start);
  const guard = new Function('test', 'assert', 'read', 'sha', nodeSource.slice(start, end));
  const run = (candidate, pins) => guard((_name, check) => check(), assert,
    path => path === input ? candidate : path === 'tests/fixtures/glp41-approved-input-successor.json'
      ? Buffer.from(JSON.stringify(pins)) : assert.fail(path), sha);
  assert.equal(fixture.inputs[input].after_sha256, 'd0bc5c1f702731b2b4fe3450884cf93310e88dcb1f7e7d6e4b33d96f4a3db644');
  assert.equal(fixture.provenance.previous_care_after_sha256, 'e463477e4a0094353f763e37a044eafd53a07d09b4e72345769244a879eb515e');
  assert.doesNotThrow(() => run(read(input), fixture));
  const stale = structuredClone(fixture);
  stale.inputs[input].after_sha256 = fixture.provenance.previous_care_after_sha256;
  assert.throws(() => run(read(input), stale), { code: 'ERR_ASSERTION' });
  const predecessor = structuredClone(fixture);
  predecessor.inputs[input].after_sha256 = fixture.provenance.prior_care_after_sha256;
  assert.equal(predecessor.inputs[input].after_sha256, '612814c63d7276d2affe721a7e63664d02703c2554d049a4db25ee61ee05560d');
  assert.throws(() => run(read(input), predecessor), { code: 'ERR_ASSERTION' });
  assert.throws(() => run(Buffer.concat([read(input), Buffer.from(' ')]), fixture), { code: 'ERR_ASSERTION' });
});
