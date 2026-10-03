import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPromo,renderRateCard,SPONSOR_ROBOTS} from '../src/paid-promo.mjs';
import {renderSponsorPlacementCandidate} from '../src/sponsor-placement-candidate.mjs';
import {auditPage} from '../scripts/validate-public-email-aliases.mjs';
import {readFileSync} from 'node:fs';

test('preview discloses sponsorship and never contains a live advertiser CTA',()=>{
 const html=renderPromo({provider:'Example <script>alert(1)</script>'});
 assert.match(html,/Sponsored/);assert.match(html,/Sponsored placements never change our independent rankings/);
 assert.match(html,/not a clinic/);assert.doesNotMatch(html,/<script>alert/);assert.match(html,/disabled aria-disabled="true"/);
 assert.doesNotMatch(html,/rel="sponsored/);
 assert.match(html,new RegExp(`<meta name="robots" content="${SPONSOR_ROBOTS}">`));assert.match(SPONSOR_ROBOTS,/noindex/);
});
test('live page fails closed without readiness and preserves rel sponsorship',()=>{
 assert.throws(()=>renderPromo({provider:'Example'},{preview:false}));
 const start=Date.now()-3600000;
 const order={provider:'Example',slug:'example',operator_approval:'reviewed',partner_creative_approval:'reviewed',payment_confirmed:true,eligibility_approved:true,inventory_reserved:true,held:false,us_provider:true,starts_at:new Date(start).toISOString(),ends_at:new Date(start+720*3600000).toISOString(),destination:'https://example.com/',affiliate:true};
 assert.match(renderPromo(order,{preview:false}),/rel="sponsored nofollow noopener"/);
 assert.throws(()=>renderPromo({...order,provider:'Fella Health'},{preview:false}));
 assert.throws(()=>renderPromo({...order,held:true},{preview:false}));
 assert.throws(()=>renderPromo({...order,destination:'javascript:alert(1)'},{preview:false}));
 assert.throws(()=>renderPromo({...order,slug:'../x'},{preview:false}));
});
test('rate card carries the approved prices, terms and disclaimers verbatim',()=>{
 const card=renderRateCard();
 for(const text of ['US-provider sponsorship','Visibility without buying a ranking.','Introduce your program in clearly labeled paid inventory on an independent GLP-1 provider comparison site.','Initial 30-day pilot',' / 30 days','$200','$100 setup + $100 placement and reporting','720 consecutive hours from verified activation','Same-scope renewal','$100','Another 30 days, by affirmative order only.','No automatic renewal or recurring charge.','No traffic, leads, sales or SEO guarantee. Subject to available inventory and final review.','Sponsored placements never change our independent rankings.','No paid top rank, editorial score, favorable review or paid SEO backlink.','Unknown is not zero. Site visits are not ad impressions.','No patient information or health-derived audience is shared.','PayPal payment details are supplied after a confirmed order.','Full refund if no conforming placement launches; refund or mutually agreed equivalent extension for undelivered time.','GLP Clinic Scout is an independent comparison publisher, not a clinic, pharmacy or medical provider. This page is not medical advice.'])
  assert.ok(card.includes(text.replaceAll('&','&amp;').replace('/providers/','<strong>/providers/</strong>')),text);
 assert.match(card,/noindex/);
 // Operator 2026-10-03: the ops@ remittance address goes in the order email only;
 // the public page publishes the partner alias and passes validate:email-aliases.
 assert.doesNotMatch(card,/ops@/);
 assert.match(card,/mailto:partners@glpclinicscout\.com/);
 const map=JSON.parse(readFileSync(new URL('../data/email-alias-map.json',import.meta.url),'utf8'));
 for(const [route,html] of [['/sponsors/rates/',card],['/sponsors/example-provider/',renderPromo()]]) assert.deepEqual(auditPage(map,route,html).violations,[],route);
});
test('/providers/ panel uses the approved example copy and no real provider or claims',()=>{
 const panel=renderSponsorPlacementCandidate('/providers/',{preview:true});
 for(const text of ['>Sponsored<','Example Provider','A paid introduction to Example Provider. Explore provider-reported program information and check current terms and eligibility directly with the provider.','View provider information','Example creative, not a provider endorsement. Any applicable affiliate commission will be disclosed next to the final link. Payment buys advertising space, not a recommendation or rank.']) assert.ok(panel.includes(text),text);
 for(const html of [panel,renderRateCard(),renderPromo()]) assert.doesNotMatch(html,/fella|nu image|\b(?:verified|licensed) (?:provider|clinic|clinician|doctor|physician|pharmacy)|<a\b[^>]*href="https?:/i);
});
