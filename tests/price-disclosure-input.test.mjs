import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {historicalPriceDisclosureInput} from './helpers/price-disclosure-input.mjs';
import {PRICE_STATE_DISCLOSURE,stripPriceStateDisclosures} from '../src/price-state.mjs';

test('GLP361 disclosure input preserves exact predecessor bytes and refuses rehashed or corrupted transport',()=>{
 const html=historicalPriceDisclosureInput();
 assert.match(html,/Eligible live comparison identities: 59\./);
 for(const edit of [s=>s+' ',s=>s.replace('identities: 59.','identities: 63.'),s=>s.replace('$179','$1')]) {
  const bad=edit(html);assert.notEqual(bad,html);
  assert.throws(()=>historicalPriceDisclosureInput(gzipSync(bad)),/historical_price_disclosure_input_drift/);
 }
 assert.throws(()=>historicalPriceDisclosureInput(Buffer.from('{}')));
});
test('GLP361 native current disclosure stripping stays exact and preserves all surrounding price history',()=>{
 const tallies={LIVE_PROVIDER_COUNT:63,PRICED_PROVIDER_COUNT:31,CALCULATOR_COMPARABLE_PROVIDER_COUNT:5,BASELINE_PRICE_ROW_COUNT:89,CURRENT_PRICE_ROW_COUNT:82,BASELINE_PRICED_PROVIDER_COUNT:35,MATRIX_PRICED_PROVIDER_COUNT:33};
 const markup=PRICE_STATE_DISCLOSURE.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>tallies[key]);
 const html='<main>'+markup+'<p>Unchanged retained history.</p></main>';
 const aside=html.match(/<aside class="panel" data-price-state-disclosure>[\s\S]*?<\/aside>/)[0];
 assert.match(aside,/identities: 63\./);
 assert.equal(stripPriceStateDisclosures(html,tallies),html.replace(aside,''));
 const unknown=aside.replace('identities: 63.','identities: 999.');
 assert.equal(stripPriceStateDisclosures(unknown,tallies),unknown);
});
