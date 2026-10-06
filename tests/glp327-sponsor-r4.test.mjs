import {paymentFixture} from './fixtures/sponsor-payment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRateCard,renderPromo } from '../src/paid-promo.mjs';
import { SPONSOR_PRICING,refundQuote,paymentVerified } from '../src/sponsor-pricing.mjs';
test('r4 total, split and optional renewal replace every active price without layout changes',()=>{
 const html=renderRateCard();
 assert.equal(SPONSOR_PRICING.initial,500);assert.equal(SPONSOR_PRICING.setup,250);assert.equal(SPONSOR_PRICING.placement,250);assert.equal(SPONSOR_PRICING.renewal,250);
 assert.match(html,/\$500/);assert.match(html,/\$250 setup \+ \$250 placement/);assert.match(html,/Same-scope renewal: \$250/);
 assert.doesNotMatch(html,/\$200|\$100/);
 assert.match(html,/No automatic renewal/);assert.match(html,/720 consecutive hours/);assert.match(html,/data-sponsor-lead-grid/);
 assert.equal(refundQuote({kind:'initial',launched:false}).amount,500);
 assert.equal(refundQuote({kind:'renewal',launched:false}).amount,250);
 assert.equal(refundQuote({kind:'initial',launched:true,undeliveredHours:360}).status,'manual_review');
 assert.throws(()=>refundQuote({kind:'initial',launched:true,undeliveredHours:721}));
});
test('self-authenticated JSON and caller rehashes never authorize a paid placement',()=>{
 const fixture=paymentFixture();
 for(const delta of [{},{provider:'Different Provider',payer_id:'OTHER'},{order_kind:'nonsense'},{amount:'540.00',tax:'40.00'}])
  assert.equal(paymentVerified({...fixture,...delta}),false);
});
test('a payment boolean or screenshot is not authenticated payment evidence',()=>{
 const forged={reviewed_order:true,order_reference:'R1',payment_verification:{status:'verified',payment_verified:true,source:'paypal_live_authenticated_capture_readback',order_reference:'R1',capture_id:'C1',currency:'USD',amount:'500.00',payee:'ops@glpclinicscout.com',receipt_sha256:'a'.repeat(64)}};
 const valid=paymentFixture();assert.equal(paymentVerified(valid),false);
 assert.equal(paymentVerified({...valid,order_reference:'REPLAY-OTHER-ORDER'}),false);
 assert.equal(paymentVerified({...valid,merchant_id:'OTHER-ACCOUNT'}),false);
 valid.payment_verification.receipt_json+=' ';assert.equal(paymentVerified(valid),false);
 assert.equal(paymentVerified(forged),false);
 assert.equal(paymentVerified({reviewed_order:true,payment_confirmed:true}),false);
 assert.equal(paymentVerified({payment_verification:{payment_verified:true,source:'screenshot'}}),false);
 assert.throws(()=>renderPromo({operator_approval:true,partner_creative_approval:true,payment_confirmed:true,eligibility_approved:true,inventory_reserved:true,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+720*3600000).toISOString()},{preview:false}),/payment|activation/i);
});
