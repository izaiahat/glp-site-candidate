import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadGoPromotionAuthority,restoreGoOnlyPriceBasis} from '../src/go-runtime-selection.mjs';
import {stableSha256} from '../src/therapeutic-taxonomy.mjs';
import {buildProviderReviewSpecs,renderProviderReviewPage} from '../src/provider-review.mjs';
const registry=JSON.parse(readFileSync(new URL('../data/program-registry.json',import.meta.url)));
const expected=registry.therapeutic_taxonomy.price_index_registry_programs_semantic_basis_sha256;
const basis=structuredClone(registry);
const read = name => JSON.parse(readFileSync(new URL('../data/'+name,import.meta.url)));
const escapeHtml = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
test('actual review renderer consumes repaired copy and binds Longevity live anchor to operator authority',()=>{
 const contracts=read('provider-page-contracts.json');
 const reviews=buildProviderReviewSpecs(read('money-page-specs.json').pages,contracts,read('provider-fastpath-contract.json'),registry,'glp-clinic-scout',read('program-content-ledger.json').programs);
 for(const id of ['mademed','strut-health','trt-nation','drhouse','longevity-meds-glp-1-review']){
  const review=reviews.find(p=>p.program_id===id);assert.ok(review);
  const html=renderProviderReviewPage(review,read('identity-registry.json'));
  assert.ok(html.includes('<html'));
  if(id==='mademed')assert.doesNotMatch(html,/\$(?:1197|897|399|299)\b/);
  if(id==='strut-health'){assert.match(html,/February 20, 2026/);assert.doesNotMatch(html,/\$199\b/);}
  if(id==='trt-nation'){
   assert.ok(html.includes(escapeHtml(review.fastpath_contract.page_copy.pricing)), 'rendered TRT pricing differs from repaired copy');
   assert.match(html, /\$219\/month[^<]*three-month minimum purchase/);
   assert.doesNotMatch(html,/\$(?:129|179)\/month/);
  }
  if(id==='drhouse'){
   for(const field of ['shipping','cancellation'])assert.ok(html.includes(escapeHtml(review.fastpath_contract.page_copy[field])),`rendered DrHouse ${field} differs from repaired copy`);
   assert.match(html,/transmission to a pharmacy within 1–2 hours[^<]*not medication delivery time/);
   assert.match(html,/cancellation: anytime without penalties[^<]*not an unconditional post-consultation refund guarantee/);
   assert.doesNotMatch(html,/as little as 1 hour|100% refund/);
  }
  if(id==='longevity-meds-glp-1-review'){
   const authority=loadGoPromotionAuthority().programs[id];
   assert.equal(authority.status,'VERIFIED');
   assert.match(authority.operator_approved_live_decision?.path||'',/OPERATOR-DECISION-20260924-all-approved-providers-live\.md$/);
   assert.equal(createHash('sha256').update(readFileSync(authority.operator_approved_live_decision.path)).digest('hex'),authority.operator_approved_live_decision.sha256);
   const issued=read('affiliate-wire-in-approvals.json').programs.find(p=>p.existing_release_alias===id)?.tracking?.provider_issued_url;
   assert.equal(issued,'https://www.xfnjwej33dd.com/841W6MT/6RHPZQL/');
   const anchor=html.match(/<a\b[^>]*data-analytics-event="affiliate_click"[^>]*data-program="longevity-meds-glp-1-review"[^>]*>/)?.[0];
   assert.ok(anchor, 'Longevity rendered conversion missing');
   assert.ok(anchor.includes(`href="${issued}" rel="sponsored nofollow noopener"`), 'Longevity rendered conversion must use the exact provider-issued URL');
   assert.doesNotMatch(html,/href="\/go\/longevity/); // No mintable /go route is claimed by this direct-link authority.
  }
 }
});
delete basis.therapeutic_taxonomy;delete basis.provider_dynamic_profiles;delete basis.consumer_therapeutic_authorities;
test('existing HOLD declaration preserves the exact frozen pricing oracle',()=>assert.equal(stableSha256(restoreGoOnlyPriceBasis(basis)),expected));
for(const [name,edit] of [
 ['price',p=>p.profiles['glp-clinic-scout'].data_profile.has_price=true],
 ['exception',p=>p.profiles['glp-clinic-scout'].exceptions.go.reason='invented'],
 ['go-live',p=>p.profiles['glp-clinic-scout'].surfaces.go=true],
 ['quiz',p=>p.profiles['glp-clinic-scout'].surfaces.quiz=false],
 ['identity',p=>p.display_name='Different'],
 ['commercial',p=>p.commercial_state='held'],
 ['route',p=>p.go.route='/go/different'],
])test(`held projection refuses unrelated ${name} drift`,()=>{
 const b=structuredClone(basis);edit(b.programs.find(p=>p.program_id==='longevity-meds-glp-1-review'));
 try{assert.notEqual(stableSha256(restoreGoOnlyPriceBasis(b)),expected);}catch(error){if(error.code==='ERR_ASSERTION')throw error;assert.match(error.message,/go_price_basis_/);}
});
test('Strut safety warning and source-bound copy survive source repair',()=>{
 const rows=JSON.parse(readFileSync(new URL('../data/provider-page-contracts.json',import.meta.url))).providers;
 const strut=rows.find(p=>p.program_id==='strut-health');assert.match(strut.page_copy.bottom_line,/FDA's February 20, 2026 warning letter/);assert.match(strut.page_copy.bottom_line,/7 business days after approval before 2-Day delivery/);
 assert.doesNotMatch(strut.page_copy.pricing,/\$199/);assert.match(strut.page_copy.regulatory_warning,/FDA sent Strut Health/);
});
