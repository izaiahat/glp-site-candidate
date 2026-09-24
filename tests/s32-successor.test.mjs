import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {stripPriceStateDisclosures,PRICE_STATE_DISCLOSURE} from '../src/price-state.mjs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url));
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
