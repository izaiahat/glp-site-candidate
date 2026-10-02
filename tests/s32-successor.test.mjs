import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {s32LedgerPredecessor,s32CareCurrentToParent} from '../src/price-index-s32-basis.mjs';
import {release2PriceLedgerBasis} from '../src/price-index-release2-basis.mjs';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {stripPriceStateDisclosures,PRICE_STATE_DISCLOSURE} from '../src/price-state.mjs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
test('exact Care successor reverses one leaf into unchanged S32 and release2 historical proofs',()=>{
 const current=read('data/program-content-ledger.json'),frozen=read('data/price-index-frozen-content-ledger.json');
 const binding=JSON.parse(read('data/price-index-nonprice-binding.json'));
 const after='Semaglutide and tirzepatide; injectable and oral options are described, including compounded options';
 const before=after+' and Mounjaro by name';
 assert.equal(sha(current),'e298a9d9a81313d8b05536c903776dbca24511463f80b265d486b5a14c80fd72');
 const parent=s32CareCurrentToParent(current);
 assert.equal(sha(parent),'88f1ec3e3d8c543e64caaa83ef5baab517e410cd180ee54ca2263eb2b1bbc95d');
 const active=JSON.parse(current).programs.find(row=>row.program_id==='care-bare-rx-glp1-review');
 assert.equal(active.meds_offered,after);
 assert.equal(JSON.parse(parent).programs.find(row=>row.program_id===active.program_id).meds_offered,before);
 assert.deepEqual(s32LedgerPredecessor(current,binding).bytes,s32LedgerPredecessor(parent,binding).bytes);
 assert.deepEqual(release2PriceLedgerBasis(current),release2PriceLedgerBasis(parent));
 assert.deepEqual(frozenPriceLedger(current,frozen,binding).bytes,frozen);
 assert.equal(JSON.parse(current).programs.find(row=>row.program_id===active.program_id).meds_offered,after);
 assert.equal(frozenPriceLedger(current,frozen,binding).current_sha256,sha(current));
 for(const [label,changed] of [
  ['unknown bytes',Buffer.concat([current,Buffer.from(' ')])],
  ['different field',Buffer.from(current.toString().replace('"meds_offered": '+JSON.stringify(after),'"meds_offered": "unapproved"'))],
  ['price mutant',Buffer.from(current.toString().replace('"starting_price":', '"starting_price_mutant":'))],
 ]){
  assert.notEqual(sha(changed),sha(current),label);
  assert.throws(()=>s32CareCurrentToParent(changed),/s32_care_current_drift/,label);
  assert.throws(()=>s32LedgerPredecessor(changed,binding),/s32_binding_current_drift/,label);
  assert.throws(()=>release2PriceLedgerBasis(changed),/price_nonprice_price_or_authority_drift/,label);
 }
});
test('S32 successor retains frozen oracle and rejects changed current bytes',()=>{
 const current=read('data/program-content-ledger.json'),frozen=read('data/price-index-frozen-content-ledger.json'),binding=JSON.parse(read('data/price-index-nonprice-binding.json'));
 assert.deepEqual(frozenPriceLedger(current,frozen,binding).bytes,frozen);
 assert.throws(()=>frozenPriceLedger(Buffer.concat([current,Buffer.from(' ')]),frozen,binding));
});
test('S32 strips exact predecessor disclosure without masking changed historical copy',()=>{
 const values=[57,22,5,89,53,35,23];let index=0;
 const aside=PRICE_STATE_DISCLOSURE.replace(/\{\{[A-Z0-9_]+\}\}/g,()=>String(values[index++]));
 assert.equal(stripPriceStateDisclosures(aside+'history $179',{}),'history $179');
 assert.equal(stripPriceStateDisclosures(aside.replace('historical','invented'),{}),aside.replace('historical','invented'));
});
