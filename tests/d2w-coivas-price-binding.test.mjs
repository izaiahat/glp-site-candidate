import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {projectCoivasResearchPriceBasis,COIVAS_RESEARCH_PRICE_BINDING} from '../src/price-index-coivas-research-binding.mjs';
import {historicalPriceIndexRegistry} from '../src/price-index-historical-registry.mjs';
const read=n=>fs.readFileSync(new URL('../data/'+n,import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const current=read('program-content-ledger.json'),frozen=read('price-index-frozen-content-ledger.json'),binding=JSON.parse(read('price-index-nonprice-binding.json')),registry=JSON.parse(read('program-registry.json'));
const receipt=JSON.parse(fs.readFileSync(COIVAS_RESEARCH_PRICE_BINDING.path));const delta=receipt.changes.find(r=>r.program_id==='coivas');
const call=d=>{const b=Buffer.from(JSON.stringify(d));return frozenPriceLedger(b,frozen,{...binding,current_sha256:sha(b)});};
test('actual parent Coivas successor keeps fresh source but exact frozen pricing bytes',()=>{
 const before=JSON.parse(current),r=frozenPriceLedger(current,frozen,binding);assert.equal(r.current_sha256,sha(current));assert.equal(r.bytes,frozen);assert.deepEqual(JSON.parse(current),before);
 assert.equal(before.programs.find(p=>p.program_id==='coivas').research_first_month_price.verified_as_of,'2026-09-10');assert.equal(r.ledger.programs.find(p=>p.program_id==='coivas').research_first_month_price.verified_as_of,'2026-08-06');
 assert.equal(registry.therapeutic_taxonomy.programs.coivas.verified_as_of,'2026-09-10');assert.equal(registry.provider_dynamic_profiles.profiles.coivas.verified_as_of,'2026-09-10');
 assert.equal(registry.provider_dynamic_profiles.profiles.coivas.calculator.mode,'manual');assert.equal(registry.provider_dynamic_profiles.profiles.coivas.calculator.first_month_base_usd,null);
});
for(const key of Object.keys(delta.changes))for(const mode of ['unknown','missing','partial-historical'])test('Coivas '+key+' '+mode+' is refused even rehashed',()=>{
 const d=JSON.parse(current),row=d.programs.find(r=>r.program_id==='coivas');
 if(mode==='unknown')row[key]={...row[key],value:'unreviewed'};
 else if(mode==='missing')delete row[key];
 else if(delta.changes[key].before_present)row[key]=delta.changes[key].before;else delete row[key];
 assert.throws(()=>call(d),/s32_binding_descriptor_drift/);
});
for(const [name,change]of [['price',r=>r.starting_price='$1'],['promotion',r=>r.promotion_authorized=false],['unknown research',r=>r.research_fake=true],['identity',r=>r.program_id='coivas-other']])test('Coivas unrelated '+name+' cannot be projected',()=>{const d=JSON.parse(current);change(d.programs.find(r=>r.program_id==='coivas'));assert.throws(()=>call(d),/s32_binding_descriptor_drift/);});
const authorityNames=['coivas-research-price-basis.json','INTEGRATION.json','ADMISSION.json','SLUG-READBACK.json','RESEARCH-PACKET-READBACK.json','coivas.json','capture-index.json','VALIDATION.json','BEFORE-program-content-ledger.json','MERGE-RUN.json','affiliate_merge_deep_research.py','merge.stdout','merge.stderr'];
for(const name of authorityNames)for(const mode of ['missing','tampered'])test('Coivas authority '+name+' '+mode+' rejects',()=>{
 const transport=p=>{if(String(p).endsWith('/'+name)){if(mode==='missing')throw Error('absent');return Buffer.from('{}');}return fs.readFileSync(p);};
 assert.throws(()=>frozenPriceLedger(current,frozen,binding,transport),/price_nonprice_price_coivas_receipt_(unreadable|hash_mismatch)/);
});
for(const key of ['source_url','verified_as_of','value'])test('Coivas registry dynamic profile '+key+' unknown change refused',()=>{
 const r=structuredClone(registry);r.programs.find(p=>p.program_id==='awin-128761').research_dynamic_profile[key]='unknown';assert.throws(()=>historicalPriceIndexRegistry(r),/price_coivas_research_drift/);
});
test('Coivas binding cannot be omitted, widened or repinned',()=>{
 for(const change of [b=>delete b.research_binding,b=>b.research_binding.sha256='0'.repeat(64),b=>b.research_binding.allow_all=true]){const b=structuredClone(binding);change(b);assert.throws(()=>frozenPriceLedger(current,frozen,b),/price_nonprice_/);}
});
