import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreGoOnlyPriceBasis } from '../src/go-runtime-selection.mjs';
import { historicalPriceIndexRegistry } from '../src/price-index-historical-registry.mjs';
import { stableSha256 } from '../src/therapeutic-taxonomy.mjs';
import {readHistoricalPriceFixture} from './helpers/provider-append-predecessor.mjs';
const registry=JSON.parse(readHistoricalPriceFixture(new URL('../data/program-registry.json',import.meta.url)));
const expected=registry.therapeutic_taxonomy.price_index_registry_programs_semantic_basis_sha256;
// This test owns the four GO-only edits, not subsequent factual/name changes.
// Authenticate the original whole price body via its native reader, then take
// only the four actual current GO/profile pairs. No frozen digest is repinned.
const basis=historicalPriceIndexRegistry(registry);
for (const id of ['awin-128761','katalys-1286','katalys-1304','katalys-647']) {
 const current=registry.programs.find(p=>p.program_id===id);
 const historical=basis.programs.find(p=>p.program_id===id);
 historical.go=structuredClone(current.go);
 historical.profiles=structuredClone(current.profiles);
}
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
