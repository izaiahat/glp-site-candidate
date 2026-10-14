import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProviderDynamicProfiles, providerSuggestions } from '../src/provider-dynamic-profiles.mjs';
import { buildCostCalculatorData, costCalculatorDropdownProviders } from '../src/cost-calculator.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { loadAffiliateLinkMap } from '../src/affiliate-link-map.mjs';
const json = file => JSON.parse(readFileSync(new URL(`../data/${file}.json`, import.meta.url)));
const ids = rows => rows.map(row => row.program_id).sort();
const profileId = 'glp-clinic-scout';

test('current identity census partitions every canonical identity without enrolling held review-only providers', () => {
  const registry = json('program-registry');
  const before = JSON.stringify(registry);
  // This is structural membership at the registry's own retained seal, not a
  // freshness renewal or permission to use the expired retatrutide authority.
  const asOf = new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`);
  const validated = validateProviderDynamicProfiles(registry, profileId, {asOf});
  const reviewOnly = registry.programs.filter(row => row.profiles?.[profileId]?.surface_membership === 'review_only');
  const reviewIds = reviewOnly.map(row => row.review_slug || row.program_id).sort();
  assert.deepEqual(reviewIds, ['retaclinic-review'], 'the documented exclusion is exact, not an arbitrary missing row');
  const expected = validated.canonicalIds.filter(id => !reviewIds.includes(id)).sort();
  assert.equal(validated.canonicalIds.length, registry.provider_dynamic_profiles.expected_counts.provider_identities);
  assert.deepEqual([...expected, ...reviewIds].sort(), [...validated.canonicalIds].sort());
  const suggestions = providerSuggestions(registry, profileId, {asOf});
  assert.deepEqual(ids(suggestions), expected, 'no missing sibling, duplicate or unsolicited recommendation');
  const data = buildCostCalculatorData(json('cost-calculator'), json('money-page-specs').pages,
    json('provider-page-contracts'), json('provider-fastpath-contract'), registry);
  const dropdown = costCalculatorDropdownProviders(data);
  assert.deepEqual(ids(data.providers), expected);
  assert.deepEqual(ids(dropdown.eligible), expected);
  assert.deepEqual(dropdown.excluded, []);
  const quiz = json('quiz-config');
  const authority = loadGoPromotionAuthority().programs;
  const links = loadAffiliateLinkMap('compare');
  for (const row of reviewOnly) {
    const id = row.review_slug || row.program_id;
    assert.ok(validated.profiles.has(id), 'editorial identity remains retained');
    assert.equal(row.profiles[profileId].surfaces.review, true);
    assert.equal(row.affiliate_relationship_snapshot.promotion_denied, true);
    for (const surface of ['compare', 'quiz', 'calculator', 'go']) assert.equal(row.profiles[profileId].surfaces[surface], false, surface);
    assert.equal(quiz.candidates.some(candidate => candidate.program_id === id), false);
    assert.notEqual(authority[id]?.promotion_authorized, true);
    assert.notEqual(links[id]?.live, true);
  }
  for (const row of validated.profiles.values()) assert.ok(!row.taxonomy.molecule_tags.includes('retatrutide'), row.program_id);
  assert.deepEqual(validated.profiles.get('retaclinic-review').taxonomy.molecule_tags, ['semaglutide', 'tirzepatide'], 'mixed provider retains only verified prescription molecule facets');
  for (const id of ['fella-health', 'telos', 'try-ageless', 'altrx-glp1-us-cps', 'futurhealth-wegovy-pillform']) {
    assert.notEqual(authority[id]?.promotion_authorized, true, id);
    assert.notEqual(links[id]?.live, true, id);
  }
  assert.equal(validated.profiles.has('fella-health'), false);
  assert.equal(JSON.stringify(registry), before, 'membership checks must not rewrite evidence, clocks or holds');
});
