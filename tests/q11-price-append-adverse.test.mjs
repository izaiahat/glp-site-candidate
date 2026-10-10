import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProviderPriceAppend,projectProviderPriceAppend} from '../src/provider-price-append.mjs';
const old=Buffer.from('{"programs":[{"program_id":"old","price":99}]}');
const next=Buffer.from('{"programs":[{"program_id":"old","price":99},{"program_id":"new","price":null}]}');
test('ledger append rejects a semantically equal but byte-altered predecessor',()=>{
 const b=makeProviderPriceAppend(old,next,'ledger',['new']);
 assert.deepEqual(projectProviderPriceAppend(old,b,'ledger'),old);
 assert.throws(()=>projectProviderPriceAppend(Buffer.concat([old,Buffer.from(' ')]),b,'ledger'),/append_predecessor_bytes_drift/);
});
test('ledger append refuses price, order, deletion, duplicate and root mutations without mutating inputs',()=>{
 const binding=makeProviderPriceAppend(old,next,'ledger',['new']);
 for(const edit of [x=>x.programs[0].price=0,x=>x.programs.reverse(),x=>x.programs.shift(),x=>x.programs.push(x.programs[0]),x=>x.unknown=1]){
  const candidate=JSON.parse(next);edit(candidate);const bytes=Buffer.from(JSON.stringify(candidate));
  assert.throws(()=>makeProviderPriceAppend(old,bytes,'ledger',['new']));
  assert.throws(()=>projectProviderPriceAppend(bytes,binding,'ledger'));
 }
 assert.equal(old.toString(),'{"programs":[{"program_id":"old","price":99}]}');
});
