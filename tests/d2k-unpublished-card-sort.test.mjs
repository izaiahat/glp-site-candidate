import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildPhase3PageGraph} from '../src/phase3-page-graph.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const runtime=fs.readFileSync(new URL('../assets/site.js',import.meta.url),'utf8');
const start=runtime.indexOf('    const activePrice = (card, drug) => {');
const end=runtime.indexOf('    const apply = ',start);assert(start>=0&&end>start);
const code=runtime.slice(start,end)+'\nresult = {activePrice, sortCards};';
function sorting(cards,sort){const ctx={cards,selected:{sort},normalizeGroupValue:(_key,v)=>v,quizMatches:new Set(),initialOrder:new Map(cards.map((c,i)=>[c,i]))};vm.runInNewContext(code,ctx);return ctx.result;}
const card=(program,price,priceMap='')=>({dataset:{program,price,priceMap}});
test('D2k actual runtime keeps missing and invalid prices last and stable in both price directions',()=>{
 const cards=[card('unknown-a','unknown'),card('higher','200'),card('empty',''),card('free','0'),card('lower','100'),card('unknown-b','NaN'),card('negative','-1')];
 for(const [sort,expected] of [['cheapest',['free','lower','higher','unknown-a','empty','unknown-b','negative']],['price-high',['higher','lower','free','unknown-a','empty','unknown-b','negative']]]){
  const api=sorting(cards,sort);assert.deepEqual(Array.from(api.sortCards('all'),c=>c.dataset.program),expected);
  for(const c of [cards[0],cards[2],cards[5],cards[6]])assert.equal(api.activePrice(c,'all'),Infinity);
 }
});
test('D2k actual runtime rejects blank map values and preserves zero and treatment-specific cash',()=>{
 const api=sorting([],'cheapest');
 assert.equal(api.activePrice(card('blank','', 'SEMAGLUTIDE:'),'SEMAGLUTIDE'),Infinity);
 assert.equal(api.activePrice(card('zero','', 'SEMAGLUTIDE:0'),'SEMAGLUTIDE'),0);
 assert.equal(api.activePrice(card('priced','99','SEMAGLUTIDE:150|TIRZEPATIDE:250'),'TIRZEPATIDE'),250);
 assert.equal(api.activePrice(card('missing','','{}'),'all'),Infinity);
});
test('D2k equal prices and all-unknown cards preserve original order',()=>{
 for(const sort of ['cheapest','price-high'])for(const cards of [[card('b',''),card('a','')],[card('b','100'),card('a','100')]])assert.deepEqual(Array.from(sorting(cards,sort).sortCards('all'),c=>c.dataset.program),['b','a']);
});
const articles=['data/blog/content-batch.json','data/blog/content-national-wow-additions.json'].flatMap(p=>read(p).articles).filter(a=>a.canonical_path.startsWith('/guides/')&&!/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(a.canonical_path));
test('D2k every freshly rendered unpublished card has empty numeric sentinel and real aurora',()=>{
 const built=buildPhase3PageGraph({graph:read('data/phase3-page-graph.json'),pharmacyInput:read('data/phase3-pharmacy-render-input.json'),pricingMatrix:read('data/provider-pricing-matrix.json'),programRegistry:read('data/program-registry.json'),homeSpec:{rows:[]},articles,couponOffersByProgram:{}});
 const cards=built.pages.flatMap(p=>[...p.html.matchAll(/<article\b[^>]*data-unpublished-price-card[^>]*>[\s\S]*?<\/article>/g)].map(m=>m[0]));assert(cards.length>0);
 for(const html of cards){assert.match(html,/data-price=""/);assert.match(html,/data-price-map=""/);assert.match(html,/<div class="p3-card-aurora" aria-hidden="true"><\/div>/);assert.match(html,/<small>No comparable published price\.<\/small>/);assert.doesNotMatch(html,/No comparable price in our capture/);assert.doesNotMatch(html,/data-price="(?:unknown|NaN|Infinity)"/);}
});

test('listing lead-in precedes commercial content while the full below-grid disclosure stays intact',()=>{
 const built=buildPhase3PageGraph({graph:read('data/phase3-page-graph.json'),pharmacyInput:read('data/phase3-pharmacy-render-input.json'),pricingMatrix:read('data/provider-pricing-matrix.json'),programRegistry:read('data/program-registry.json'),homeSpec:{rows:[]},articles,couponOffersByProgram:{}});
 const listings=built.pages.filter(p=>/data-listing-archetype="[ABCE]"/.test(p.html));
 assert(listings.length>0);
 const canonical='<aside class="p3-source-disclosure affiliate-note table-disclosure"><strong>How these links work.</strong> Price-source links go directly to the provider page Clinic Scout checked, not through an affiliate redirect. Separately marked sponsored links may earn Clinic Scout a commission. Check the ordering method stated for each comparison; payment is not evidence of quality, safety or medical suitability.</aside>';
 for(const page of listings){
  const body=page.html.slice(page.html.indexOf('<body'));
  const lead=body.match(/<p class="listing__disclosure-lead affiliate-note">([^<]+)<\/p>/);
  assert(lead,`${page.route}: visible lead-in text is server-rendered`);
  assert.equal(lead[1],'We may earn a commission from sponsored links.');
  assert.equal(body.split(lead[0]).length-1,1,page.route);
  for(const marker of [/\$\s?\d/,/rel="sponsored/,/data-analytics-event="affiliate_click"/]){
   const at=body.search(marker);assert(at<0||lead.index<at,`${page.route}: lead-in before ${marker}`);
  }
  assert.equal(body.split(canonical).length-1,1,`${page.route}: full disclosure unchanged`);
  assert(body.indexOf(canonical)>body.indexOf('id="provider-results"'),`${page.route}: canonical disclosure remains below grid`);
 }
});

test('unpublished cards retain source facets for runtime filtering without inventing prices',()=>{
 const built=buildPhase3PageGraph({graph:read('data/phase3-page-graph.json'),pharmacyInput:read('data/phase3-pharmacy-render-input.json'),pricingMatrix:read('data/provider-pricing-matrix.json'),programRegistry:read('data/program-registry.json'),homeSpec:{rows:[]},articles,couponOffersByProgram:{}});
 const cards=built.pages.flatMap(p=>[...p.html.matchAll(/<article\b[^>]*data-unpublished-price-card[^>]*>/g)].map(m=>m[0]));
 assert(cards.length>0);
 for(const html of cards){
  assert.match(html,/data-medications="[^"]+"/);
  assert.match(html,/data-drugs="[A-Z_ ]+"/);
  assert.match(html,/data-forms="(?:COMPOUNDED|BRAND_NAME)(?: (?:COMPOUNDED|BRAND_NAME))*"/);
  assert.match(html,/data-duration="(?:unknown|[0-9 ]+)"/);
  assert.match(html,/data-price=""/);
 }
});
