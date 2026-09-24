import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreGoOnlyPriceBasis } from '../src/go-runtime-selection.mjs';
import { stableSha256 } from '../src/therapeutic-taxonomy.mjs';
const registry=JSON.parse(readFileSync(new URL('../data/program-registry.json',import.meta.url)));
const expected=registry.therapeutic_taxonomy.price_index_registry_programs_semantic_basis_sha256;
const basis=structuredClone(registry);
delete basis.therapeutic_taxonomy;delete basis.provider_dynamic_profiles;delete basis.consumer_therapeutic_authorities;
test('four receipt-bound go-only changes preserve exact original price basis',()=>{
 assert.notEqual(stableSha256(basis),expected);
 assert.equal(stableSha256(restoreGoOnlyPriceBasis(basis)),expected);
});
for(const [name,edit] of [
 ['route',p=>{p.go.route='/go/wrong';}],
 ['commercial-state',p=>{p.commercial_state='held';}],
 ['price-profile',p=>{p.profiles['glp-clinic-scout'].data_profile.has_price=true;}],
 ['membership',(_p,b)=>{b.programs.pop();}],
 ['identity',p=>{p.display_name='Different provider';}],
])test(`go-only price basis rejects ${name} drift`,()=>{
 const changed=structuredClone(basis),p=changed.programs.find(p=>p.program_id==='awin-128761');edit(p,changed);
 try { assert.notEqual(stableSha256(restoreGoOnlyPriceBasis(changed)),expected); }
 catch(error){if(error.code==='ERR_ASSERTION')throw error;assert.match(error.message,/go_price_basis_/);}
});
