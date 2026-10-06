import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPromo,renderRateCard,SPONSOR_ROBOTS} from '../src/paid-promo.mjs';
import {renderSponsorPlacementCandidate, renderSponsoredPanel} from '../src/sponsor-placement-candidate.mjs';
import {auditPage} from '../scripts/validate-public-email-aliases.mjs';
import {readFileSync} from 'node:fs';
import {paymentFixture} from './fixtures/sponsor-payment.mjs';

test('plain sponsor copy keeps disclosures next to the decision and link',()=>{
 const panel=renderSponsoredPanel();
 assert.match(panel,/Example placement\. No provider is being promoted\./);
 assert.doesNotMatch(panel,/A paid introduction|Payment buys advertising space|Any applicable affiliate commission/);
 const livePanel=renderSponsoredPanel({provider:'Example',preview:false,destination:'https://example.com/',affiliate:true});
 assert.match(livePanel,/>Sponsored<\/span>/);
 assert.match(livePanel,/Paid for by Example\. We may also earn a commission if you use this link\./);
 assert.ok(livePanel.indexOf('Paid for by Example.')-livePanel.indexOf('data-sponsored-link')<250,'disclosure adjacent to link');
 assert.doesNotMatch(renderSponsoredPanel({preview:false,provider:'Example',destination:'https://example.com/'}),/commission/,'no invented affiliate connection');
 const promo=renderPromo();
 assert.equal((promo.match(/Independent rankings do not change/g)||[]).length,1,'one independence explanation');
 assert.doesNotMatch(promo,/Your comparison stays independent|Any applicable affiliate commission|We make no treatment/);
 assert.match(promo,/Example page\. Provider details will appear here after review\./);
 assert.doesNotMatch(renderRateCard(),/Visibility without buying a ranking|Audience and reporting, honestly|Unknown is not zero/);
});
test('preview discloses sponsorship and never contains a live advertiser CTA',()=>{
 const html=renderPromo({provider:'Example <script>alert(1)</script>'});
 assert.match(html,/Sponsored/);assert.match(html,/Independent rankings do not change/);
 assert.match(html,/not a clinic/);assert.doesNotMatch(html,/<script>alert/);assert.match(html,/disabled aria-disabled="true"/);
 assert.doesNotMatch(html,/rel="sponsored/);
 assert.match(html,new RegExp(`<meta name="robots" content="${SPONSOR_ROBOTS}">`));assert.match(SPONSOR_ROBOTS,/noindex/);
});
test('live page fails closed without readiness and preserves rel sponsorship',()=>{
 assert.throws(()=>renderPromo({provider:'Example'},{preview:false}));
 const start=Date.now()-3600000;
 const order={provider:'Example',slug:'example',operator_approval:'reviewed',partner_creative_approval:'reviewed',payment_confirmed:true,eligibility_approved:true,inventory_reserved:true,held:false,us_provider:true,starts_at:new Date(start).toISOString(),ends_at:new Date(start+720*3600000).toISOString(),destination:'https://example.com/',affiliate:true};
 Object.assign(order,paymentFixture());
 const html=renderPromo(order,{preview:false});
 assert.match(html,/rel="sponsored nofollow noopener"/);
 assert.match(html,/data-sponsor-ad-disclosure>Paid for by Example\. We may also earn a commission if you use this link\./);
 for(const field of ['operator_approval','partner_creative_approval','payment_verification','reviewed_order','eligibility_approved','inventory_reserved']) assert.throws(()=>renderPromo({...order,[field]:false},{preview:false}),field);
 assert.throws(()=>renderPromo({...order,provider:'Fella Health'},{preview:false}));
 assert.throws(()=>renderPromo({...order,held:true},{preview:false}));
 assert.throws(()=>renderPromo({...order,destination:'javascript:alert(1)'},{preview:false}));
 assert.throws(()=>renderPromo({...order,slug:'../x'},{preview:false}));
 assert.throws(()=>renderPromo({...order,ends_at:new Date(start+721*3600000).toISOString()},{preview:false}));
});
test('rate card preserves material prices, renewal, delivery and refund terms',()=>{
 const card=renderRateCard();
 for(const text of ['For US providers.',' / 30 days','$500','$250 setup + $250 placement and reporting','720 consecutive hours from verified activation','Same-scope renewal','$250','Another 30 days, by affirmative order only.','No automatic renewal or recurring charge.','No traffic, leads, sales or SEO guarantee. Subject to available inventory and final review.','Independent rankings do not change. Sponsorship does not buy a score, favorable review or SEO backlink.','We do not have a verified audience size or sponsor impression estimate for this proposal. Site visits are not ad impressions.','No patient information or health-derived audience is shared.','PayPal payment details are supplied after a confirmed order.','Full refund if no conforming placement launches; refund or mutually agreed equivalent extension for undelivered time.','GLP Clinic Scout is an independent comparison publisher, not a clinic, pharmacy or medical provider. This page is not medical advice.']) assert.ok(card.includes(text),text);
 assert.match(card,/noindex/);assert.doesNotMatch(card,/ops@/);assert.match(card,/mailto:partners@glpclinicscout\.com/);
 const map=JSON.parse(readFileSync(new URL('../data/email-alias-map.json',import.meta.url),'utf8'));
 for(const [route,html] of [['/sponsors/rates/',card],['/sponsors/example-provider/',renderPromo()]]) assert.deepEqual(auditPage(map,route,html).violations,[],route);
});
test('/providers/ panel is a neutral example, not a client or program claim',()=>{
 const panel=renderSponsorPlacementCandidate('/providers/',{preview:true});
 for(const text of ['>Sponsored<','Example Provider',"A space for a provider's program summary.",'View provider information','Example placement. No provider is being promoted.']) assert.ok(panel.includes(text),text);
 for(const html of [panel,renderRateCard(),renderPromo()]) assert.doesNotMatch(html,/fella|nu image|\b(?:verified|licensed) (?:provider|clinic|clinician|doctor|physician|pharmacy)|<a\b[^>]*href="https?:/i);
});
