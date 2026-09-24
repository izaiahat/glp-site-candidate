import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='/home/ubuntu/business/site-system/flagship-v2/candidates/glp34-provider-families-20260912';
const execution='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
const spec='/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass7-spec-20260902/specs/listing-template.md';
const read=p=>JSON.parse(fs.readFileSync(p));
const every=(xs,f)=>xs.length>0&&xs.every(f);
const check=(name,pass,evidence)=>({name,status:pass?'PASS':'FAIL',evidence});
const gap=name=>({name,status:'NOT_EXERCISED'});
const signature=name=>({name,status:'AWAITING_OPERATOR_SIGNATURE',witness:'Izaiah / design authority',self_certified:false});
const classes=['card-action-structure','registry-counts-eligibility','disclosure-attribution','imagery-rendering','review-intake-controls','imagery-evidence-selection','sourced-facts-price','review-persistence','review-content-publication','coupon-copy-feedback','consented-email-lifecycle'];
export async function surfaceClasses(page,origin,viewport){
 assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
 const histogram=read(execution+'/histogram.json'), inventory=read(execution+'/before/source-inventory.json');
 const registry=read(root+'/data/program-registry.json').programs;
 const pharmacies=read(root+'/data/phase3-pharmacy-render-input.json').entries;
 assert(registry.length>0&&pharmacies.length>0);
 const mappings=[...fs.readFileSync(spec,'utf8').matchAll(/^\| (\d{2}) \| `([^`]+)` \| ([ABCDE]) \| (.+) \|$/gm)].map(m=>({row:m[1],route:m[2],type:m[3]}));
 assert.equal(mappings.length,26);
 const canonicalReviews=registry.filter(r=>r.commercial_state==='live'&&Object.values(r.profiles||{}).some(p=>p.vertical_fit&&p.wired&&p.surfaces?.review&&p.canonical_identity?.role!=='alias')).map(r=>r.review_path).filter(Boolean);
 const routes=[...new Set(['/', '/providers/','/self-pay/','/pharmacies/','/reviews/',...mappings.map(m=>m.route),...canonicalReviews,...pharmacies.map(r=>r.route)])];
 // Real no-JS rendering exposes the shipped noscript full-access path, not synthetic hydration.
 const context=await page.context().browser().newContext({viewport:page.viewportSize(),javaScriptEnabled:false,serviceWorkers:'block'});
 await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin&&r.request().method()==='GET'&&!u.pathname.startsWith('/go/')?r.continue():r.abort();});
 const p=await context.newPage(), observations=[];
 try{for(const route of routes){
  const response=await p.goto(origin+route,{waitUntil:'domcontentloaded'});
  const dom=await p.evaluate(()=>{
   const nodes=s=>[...document.querySelectorAll(s)];
   const schemas=nodes('script[type="application/ld+json"]').flatMap(n=>{try{return [JSON.parse(n.textContent)];}catch{return [];}});
   const firstParty=a=>{const u=new URL(a.getAttribute('href'),location.href);return u.origin===location.origin?u.pathname+u.search+u.hash:null;};
   const cards=nodes('[data-phase3-provider]:not([data-provider-lazy-index])').map(n=>({id:n.dataset.program,name:n.querySelector('h2,h3')?.textContent.trim(),actions:[...n.querySelectorAll('a,button')].map(a=>({tag:a.tagName,text:a.textContent.trim(),first_party:a.tagName==='A'?firstParty(a):null,sponsored:(a.rel||'').split(/\s+/).includes('sponsored'),rel:a.rel||'',quiet:a.classList.contains('cs-btn--quiet'),review:a.hasAttribute('data-provider-review-link')})),fields:[...n.querySelectorAll('dt')].map(x=>x.textContent.trim()),text:n.textContent.trim(),checked:n.querySelectorAll('time[datetime]').length}));
   const pharm=nodes('[data-pharmacy-card]').map(n=>({tag:n.tagName,route:firstParty(n),name:n.querySelector('h2,h3')?.textContent.trim(),nested:n.querySelectorAll('a,button,input,select,textarea').length,blob:n.querySelectorAll('[class*="aurora"],[class*="blob"],.p3-card-actions').length,text:n.textContent.trim(),checked:n.querySelectorAll('time[datetime]').length}));
   const images=nodes('main img').map(n=>({src:n.getAttribute('src'),srcset:n.getAttribute('srcset'),alt:n.getAttribute('alt'),width:n.getAttribute('width'),height:n.getAttribute('height'),loading:n.loading,complete:n.complete&&n.naturalWidth>0,picture:n.parentElement.tagName==='PICTURE'?[...n.parentElement.querySelectorAll('source')].map(s=>({type:s.type,srcset:s.srcset})):[]}));
   const forms=nodes('form').map(f=>({id:f.id,action:f.getAttribute('action'),controls:[...f.querySelectorAll('input,select,textarea')].map(n=>({tag:n.tagName,name:n.name,type:n.type,list:n.getAttribute('list'),role:n.getAttribute('role'),hidden:!n.getBoundingClientRect().width||!n.getBoundingClientRect().height,required:n.required,checked:n.checked,autocomplete:n.autocomplete})),text:f.textContent.trim()}));
   return {title:document.title,text:document.querySelector('main')?.textContent||'',cards,pharm,images,forms,schemas,listingCounts:nodes('.listing__count').map(n=>n.textContent.trim()),facts:nodes('main dl.facts').map(n=>({terms:[...n.querySelectorAll('dt')].map(x=>x.textContent.trim()),values:[...n.querySelectorAll('dd')].map(x=>x.textContent.trim())}))};
  });
  observations.push({route,status:response.status(),...dom});
 }}finally{await context.close();}
 const evidence=execution+`/after/${viewport}-surface-observations.json`;
 fs.writeFileSync(evidence,JSON.stringify({viewport,mode:'real-browser-no-js',expected_routes:routes,observations},null,2)+'\n');
 const listings=observations.filter(o=>mappings.some(m=>m.route===o.route)||['/providers/','/self-pay/'].includes(o.route));
 const cards=listings.flatMap(o=>o.cards.map(c=>({...c,route:o.route})));
 const pharmacy=observations.find(o=>o.route==='/pharmacies/');
 const pharm=pharmacy?.pharm||[];
 const eligible=pharmacies.filter(e=>e.locations?.status==='source_backed'&&e.services?.status==='source_backed'&&e.locations.items.some(i=>typeof i==='string'?i.trim():i?.address||i?.city||i?.state)&&e.services.items.some(i=>String(i||'').trim())&&e.evidence_summary?.citation_count&&e.evidence_summary.source_classes?.length&&e.evidence_summary.last_researched_date);
 const pharmacySet=check('All independently eligible canonical pharmacy cards exactly represented',eligible.length>0&&JSON.stringify(pharm.map(c=>c.route).sort())===JSON.stringify(eligible.map(e=>e.route).sort()),{expected:eligible.map(e=>e.route),observed:pharm.map(c=>c.route)});
 const wholePharmacy=()=>[pharmacySet,check('Every pharmacy card one canonical entry anchor with zero nested interactive controls',every(pharm,c=>c.tag==='A'&&c.nested===0&&c.route?.startsWith('/pharmacies/')),{cards:pharm.length})];
 const byId=new Map(registry.flatMap(r=>[[r.program_id,r],[r.review_slug||r.program_id,r]]));
 const hierarchy=()=>[check('Every complete source-scoped card uses at most two anchors/buttons and exactly one canonical review-or-detail body action',every(cards,c=>{
  const record=byId.get(c.id);if(!record)return false;
  const alias=Object.values(record.profiles||{}).find(p=>p.canonical_identity?.canonical_program_id)?.canonical_identity.canonical_program_id;
  const canonical=byId.get(alias)||record;
  const body=c.actions.filter(a=>a.first_party&&/^\/(reviews|providers)\//.test(a.first_party));
  const expected=canonical.review_path&&observations.some(o=>o.route===canonical.review_path&&o.status===200)?canonical.review_path:`/providers/${record.program_id}/`;
  return c.actions.length<=2&&body.length===1&&body[0].first_party===expected&&body[0].quiet;
 }),{cards:cards.length,evidence})];
 const walkSchema=x=>!x||typeof x!=='object'?[]:[x,...Object.values(x).flatMap(v=>Array.isArray(v)?v.flatMap(walkSchema):walkSchema(v))];
 const schemaNodes=observations.flatMap(o=>o.schemas.flatMap(walkSchema));
 const mechanical={
  'RN-01835':hierarchy,'RN-02748':hierarchy,'RN-02950':hierarchy,
  'RN-01897':()=>[check('Every rendered review secondary carries exact named Read our … review copy, quiet styling and required marker',every(cards.filter(c=>c.actions.some(a=>a.first_party?.startsWith('/reviews/'))),c=>c.actions.filter(a=>a.first_party?.startsWith('/reviews/')).every(a=>a.review&&a.quiet&&/^Read our .+ review$/.test(a.text))),{cards:cards.length,evidence})],
  'RN-02750':()=>[...hierarchy(),check('No affiliate parameters or redirect in any review/detail card action',every(cards,c=>c.actions.filter(a=>a.first_party&&/^\/(reviews|providers)\//.test(a.first_party)).every(a=>!/[?#]/.test(a.first_party))),{network_followed:0})],
  'RN-02758':wholePharmacy,'RN-02759':wholePharmacy,'RN-02993':wholePharmacy,
  'RN-02766':()=>[...wholePharmacy(),check('No nested blob/aurora/action-footer nodes in any pharmacy card',every(pharm,c=>c.blob===0),{cards:pharm.length}),gap('Every inner computed paper/background mechanism and compact factual anatomy')],
  'RN-00317':()=>['program-registry.json','phase3-pharmacy-render-input.json'].map(file=>{const a=fs.readFileSync(root+'/data/'+file),b=fs.readFileSync('/home/ubuntu/business/site-system/flagship-v2/work/glp215-accepted-base/data/'+file);return check('Preserve governed truth/eligibility input '+file,a.equals(b),{bytes:a.length,sha256:createHash('sha256').update(a).digest('hex')});}),
  'RN-00704':()=>[check('No medically-reviewed-by claim on any source-scoped current page',every(observations,o=>o.status===200&&!/medically reviewed by/i.test(o.text)),{routes:routes.length})],
  'RN-00706':()=>[check('No medical reviewer Person schema on any source-scoped page',observations.every(o=>o.status===200)&&schemaNodes.length>0&&!schemaNodes.some(n=>n['@type']==='Person'||n.reviewedBy||n.medicalSpecialty),{nodes:schemaNodes.length})],
  'RN-00709':()=>[check('No self-serving publisher AggregateRating or Review schema',schemaNodes.length>0&&!schemaNodes.some(n=>['Review','AggregateRating'].includes(n['@type'])&&/Clinic Scout|glpclinicscout/i.test(JSON.stringify(n.itemReviewed||{})))),gap('Independent net-impression review of all editorial rating attribution')],
  'RN-02466':()=>[check('Every mapped C route remains hero-free',every(mappings.filter(m=>m.type==='C'),m=>{const o=observations.find(o=>o.route===m.route);return o?.status===200&&!o.images.some(i=>/funnel-hero/.test(i.src||''));}),{routes:mappings.filter(m=>m.type==='C').map(m=>m.route)}),gap('Mapped C hard-speed budget measured under designated harness')],
  'RN-02443':()=>[...wholePharmacy(),gap('Every imagery selection independently proves no implied accreditation')],
  'RN-02782':()=>[check('All canonical governed review pages have nonempty paired dl.facts terms/values',every(observations.filter(o=>registry.some(r=>r.review_path===o.route)),o=>o.status===200&&every(o.facts,f=>f.terms.length===f.values.length&&every(f.terms,t=>t.length>0)&&every(f.values,v=>v.length>0))),{review_routes:observations.filter(o=>registry.some(r=>r.review_path===o.route)).map(o=>o.route)})],
  'RN-02095':()=>[check('Review subject control no longer uses competing native list popup',every(observations.filter(o=>o.route==='/reviews/').flatMap(o=>o.forms.flatMap(f=>f.controls)).filter(c=>/provider|pharmacy|subject/i.test(c.name)),c=>!c.list),{evidence}),gap('Custom searchable/scrollable keyboard combobox and unchanged submission effect')]
 };
 const witnessOnly={
  'RN-01987':'Approve recommended review-first hierarchy and registry-derived return links, with unchanged sitemap policy',
  'RN-02767':'F-04 pharmacy review interpretation; canonical whole-card entry retained; any review destination needs legal/product confirmation',
  'RN-02942':'F-04 sign provider Review-or-Details plus sponsored CTA; pharmacy whole-card/no-button disposition',
  'RN-02966':'F-04 independent sign-off on whole-card pharmacy destination and no nested controls',
  'RN-00066':'D58 define sufficient genuine moderated review corpus and authorize later public review pages/cards'
 };
 const results={};
 for(const className of classes){
  const expected=histogram.primary_histogram.find(c=>c.class===className).occurrence_ids;
  const rows=expected.map(id=>{
   const note=inventory.notes.find(n=>n.id===id);assert(note?.literal_requirement);
   const occurrence=histogram.occurrences.find(o=>o.id===id);
   const checks=mechanical[id]?mechanical[id]():[gap('Full source-bound predicate: '+note.literal_requirement)];
   if(witnessOnly[id])checks.push(signature(witnessOnly[id]));
   // Additional obligations are never discharged by the primary probe alone.
   if(occurrence.compound_effects?.length)checks.push(...occurrence.compound_effects.map(c=>gap('Compound: '+c.effect)));
   return {id,literal_requirement:note.literal_requirement,source_path:note.source_path,source_line:note.source_line,checks,evidence,status:checks.every(c=>c.status==='PASS')?'PASS':'UNRESOLVED'};
  });
  const resolved=rows.filter(r=>r.status==='PASS').map(r=>r.id);
  fs.writeFileSync(execution+`/after/${viewport}-${className}-class.json`,JSON.stringify({class:className,expected:expected.length,resolved,rows,evidence},null,2)+'\n');
  results[className]=resolved;
  console.log(`GLP34_CLASS ${viewport} ${className} ${resolved.length}/${expected.length}`);
 }
 return results;
}
