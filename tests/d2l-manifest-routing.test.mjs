import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { completeGoAuthority } from './fixtures/complete-go-authority.mjs';
import { loadAffiliateLinkMap } from '../src/affiliate-link-map.mjs';
import {buildPhase3PageGraph} from '../src/phase3-page-graph.mjs';
import {parseGoQuery} from '../src/worker.mjs';
import {JSDOM} from 'jsdom';
import {resolveCardOutbound,approvedDirectCard} from '../src/card-outbound.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const fixture={programs:{}};
const args={graph:read('data/phase3-page-graph.json'),pharmacyInput:read('data/phase3-pharmacy-render-input.json'),pricingMatrix:read('data/provider-pricing-matrix.json'),programRegistry:read('data/program-registry.json'),homeSpec:{rows:[]},articles:['data/blog/content-batch.json','data/blog/content-national-wow-additions.json'].flatMap(p=>read(p).articles).filter(a=>a.canonical_path.startsWith('/guides/')&&!/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(a.canonical_path))};
const links=loadAffiliateLinkMap('compare');
for(const id of ['biltrx','orderlymeds']) {
 const program=args.programRegistry.programs.find(p=>(p.review_slug||p.program_id)===id);
 fixture.programs[program.program_id]=completeGoAuthority(program,links[id]);
}
const render=authority=>buildPhase3PageGraph({...args,goPromotionAuthority:authority}).pages;
const direct=render({programs:{}}),go=render(fixture),adopted=render(loadGoPromotionAuthority());
const anchors=(html,id)=>[...html.matchAll(/<a\b[^>]*data-analytics-event="affiliate_click"[^>]*>/g)].map(m=>m[0]).filter(a=>a.includes(`data-program="${id}"`));
const href=a=>a.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&');
for(const [route,id] of [['/mounjaro/','biltrx'],['/providers/','orderlymeds']])test(`D2l ${route} ${id} direct/verified states come only from injected promotion manifest`,()=>{
 const a=anchors(direct.find(p=>p.route===route).html,id),b=anchors(go.find(p=>p.route===route).html,id);
 if(route==='/providers/') {
  const selections=Object.values(loadGoSelection().programs).filter(p=>p.render_id===id);
  assert.equal(selections.length,1);const selected=selections[0];assert.equal(selected.status,'VERIFIED');
  assert.equal(selected.program_id,id);assert.equal(selected.route,`/go/${id}`);
  const ledger=read('data/go-terms-review-ledger.json'),terms=ledger.programs[id];
  assert(terms);assert.equal(terms.program_id,id);assert.equal(terms.risk_accepted,true);
  assert.equal(terms.scope,'first-party-redirect-and-documented-subids');
  assert.equal(terms.operator_selection_receipt_sha256,ledger.selection_sha256);
  assert.equal(typeof selected.issued_link,'string');assert.equal(typeof terms.tracking_base_url,'string');
  assert.equal(selected.issued_link,terms.tracking_base_url);assert.equal(links[id].affiliate_href,selected.issued_link);
  assert.equal(GO_RUNTIME_MANIFEST.programs[id].tracking.base_url,selected.issued_link);
  const allowed=new URL(terms.tracking_base_url);
  assert.equal(allowed.protocol,'https:');assert.equal(allowed.username,'');assert.equal(allowed.password,'');
  assert.equal(allowed.port,'');assert.equal(allowed.hash,'');
  const attr=(anchor,name)=>{
   const values=[...anchor.matchAll(new RegExp(`(?:^|\\s)${name}="([^"]*)"`,'g'))];
   assert.equal(values.length,1,`${id}:${name} must occur exactly once`);return values[0][1];
  };
  assert(a.length>0,id+' card absent');assert.equal(b.length,a.length);
  for(let i=0;i<a.length;i++){
   const directHref=attr(a[i],'href').replaceAll('&amp;','&'),goHref=attr(b[i],'href').replaceAll('&amp;','&');
   assert.equal(attr(a[i],'data-link-mode'),'transparent-direct');assert.equal(directHref,selected.issued_link);
   assert.equal(new URL(directHref).origin,allowed.origin);assert.equal(attr(a[i],'data-transparent-direct-terms'),'true');
   assert.doesNotMatch(a[i],/\bdata-funnel-v2-go\b/);
   assert.equal(attr(b[i],'data-link-mode'),'server-redirect');assert.match(b[i],/\bdata-funnel-v2-go(?=\s|>)/);
   assert.doesNotMatch(b[i],/\bdata-transparent-direct-terms\b/);
   for(const anchor of [a[i],b[i]]){
    for(const token of ['sponsored','noopener','nofollow'])assert(attr(anchor,'rel').split(/\s+/).includes(token));
    assert.equal(attr(anchor,'data-program'),id);assert.equal(attr(anchor,'data-provider-slug'),id);
    assert.equal(attr(anchor,'data-page-slug'),'providers');assert.equal(attr(anchor,'data-variant'),'a');
    const rank=attr(anchor,'data-rank-position'),position=attr(anchor,'data-link-position');
    assert.match(rank,/^[1-9]\d*$/);assert(Number.isSafeInteger(Number(rank)));
    assert(['provider-card','provider-card-unverified'].includes(position));
    const slot=(position==='provider-card-unverified'?'pcu':'pc')+rank;
    assert.equal(attr(anchor,'data-subid'),`providers.${slot}`);assert.equal(attr(anchor,'data-sub1'),rank+'B');
   }
   const key=attr(b[i],'data-subid');assert.equal(attr(a[i],'data-subid'),key);
   assert.equal(goHref,`${selected.route}?s=${encodeURIComponent(key)}&v=a`);
   const parsed=parseGoQuery(new URL(goHref,'https://site.invalid'));
   assert.equal(parsed.pageSlug,'providers');assert.equal(parsed.linkPosition,key.slice('providers.'.length));
   assert.equal(parsed.csClickId,null);
  }
  assert.deepEqual(anchors(direct.find(p=>p.route==='/wegovy/').html,id),[],'S30 removed unsupported Wegovy offer, not directory identity or existing approved winner');
  return;
 }
 assert(a.length>0,id+' card absent');assert.equal(b.length,a.length);
 const current=anchors(adopted.find(p=>p.route===route).html,id);assert.equal(current.length,a.length);
 const selected=Object.values(loadGoSelection().programs).find(p=>p.render_id===id);
 if(selected?.status==='VERIFIED'){
  assert.equal(GO_RUNTIME_MANIFEST.programs[id].tracking.base_url,selected.issued_link);
  for(const anchor of current){assert.equal(new URL(href(anchor),'https://site.invalid').pathname,selected.route);assert.match(anchor,/data-funnel-v2-go/);}
 } else {
  // Actual merged incomplete Biltrx authority must not inherit synthetic permission.
  for(const anchor of current){assert.match(href(anchor),/^https:\/\//);assert.doesNotMatch(anchor,/data-funnel-v2-go/);}
 }
 for(let i=0;i<a.length;i++){
  assert.match(href(a[i]),/^https:\/\//);assert.match(a[i],/data-transparent-direct-terms="true"/);
  assert.equal(new URL(href(b[i]),'https://site.invalid').pathname,'/go/'+id);
  assert.match(b[i],/rel="[^"]*sponsored/);assert.match(b[i],/rel="[^"]*nofollow/);assert.match(b[i],/data-funnel-v2-go/);assert.match(b[i],/data-sub1="\d+B"/);assert.match(b[i],/data-provider-slug="/);
  const parsed=parseGoQuery(new URL(href(b[i]),'https://site.invalid'));assert.equal(parsed.pageSlug,route.slice(1,-1));assert.match(parsed.linkPosition,/^pcu?\d+$/);assert.equal(parsed.csClickId,null);
 }
});
for(const med of ['semaglutide','tirzepatide'])test(`D2l ${med} editorial category citations are never converted into paid redirects`,()=>{
 const a=direct.find(p=>p.route==='/'+med+'/').html,b=go.find(p=>p.route==='/'+med+'/').html;
 assert.equal(a,b);assert.match(a,/data-g08-category-count/);assert.match(a,/Provider terms, checked/);
 const citations=[...a.matchAll(/<a\b[^>]*data-citation=[^>]*>/g)].map(m=>m[0]);assert(citations.length>0);
 for(const citation of citations){assert.match(href(citation),/^https:\/\//);assert.doesNotMatch(citation,/data-analytics-event="affiliate_click"|data-funnel-v2-go/);}
 assert(anchors(a,'orderlymeds').length>0);
});
test('D2l direct-only contractual exception cannot be cleared by a generic promotion fixture',()=>{
 const heldRegistry=structuredClone(args.programRegistry);
 const held=heldRegistry.programs.find(p=>p.program_id==='biltrx');assert(held);
 // Historical direct-only fixture is explicit; current four GO supersessions remain adopted.
 held.go.entry_state='held';held.profiles['glp-clinic-scout'].surfaces.go=false;
 held.profiles['glp-clinic-scout'].exceptions.go={enabled:true,reason:'Explicit historical direct-only test fixture',surface_restriction_basis:'operator_terms_transparent_direct_only'};
 const heldPages=buildPhase3PageGraph({...args,programRegistry:heldRegistry,goPromotionAuthority:fixture}).pages;
 let count=0;for(const p of heldPages.filter(p=>['/mounjaro/','/wegovy/'].includes(p.route))){for(const a of anchors(p.html,'biltrx')){count++;assert(!href(a).startsWith('/go/'));}}assert(count>0);
});

// Census independently of mode: missing metadata must not make a test vacuous.
const comparisonCounts=new Map([['/both/',7],['/starter/',31],['/step-up/',31]]);
const comparisonSelector='[data-comparison-card] a[rel~="sponsored"]';
function assertComparisonOutbound(pages,authority) {
 let goCount=0,directCount=0;
 for(const [route,count] of comparisonCounts) {
  const page=pages.find(p=>p.route===route);assert(page,route);
  const dom=new JSDOM(page.html); // No scripts/resources/navigation.
  try {
   const doc=dom.window.document;
   const cards=[...doc.querySelectorAll('[data-comparison-card]')];
   const actions=[...doc.querySelectorAll(comparisonSelector)];
   assert.equal(cards.length,count,route+' cards');assert.equal(actions.length,count,route+' anchors');
   assert.equal(doc.querySelectorAll('[data-comparison-card][data-medications*="retatrutide"]').length,0);
   assert.equal(doc.querySelectorAll('[data-comparison-card][data-program*="fella"]').length,0);
   for(const action of actions) {
    const id=action.dataset.program;
    const program=args.programRegistry.programs.find(p=>p.program_id===id||p.review_slug===id);assert(program);
    const outbound=resolveCardOutbound({program,affiliate:links[id],promotionAuthority:authority,
     pageSlug:route.slice(1,-1),position:'provider-card',rankPosition:cards.indexOf(action.closest('[data-comparison-card]'))+1});
    assert(outbound.mode==='go'||approvedDirectCard(outbound,links[id],authority.programs[program.program_id]));
    if(outbound.mode==='go')goCount++;else directCount++;
    assert.equal(action.getAttribute('href'),outbound.href,route+': '+id+' target');
    const attrDom=new JSDOM(`<a ${outbound.attributes}></a>`);
    try { for(const attr of attrDom.window.document.querySelector('a').attributes)
     assert.equal(action.getAttribute(attr.name),attr.value,route+': '+id+' '+attr.name);
    } finally { attrDom.window.close(); }
    assert.equal(action.dataset.linkPosition,'provider-card');
    assert.equal(action.dataset.analyticsEvent,'affiliate_click');
    assert.equal(action.className,'cs-btn cs-palette-action');assert.equal(action.textContent,'Visit provider');
    assert.equal(action.getAttribute('rel'),'sponsored nofollow noopener');
    assert(action.closest('[data-comparison-card]').querySelector('a[data-card-review]'));
   }
  } finally { dom.window.close(); }
 }
 return {goCount,directCount};
}
test('D2l comparison presets retain all 69 resolved modes and 25 GO targets',()=>{
 assert.deepEqual(assertComparisonOutbound(adopted,loadGoPromotionAuthority()),{goCount:25,directCount:44});
});
test('D2l TEST-only priced Reta row cannot enter comparison presets',()=>{
 const pricingMatrix=structuredClone(args.pricingMatrix),authority=loadGoPromotionAuthority();
 const subject=Object.values(pricingMatrix.providers).find(entry=>entry.program_id==='direct-meds');
 assert(subject?.medications.length>0);
 // TEST-only adversarial pricing input, not a health claim or production grant.
 subject.medications.push({...structuredClone(subject.medications[0]),medication_id:'retatrutide'});
 assert(subject.medications.some(row=>row.medication_id==='retatrutide'));
 const pages=buildPhase3PageGraph({...args,pricingMatrix,goPromotionAuthority:authority}).pages;
 assert.deepEqual(assertComparisonOutbound(pages,authority),{goCount:25,directCount:44});
});
test('D2l comparison presets consume TEST-only complete GO and approved direct controls',()=>{
 const authority=loadGoPromotionAuthority();
 const program=args.programRegistry.programs.find(p=>p.program_id==='orderlymeds');assert(program);
 // Explicit TEST-only direct approval: no GO receipt fields; never persisted.
 authority.programs.orderlymeds={status:'VERIFIED',promotion_authorized:true,issued_link:links.orderlymeds.affiliate_href};
 assert(approvedDirectCard(resolveCardOutbound({program,affiliate:links.orderlymeds,promotionAuthority:authority,
  pageSlug:'starter',position:'provider-card',rankPosition:1}),links.orderlymeds,authority.programs.orderlymeds));
 const directCounts=assertComparisonOutbound(render(authority),authority);
 assert(directCounts.directCount>44);assert.equal(directCounts.goCount+directCounts.directCount,69);
 authority.programs.orderlymeds=completeGoAuthority(program,links.orderlymeds);
 const counts=assertComparisonOutbound(render(authority),authority);
 assert.deepEqual(counts,{goCount:25,directCount:44});
});
for(const state of ['held','review-only'])test(`D2l comparison presets preserve ${state} exclusion`,()=>{
 const registry=structuredClone(args.programRegistry),authority=loadGoPromotionAuthority();
 const program=registry.programs.find(p=>p.program_id==='orderlymeds');assert(program);
 // This subject is present on starter/step-up; both has no published term.
 for(const route of ['/starter/','/step-up/'])assert(anchors(adopted.find(p=>p.route===route).html,'orderlymeds').length>0);
 if(state==='held')program.commercial_state='held';
 else { program.profiles['glp-clinic-scout'].surfaces.compare=false;program.profiles['glp-clinic-scout'].surfaces.review=true; }
 const outbound=resolveCardOutbound({program,affiliate:links.orderlymeds,promotionAuthority:authority,pageSlug:'starter',position:'provider-card',rankPosition:1});
 assert.equal(outbound.mode,'held');assert.equal(outbound.href,null);assert.equal(outbound.attributes,'');
 assert.equal(approvedDirectCard(outbound,links.orderlymeds,authority.programs.orderlymeds),false);
 const pages=buildPhase3PageGraph({...args,programRegistry:registry,goPromotionAuthority:authority}).pages;
 for(const route of comparisonCounts.keys()) {
  const dom=new JSDOM(pages.find(p=>p.route===route).html);
  try {assert.equal(dom.window.document.querySelectorAll('[data-comparison-card][data-program="orderlymeds"]').length,0);}
  finally {dom.window.close();}
 }
});
