import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectProviderPriceAppend } from '../../src/provider-price-append.mjs';
import { historicalAffiliateRegistry } from '../../src/affiliate-relationship-sync.mjs';
import { deriveIdentityGroups } from '../../src/provider-identity.mjs';
import { optionCProgramIds } from './d2w-s9-contracts.mjs';
import { currentComparisonPrograms } from './current-comparison-cohort.mjs';
import { assertCurrentHeldEligibility } from './current-review-holds.mjs';

export async function assertExtraProfileMembership(extraProfiles, EXTRA_PROFILE_BASELINE, read) {
  const json = async file => JSON.parse(await read('data/' + file + '.json'));
  const [registry, ledger, binding, eligibility, activationSelection, providerContracts, providerFastpath] = await Promise.all([
    'program-registry','program-content-ledger','provider-price-append','program-page-eligibility',
    'affiliate-activation-selection','provider-page-contracts','provider-fastpath-contract',
  ].map(json));
  // Use the native historical-price projection, including its exact predecessor
  // and current semantic guards. Never repin or treat the old bytes as approval.
  const old = JSON.parse(projectProviderPriceAppend(Buffer.from(JSON.stringify(historicalAffiliateRegistry(registry))), binding.registry, 'registry'));
  const historicalLedger = JSON.parse(projectProviderPriceAppend(Buffer.from(await read('data/program-content-ledger.json')), binding.ledger, 'ledger'));
  // Exact 9cd63e7 fact corpus; preserve it as historical, not current approval.
  const factBytes = await read('data/provider-facts-backfill-20260830.json');
  assert.equal(createHash('sha256').update(factBytes).digest('hex'), 'e08a533653dd20f8400ad35d4562ec21478704a4d6c5758d61e85f83c1b97f3f');
  const {aliasIds} = deriveIdentityGroups(old, 'glp-clinic-scout', historicalLedger.programs);
  const cards = new Set(optionCProgramIds(old, {ledger:historicalLedger, facts:JSON.parse(factBytes)}));
  const historicalExtras = currentComparisonPrograms(old).filter(program => {
    const profile = program.profiles?.['glp-clinic-scout'];
    return program.commercial_state === 'live' && profile?.vertical_fit === true && profile.wired === true
      && profile.surfaces.review === true && !aliasIds.has(program.program_id) && !cards.has(program.review_slug || program.program_id);
  });
  // Exact original assertion retained on authenticated pre-append membership.
  {
    const extraProfiles = historicalExtras;
    assert.deepEqual(extraProfiles.map((program) => program.program_id).sort(), EXTRA_PROFILE_BASELINE,
      'Pass-5 seven extra profiles drifted from the pinned baseline');
  }
  assert.deepEqual(binding.registry.added_ids, binding.ledger.added_ids);
  const expected = [...EXTRA_PROFILE_BASELINE, ...binding.registry.added_ids].sort();
  assert.equal(new Set(expected).size, expected.length, 'append cannot duplicate a historical profile');
  assert.deepEqual(extraProfiles.map(program => program.program_id).sort(), expected,
    'current extra profiles must equal historical membership plus authenticated append, not a new count');
  assertCurrentHeldEligibility({eligibility, activationSelection, contentLedger:ledger, programRegistry:registry, providerContracts, providerFastpath});
}
