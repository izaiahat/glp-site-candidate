import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizedProfileSha256 } from '../src/provider-dynamic-profiles.mjs';
import { normalizedTaxonomySha256 } from '../src/therapeutic-taxonomy.mjs';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url)));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('GLP-234 registry projections name the first-party brand without altering routing or held commercial custody', async () => {
  const registry = await load('program-registry.json');
  const program = registry.programs.find((row) => row.program_id === 'try-ageless');
  const profile = registry.provider_dynamic_profiles.profiles['try-ageless'];
  const taxonomy = registry.therapeutic_taxonomy.programs['try-ageless'];
  assert.ok(program && profile && taxonomy);
  assert.deepEqual([program.display_name, profile.provider, taxonomy.provider],
    ['Try Ageless', 'Try Ageless', 'Try Ageless']);
  assert.deepEqual(profile.aliases, []); // AgelessRx is not a verified alias.
  assert.equal(profile.program_id, 'try-ageless');
  assert.equal(taxonomy.registry_program_id, 'try-ageless');
  assert.deepEqual(program.go, { entry_state: 'transparent_direct', route: '/go/try-ageless' });
  assert.deepEqual(taxonomy.commercial_link_state, { compare: 'live', quiz: 'live' });
  const binding = profile.evidence_bindings.find((row) => row.evidence_kind === 'registry_identity_projection');
  assert.equal(JSON.parse(binding.evidence_text).provider, 'Try Ageless');
  assert.equal(binding.evidence_sha256, sha(binding.evidence_text));
  assert.equal(profile.normalized_sha256, normalizedProfileSha256(profile));
  assert.equal(taxonomy.normalized_sha256, normalizedTaxonomySha256(taxonomy));

  // Historical network row is deliberately not rewritten as a brand-mapping assertion.
  const selection = await load('affiliate-activation-selection.json');
  assert.ok(selection.excluded_network_paused_programs.includes('try-ageless'));
  assert.deepEqual(selection.excluded_selection_evidence.find((row) => row.program_id === 'try-ageless'), {
    display_name: 'AgelessRx', link_mode: 'transparent_direct', network: 'Katalys',
    network_program_id: '1538', program_id: 'try-ageless', sheet_row: 94,
    sheet_status: 'approved_active_tracking_ready', tracking_host: 'track.revoffers.com',
    tracking_link_sha256: 'f160cdd13074620be4ba6fac5258d2480ae1dcb45327a9b11e0e49cc3e4ed650',
    disposition: 'historical_snapshot_only_not_activation_authority',
  });
  for (const [name, expected] of [
    ['affiliate-activation-selection.json', '63586a11a80878a008c61b0825ff5344726906b0e7efece6811dd986f3db0de6'],
    ['affiliate-held-link-manifest.json', '613ce4dcd21357466e11f9338c71c554d71c6feac71a57127c2059d0db153675'],
    ['go-runtime-promotion-authority.json', 'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2'],
  ]) assert.equal(sha(await readFile(new URL(`../data/${name}`, import.meta.url))), expected, name);
  assert.equal(sha(await readFile(new URL('../functions/go/program-manifest.js', import.meta.url))),
    'cab1f5b4a8437080c09f580daf7be19bb4b9a177673150ba1f1e8f9abe113f7a');
});
