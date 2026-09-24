import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {historicalPriceIndexRegistry} from '../src/price-index-historical-registry.mjs';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {validatePriceIndexInputs,buildPriceIndexArtifacts,normalizePriceIndexSourceHashes} from '../src/price-index.mjs';
import {reconcileTherapeuticTaxonomyWireIn} from '../src/therapeutic-taxonomy.mjs';
import {reconcileProviderDynamicProfilesWireIn} from '../src/provider-dynamic-profiles.mjs';
const read=p=>readFileSync(new URL('../data/'+p,import.meta.url));
const json=p=>JSON.parse(read(p));const sha=b=>createHash('sha256').update(b).digest('hex');
const binding=frozenPriceLedger(read('program-content-ledger.json'),read('price-index-frozen-content-ledger.json'),json('price-index-nonprice-binding.json'));
const input={tracker:json('price-tracker.json'),study:json('original-data-study.json'),programRegistry:json('program-registry.json'),contentLedger:binding.ledger,sourceHashes:{original_data_study_sha256:sha(read('original-data-study.json')),program_registry_sha256:sha(read('program-registry.json')),program_content_ledger_sha256:binding.frozen_sha256}};
const telos=r=>r.programs.find(p=>p.program_id==='telos-rx');
test('actual price owner preserves Telos historical records without touching live input',()=>{
 const before=structuredClone(input),v=validatePriceIndexInputs(input),out=buildPriceIndexArtifacts(input);
 assert.equal(v.status,'PASS');assert.ok(v.live_provider_ids.includes('telos-rx'));assert.ok(input.tracker.price_index.records.some(r=>r.provider_id==='telos-rx'));assert.deepEqual(input,before);
 assert.equal(telos(input.programRegistry).commercial_state,'held');assert.equal(telos(input.programRegistry).profiles['glp-clinic-scout'].wired,false);
 for(const k of ['compare','quiz','calculator','go'])assert.equal(telos(input.programRegistry).profiles['glp-clinic-scout'].surfaces[k],false);
 assert.equal(json('program-content-ledger.json').programs.find(p=>p.program_id==='telos-rx').promotion_authorized,false);
 assert.match(out.html,/data-index-record-id="telos/);assert.doesNotMatch(out.html,/href="\/go\/telos/);
});
test('current true hash differs while full frozen ledger is preserved',()=>{assert.equal(binding.current_sha256,sha(read('program-content-ledger.json')));assert.notEqual(binding.current_sha256,binding.frozen_sha256);assert.equal(binding.frozen_sha256,'374667b3f4a13bb7dd5776f1cd29add113b25fa1826c6af4620c07668b496830');assert.deepEqual(binding.ledger,json('price-index-frozen-content-ledger.json'));});
for(const [name,edit]of [
 ['Telos price',r=>telos(r).starting_price='$1'],
 ['Telos display',r=>telos(r).display_name='other'],
 ['Telos identity',r=>telos(r).program_id='other'],
 ['Telos route',r=>telos(r).review_path='/reviews/other/'],
 ['Telos authority',r=>telos(r).research_hold_receipt.sha256='0'.repeat(64)],
 ['Telos arbitrary HOLD',r=>telos(r).commercial_state='HOLD'],
 ['Telos live promotion',r=>telos(r).commercial_state='live'],
 ['Telos profile promotion',r=>telos(r).profiles['glp-clinic-scout'].wired=true],
 ['Telos profile surface',r=>telos(r).profiles['glp-clinic-scout'].surfaces.go=true],
 ['Telos unknown field',r=>telos(r).allow_price=true],
 ['missing alias',r=>r.programs.splice(r.programs.findIndex(p=>p.program_id==='telos-rx-review'),1)],
 ['alias authority',r=>r.programs.find(p=>p.program_id==='telos-rx-review').research_hold_receipt.sha256='0'.repeat(64)],
 ['duplicate identity',r=>r.programs.push(structuredClone(telos(r)))],
 ['other provider held',r=>r.programs.find(p=>p.program_id!=='telos-rx').commercial_state='held'],
 ['other provider price',r=>r.programs[0].starting_price='$1'],
 ['other provider membership',r=>r.programs.splice(0,1)],
 ['root price authority',r=>r.unreviewed_authority=true],
 ['whole historical oracle repin',r=>r.therapeutic_taxonomy.price_index_registry_programs_semantic_basis_sha256='0'.repeat(64)],
 ['frozen source repin',r=>r.therapeutic_taxonomy.price_index_registry_frozen_source_sha256='0'.repeat(64)],
])test('owner refuses self-rehashed '+name,()=>{
 const d=structuredClone(input);edit(d.programRegistry);d.sourceHashes.program_registry_sha256=sha(JSON.stringify(d.programRegistry));
 assert.throws(()=>validatePriceIndexInputs(d),/price_index_historical_|price_coivas_|go_price_basis_|price_index_registry_semantic_basis_drift/);
 // Even a forged observation tuple must not skip historical authorization.
 d.tracker.price_index.observations.at(-1).source_files={...d.sourceHashes};
 assert.throws(()=>validatePriceIndexInputs(d),/price_index_historical_|price_coivas_|go_price_basis_|price_index_registry_semantic_basis_drift/);
});
for(const name of ['telos-held-price-basis.json','telos-research-hold-receipt.json','ACK.json','CURRENT-ROW-READBACK.json','price-index-frozen-content-ledger.json']){
 for(const mode of ['missing','tampered'])test('historical projection refuses '+mode+' '+name,()=>{
  const transport=path=>{if(String(path).endsWith('/'+name)){if(mode==='missing')throw Error('missing');return Buffer.from('{}');}return readFileSync(path);};
  assert.throws(()=>historicalPriceIndexRegistry(input.programRegistry,input.contentLedger,transport),/price_index_historical_authority_(unreadable|hash_mismatch)/);
 });
}
for(const [name,edit]of [
 ['price',l=>l.programs[0].starting_price='$1'],['identity',l=>l.programs.pop()],['authority',l=>l.programs[0].promotion_authorized=false],['source date',l=>l.programs[0].research_first_month_price.verified_as_of='2099-01-01'],['root',l=>l.unknown=true],
])test('owner refuses whole historical ledger '+name+' drift',()=>{const d=structuredClone(input);edit(d.contentLedger);assert.throws(()=>validatePriceIndexInputs(d),/price_index_historical_ledger_drift/);});
test('normalization alone also authenticates whole held price registry',()=>{const r=structuredClone(input.programRegistry);r.unknown=true;assert.throws(()=>normalizePriceIndexSourceHashes(r,input.sourceHashes),/price_index_historical_registry_drift/);});
test('reconciled owner subtrees are idempotent and Telos remains absent',()=>{
 const registry=structuredClone(input.programRegistry),before=structuredClone(registry);
 reconcileTherapeuticTaxonomyWireIn({registry,profileId:'glp-clinic-scout',pages:json('money-page-specs.json').pages,quizConfig:json('quiz-config.json')});
 reconcileProviderDynamicProfilesWireIn({registry,profileId:'glp-clinic-scout'});
 const once=structuredClone(registry);
 reconcileTherapeuticTaxonomyWireIn({registry,profileId:'glp-clinic-scout',pages:json('money-page-specs.json').pages,quizConfig:json('quiz-config.json')});
 reconcileProviderDynamicProfilesWireIn({registry,profileId:'glp-clinic-scout'});
 assert.deepEqual(registry,once,'C02: second reconciliation must be a fixed point');
 assert.equal(Object.hasOwn(registry.therapeutic_taxonomy.programs,'telos-rx'),false);assert.equal(Object.hasOwn(registry.provider_dynamic_profiles.profiles,'telos-rx'),false);
 // Separate retained requirement: C01 owns reconciling the raw owner output.
 assert.deepEqual(once,before,'C01: raw owner output must already be reconciled');
});
