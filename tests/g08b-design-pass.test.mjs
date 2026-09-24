import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {buildPhase3PageGraph} from '../src/phase3-page-graph.mjs';
import * as category from '../src/compounded-category.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const registry=read('data/program-registry.json'),pricing=read('data/provider-pricing-matrix.json');
const args={graph:read('data/phase3-page-graph.json'),programRegistry:registry,pharmacyInput:read('data/phase3-pharmacy-render-input.json'),pricingMatrix:pricing,homeSpec:{rows:[]},articles:['content-batch.json','content-national-wow-additions.json'].flatMap(p=>read('data/blog/'+p).articles).filter(a=>a.canonical_path.startsWith('/guides/')&&!/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(a.canonical_path))};
const built=buildPhase3PageGraph(args);
const text=html=>html.replace(/<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
for(const med of ['semaglutide','tirzepatide']){
 const html=built.pages.find(p=>p.route==='/'+med+'/').html;
 test(`G08b ${med}: hero first, compact disclosure after, FDA first inside directory before prices`,()=>{
  assert(html.indexOf('<h1')<html.indexOf('How these links work.'));
  assert.match(html,/<section id="g08-directory">\s*<p class="g08-caveat">/);
  assert(html.indexOf('class="g08-caveat"')<html.indexOf('data-price-row-id'));
  const notices=[...html.matchAll(/<aside\b[^>]*\sclass="([^"]*)"[^>]*>([\s\S]*?)<\/aside>/g)].filter(([,classes])=>classes.split(/[\t\n\f\r ]+/).includes('g08-links-note'));
  assert.equal(notices.length,1);
  assert.match(notices[0][2],/How these links work\./);
  assert(html.indexOf('<h1')<html.indexOf(notices[0][0]));
  assert(html.indexOf(notices[0][0])<html.indexOf('data-price-row-id'));
 });
 test(`G08b ${med}: reader language, labeled dates and sources`,()=>{
  assert.doesNotMatch(text(html),/\bUNKNOWN\b|taxonomy|registry|\bpacket\b|\bS(?:4|11)\b|patient availability|https?:\/\/|\d{4}-\d\d-\d\dT\d\d:/i);
  assert.match(html,/Provider terms, checked \d{1,2} [A-Z][a-z]{2} \d{4}/);
  assert.match(html,/FDA concerns about unapproved GLP-1 drugs, checked/);assert.match(html,/Next question/);
  if(med==='tirzepatide')assert.match(html,/FDA compounding questions and answers, checked/);
 });
 test(`G08b ${med}: one quiz primary and secondary terms link`,()=>{
  const hero=html.match(/<section class="g08-hero">[\s\S]*?<\/section>/)[0];
  const primary=[...hero.matchAll(/<a\b[^>]*class="[^"]*cs-palette-action[^"]*"[^>]*>/g)].map(m=>m[0]);assert.equal(primary.length,1);assert.match(primary[0],/href="\/quiz\/provider-fit\/"/);
  const entries=[...html.matchAll(/<(tr|article) data-g08-provider-id="[^"]+"[^>]*>([\s\S]*?)<\/\1>/g)];assert(entries.length>0);
  for(const entry of entries)assert.equal((entry[2].match(/data-g08-primary/g)||[]).length,1);
  assert.match(html,/<a href="#g08-directory">Compare program terms<\/a>/);
 });
 test(`G08b ${med}: every price has a single summary with kind, limitations and dated source`,()=>{
  const sections=[...html.matchAll(/<section class="typed-price"[^>]*>[\s\S]*?<\/section>/g)].map(m=>m[0]);assert(sections.length>0);
  for(const s of sections){assert.equal((s.match(/data-g08-price-line/g)||[]).length,1);assert.match(s,/data-typed-price-kind/);assert.match(s,/reported <time datetime="\d{4}-\d\d-\d\d">/);assert.match(s,/g08-price-limitations/);assert.match(s,/data-citation="first_party_price_evidence"/);assert.doesNotMatch(s,/blockquote|Monthly\$|complete first debit UNKNOWN/);}
 });
}
test('G08b count follows a real registry eligibility removal, not a literal',()=>{
 const changed=structuredClone(args);const p=changed.programRegistry.programs.find(p=>p.commercial_state==='live'&&p.profiles?.['glp-clinic-scout']?.wired&&p.profiles?.['glp-clinic-scout']?.surfaces?.review&&changed.programRegistry.therapeutic_taxonomy.programs[p.review_slug||p.program_id]?.molecule_tags?.includes('semaglutide')&&changed.programRegistry.therapeutic_taxonomy.programs[p.review_slug||p.program_id]?.treatment_type_tags?.includes('compounded'));
 assert(p);const programs=registry.programs;const before=category.renderCompoundedCategoryBody({medication:'semaglutide',programs,pricingMatrix:pricing,registry});
 const after=category.renderCompoundedCategoryBody({medication:'semaglutide',programs:programs.filter(x=>x.program_id!==p.program_id),pricingMatrix:pricing,registry});
 assert.equal(Number(after.match(/data-g08-category-count="(\d+)"/)[1]),Number(before.match(/data-g08-category-count="(\d+)"/)[1])-1);
});
test('G08b compact label preserves billing interval and does not repeat monthly cash schedule',()=>{
 const rows=Object.values(pricing.providers).flatMap(p=>p.medications).filter(r=>r.price_kind==='monthly_cash');assert(rows.length);
 for(const r of rows){const html=category.renderCategoryPrice(r);const line=html.match(/data-g08-price-line[^>]*>([\s\S]*?)<\/p>/)[1];assert.equal((line.match(/\$/g)||[]).length,1);assert(!line.includes(r.facts.cash_schedule.value));if(r.facts.terms_charge_interval)assert(line.includes('every 30 days'));}
});
test('G08b typed kinds preserve floors, bundles, equivalents and missing amounts without arithmetic',()=>{
 const rows=Object.values(pricing.providers).flatMap(p=>p.medications).filter(r=>r.price_kind);
 for(const r of rows){
  const html=category.renderCategoryPrice(r),visible=text(html);
  assert.match(html,new RegExp('data-typed-price-kind="'+r.price_kind+'"'));
  if(r.price_kind==='floor_from')assert.match(visible,/From \$.*advertised starting price/);
  if(r.price_kind==='prepaid_bundle')assert.match(visible,/prepaid bundle/);
  if(r.price_kind==='monthly_equivalent_of_billing_period'){
   assert.match(visible,/equivalent · billed/);
   if(r.facts.amount_usd.value==='UNKNOWN')assert.match(visible,/full billed amount (?:is )?not stated/i);
  }
  assert.match(visible,/Total initial and renewal charges/);
  assert.doesNotMatch(visible,/\bUNKNOWN\b|https?:\/\/|\d{4}-\d\d-\d\dT/);
 }
});
test('G08b compact price refuses an unbound or malformed price',()=>{
 const original=Object.values(pricing.providers).flatMap(p=>p.medications).find(r=>r.price_kind==='monthly_cash');
 const unbound=structuredClone(original);unbound.evidence=[];unbound.identity_evidence=[];for(const f of Object.values(unbound.facts))f.evidence=[];
 assert.throws(()=>category.renderCategoryPrice(unbound),/category_price_evidence_missing/);
 const invalid=structuredClone(original);invalid.facts.amount_usd.value=-1;
 assert.throws(()=>category.renderCategoryPrice(invalid),/typed_price_amount_invalid/);
});
test('G08b refreshed same plan does not also claim its predecessor price is missing',()=>{
 const original=category.renderCompoundedCategoryBody({medication:'semaglutide',programs:registry.programs,pricingMatrix:pricing,registry});
 assert.doesNotMatch(original,/data-g08-unpriced-row-id="try-ageless:0:compounded-semaglutide-injection"/);
 const tirzepatide=category.renderCompoundedCategoryBody({medication:'tirzepatide',programs:registry.programs,pricingMatrix:pricing,registry});
 assert.doesNotMatch(tirzepatide,/data-g08-unpriced-row-id="try-ageless:[12]:compounded-tirzepatide-(?:injection|oral)"/);
 const changed=structuredClone(pricing);
 changed.providers['try-ageless'].medications.find(r=>r.medication_id==='compounded-semaglutide-injection').plan_label='A genuinely different plan';
 const different=category.renderCompoundedCategoryBody({medication:'semaglutide',programs:registry.programs,pricingMatrix:changed,registry});
 assert.match(different,/data-g08-unpriced-row-id="try-ageless:0:compounded-semaglutide-injection"/);
});
