import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {release2PriceLedgerBasis} from '../src/price-index-release2-basis.mjs';
import {sourceDisplayPacket,projectProviderDisplayFacts,projectProviderDisplayLedger} from '../src/provider-display-evidence.mjs';
import {readHistoricalPriceFixture} from './helpers/provider-append-predecessor.mjs';
const read=n=>readHistoricalPriceFixture(new URL('../data/'+n,import.meta.url));
const current=read('program-content-ledger.json'),frozen=read('price-index-frozen-content-ledger.json'),binding=JSON.parse(read('price-index-nonprice-binding.json'));
test('R2 exact source changes retain whole frozen price oracle',()=>{
 const result=frozenPriceLedger(current,frozen,binding);assert.deepEqual(result.bytes,frozen);
 assert.deepEqual(release2PriceLedgerBasis(current),read('d2w-release2-price-predecessor-ledger.json'));
});
for(const field of ['criteria_scores','live_link_allowed','program_id'])test('price oracle rejects unlisted '+field+' mutation',()=>{
 const tampered=JSON.parse(current);tampered.programs[0][field]='UNAUTHORIZED';
 assert.throws(()=>frozenPriceLedger(Buffer.from(JSON.stringify(tampered)),frozen,binding),/s32_binding_current_drift/);
});
test('price bridge rejects altered exact receipt',()=>{
 assert.throws(()=>release2PriceLedgerBasis(current,p=>String(p).includes('d2w-release2-price-basis.json')?Buffer.from('{}'):readFileSync(p)),/descriptor_drift/);
});
test('price bridge rejects altered predecessor snapshot',()=>{
 assert.throws(()=>release2PriceLedgerBasis(current,p=>String(p).includes('price-predecessor-ledger')?Buffer.from('{}'):readFileSync(p)),/predecessor_drift/);
});
test('Bodybuilding evidence table and ledger dates follow exact price packet',()=>{
 const id='bodybuilding-com-glp-1-longevity-review',packet=sourceDisplayPacket(id),ledger=projectProviderDisplayLedger({program_id:id}),facts=projectProviderDisplayFacts({program_id:id,facts:{}});
 assert.equal(facts.facts.total_monthly_cost.capture_date,packet.fields.first_month_price.verified_as_of);
 assert.equal(ledger.research_first_month_price.verified_as_of,packet.fields.first_month_price.verified_as_of);
 assert.equal(facts.facts.total_monthly_cost.value,packet.fields.first_month_price.value);
 assert.equal(packet.fields.first_month_price.verified_as_of,'2026-09-10');
});
