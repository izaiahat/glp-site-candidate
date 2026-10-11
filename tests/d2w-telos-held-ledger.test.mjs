import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {readHistoricalPriceFixture} from './helpers/provider-append-predecessor.mjs';
const data=new URL('../data/',import.meta.url),read=name=>readHistoricalPriceFixture(new URL(name,data));
const frozen=read('price-index-frozen-content-ledger.json'),current=read('program-content-ledger.json'),binding=JSON.parse(read('price-index-nonprice-binding.json'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const telos=d=>d.programs.find(x=>x.program_id==='telos-rx');
function mutateCurrent(fn){const d=JSON.parse(current);fn(d);const bytes=Buffer.from(JSON.stringify(d));return()=>frozenPriceLedger(bytes,frozen,{...binding,current_sha256:sha(bytes)});}
test('exact actual HOLD descendant returns original whole frozen bytes, not an alias',()=>{
 const r=frozenPriceLedger(current,frozen,binding);
 assert.equal(r.bytes,frozen);assert.deepEqual(r.ledger,JSON.parse(frozen));
 assert.equal(r.frozen_sha256,'374667b3f4a13bb7dd5776f1cd29add113b25fa1826c6af4620c07668b496830');
 assert.equal(r.current_sha256,sha(current));assert.notEqual(r.current_sha256,r.frozen_sha256);
 assert.equal(telos(JSON.parse(current)).promotion_authorized,false);
});
for(const [name,fn]of[
 ['Telos price',d=>telos(d).starting_price='$1'],
 ['Telos price date',d=>telos(d).research_first_month_price.checked_as_of='2099-01-01'],
 ['Telos source',d=>telos(d).source_url='https://example.invalid/'],
 ['Telos link upgrade',d=>telos(d).live_link_allowed=true],
 ['Telos promotion upgrade',d=>telos(d).promotion_authorized=true],
 ['Telos status upgrade',d=>telos(d).status='live_operator_approved_transparent_direct'],
 ['Telos go upgrade',d=>telos(d).go_route_wired=true],
 ['Telos missing receipt',d=>delete telos(d).research_hold_receipt],
 ['Telos receipt extra key',d=>telos(d).research_hold_receipt.waiver=true],
 ['Telos permission string',d=>telos(d).promotion_authorized='false'],
 ['Telos missing permission',d=>delete telos(d).live_link_allowed],
 ['unknown Telos field',d=>telos(d).unreviewed=true],
 ['unrelated provider authority',d=>d.programs[0].promotion_authorized=!d.programs[0].promotion_authorized],
 ['Coivas hold laundering',d=>d.programs.find(x=>x.program_id==='coivas').research_hold_receipt=telos(d).research_hold_receipt],
 ['root field',d=>d.waiver=true],
 ['missing member',d=>d.programs.pop()],
 ['duplicate identity',d=>d.programs.push({...telos(d)})],
 ['alias added to price ledger',d=>d.programs.push({...telos(d),program_id:'telos-rx-review'})],
])test(`rehashed current cannot admit ${name}`,()=>assert.throws(mutateCurrent(fn),/s32_binding_descriptor_drift/));
const legacyBinding=JSON.parse(fs.readFileSync(new URL('../data/price-index-nonprice-binding-v4.json',import.meta.url)));
const legacyCurrent=fs.readFileSync(new URL('../data/s32-predecessor-content-ledger.json',import.meta.url));
for(const field of legacyBinding.nonprice_fields)test(`retains existing medication permission ${field.program_id}:${field.key}`,()=>{
 const d=JSON.parse(legacyCurrent);d.programs.find(x=>x.program_id===field.program_id)[field.key]={test:'existing nonprice allowance'};const bytes=Buffer.from(JSON.stringify(d));assert.equal(frozenPriceLedger(bytes,frozen,{...legacyBinding,current_sha256:sha(bytes)}).bytes,frozen);
});
for(const target of ['telos-held-ledger-binding.json','telos-research-hold-receipt.json','ACK.json','CURRENT-ROW-READBACK.json']){
 test(`tampered receipt chain fails: ${target}`,()=>assert.throws(()=>frozenPriceLedger(current,frozen,binding,p=>{
   const bytes=fs.readFileSync(p);return String(p).endsWith(target)?Buffer.concat([bytes,Buffer.from(' ')]):bytes;
 }),/hold_receipt_hash_mismatch/));
 test(`missing receipt chain fails: ${target}`,()=>assert.throws(()=>frozenPriceLedger(current,frozen,binding,p=>{
   if(String(p).endsWith(target))throw Error('ENOENT');return fs.readFileSync(p);
 }),/hold_receipt_unreadable/));
}
for(const [name,fn]of[
 ['unknown root field',b=>b.allow_price=true],
 ['unknown descriptor field',b=>b.predecessor_binding.allow_price=true],
 ['unreviewed descriptor path',b=>b.predecessor_binding.path='data/other.json'],
 ['unreviewed descriptor hash',b=>b.predecessor_binding.sha256='0'.repeat(64)],
 ['widened scope',b=>b.nonprice_fields.push({program_id:'telos-rx',key:'starting_price'})],
 ['removed scope',b=>b.nonprice_fields.pop()],
 ['downgraded binding version',b=>b.schema='glp.frozen-price-nonprice-binding.v1'],
])test(`strict binding rejects ${name}`,()=>{const b=structuredClone(binding);fn(b);assert.throws(()=>frozenPriceLedger(current,frozen,b),/s32_binding_descriptor_drift|price_nonprice_binding_scope_invalid/);});
test('legacy v1 whole frozen source remains valid without HOLD projection',()=>{
 const b={...legacyBinding,schema:'glp.frozen-price-nonprice-binding.v1',current_sha256:sha(frozen)};delete b.held_binding;delete b.research_binding;
 assert.equal(frozenPriceLedger(frozen,frozen,b).bytes,frozen);
 assert.throws(()=>frozenPriceLedger(current,frozen,{...b,current_sha256:sha(current)}),/price_or_authority_drift/);
});
test('current/frozen raw bytes still independently pinned',()=>{
 assert.throws(()=>frozenPriceLedger(Buffer.concat([current,Buffer.from(' ')]),frozen,binding),/s32_binding_current_drift/);
 assert.throws(()=>frozenPriceLedger(current,Buffer.concat([frozen,Buffer.from(' ')]),binding),/hash_mismatch/);
});
