import assert from 'node:assert/strict';
import {deriveGoEntriesFromRegistry, assertLiveSurfaceParity} from '../../src/program-registry.mjs';
import {effectiveAffiliateRegistry, effectiveAffiliateBuildInputs} from '../../src/affiliate-relationship-sync.mjs';
import {manifestSha256} from '../../src/go-runtime-manifest.mjs';

// Verify today's complete generated rows against today's maintained producer.
// Historical snapshots are intentionally not accepted by this interface.
export function assertGLP234CurrentGo({registry, ledger, eligibility, selection, links, authority, labels, manifest}) {
  // The native build consumes this raw content ledger as its tracked program
  // register (scripts/build-staging.mjs), including held/paused editorial rows.
  // Compare BEFORE denial-only projection: live-surface parity intentionally
  // ignores non-live rows and collapses aliases; neither it nor counts prove
  // complete raw membership. Do not infer eligibility from commercial status.
  const ids = rows => rows.map(row => row.program_id).sort();
  assert.deepEqual(ids(eligibility.programs), ids(ledger.programs),
    'glp234_current_eligibility_native_identity_drift');
  const effective = effectiveAffiliateRegistry(registry);
  const inputs = effectiveAffiliateBuildInputs(registry,
    {eligibility, activationSelection:selection, contentLedger:ledger}, 'glp-clinic-scout');
  assertLiveSurfaceParity(effective, 'glp-clinic-scout', inputs.eligibility, inputs.contentLedger.programs);
  const expected = {
    schema:'affiliate-worker-staging-v3-registry', program_registry_schema:effective.schema,
    site_profile:'glp-clinic-scout', internal_fallback:'https://glpclinicscout.com/providers/',
    programs:deriveGoEntriesFromRegistry(effective, 'glp-clinic-scout', ledger.programs, links, authority, labels),
  };
  assert.deepEqual(manifest, {
    ...expected, manifest_sha256:manifestSha256(expected),
    programs:Object.fromEntries(expected.programs.map(row => [row.route_slug || row.program_id, row])),
  }, 'glp234_current_go_native_source_drift');
}
