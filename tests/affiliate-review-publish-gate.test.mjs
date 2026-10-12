import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { assertAffiliateReviewPublishable, labelNonAffiliateReview } from '../src/affiliate-review-publish-gate.mjs';
const href='https://network.example/trk/?o=1&a=803003';
const program={program_id:'test',commercial_state:'live',affiliate_relationship_snapshot:{relationship_status:'approved_active_tracking_ready',promotion_denied:false}};
const review={program_id:'test',row:{promotion_authorized:true,live_link_allowed:true,affiliate_href:href},fastpath_contract:{network_contract:{relationship_state:'approved_or_active',tracking_url:href}}};
const authority={status:'VERIFIED',promotion_authorized:true};
const html=`<p>Clinic Scout may earn a commission.</p><a data-program="test" data-analytics-event="affiliate_click" href="${href.replaceAll('&','&amp;')}" rel="sponsored nofollow">Start</a>`;
test('approved affiliate review cannot publish link-dark even if row holds a URL',()=>assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,'<p>commission</p>'),/affiliate_review_missing_approved_anchor/));
test('expected exact approved URL and sponsored/nofollow pass',()=>assert.equal(assertAffiliateReviewPublishable(review,program,authority,html).status,'AFFILIATE_BOUND'));
test('missing authority fails rather than silent downgrade',()=>assert.throws(()=>assertAffiliateReviewPublishable(review,program,null,html),/affiliate_review_approval_unbound/));
test('different URL, subject and missing rel refuse',()=>{for(const broken of [html.replace('o=1','o=2'),html.replace('data-program="test"','data-program="other"'),html.replace('sponsored nofollow','nofollow')])assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,broken),/affiliate_review_missing_approved_anchor/);});
test('non-affiliate requires explicit source state and visible label',()=>{const p={program_id:'rx',affiliate_relationship:'non_affiliate',prescription_provider:true}; const r={program_id:'rx',row:{}};assert.throws(()=>assertAffiliateReviewPublishable(r,p,null,'<p>Independent review</p>'),/non_affiliate_review_label_missing/);assert.equal(assertAffiliateReviewPublishable(r,p,null,'<p>Non-affiliate provider. We do not earn a commission from this provider.</p>').status,'NON_AFFILIATE_LABELED');});
test('existing held relationship never gains link or reactivation',()=>{const p={...program,affiliate_relationship_snapshot:{promotion_denied:true,relationship_status:'paused_network_program_paused'}};assert.equal(assertAffiliateReviewPublishable(review,p,{status:'WITHHELD',promotion_authorized:false},'<p>Partner link unavailable</p>').status,'HELD_NO_PROMOTION');assert.throws(()=>assertAffiliateReviewPublishable(review,p,{status:'WITHHELD',promotion_authorized:false},html),/held_review_has_affiliate_anchor/);});
test('missing relationship does not count as non-affiliate',()=>assert.throws(()=>assertAffiliateReviewPublishable({program_id:'unknown',row:{}},{program_id:'unknown'},null,'<p>Non-affiliate</p>'),/affiliate_review_relationship_unknown/));
test('hidden links and hidden disclosure cannot satisfy publication',()=>{
 assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,html.replace('<a ','<a hidden ')),/missing_approved_anchor/);
 assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,html.replace('<p>','<p hidden>')),/disclosure_missing/);
});
test('validated build invokes final artifact gate as well as pre-write guard',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
 assert.ok(pkg.scripts['build:validated'].endsWith('node scripts/validate-affiliate-review-publication.mjs'));
 assert.match(readFileSync(new URL('../scripts/build-staging.mjs',import.meta.url),'utf8'),/assertAffiliateReviewPublishable\(review, record/);
});
test('renderer labels only explicitly non-affiliate prescription records',()=>{
 const p={program_id:'rx',affiliate_relationship:'non_affiliate',prescription_provider:true};
 const raw='<h1>Provider review</h1>';
 assert.throws(()=>assertAffiliateReviewPublishable({program_id:'rx'},p,null,raw),/label_missing/);
 const labeled=labelNonAffiliateReview(raw,p);
 assert.equal(assertAffiliateReviewPublishable({program_id:'rx'},p,null,labeled).status,'NON_AFFILIATE_LABELED');
 assert.equal(labelNonAffiliateReview(raw,program),raw);
});
test('stripping tracking metadata cannot hide a held or malformed subject link',()=>{
 const stripped=html.replace(' data-program="test"','').replace(' data-analytics-event="affiliate_click"','').replace(' rel="sponsored nofollow"','');
 const held={...program,affiliate_relationship_snapshot:{promotion_denied:true}};
 assert.throws(()=>assertAffiliateReviewPublishable(review,held,{status:'WITHHELD',promotion_authorized:false},stripped),/held_review_has_affiliate_anchor/);
 assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,html+stripped),/affiliate_review_missing_approved_anchor/);
 const wrong=html.replace('o=1','o=2').replace(' data-analytics-event="affiliate_click"','').replace(' rel="sponsored nofollow"','');
 assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,html+wrong),/affiliate_review_missing_approved_anchor/);
});
test('no-JS fallback cannot hide a held subject link',()=>{
 const held={...program,affiliate_relationship_snapshot:{promotion_denied:true}};
 const bare=`<a href="${href.replaceAll('&','&amp;')}">Start</a>`;
 assert.throws(()=>assertAffiliateReviewPublishable(review,held,authority,`<noscript>${bare}</noscript>`),/held_review_has_affiliate_anchor/);
 assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,html+`<noscript>${bare}</noscript>`),/affiliate_review_missing_approved_anchor/);
 assert.equal(assertAffiliateReviewPublishable(review,program,authority,html+'<noscript><p>JavaScript optional.</p></noscript>').anchors,1);
 assert.throws(()=>assertAffiliateReviewPublishable(review,program,authority,`<p>commission</p><noscript>${html}</noscript>`),/affiliate_review_missing_approved_anchor/);
 assert.equal(assertAffiliateReviewPublishable(review,program,authority,html+'<noscript><a data-program="other" href="https://other.example/">Other</a></noscript>').anchors,1);
});
test('existing alias promotion restriction stays link-dark and points to canonical review',()=>{
 const p={...program,profiles:{'glp-clinic-scout':{canonical_identity:{role:'alias',canonical_program_id:'canonical'},surfaces:{go:false,compare:false}}}};
 const canonical='<a href="/reviews/canonical/">Canonical review</a>';
 assert.equal(assertAffiliateReviewPublishable(review,p,authority,canonical).status,'CANONICAL_ALIAS_NO_PROMOTION');
 assert.throws(()=>assertAffiliateReviewPublishable(review,p,authority,canonical+html),/canonical_alias_review_invalid/);
});
