import test from 'node:test';
import assert from 'node:assert/strict';
import {providerDetailAffiliate} from '../src/provider-detail-affiliate.mjs';
const link={live:true,affiliate_href:'https://network.test/approved'};
test('canonical selected records resolve their reviewed render identity',()=>{
 assert.equal(providerDetailAffiliate({program_id:'awin-1',review_slug:'coivas'},{coivas:link},{held:false}),link);
});
test('current hold wins over render alias and historical live flag',()=>{
 const result=providerDetailAffiliate({program_id:'awin-1',review_slug:'coivas'},{coivas:link},{held:true});
 assert.equal(result.live,false);assert.equal(result.affiliate_href,null);
});
test('missing governed map row cannot be manufactured from selection',()=>{
 assert.equal(providerDetailAffiliate({program_id:'awin-1',review_slug:'coivas'},{},{held:false,issuedHref:'https://network.test/approved'}),null);
});
test('same-id direct providers keep the exact issued link',()=>assert.equal(providerDetailAffiliate({program_id:'direct'},{direct:link},null),link));
