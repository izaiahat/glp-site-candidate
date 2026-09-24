import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {projectMoneyPagesFromRegistry,projectQuizFromRegistry,deriveProfileSurfaceSets} from '../src/program-registry.mjs';
import {projectTherapeuticSurfaces} from '../src/therapeutic-taxonomy.mjs';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {historicalPriceIndexRegistry} from '../src/price-index-historical-registry.mjs';
import {buildPriceIndexArtifacts,normalizePriceIndexSourceHashes} from '../src/price-index.mjs';
import {assertTalliesDerived,isTallyGatedRoute} from '../src/surface-tallies.mjs';
import {inheritedDisclosureDates} from '../src/inherited-disclosure-dates.mjs';
import {resolveCatalogDate,resolveMaterialDate,resolveRouteLastmod} from '../scripts/postbuild-aeo-surface.mjs';
import {buildProviderReviewSpecs,renderProviderReviewPage} from '../src/provider-review.mjs';
import {buildPhase3PageGraph} from '../src/phase3-page-graph.mjs';
import {sourceDisplayPacket,projectProviderDisplayLedger,projectProviderDisplayFacts} from '../src/provider-display-evidence.mjs';
const root=new URL('../',import.meta.url),bytes=n=>readFileSync(new URL('data/'+n,root)),read=n=>JSON.parse(bytes(n)),sha=b=>createHash('sha256').update(b).digest('hex');
const registry=read('program-registry.json'),money=read('money-page-specs.json'),quiz=read('quiz-config.json'),ledger=read('program-content-ledger.json'),profile='glp-clinic-scout';
const frozen=frozenPriceLedger(bytes('program-content-ledger.json'),bytes('price-index-frozen-content-ledger.json'),read('price-index-nonprice-binding.json'));
const bad=/Delivery in as little as 1 hour|\$129 for the weight-loss panel|Weight-loss blood work is an additional \$129|\$129 weight-loss panel/;
const latest=read('price-tracker.json').price_index.observations.at(-1).observed_on;
function priceInput(){return {tracker:read('price-tracker.json'),study:read('original-data-study.json'),programRegistry:registry,contentLedger:frozen.ledger,sourceHashes:normalizePriceIndexSourceHashes(registry,{original_data_study_sha256:sha(bytes('original-data-study.json')),program_content_ledger_sha256:frozen.frozen_sha256,program_registry_sha256:sha(bytes('program-registry.json'))})};}
// Rebuild 1 ruling (S9-2): the receipted hold stays a DARK ROW in the raw money
// source. The installed held-aware census requires the row to be present and
// projects it off; a missing held row is itself a fail-closed sensor failure.
// The taxonomy expectation is therefore surface-scoped, exactly like the quiz
// pool, and only for a row the registry proves is held, unwired and scoped off.
test('S9-2 held money rows stay dark in source and the required taxonomy stays fail-closed',()=>{
 const asOf=[registry.provider_dynamic_profiles.sealed_as_of,registry.therapeutic_taxonomy.sealed_as_of].sort().at(-1)+'T12:00:00Z';
 const required=money.pages.filter(p=>registry.therapeutic_taxonomy.required_surface_paths.includes(p.path));
 assert.equal(required.length,3);
 for(const p of required){
  const held=p.rows.find(r=>r.program_id==='telos-rx');
  assert.ok(held,p.path+': the receipted hold must remain a source row');
  assert.equal(held.live_link_allowed,false);assert.equal(held.promotion_authorized,false);
  assert.equal(held.affiliate_href??null,null);
 }
 const projected=projectTherapeuticSurfaces({registry,profileId:profile,pages:money.pages,quizConfig:quiz,asOf});
 assert.equal(projected.includeProgramIds.length,57);
 assert.ok(!projected.includeProgramIds.includes('telos-rx'));
 // an id the registry does not prove scoped-off still fails closed
 const forged=structuredClone(money.pages);
 forged.find(p=>registry.therapeutic_taxonomy.required_surface_paths.includes(p.path)).rows.push({program_id:'not-a-program',live_link_allowed:false,promotion_authorized:false});
 assert.throws(()=>projectTherapeuticSurfaces({registry,profileId:profile,pages:forged,quizConfig:quiz,asOf}),/surface_membership_mismatch/);
 // and a held row promoted onto a conversion surface stops being scoped-off
 const promoted=structuredClone(registry);
 promoted.programs.find(p=>p.program_id==='telos-rx').profiles[profile].surfaces.compare=true;
 assert.throws(()=>projectTherapeuticSurfaces({registry:promoted,profileId:profile,pages:money.pages,quizConfig:quiz,asOf}),/surface_membership_mismatch|dynamic_profile|taxonomy/);
});
// Rebuild 1 ruling (S9-5): quiz-config keeps the receipted held candidate as a
// dark row (the documented in-tree surface_restriction pattern, and what the
// installed census requires). The BUILT quiz drops it, and the owner projection
// is what removes it - the raw config is deliberately not regenerated.
test('S9-5 quiz source keeps the held candidate dark while the owner projection drops it',()=>{
 assert.equal(quiz.candidates.length,59);assert.equal(quiz.golden_vectors.length,8);
 for(const r of quiz.candidates)assert.equal(r.live_link_allowed,false);
 const held=quiz.candidates.find(r=>r.program_id==='telos-rx');
 assert.ok(held,'the receipted hold must remain a source candidate');
 assert.equal(registry.programs.find(p=>p.program_id==='telos-rx').profiles[profile].surfaces.quiz,false);
 const owner=projectQuizFromRegistry(registry,profile,quiz);
 assert.ok(!owner.candidates.some(r=>r.program_id==='telos-rx'),'the owner projection drops the scoped-off row');
 const projected=projectQuizFromRegistry(registry,profile,quiz,ledger);for(const id of ['drhouse','trt-nation'])assert.doesNotMatch(JSON.stringify(projected.candidates.find(p=>p.program_id===id)),bad);
});
test('S9-7 alias declares no page; exact price reconstruction preserves complete oracle',()=>{
 const a=registry.programs.find(p=>p.program_id==='telos-rx-review');assert.ok(!Object.hasOwn(a,'review_path'));assert.equal(a.commercial_state,'held');assert.equal(a.profiles[profile].wired,false);assert.ok(Object.values(a.profiles[profile].surfaces).every(x=>x===false));
 assert.ok(!deriveProfileSurfaceSets(registry,profile).review.has(a.program_id));
 const before=structuredClone(registry),historical=historicalPriceIndexRegistry(registry,frozen.ledger);assert.deepEqual(registry,before);assert.ok(!historical.programs.some(p=>p.program_id===a.program_id));assert.equal(historical.programs.find(p=>p.program_id==='telos-rx').commercial_state,'live');
});
for(const [name,edit] of [['live',a=>a.commercial_state='live'],['wired',a=>a.profiles[profile].wired=true],['review surface',a=>a.profiles[profile].surfaces.review=true],['wrong path',a=>a.review_path='/reviews/forged/'],['identity',a=>a.display_name='Forged'],['go',a=>a.go.entry_state='server_redirect']])test('S9-7 alias descendant refuses '+name,()=>{const r=structuredClone(registry);edit(r.programs.find(p=>p.program_id==='telos-rx-review'));assert.throws(()=>historicalPriceIndexRegistry(r,frozen.ledger));});
test('S9-3 actual observer is same-day idempotent with the authenticated frozen ledger',()=>{
 const files=['price-tracker.json','program-content-ledger.json','price-index-frozen-content-ledger.json','price-index-nonprice-binding.json'],before=files.map(n=>sha(bytes(n)));
 const run=spawnSync(process.execPath,['scripts/update-price-index.mjs','--observed-on',latest],{cwd:root,encoding:'utf8'});assert.equal(run.status,0,run.stderr);const r=JSON.parse(run.stdout);assert.equal(r.status,'UNCHANGED_ALREADY_OBSERVED');assert.equal(r.source_files.program_content_ledger_sha256,frozen.frozen_sha256);assert.deepEqual(files.map(n=>sha(bytes(n))),before);
});
test('S9-11 price owner emits live tally token while historical observations and metrics remain unchanged',()=>{
 const input=priceInput(),before=structuredClone(input),built=buildPriceIndexArtifacts(input,{now:latest+'T23:59:59Z'});assert.deepEqual(input,before);assert.equal(built.manifest.live_provider_count,58);assert.equal(built.manifest.metrics.length,2);
 // Four reader-visible provider totals now derive from the token: the latest-
 // observation aside, both metric cards, and the methodology provider universe.
 assert.equal((built.html.match(/\{\{LIVE_PROVIDER_COUNT\}\}/g)||[]).length,5);assert.doesNotMatch(built.html,/of 58 live providers/);assert.doesNotMatch(built.html,/58 live/);assert.ok(built.html.includes('Historical provider sample: 17'));assert.ok(built.html.includes('Historical provider sample: 18'));
 assert.equal(isTallyGatedRoute('glp-1-price-index/index.html'),true);
 const derived={LIVE_PROVIDER_COUNT:57,COMPARISON_PAGE_COUNT:12,RESEARCH_GUIDE_COUNT:1},html=built.html.replace(/<aside class="panel" data-price-state-disclosure>[\s\S]*?<\/aside>/,'').replaceAll('{{LIVE_PROVIDER_COUNT}}','57');assertTalliesDerived('glp-1-price-index/index.html',html,derived);assert.throws(()=>assertTalliesDerived('glp-1-price-index/index.html',html.replaceAll('57 live providers','58 live providers'),derived),/surface_tally_not_derived/);
});
test('S9-4 exact D2p evidence restores sitemap date without moving article freshness or waiving provenance',()=>{
 const route='/guides/mounjaro-coupon/',article=read('blog/content-batch.json').articles.find(a=>a.canonical_path===route),d=inheritedDisclosureDates(route,article);assert.equal(d.lastmod,'2026-09-09');assert.equal(d.editorialDate,article.updated_at);assert.equal(d.editorialDate,'2026-08-29');
 const base=resolveRouteLastmod({route,hash:'same',recorded:{content_sha256:'same',lastmod:article.updated_at},releaseDate:'2026-09-10'}),owned=resolveCatalogDate(route,article,article.updated_at,base,d.lastmod,'2026-09-10');assert.equal(resolveMaterialDate(route,d.lastmod,owned,'2026-09-10').lastmod,'2026-09-09');
 assert.throws(()=>resolveRouteLastmod({route,hash:'changed',recorded:{content_sha256:'old',lastmod:article.updated_at},releaseDate:'2026-09-10'}),/provenance_stale/);assert.equal(inheritedDisclosureDates('/unrelated/',null),null);assert.throws(()=>inheritedDisclosureDates(route,article,()=>Buffer.from('{}')),/hash_mismatch/);assert.throws(()=>inheritedDisclosureDates(route,{...article,updated_at:'2026-09-10'}),/editorial_source_changed/);
});
for(const id of ['drhouse','trt-nation'])test('S9 notes: '+id+' active duplicates and actual review renderer omit unsupported literals',()=>{
 const contracts=read('provider-page-contracts.json'),contract=contracts.providers.find(p=>p.program_id===id);assert.doesNotMatch(JSON.stringify(contract.row_contract),bad);for(const p of money.pages)for(const r of p.rows.filter(r=>r.program_id===id))assert.doesNotMatch(JSON.stringify(r),bad);
 const reviews=buildProviderReviewSpecs(money.pages,contracts,read('provider-fastpath-contract.json'),registry,profile,ledger.programs),review=reviews.find(r=>r.program_id===id),html=renderProviderReviewPage(review,read('identity-registry.json'));assert.doesNotMatch(html,bad);
 if(id==='drhouse'){assert.match(html,/5-10 business days/);assert.match(html,/1–2 hours/);assert.match(html,/not medication delivery time/);assert.match(html,/paid visits are credited/);assert.match(html,/care-provided and other exclusions/);assert.doesNotMatch(contract.page_copy.cancellation,/100%/);}
 const raw=ledger.programs.find(p=>p.program_id===id),before=structuredClone(raw),view=projectProviderDisplayLedger(raw);assert.deepEqual(raw,before);assert.doesNotMatch(JSON.stringify({limitations:view.limitations,shipping:view.research_shipping_wait.value,consult:view.research_consultation_fee.value}),bad);
 const facts=read('provider-facts-backfill-20260830.json').programs.find(p=>p.program_id===id),factsBefore=structuredClone(facts),display=projectProviderDisplayFacts(facts);assert.deepEqual(facts,factsBefore);assert.doesNotMatch(JSON.stringify(display),bad);
 assert.throws(()=>sourceDisplayPacket(id,()=>Buffer.from('{}')),/packet_hash_mismatch/);
});
test('S9 notes: actual Phase3 in-memory provider pages and lazy payload sources are corrected without public writes',()=>{
 const articles=['blog/content-batch.json','blog/content-national-wow-additions.json'].flatMap(n=>read(n).articles).filter(a=>a.canonical_path.startsWith('/guides/')&&!/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(a.canonical_path));
 const built=buildPhase3PageGraph({graph:read('phase3-page-graph.json'),pharmacyInput:read('phase3-pharmacy-render-input.json'),pricingMatrix:read('provider-pricing-matrix.json'),programRegistry:registry,homeSpec:{rows:[]},articles});
 for(const route of ['/providers/drhouse/','/providers/trt-nation/','/providers/','/self-pay/']){const p=built.pages.find(p=>p.route===route);assert.ok(p,route);assert.doesNotMatch(p.html,bad,route);}
 assert.match(built.pages.find(p=>p.route==='/providers/drhouse/').html,/5-10 business days/);
});
