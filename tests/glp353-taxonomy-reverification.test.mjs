import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateTherapeuticTaxonomy, matchesTherapeuticFacets } from '../src/therapeutic-taxonomy.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url));
const registry = JSON.parse(read('data/program-registry.json'));
const archive = 'reports/ops/glp353-taxonomy-reverification-20261009';
const verificationBytes = read(`${archive}/verification.json`);
const proof = JSON.parse(verificationBytes);
const previous = JSON.parse(read(`${archive}/previous-rows.json`));
const normalized = text => text.replaceAll('*', '').replaceAll('#', '').replace(/\s+/g, ' ').trim().toLowerCase();
const fields = ['molecule_tags', 'brand_name_tags', 'delivery_form_tags', 'treatment_type_tags'];
test('GLP-353 renews 24 canonical rows plus the Shed alias from live hash-bound public receipts', () => {
  assert.equal(proof.rows.length, 24);
  assert.equal(new Set(proof.rows.map(row => row.program_id)).size, 24);
  assert.equal(proof.raw_row_count, 25);
  assert.equal(registry.therapeutic_taxonomy.freshness_max_days, 31);
  const authority = registry.therapeutic_taxonomy.authorities.glp353_live_reverification_20261009;
  assert.equal(authority.sha256, sha(verificationBytes));
  for (const [url, descriptor] of Object.entries(proof.captures)) {
    const bytes = read(descriptor.path), capture = JSON.parse(bytes);
    assert.equal(sha(bytes), descriptor.sha256);
    assert.equal(capture.request.url, url);
    assert.equal(capture.request.maxAge, 0);
    assert.equal(capture.response.success, true);
    assert.equal(sha(capture.response.data.markdown), descriptor.markdown_sha256);
    assert.equal(capture.received_at, descriptor.received_at);
    assert.equal(capture.received_at.slice(0, 10), '2026-10-09');
    assert.ok(!/[?&](?:aff|affiliate|subid|clickid)=|\.sjv\.io|go2cloud|track\./i.test(url));
  }
  for (const item of [...proof.rows, ...proof.alias_assertions]) {
    const row = registry.therapeutic_taxonomy.programs[item.program_id];
    assert.equal(previous[item.program_id].verified_as_of, '2026-09-08');
    assert.equal(row.verified_as_of, '2026-10-09');
    assert.equal(row.evidence_captured_at.slice(0, 10), row.verified_as_of);
    assert.deepEqual(row.commercial_link_state, previous[item.program_id].commercial_link_state);
    for (const assertion of item.assertions) {
      assert.ok(assertion.quote.length >= 10, 'An assertion must retain its substantive quote, never an iterated string character');
      const capture = JSON.parse(read(proof.captures[assertion.source_url].path));
      assert.ok(normalized(capture.response.data.markdown).includes(normalized(assertion.quote)), `${item.program_id}:${assertion.tag}`);
    }
    for (const field of fields) for (const tag of row[field]) {
      assert.ok(item.assertions.some(a => a.field === field && a.tag === tag), `${item.program_id}:${field}:${tag}`);
    }
    for (const field of fields) {
      assert.deepEqual(row[field], item.program_id === 'mademed' && field === 'treatment_type_tags' ? [] : previous[item.program_id][field]);
    }
    for (const binding of row.evidence_bindings) {
      assert.equal(binding.evidence_sha256, proof.captures[binding.source_url].sha256);
      assert.equal(binding.verified_as_of, row.verified_as_of);
    }
  }
  assert.equal(registry.therapeutic_taxonomy.programs.shedrx.verified_as_of, '2026-10-09');
  // Keep the immutable cohort at its original clock. Coivas was not part of
  // that cohort; its later producer receipt authenticates the exact predecessor.
  // Current Coivas and the real-clock CLI are checked separately in its tests.
  const historical = structuredClone(registry);
  const coivasRenewal = JSON.parse(read('reports/ops/glp38-20260915/taxonomy-refresh/run-20261012T030059882049Z/coivas-verification.json'));
  assert.equal(coivasRenewal.previous_row.program_id, 'coivas');
  assert.equal(coivasRenewal.previous_row.verified_as_of, '2026-09-10');
  assert.ok(!proof.rows.some(row => row.program_id === 'coivas'));
  historical.therapeutic_taxonomy.programs.coivas = coivasRenewal.previous_row;
  validateTherapeuticTaxonomy(historical, 'glp-clinic-scout', {asOf: new Date('2026-10-09T12:00:00Z')});
});
test('GLP-353 holds Mademed compounded classification without guessing absence or lifting commercial holds', () => {
  const row = registry.therapeutic_taxonomy.programs.mademed;
  assert.equal(row.treatment_type_state, 'not_verified');
  assert.deepEqual(row.treatment_type_tags, []);
  assert.ok(!matchesTherapeuticFacets(row, [], 'compounded'));
  assert.match(row.claim_qualification, /NOT_VERIFIED/);
  const profile = registry.provider_dynamic_profiles.profiles.mademed;
  assert.deepEqual(profile.taxonomy.treatment_type_tags, []);
  assert.equal(profile.taxonomy.treatment_type_state, 'not_verified');
  if (profile.research?.source_excerpts?.taxonomy_tags) {
    assert.deepEqual(profile.research.source_excerpts.taxonomy_tags.treatment_type_tags, []);
  }
  const policies = JSON.parse(read('scripts/therapeutic-taxonomy-refresh-policies.json'));
  assert.match(policies.mademed.review_required, /review/);
  assert.ok(!Object.keys(registry.therapeutic_taxonomy.programs).some(id => /fella/i.test(id)));
});
test('GLP-353 leaves the 31-day stale-evidence rejection enforced', () => {
  const stale = structuredClone(registry);
  stale.therapeutic_taxonomy.programs.biltrx.verified_as_of = '2026-09-08';
  assert.throws(() => validateTherapeuticTaxonomy(stale, 'glp-clinic-scout', {asOf: new Date('2026-10-09T12:00:00Z')}), /therapeutic_taxonomy_evidence_stale:biltrx/);
});
