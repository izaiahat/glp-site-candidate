import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
const data = new URL('../data/',import.meta.url);
const frozen = fs.readFileSync(new URL('price-index-frozen-content-ledger.json',data));
const current = fs.readFileSync(new URL('program-content-ledger.json',data));
const binding = JSON.parse(fs.readFileSync(new URL('price-index-nonprice-binding.json',data)));
const sha = x => createHash('sha256').update(x).digest('hex');
test('S21 independently stored exact successor binds current and frozen bytes',()=>{
 // S21 descendant: the receipted HOLD has different true source bytes; it
 // preserves the original frozen oracle, not equality with today's ledger.
 const r=frozenPriceLedger(current,frozen,binding);assert.equal(r.frozen_sha256,sha(frozen));assert.equal(r.current_sha256,sha(current));assert.notEqual(r.current_sha256,r.frozen_sha256);assert.deepEqual(r.ledger,JSON.parse(frozen));assert.equal(r.frozen_sha256,'374667b3f4a13bb7dd5776f1cd29add113b25fa1826c6af4620c07668b496830');
});
for (const [name,mutate] of [
 ['price',d=>d.programs[0].starting_price='$1'],
 ['permission',d=>d.programs[0].live_link_allowed=!d.programs[0].live_link_allowed],
 ['price evidence date',d=>d.programs[0].research_first_month_price={verified_as_of:'2099-01-01'}],
 ['price evidence source',d=>d.programs[0].research_first_month_price.source_url='https://example.invalid/unreviewed'],
 ['billing provenance',d=>d.programs[0].research_first_month_price.billing_basis='annual'],
 ['provider membership',d=>d.programs.pop()],
 ['unrelated root evidence',d=>d.unreviewed_change=true],
]) test(`even a rehashed current binding rejects ${name} drift`,()=>{
 const d=JSON.parse(current);mutate(d);const bytes=Buffer.from(JSON.stringify(d));assert.throws(()=>frozenPriceLedger(bytes,frozen,{...binding,current_sha256:sha(bytes)}),/s32_binding_descriptor_drift/);
});
test('corrupt frozen source and unpinned current bytes fail closed',()=>{
 assert.throws(()=>frozenPriceLedger(current,Buffer.concat([frozen,Buffer.from(' ')]),binding),/hash_mismatch/);
 assert.throws(()=>frozenPriceLedger(Buffer.concat([current,Buffer.from(' ')]),frozen,binding),/s32_binding_current_drift/);
});
test('widening the nonprice field allowlist cannot authorize price or authority changes',()=>{
 assert.throws(()=>frozenPriceLedger(current,frozen,{...binding,nonprice_fields:[...binding.nonprice_fields,{program_id:'shedrx',key:'starting_price'}]}),/scope_invalid/);
});
