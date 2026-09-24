import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripPriceStateDisclosures} from '../src/price-state.mjs';

test('GLP-215 accepted release disclosure normalizes without hiding changed historical semantics',()=>{
 const html=readFileSync('/home/ubuntu/business/site-system/flagship-v2/releases/sealed-d2w-release2-current-20260911T152308Z/public/glp-1-price-index/index.html','utf8');
 const disclosures=html.match(/<aside class="panel" data-price-state-disclosure>[\s\S]*?<\/aside>/g);
 assert.equal(disclosures.length,1);
 const aside=disclosures[0];
 assert(aside.includes('subset contains 32 identities'));
 assert(aside.includes('89→82'));
 assert(aside.includes('35→33'));
 assert.equal(stripPriceStateDisclosures(html,{}),html.replace(aside,''));
 const changedCopy=aside.replace('Historical index observations','Invented index observations');
 assert.equal(stripPriceStateDisclosures(changedCopy,{}),changedCopy);
 const changedCount=aside.replace('subset contains 32 identities','subset contains 999 identities');
 assert.equal(stripPriceStateDisclosures(changedCount,{}),changedCount);
 const historical='<p>Historical amount $179; observed 2026-08-01; sample 19.</p>';
 assert.equal(stripPriceStateDisclosures(aside+historical,{}),historical);
 assert.notEqual(stripPriceStateDisclosures(aside+historical.replace('$179','$1'),{}),historical);
});
