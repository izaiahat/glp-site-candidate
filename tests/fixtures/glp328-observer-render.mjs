// Explicit isolated test transport. This file is NOT a registered build input.
// Receives the actual Python observer's synthetic-GET fixture result, not a
// made-up paid flag. Production paymentVerified has no injection switch.
import {mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as child from 'node:child_process';
import {createHash} from 'node:crypto';
const {site,observed,at}=JSON.parse(readFileSync(0,'utf8'));
assert.equal(observed.payment_verified,true,'real maintained observer fixture must have passed');
Date.now=()=>Date.parse(at); // Isolated test clock only.
mock.module('node:child_process',{namedExports:{...child,spawnSync:(exe,args,options)=>{
 assert.equal(exe,'/home/ubuntu/.hermes/hermes-agent/venv/bin/python3');
 assert.deepEqual(args,['-I','/home/ubuntu/business/scripts/glp_sponsor_site_payment.py']);
 assert.deepEqual(JSON.parse(options.input),site);
 return {status:0,stdout:JSON.stringify({...observed,request_sha256:createHash('sha256').update(options.input).digest('hex')})};
}}});
const {renderSponsorInventory}=await import('../../src/sponsor-inventory.mjs');
const {renderSponsoredPanel}=await import('../../src/sponsor-placement-candidate.mjs');
const {paymentVerified}=await import('../../src/sponsor-pricing.mjs');
const inventory={schema:'glp327_sponsor_inventory_v1',selection:{slot:site.inventory_slot,order_reference:site.order_reference},orders:[site]};
const result=renderSponsorInventory(inventory);
const promo=result.pages[`sponsors/${site.slug}/index.html`];
const panel=renderSponsoredPanel({...site,preview:false});
for(const html of [promo,panel]) {
 assert.match(html,/Sponsored/);assert.match(html,/Paid for by Synthetic Fixture Provider/);
 for(const fact of Object.values(site.facts)) assert.ok(html.includes(fact.text));
 assert.match(html,/rel="sponsored nofollow noopener"/);
}
assert.equal(paymentVerified({...site,payment_verified:true}),false,'changed/copied flag must not match request');
assert.throws(()=>renderSponsorInventory({...inventory,orders:[{...site,release_approved:false}]}));
console.log(JSON.stringify({fixture_only:true,observer_to_inventory_to_native_assets:'PASS',promo_bytes:Buffer.byteLength(promo),panel_bytes:Buffer.byteLength(panel),financial_writes:0,public_writes:0,deploys:0}));
