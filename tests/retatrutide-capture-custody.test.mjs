import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { historicalRetatrutideInputs, RETATRUTIDE_HISTORICAL_REF, RETATRUTIDE_HISTORICAL_PINS } from './fixtures/historical-retatrutide-inputs.mjs';
import { authenticatedCapture, captureDirectory, capturePins, materializeHostedCaptures } from './helpers/materialize-retatrutide-capture.mjs';
import { validateConsumerTherapeuticAuthorities, consumerTherapeuticFilters } from '../src/therapeutic-taxonomy.mjs';
import { validateProviderDynamicProfiles } from '../src/provider-dynamic-profiles.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const json = file => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url)));
const current = json('program-registry.json');
const readHistorical = file => execFileSync('git', ['show', `${RETATRUTIDE_HISTORICAL_REF}:data/${file}`], {cwd: root, maxBuffer: 16 * 1024 * 1024});

test('retatrutide historical generation authenticates every raw input and rejects changed bytes', () => {
  const before = JSON.stringify(current);
  const fixture = historicalRetatrutideInputs();
  assert.equal(fixture.asOf.toISOString(), '2026-09-24T12:00:00.000Z');
  assert.equal(fixture.registry.consumer_therapeutic_authorities.molecules.retatrutide.local_capture_authority.audit_summary.audited_at, '2026-09-09T02:48:58.211798');
  for (const file of Object.keys(RETATRUTIDE_HISTORICAL_PINS)) {
    for (const tamper of [bytes => Buffer.concat([bytes, Buffer.from(' ')]), () => Buffer.from('{}')]) {
      assert.throws(() => historicalRetatrutideInputs(name => name === file ? tamper(readHistorical(name)) : readHistorical(name)), /immutable September source bytes/);
    }
  }
  assert.equal(JSON.stringify(current), before);
});

test('retatrutide captured public evidence remains byte-exact and native creation is denied', () => {
  for (const file of Object.keys(capturePins)) {
    const fixture = authenticatedCapture(file);
    assert.deepEqual(authenticatedCapture(file, readFileSync(`${captureDirectory}/${file}`)), fixture);
    assert.throws(() => authenticatedCapture(file, Buffer.concat([fixture, Buffer.from(' ')])), /retained capture bytes/);
    assert.throws(() => authenticatedCapture(file, Buffer.from('{}')), /retained capture bytes/);
  }
  if (process.env.GITHUB_ACTIONS !== 'true') assert.throws(materializeHostedCaptures, /creation is hosted-test-only/);
});

test('retatrutide current strict authority rejects expired capture before evaluating claimed provider availability', () => {
  const asOf = new Date();
  const sealed = new Date(`${current.therapeutic_taxonomy.sealed_as_of}T12:00:00Z`);
  assert.ok(asOf >= sealed, 'runtime is not a backdated September fixture');
  for (const clock of [sealed, asOf]) {
    assert.throws(() => validateConsumerTherapeuticAuthorities(current, 'glp-clinic-scout', {asOf: clock}), /consumer_authority_capture_status_time_invalid:audit_summary/);
    assert.throws(() => consumerTherapeuticFilters(current, 'glp-clinic-scout', {asOf: clock}), /consumer_authority_capture_status_time_invalid:audit_summary/);
  }
  const dynamic = validateProviderDynamicProfiles(current, 'glp-clinic-scout', {asOf: sealed});
  assert.ok(dynamic.profiles.size > 0);
  for (const profile of dynamic.profiles.values()) assert.ok(!profile.taxonomy.molecule_tags.includes('retatrutide'));
});

test('retatrutide historical lawful negative stays unavailable even with positive provider evidence', () => {
  const {registry, asOf} = historicalRetatrutideInputs();
  const dynamic = validateProviderDynamicProfiles(registry, 'glp-clinic-scout', {asOf});
  const profile = structuredClone(dynamic.profiles.get('coivas'));
  profile.taxonomy.molecule_tags = [...profile.taxonomy.molecule_tags, 'retatrutide'].sort();
  profile.evidence_bindings = profile.evidence_bindings.map(binding => binding.fields.includes('taxonomy.molecule_tags')
    ? {...binding, evidence_text: 'Coivas offers retatrutide.'} : binding);
  const options = {asOf, dynamic: {profiles: new Map([[profile.program_id, profile]])}};
  const authority = validateConsumerTherapeuticAuthorities(registry, 'glp-clinic-scout', options).retatrutide;
  assert.equal(authority.provider_evidence_positive, true);
  assert.equal(authority.lawful_regulatory_authority_positive, false);
  assert.equal(authority.consumer_available, false);
  assert.ok(!consumerTherapeuticFilters(registry, 'glp-clinic-scout', options).some(row => row.value === 'retatrutide'));
});
