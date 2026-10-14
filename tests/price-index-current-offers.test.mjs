import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as refresh from '../src/price-refresh-evidence.mjs';
import {readerPriceText} from '../src/typed-price-labels.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>JSON.parse(readFileSync(root+'data/'+name));

test('price index publishes the exact validated October offers without rewriting historical statistics',()=>{
  const matrix=read('provider-pricing-matrix.json'), ledger=read('price-refresh-ledger.json');
  const historical='<main><section><h1>Price index</h1><p>Historical benchmark as of 2026-09-03</p></section></main>';
  const html=refresh.addCurrentPriceIndexOffers(historical,{root,matrix,now:new Date('2026-10-09T23:59:59Z')});
  const ids=[...html.matchAll(/data-current-price-row="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,30);
  assert.deepEqual(ids.sort(),[...new Set(ledger.entries.map(e=>e.row_id))].sort());
  assert.match(html,/Current validated provider offers/);
  assert.match(html,/as of 2026-10-09/);
  assert.equal((html.match(/data-current-price-as-of="2026-10-09"/g)||[]).length,30);
  assert.match(html,/not comparable monthly cash charges/);
  assert.doesNotMatch(html,/fella/i);
  assert.equal(refresh.stripCurrentPriceIndexOffers(html),historical);
  assert.equal(refresh.addCurrentPriceIndexOffers(html,{root,matrix,now:new Date('2026-10-09T23:59:59Z')}),html);
  // Every output offer comes from the current matrix; unknown facts are retained.
  for(const e of ledger.entries){
    const row=matrix.providers[e.program_id].medications.find(r=>r.row_id===e.row_id);
    const card=html.split(`data-current-price-row="${e.row_id}"`)[1].split('</article>')[0];
    for(const component of row.unknown_components) assert.ok(card.includes(readerPriceText(component).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')), 'unknown component retained: '+component);
  }
  const mutated=structuredClone(matrix);mutated.providers[ledger.entries[0].program_id].medications.find(r=>r.row_id===ledger.entries[0].row_id).facts.amount_usd.value=0;
  assert.throws(()=>refresh.addCurrentPriceIndexOffers(historical,{root,matrix:mutated,now:new Date('2026-10-09T23:59:59Z')}),/price_refresh_evidence:/);
  const build=readFileSync(root+'scripts/build-staging.mjs','utf8');
  assert.match(build,/addCurrentPriceIndexOffers\(priceIndex\.html/);
  assert.match(build,/stripCurrentPriceIndexOffers\(preservedPriceIndexHtml/);
});
