import test from 'node:test';
import assert from 'node:assert/strict';
import * as graph from '../src/phase3-page-graph.mjs';
const cash=(medication_id,value)=>({medication_id,price_kind:'monthly_cash',facts:{amount_usd:{value}}});
test('D2j monthly cash uses typed fact, not removed ongoing_usd',()=>assert.equal(graph.directoryPriceMap([cash('compounded-semaglutide-injection',297)]),'SEMAGLUTIDE:297'));
test('D2j informational kinds do not enter mixed cash sorting',()=>{
 for(const price_kind of ['floor_from','prepaid_bundle','monthly_equivalent_of_billing_period','membership_plus_medication','intro_then_ongoing'])assert.equal(graph.directoryPriceMap([{...cash('compounded-semaglutide-injection',119),price_kind,ongoing_usd:999}]),'');
});
test('D2j missing, nonnumeric, null and nonfinite values are omitted, never zero-coerced',()=>{
 for(const value of [undefined,null,NaN,Infinity,-1,'UNKNOWN','297'])assert.equal(graph.directoryPriceMap([cash('compounded-semaglutide-injection',value)]),'');
 assert.equal(graph.directoryPriceMap([cash('compounded-semaglutide-injection',0)]),'SEMAGLUTIDE:0');
});
test('D2j legacy evidenced numeric paths remain usable',()=>assert.equal(graph.directoryPriceMap([{medication_id:'brand-wegovy',ongoing_usd:199},{medication_id:'brand-ozempic'}]),'WEGOVY:199'));
test('D2j duplicate equal keys collapse; ambiguous product/form prices omitted rather than cheapest-selected',()=>{
 const a=cash('compounded-tirzepatide-injection',349),b=cash('compounded-tirzepatide-oral',199);
 assert.equal(graph.directoryPriceMap([a,a]),'TIRZEPATIDE:349');assert.equal(graph.directoryPriceMap([a,b]),'');
});
