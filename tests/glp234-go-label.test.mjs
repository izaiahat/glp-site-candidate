import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {goCommercialLabels} from '../src/go-commercial-labels.mjs';
import {deriveGoEntriesFromRegistry} from '../src/program-registry.mjs';
import {renderGoRuntimeManifestModule} from '../src/go-runtime-manifest.mjs';
import {loadAffiliateLinkMap} from '../src/affiliate-link-map.mjs';
import {loadGoPromotionAuthority} from '../src/go-runtime-selection.mjs';
import {projectProviderDisplayLedger} from '../src/provider-display-evidence.mjs';
import {GO_RUNTIME_MANIFEST} from '../functions/go/program-manifest.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Execute each maintained label initializer and GO call with identical authority
// inputs. Do not import these effectful scripts or run their output writers.
async function producerEntries(file, registry, ledger, links, authority) {
  const source = readFileSync(new URL('../scripts/' + file, import.meta.url), 'utf8');
  const initializer = source.match(/^\s*const commercialLabels = .+;$/m)?.[0] || '';
  const call = source.match(/programs: (deriveGoEntriesFromRegistry\([^\n]+\))[, ]/)?.[1];
  assert.ok(call, file + ': maintained GO call must be present');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const execute = new Function('deriveGoEntriesFromRegistry', 'goCommercialLabels', 'readJson', 'readFile', 'path', 'ROOT', 'registry', 'programRegistry', 'ledger', 'contentLedger', 'SITE_PROFILE', 'loadAffiliateLinkMap', 'goPromotionAuthority',
    `return (async () => {${initializer}\nreturn ${call};})()`);
  return execute(deriveGoEntriesFromRegistry, goCommercialLabels, name => read('data/' + name),
    async file => readFileSync(file, 'utf8'), path, root, registry, registry, ledger,
    {...ledger, programs: ledger.programs.map(row => projectProviderDisplayLedger(row))},
    'glp-clinic-scout', () => links, authority);
}

test('GLP-234 F2 maintained build and regeneration GO callers use the same commercial labels', async () => {
  const registry = read('data/program-registry.json'), ledger = read('data/program-content-ledger.json');
  const before = structuredClone({registry, ledger});
  const links = loadAffiliateLinkMap('compare'), authority = loadGoPromotionAuthority();
  const build = await producerEntries('build-staging.mjs', registry, ledger, links, authority);
  const regeneration = await producerEntries('regenerate-go-runtime-manifest.mjs', registry, ledger, links, authority);
  assert.deepEqual(build, regeneration);
  const manifest = programs => renderGoRuntimeManifestModule({schema:'affiliate-worker-staging-v3-registry', program_registry_schema:registry.schema, site_profile:'glp-clinic-scout', internal_fallback:'https://glpclinicscout.com/providers/', programs});
  assert.equal(manifest(build), manifest(regeneration));
  assert.deepEqual(build.find(row => row.program_id === 'try-ageless'), GO_RUNTIME_MANIFEST.programs['try-ageless']);
  assert.equal(build.find(row => row.program_id === 'try-ageless').live_link_allowed, false);
  assert.deepEqual({registry, ledger}, before);
  for (const file of ['build-staging.mjs', 'regenerate-go-runtime-manifest.mjs']) {
    assert.match(readFileSync(new URL('../scripts/' + file, import.meta.url), 'utf8'), /import \{ goCommercialLabels \} from "\.\.\/src\/go-commercial-labels\.mjs"/);
  }
});
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
