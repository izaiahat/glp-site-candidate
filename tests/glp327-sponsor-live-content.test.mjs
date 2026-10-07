import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as pricing from '../src/sponsor-pricing.mjs';
import {sponsorContentFixture} from './fixtures/sponsor-content.mjs';

// Node's isolated test-process module mock ONLY. No production switch or injected verifier.
mock.module('../src/sponsor-pricing.mjs', {namedExports:{...pricing,paymentVerified:order=>order.order_reference==='SYNTHETIC-NOT-A-PAYMENT'}});
const {renderPromo} = await import('../src/paid-promo.mjs');
const {renderSponsoredPanel} = await import('../src/sponsor-placement-candidate.mjs');
const {validateSponsorOrder} = await import('../src/sponsor-order.mjs');
const {renderConfiguredListing,phase3Registry,loadPass2DoseCapture,loadProviderLogoManifest} = await import('../src/phase3-page-graph.mjs');

test('A2 affiliate status requires explicit booleans and equal commission disclosures across surfaces',async()=>{
 const {renderSponsorInventory} = await import('../src/sponsor-inventory.mjs');
 const disclosure=html=>html.match(/Paid for by Synthetic Fixture Provider\.(?: We may also earn a commission if you use this link\.)?/)[0];
 for(const affiliate of [true,false]) {
  const inventory=sponsorContentFixture(),order=inventory.orders[0];order.affiliate=affiliate;
  assert.equal(validateSponsorOrder(order),order);
  const selected=renderSponsorInventory(inventory);
  const promo=selected.pages['sponsors/synthetic-fixture-provider/index.html'];
  const panel=renderSponsoredPanel({...selected.order,preview:false});
  const expected=`Paid for by Synthetic Fixture Provider.${affiliate?' We may also earn a commission if you use this link.':''}`;
  assert.equal(disclosure(panel),expected);
  assert.equal(disclosure(promo),expected);
  for(const html of [panel,promo]) assert.equal(html.includes('We may also earn a commission'),affiliate);
  assert.equal(pricing.paymentVerified(order),false,'synthetic controls are not real payment evidence');
 }
 for(const [name,value] of [['missing',undefined],['null',null],['string true','true'],['string false','false']]) {
  const inventory=sponsorContentFixture(),order=inventory.orders[0];
  if(value===undefined) delete order.affiliate;else order.affiliate=value;
  for(const [surface,render] of [
   ['validator',()=>validateSponsorOrder(order)],['inventory',()=>renderSponsorInventory(inventory)],
   ['directory panel',()=>renderSponsoredPanel({...order,preview:false})],['promo',()=>renderPromo(order,{preview:false})]
  ]) assert.throws(render,/Explicit boolean affiliate status required/,`${surface} must reject ${name}`);
 }
});

test('A2 exact reviewed inventory renders all factual slots on the page and directory; real unpaid inventory stays absent',async()=>{
 const inventory=sponsorContentFixture(), order=inventory.orders[0];
 assert.match(renderPromo(order,{preview:false}),/Synthetic price: \$123 monthly; medication excluded\./,'approved factual slots must not disappear in nonpreview');
 const {renderSponsorInventory} = await import('../src/sponsor-inventory.mjs');
 const result=renderSponsorInventory(inventory);
 assert.equal(result.order.order_reference,order.order_reference);
 const promo=result.pages['sponsors/synthetic-fixture-provider/index.html'];
 const panel=renderSponsoredPanel({...order,preview:false});
 const json=f=>JSON.parse(readFileSync(new URL('../data/'+f,import.meta.url),'utf8'));
 const graph=json('phase3-page-graph.json'),programRegistry=json('program-registry.json');
 const renderDirectory=sponsorOrder=>renderConfiguredListing('E',{route:'/providers/',slug:'providers',name:'Compare providers'}, {
   graph,pharmacyInput:json('phase3-pharmacy-render-input.json'),pricingMatrix:json('provider-pricing-matrix.json'),registry:phase3Registry(graph,programRegistry),coupons:{},doseCapture:loadPass2DoseCapture(),logoManifest:loadProviderLogoManifest(),articles:[],sponsorOrder
 });
 const directory=renderDirectory(result.order);
 const tail=html=>html.slice(html.indexOf('<section id="provider-results"'));
 assert.equal(tail(directory),tail(renderDirectory(null)),'paid order cannot reorder or rewrite organic results');
 for(const html of [promo,panel,directory]) {
  for(const fact of Object.values(order.facts)) assert.ok(html.includes(fact.text.replaceAll('<','&lt;').replaceAll('>','&gt;')),fact.text);
  assert.match(html,/Sponsored/);assert.match(html,/Paid for by Synthetic Fixture Provider/);
  assert.match(html,/rel="sponsored nofollow noopener"/);assert.doesNotMatch(html,/<script>fixture/);
 }
 assert.match(promo,/data-sponsor-facts/);assert.match(promo,/Reported information/);
 assert.ok(directory.indexOf('data-sponsored-placement')<directory.indexOf('id="provider-results"'));
 assert.equal(pricing.paymentVerified(order),false,'unmocked payment authority rejects fictional test data');
 assert.deepEqual(renderSponsorInventory(json('sponsor-inventory.json')),{order:null,pages:{}});
 for(const change of [
  d=>d.selection.order_reference='WRONG',d=>d.orders.push({...order}),d=>d.selection.slot='OTHER',
  d=>d.orders[0].inventory_slot='OTHER',d=>d.orders[0].release_approved=false,
  d=>d.orders[0].operator_approval=false,d=>d.orders[0].partner_creative_approval=false,
  d=>d.orders[0].order_reference=d.selection.order_reference='UNPAID',
  d=>d.orders[0].facts.published_price=null,d=>d.orders[0].facts.current_offer.source_url='javascript:alert(1)',
  d=>d.orders[0].facts.eligibility_states.checked_at='2999-01-01',d=>d.orders[0].held=true,
  d=>d.orders[0].provider='Fella Health',d=>d.orders[0].ends_at=d.orders[0].starts_at
 ]) {const invalid=structuredClone(inventory);change(invalid);assert.throws(()=>renderSponsorInventory(invalid));}
 assert.throws(()=>renderSponsorInventory(inventory,{preview:true}),/preview/i);
 if(process.env.GLP327_FIXTURE_HTML_OUT) {
  // Explicit local browser fixture artifacts, outside public/ and not release-ready.
  const {addSharedRuntime,deriveLiveProviders,resolveDerivedCounts}=await import('../scripts/build-staging.mjs');
  const {projectProviderDisplayLedger}=await import('../src/provider-display-evidence.mjs');
  const {upgradePhase3PageVisuals}=await import('../src/pass2-page-visual-upgrades.mjs');
  const tallies={LIVE_PROVIDER_COUNT:deriveLiveProviders(programRegistry,structuredClone(json('program-content-ledger.json').programs).map(row=>projectProviderDisplayLedger(row))).liveProgramCount};
  const finalized=resolveDerivedCounts(addSharedRuntime(upgradePhase3PageVisuals(directory,{family:'providers-hub',route:'/providers/',graph,registry:programRegistry})),'providers/index.html',tallies);
  writeFileSync(process.env.GLP327_FIXTURE_HTML_OUT+'/promo.html',addSharedRuntime(promo));
  writeFileSync(process.env.GLP327_FIXTURE_HTML_OUT+'/directory.html',finalized);
 }
});
