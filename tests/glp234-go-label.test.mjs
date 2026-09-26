import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {goCommercialLabels} from '../src/go-commercial-labels.mjs';
import {deriveGoEntriesFromRegistry} from '../src/program-registry.mjs';
import {renderGoRuntimeManifestModule} from '../src/go-runtime-manifest.mjs';
import {loadAffiliateLinkMap} from '../src/affiliate-link-map.mjs';
import {loadGoPromotionAuthority} from '../src/go-runtime-selection.mjs';
const read = file => JSON.parse(readFileSync(new URL('../'+file, import.meta.url)));
const sha = text => createHash('sha256').update(text).digest('hex');

test('consumer identity change leaves generated /go manifest bytes unchanged', () => {
  const registry = read('data/program-registry.json');
  const commercial = read('data/affiliate-held-link-manifest.json');
  const labels = goCommercialLabels(commercial);
  const ledger = read('data/program-content-ledger.json');
  const links = loadAffiliateLinkMap('compare');
  const authority = loadGoPromotionAuthority();
  const produce = source => renderGoRuntimeManifestModule({
    schema: 'affiliate-worker-staging-v3-registry',
    program_registry_schema: source.schema,
    site_profile: 'glp-clinic-scout',
    internal_fallback: 'https://glpclinicscout.com/providers/',
    programs: deriveGoEntriesFromRegistry(source, 'glp-clinic-scout', ledger.programs, links, authority, labels),
  });
  const oldConsumer = structuredClone(registry);
  oldConsumer.programs.find(row => row.program_id === 'try-ageless').display_name = 'AgelessRx';
  assert.equal(sha(produce(oldConsumer)), sha(produce(registry)));
  const row = commercial.programs.find(row => row.content_program_id === 'try-ageless');
  assert.equal(row.immutable_network_program_id, '1538');
  assert.equal(labels['try-ageless'], 'AgelessRx');
  assert.equal(authority.programs['try-ageless'].status, 'WITHHELD');
  assert.equal(links['try-ageless']?.live, false);
  assert.throws(() => goCommercialLabels({...commercial, programs: commercial.programs.filter(x => x !== row)}), /go_commercial_identity_invalid/);
});
