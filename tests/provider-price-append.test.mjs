import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeProviderPriceAppend, projectProviderPriceAppend, refreshProviderPriceAppendEvidence} from '../src/provider-price-append.mjs';
const raw=x=>Buffer.from(JSON.stringify(x));
const before={programs:[{program_id:'old',price:100}],site_profiles:{'glp-clinic-scout':{expected_sitemap_routes:1}},therapeutic_taxonomy:{price_index_registry_programs_semantic_basis_sha256:'frozen'}};
const after=structuredClone(before); after.programs.push({program_id:'new',price:null}); after.site_profiles['glp-clinic-scout'].expected_sitemap_routes++;
after.therapeutic_taxonomy.price_index_registry_programs_semantic_basis_sha256='current';
test('append binding reconstructs exact predecessor without changing current input',()=>{
 const binding=makeProviderPriceAppend(raw(before),raw(after),'registry',['new']);
 const saved=structuredClone(after);
 assert.deepEqual(JSON.parse(projectProviderPriceAppend(raw(after),binding,'registry')),before);
 assert.deepEqual(after,saved);
 assert.deepEqual(JSON.parse(projectProviderPriceAppend(raw(before),binding,'registry')),before);
});
test('retained row, unrelated metadata, membership and consumed input drift refuse',()=>{
 const binding=makeProviderPriceAppend(raw(before),raw(after),'registry',['new']);
 for(const edit of [x=>x.programs[0].price++,x=>x.programs.push({program_id:'unexpected'}),x=>x.site_profiles['glp-clinic-scout'].unexpected=true]){
  const bad=structuredClone(after); edit(bad);
  assert.throws(()=>makeProviderPriceAppend(raw(before),raw(bad),'registry',['new']),/append_scope/);
  assert.throws(()=>projectProviderPriceAppend(raw(bad),binding,'registry'),/append_current_drift/);
 }
});
test('taxonomy renewal derives a binding successor without repinning predecessor, prices, ledger or membership',()=>{
 const binding=makeProviderPriceAppend(raw(before),raw(after),'registry',['new']);
 const renewed=structuredClone(after);
 renewed.therapeutic_taxonomy.verified_as_of='2026-10-12';
 assert.throws(()=>projectProviderPriceAppend(raw(renewed),binding,'registry'),/append_current_drift/);
 const successor=refreshProviderPriceAppendEvidence(raw(renewed),binding);
 assert.equal(successor.predecessor_sha256,binding.predecessor_sha256);
 assert.equal(successor.predecessor_semantic_sha256,binding.predecessor_semantic_sha256);
 assert.deepEqual(successor.added_ids,binding.added_ids);
 assert.deepEqual(projectProviderPriceAppend(raw(renewed),successor,'registry'),raw(before));
 for(const edit of [x=>x.programs[0].price++,x=>x.programs.push({program_id:'unexpected'}),x=>x.site_profiles['glp-clinic-scout'].unexpected=true,x=>x.therapeutic_taxonomy.price_index_registry_frozen_source_sha256='changed']) {
  const bad=structuredClone(renewed);edit(bad);
  assert.throws(()=>refreshProviderPriceAppendEvidence(raw(bad),binding),/append_scope/);
 }
 const corrupt=structuredClone(binding);corrupt.predecessor_sha256='0'.repeat(64);
 assert.throws(()=>refreshProviderPriceAppendEvidence(raw(renewed),corrupt),/append_predecessor_drift/);
});
test('ledger restores only append plus enrichment bookkeeping, preserves exact bytes',()=>{
 const old=raw({programs:[{program_id:'old',price:1}],research_enrichment:{at:'old'}});
 const next=raw({programs:[{program_id:'old',price:1},{program_id:'new'}],research_enrichment:{at:'new'}});
 const binding=makeProviderPriceAppend(old,next,'ledger',['new']);
 assert.deepEqual(projectProviderPriceAppend(next,binding,'ledger'),old);
 const bad=JSON.parse(next); bad.programs[0].price=2;
 assert.throws(()=>makeProviderPriceAppend(old,raw(bad),'ledger',['new']),/append_scope/);
});
