import test from 'node:test';
import assert from 'node:assert/strict';
import { sameCanonicalRegistryIdentity } from '../src/therapeutic-taxonomy.mjs';

const profile = 'glp-clinic-scout';
const programs = new Map([
  ['direct-meds', { program_id: 'katalys-1304', review_slug: 'direct-meds', profiles: { [profile]: { vertical_fit: true } } }],
  ['direct-meds-review', { program_id: 'direct-meds-review', profiles: { [profile]: { vertical_fit: true, canonical_identity: { role: 'alias', canonical_program_id: 'direct-meds' } } } }],
  ['separate-offer', { program_id: 'separate-offer', profiles: { [profile]: { vertical_fit: true } } }],
  ['unbound-alias', { program_id: 'unbound-alias', profiles: { [profile]: { canonical_identity: { role: 'alias', canonical_program_id: 'missing' } } } }],
]);

test('GLP-181: Affiliati 100131 review alias shares only the declared canonical Direct Meds identity', () => {
  assert.equal(sameCanonicalRegistryIdentity(programs, profile, 'direct-meds', 'direct-meds-review'), true);
  assert.equal(sameCanonicalRegistryIdentity(programs, profile, 'direct-meds-review', 'direct-meds'), true);
  assert.equal(sameCanonicalRegistryIdentity(programs, profile, 'direct-meds-review', 'separate-offer'), false);
  assert.equal(sameCanonicalRegistryIdentity(programs, profile, 'direct-meds', 'separate-offer'), false);
  assert.equal(sameCanonicalRegistryIdentity(programs, profile, 'direct-meds', 'unbound-alias'), false);
  assert.equal(sameCanonicalRegistryIdentity(programs, profile, 'direct-meds', 'direct-meds'), false);
});
