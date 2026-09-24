import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPhase3PageGraph } from '../src/phase3-page-graph.mjs';
import { deriveIdentityGroups } from '../src/provider-identity.mjs';
const read = rel => JSON.parse(readFileSync(new URL('../'+rel, import.meta.url)));
const graph=read('data/phase3-page-graph.json'), registry=read('data/program-registry.json');
const ledger=read('data/program-content-ledger.json');
const articles=['content-batch.json','content-national-wow-additions.json'].flatMap(file=>read('data/blog/'+file).articles).filter(a=>a.canonical_path.startsWith('/guides/')&&!/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(a.canonical_path));
const built=buildPhase3PageGraph({graph,programRegistry:registry,pharmacyInput:read('data/phase3-pharmacy-render-input.json'),pricingMatrix:read('data/provider-pricing-matrix.json'),homeSpec:{rows:[]},articles});
const {aliasIds}=deriveIdentityGroups(registry,'glp-clinic-scout',ledger.programs);
const roster=med=>registry.programs.filter(p=>{
 const profile=p.profiles?.['glp-clinic-scout'],tax=registry.therapeutic_taxonomy.programs[p.review_slug||p.program_id];
 return p.commercial_state==='live'&&profile?.vertical_fit===true&&profile?.wired===true&&profile?.surfaces?.review===true&&!aliasIds.has(p.program_id)&&!(/fella/i.test(p.program_id+' '+p.display_name))&&tax?.commercial_link_state?.compare==='live'&&tax.molecule_tags.includes(med)&&tax.treatment_type_tags.includes('compounded');
}).sort((a,b)=>a.display_name.localeCompare(b.display_name)||a.program_id.localeCompare(b.program_id));
for(const med of ['semaglutide','tirzepatide']){
 test(`${med}: organic page exists with self canonical and indexable robots`,()=>{
  const page=built.pages.find(p=>p.route===`/${med}/`);assert.ok(page,'organic page missing');
  assert.match(page.html,new RegExp(`<link rel="canonical" href="https://glpclinicscout.com/${med}/">`));
  assert.match(page.html,/<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.ok(built.indexableRoutes.includes(`/${med}/`));assert.match(page.html,/<h1[ >]/);
 });
 test(`${med}: full current live roster in each responsive representation`,()=>{
  const html=built.pages.find(p=>p.route===`/${med}/`)?.html||'';
  const ids=[...html.matchAll(/data-g08-provider-id="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids,[...roster(med).map(p=>p.program_id),...roster(med).map(p=>p.program_id)]);
  for(const p of roster(med))assert.ok(html.includes(`href="${p.review_path}"`),p.program_id);
  assert.ok(!ids.includes('measured'));assert.ok(!ids.some(id=>/fella/i.test(id)));
 });
 test(`${med}: visible caveat, disclosure and organic navigation`,()=>{
  const html=built.pages.find(p=>p.route===`/${med}/`)?.html||'';
  assert.ok(html.includes('Compounded drugs are not FDA approved, and FDA does not premarket-review them for safety, effectiveness, or quality.'));
  assert.ok(html.includes('How these links work.'));
  for(const path of ['/providers/','/quiz/provider-fit/','/how-we-rate/','/editorial-guidelines/','/how-we-make-money/',med==='semaglutide'?'/tirzepatide/':'/semaglutide/'])assert.ok(html.includes(`href="${path}"`),path);
  assert.doesNotMatch(html,/Commissions never change|\/home\/ubuntu|\{\{LIVE_PROVIDER_COUNT\}\}|data-price="/);
 });
 test(`${med}: organic redirect retired while paid page contract remains`,()=>{
  assert.ok(!built.redirects.some(([from])=>from===`/${med}/`));
  const paid=built.pages.find(p=>p.route===`/lp/best-providers/compounded-${med}/`);assert.ok(paid);
  assert.match(paid.html,/<meta name="robots" content="noindex/);
  assert.ok(!built.indexableRoutes.includes(paid.route));
 });
}
test('both category owners have incoming provider-hub links',()=>{
 const html=built.pages.find(p=>p.route==='/providers/').html;
 for(const med of ['semaglutide','tirzepatide'])assert.ok(html.includes(`href="/${med}/"`));
});
test('route count grows through graph config without losing existing families',()=>{
 assert.equal(built.pages.length,graph.expected_indexable_routes);
 assert.equal(new Set(built.pages.map(p=>p.route)).size,built.pages.length);
 assert.ok(built.redirects.some(([from,to])=>from==='/cost/'&&to==='/providers/'));
});
