import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import * as child from 'node:child_process';
import {createHash} from 'node:crypto';
import {sponsorContentFixture} from './fixtures/sponsor-content.mjs';
import {readFileSync} from 'node:fs';
import {retainedPricingCaptureSource} from './fixtures/sponsor-retained-capture.mjs';

// Isolated transport fixture, NOT a production payment/approval override.
let input;
let response;
mock.module('node:child_process',{namedExports:{...child,spawnSync:(exe,args,options)=>{
  assert.equal(exe,'/home/ubuntu/.hermes/hermes-agent/venv/bin/python3');
  assert.deepEqual(args,['-I','/home/ubuntu/business/scripts/glp_sponsor_site_payment.py']);
  assert.equal(options.shell,false);input=JSON.parse(options.input);
  return response ?? {status:0,stdout:JSON.stringify({payment_verified:true,
    source:'paypal_authenticated_invoice_reporting_observer',order_reference:input.order_reference,
    request_sha256:createHash('sha256').update(options.input).digest('hex')})};
}}});
const {paymentVerified}=await import('../src/sponsor-pricing.mjs');
const {renderSponsorInventory}=await import('../src/sponsor-inventory.mjs');

test('existing inventory and promo use observer transport, never a caller paid flag',()=>{
  const inventory=sponsorContentFixture();
  const result=renderSponsorInventory(inventory);
  assert.match(result.pages['sponsors/synthetic-fixture-provider/index.html'],/Paid for by Synthetic Fixture Provider/);
  assert.equal(input.order_reference,inventory.selection.order_reference);
  assert.equal(input.payment_verified,undefined);
});

test('unverified, copied, stale response, wrong reference and process failure all fail closed',()=>{
  const order=sponsorContentFixture().orders[0];
  for(const bad of [
    {status:1,stdout:'{}'}, {status:null,stdout:'{}'}, {status:0,stdout:'not JSON'},
    {status:0,stdout:JSON.stringify({payment_verified:true,order_reference:order.order_reference})},
    {status:0,stdout:JSON.stringify({payment_verified:false,source:'paypal_authenticated_invoice_reporting_observer'})},
    {status:0,stdout:JSON.stringify({payment_verified:true,source:'paypal_authenticated_invoice_reporting_observer',order_reference:'OTHER',request_sha256:'a'.repeat(64)})}
  ]) {response=bad;assert.equal(paymentVerified({...order,payment_verified:true}),false);}
  response=undefined;
});

test('retained capture projects only the exact live-only delegate; all render/economics bytes stay pinned',()=>{
 const source=readFileSync(new URL('../src/sponsor-pricing.mjs',import.meta.url),'utf8');
 const capture=JSON.parse(readFileSync(new URL('../reports/ops/sponsor-clean-layout-20261003/copy/readiness-r5/captures/CAPTURE.json',import.meta.url),'utf8'));
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const expected=capture.sourceHashes['src/sponsor-pricing.mjs'];
 assert.equal(hash(retainedPricingCaptureSource(source)),expected);
 assert.throws(()=>retainedPricingCaptureSource(source.replace('return authenticatedSponsorPayment(order);','return true;')));
 assert.throws(()=>retainedPricingCaptureSource(source.replace("from './sponsor-payment-observer.mjs'","from './other.mjs'")));
 assert.notEqual(hash(retainedPricingCaptureSource(source.replace('SPONSOR_PRICING[kind]','999'))),expected);
});
