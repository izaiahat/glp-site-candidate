import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPromo,renderRateCard,renderDirectoryMock} from '../src/paid-promo.mjs';

test('preview discloses sponsorship and never contains a live advertiser CTA',()=>{
 const html=renderPromo({provider:'Example <script>alert(1)</script>'});
 assert.match(html,/Sponsored/);assert.match(html,/Sponsored placements never change our independent rankings/);
 assert.match(html,/not a clinic/);assert.doesNotMatch(html,/<script>/);assert.match(html,/disabled aria-disabled="true"/);
});
test('live page fails closed without readiness and preserves rel sponsorship',()=>{
 assert.throws(()=>renderPromo({provider:'Example'},{preview:false}));
 const start=Date.now()-3600000;
 const order={provider:'Example',operator_approval:'reviewed',partner_creative_approval:'reviewed',payment_confirmed:true,eligibility_approved:true,inventory_reserved:true,held:false,us_provider:true,starts_at:new Date(start).toISOString(),ends_at:new Date(start+720*3600000).toISOString(),destination:'https://example.com/',affiliate:true};
 assert.match(renderPromo(order,{preview:false}),/rel="sponsored nofollow noopener"/);
 assert.throws(()=>renderPromo({...order,provider:'Fella Health'},{preview:false}));
 assert.throws(()=>renderPromo({...order,held:true},{preview:false}));
 assert.throws(()=>renderPromo({...order,destination:'javascript:alert(1)'},{preview:false}));
});
test('rate and placement proposal have exact prices, duration and separate inventory',()=>{
 const card=renderRateCard();assert.match(card,/\$200/);assert.match(card,/\$100/);assert.match(card,/720 consecutive hours/);assert.match(card,/No traffic, leads, sales or SEO guarantee/);
 const mock=renderDirectoryMock();assert.ok(mock.indexOf('Sponsored')<mock.indexOf('Organic provider comparison'));
});
