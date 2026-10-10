import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {release2PriceLedgerBasis} from '../src/price-index-release2-basis.mjs';
import {renderCategoryPrice} from '../src/compounded-category.mjs';
import {readHistoricalPriceFixture} from './helpers/provider-append-predecessor.mjs';
const read=name=>readHistoricalPriceFixture(new URL('../data/'+name,import.meta.url));
const current=read('program-content-ledger.json'),frozen=read('price-index-frozen-content-ledger.json');
const binding=JSON.parse(read('price-index-nonprice-binding.json'));
test('TAP844 v5 proof admits exact R2 basis and rejects altered successor proof',()=>{
 assert.deepEqual(release2PriceLedgerBasis(current),read('d2w-release2-price-predecessor-ledger.json'));
 assert.throws(()=>release2PriceLedgerBasis(current,p=>String(p).endsWith('/s32-ledger-successor-v1.json')?Buffer.from('{}'):readFileSync(p)),/s32_binding_source_hash/);
});
test('TAP747 v5 research binding is explicit and cannot be deleted widened or repinned',()=>{
 assert.deepEqual(binding.research_binding,JSON.parse(read('price-index-nonprice-binding-v4.json')).research_binding);
 for(const mutate of [b=>delete b.research_binding,b=>b.research_binding.allow_all=true,b=>b.research_binding.sha256='0'.repeat(64)]){
  const changed=structuredClone(binding);mutate(changed);
  assert.throws(()=>frozenPriceLedger(current,frozen,changed),/price_nonprice_research_binding_invalid/);
 }
});
test('TAP998 every typed disclosure names both initial and renewal total uncertainty',()=>{
 const rows=Object.values(JSON.parse(read('provider-pricing-matrix.json')).providers).flatMap(p=>p.medications).filter(r=>r.price_kind);
 assert.ok(rows.length);
 for(const row of rows)assert.match(renderCategoryPrice(row),/Total initial and renewal charges, including any separate fees, are not stated here; request a complete quote\./);
});
test('TAP172 widened v5 nonprice allowlist reports scope_invalid rather than TypeError',()=>{
 assert.ok(Array.isArray(binding.nonprice_fields));
 const changed={...binding,nonprice_fields:[...binding.nonprice_fields,{program_id:'shedrx',key:'starting_price'}]};
 assert.throws(()=>frozenPriceLedger(current,frozen,changed),/price_nonprice_binding_scope_invalid/);
});
