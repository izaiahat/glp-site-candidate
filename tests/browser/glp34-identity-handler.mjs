import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const execution = '/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
const requirements = {
 'RN-00088':['medication nav/hero/carousel exact destination parity; distinct compounds; no collapse'],
 'RN-00320':['cards'], 'RN-00361':['cards'],
 'RN-00441':['pharmacy top-level navigation, hub, sitemap and complete detail policy'],
 'RN-00456':['seven hydrated intents including pill and distinct compounds; original 3+3 versus historical 4+3 layout evidence'],
 'RN-00471':['centered all-program action; derived count/copy; hover; cheapest target'],
 'RN-01281':['mademed'], 'RN-01289':['skinnyrx-1-glp-weight-loss-provider-review'],
 'RN-01300':['separate shed/shedrx audit identities and metric provenance; canonical relationship; unchanged redirects'],
 'RN-01358':['candidate-preview and instrumented-candidate scope; historical 38 not eligibility authority'],
 'RN-01375':['JRNYS/MEDVI network/redirect identity and dated protected live evidence local comparison'],
 'RN-01392':['all primary review actions by row/surface and historical 50/48 snapshot disposition'],
 'RN-01395':['review-only rows joined to authorized go manifest; missed monetization and held exclusions'],
 'RN-01834':['named'], 'RN-01836':['returns','detail sitemap/declared route policy'],
 'RN-01895':['aliases','cards'], 'RN-01901':['cards'],
 'RN-01903':['returns','both model lanes; sitemap policy; alias preservation; return outside card action cap'],
 'RN-02566':['selfpay','E template and all eligible sourced self-pay records; insurance/self-pay context'],
 'RN-02799':['selfpay','generic'], 'RN-02802':['generic'], 'RN-02822':['cards'], 'RN-02977':['generic','selfpay'],
 'RN-EXTRA-3631':['retired','aliases','cards','six medication query/fragment semantics and all-program action'],
 'RN-EXTRA-3662':['seven provider-menu intents and local targets; hero 4+3 layout'],
 'RN-EXTRA-3664':['pharmacy top-level navigation, hub and complete detail inventory'],
 'RN-EXTRA-3669':['seven hero buttons including pill; 4+3 layout; actual filter hydration'],
 'RN-EXTRA-3680':['derived all-program count and appropriate copy; working action'],
 'RN-EXTRA-3702':['retired'],
 'RN-EXTRA-3708':['six legacy medication intents plus bare-all and insurance/self-pay; targets and query/fragment semantics'],
 'RN-EXTRA-3711':['local review server behavior independently exercised without production redirects'],
 'RN-EXTRA-3716':['aliases','all four historical populations on each stated medication/self-pay surface'],
 'RN-EXTRA-3718':['aliases','cards'], 'RN-EXTRA-3722':['aliases','cards'],
 'RN-EXTRA-3828':['retired','six medication-intent replacements and all-program query/filter state'],
 'RN-EXTRA-3829':['aliases'],
 'RN-EXTRA-3838':['source-bound manufacturer compliance-versus-omission disposition and corresponding resource behavior'],
};
export async function identityClass(page, origin, viewport) {
 assert(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname), 'local candidate only');
 const histogram = JSON.parse(fs.readFileSync(path.join(execution,'histogram.json')));
 const expected = histogram.primary_histogram.find(row => row.class === 'identity-route-eligibility').occurrence_ids;
 assert.equal(expected.length,37); assert.deepEqual(Object.keys(requirements).sort(), [...expected].sort());
 const registry = JSON.parse(fs.readFileSync(path.join(root,'data/program-registry.json'))).programs;
 const files=[]; const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.html'))files.push(f);}};walk(path.join(root,'public'));
 assert(files.length>0);
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 const inventory=[];
 // Parse every emitted HTML file, including deferred templates, without executing or following its links.
 for(let i=0;i<files.length;i+=20){
  const batch=files.slice(i,i+20).map(f=>{
   const html=fs.readFileSync(f,'utf8');
   const src=html.match(/data-provider-card-payloads\s+data-src="([^"]+)"/)?.[1];
   assert(!src||/^\/assets\/[a-zA-Z0-9.-]+\.json$/.test(src));
   const payload=src?JSON.parse(fs.readFileSync(path.join(root,'public',src))):null;
   return {route:'/'+path.relative(path.join(root,'public'),f).replace(/index\.html$/,''),html,payload};
  });
  inventory.push(...await page.evaluate(batch=>batch.map(({route,html,payload})=>{
   const doc=new DOMParser().parseFromString(html,'text/html');
   for(const template of [...doc.querySelectorAll('template')])template.replaceWith(template.content.cloneNode(true));
   const bodies=payload||JSON.parse(doc.querySelector('[data-provider-card-payloads]')?.textContent||'[]');
   for(const card of doc.querySelectorAll('[data-provider-lazy-index]')){
    const body=bodies[Number(card.dataset.providerLazyIndex)];
    if(typeof body!=='string'||!body.trim())throw new Error('Missing deferred card body: '+route);
    card.innerHTML=body;
   }
   const link=a=>({href:a.getAttribute('href'),text:a.textContent.trim(),rel:a.getAttribute('rel')||'',quiet:a.classList.contains('cs-btn--quiet'),inHeaderNav:a.matches('nav.gcs-nav .gcs-links > li > a')});
   return {route,links:[...doc.querySelectorAll('a[href]')].map(link).filter(a=>a.href?.startsWith('/')&&!a.href.startsWith('//')&&!a.href.startsWith('/go/')),
    cards:[...doc.querySelectorAll('[data-phase3-provider]')].map(n=>({id:n.getAttribute('data-program'),name:n.querySelector('h2,h3,h4')?.textContent.trim(),actions:[...n.querySelectorAll('.p3-card-actions a')].map(link).filter(a=>/^\/(reviews|providers)\//.test(a.href||'')),reviews:n.querySelectorAll('[data-card-review]').length})),
    returns:[...doc.querySelectorAll('[data-review-provider-detail-link]')].map(link)};
  }),batch));
 }
 const cards=inventory.flatMap(p=>p.cards.map(c=>({...c,route:p.route})));
 const links=inventory.flatMap(p=>p.links.map(a=>({...a,route:p.route})));
 const canonical=record=>{const a=record?.profiles?.['glp-clinic-scout']?.canonical_identity;return a?.role==='alias'?registry.find(r=>r.program_id===a.canonical_program_id):record;};
 const recordFor=id=>registry.find(r=>r.program_id===id||r.review_slug===id);
 const pharmacyEntries=JSON.parse(fs.readFileSync(path.join(root,'data/phase3-pharmacy-render-input.json'))).entries;
 assert(pharmacyEntries.length>0);
 const targets=[...new Set([...pharmacyEntries.map(e=>e.route),'/pharmacies/',...cards.flatMap(c=>c.actions.map(a=>a.href)),...inventory.flatMap(p=>p.returns.map(a=>a.href)), '/reviews/mademed/','/reviews/skinnyrx-1-glp-weight-loss-provider-review/','/providers/?sort=cheapest','/self-pay/'])];
 const statuses={};
 for(const target of targets){
  assert(/^\/(reviews|providers|self-pay|pharmacies)\//.test(target)&&!target.startsWith('//'));
  const response=await page.goto(origin+target,{waitUntil:'domcontentloaded'});
  statuses[target]=response.status();
 }
 const check=(name,predicate,detail)=>({name,status:predicate?'PASS':'FAIL',detail});
 const nonemptyEvery=(rows,fn)=>rows.length>0&&rows.every(fn);
 const validCard=c=>{const r=recordFor(c.id),wanted=canonical(r)?.review_path;return Boolean(r)&&c.actions.length===1&&c.actions[0].href===(wanted||`/providers/${r.program_id}/`)&&statuses[c.actions[0].href]===200;};
 const named=c=>{const wanted=canonical(recordFor(c.id))?.review_path;return !wanted||(c.reviews===1&&c.actions.filter(a=>a.href===wanted&&/review/i.test(a.text)&&c.name&&a.text.toLowerCase().includes(c.name.toLowerCase())).length===1);};
 const aliases={coivas:'awin-128761','direct-meds':'katalys-1304',mangorx:'katalys-647','sprout-health':'katalys-1286',shed:'katalys-1516'};
 const generic=links.filter(a=>/^(Find|Browse)(?: a| all)? (providers?|programs?)$/i.test(a.text));
 const both=links.filter(a=>a.text==='Compare both paths');
 const reviewPages=inventory.filter(p=>/^\/reviews\/[^/]+\/$/.test(p.route)&&registry.some(r=>canonical(r)?.review_path===p.route));
 const sitemap=fs.readFileSync(path.join(root,'public/sitemap.xml'),'utf8');
 const returnPolicy=nonemptyEvery(reviewPages,p=>p.returns.length===1&&p.returns.every(a=>statuses[a.href]===200&&sitemap.includes('https://glpclinicscout.com'+a.href)));
 const predicates={
  cards:()=>check('canonical named review OR valid detail fallback',nonemptyEvery(cards,c=>validCard(c)&&named(c)),{cards:cards.length,failed:cards.filter(c=>!validCard(c)||!named(c))}),
  named:()=>check('exactly one provider-named published review per shared card',nonemptyEvery(cards,named),{cards:cards.length,failed:cards.filter(c=>!named(c))}),
  aliases:()=>check('registry aliases and actual emitted card destinations',Object.entries(aliases).every(([slug,id])=>recordFor(slug)?.program_id===id&&nonemptyEvery(cards.filter(c=>[slug,id].includes(c.id)),validCard))&&canonical(recordFor('shed'))?.program_id==='shedrx',{populations:Object.fromEntries(Object.entries(aliases).map(([slug,id])=>[slug,cards.filter(c=>[slug,id].includes(c.id)).length]))}),
  returns:()=>check('one quiet nonsponsored canonical detail return and local target',nonemptyEvery(reviewPages,p=>{const r=canonical(registry.find(r=>r.review_path===p.route));return p.returns.length===1&&p.returns[0].href===`/providers/${r.program_id}/`&&p.returns[0].quiet&&!/sponsored/.test(p.returns[0].rel)&&statuses[p.returns[0].href]===200;}),{reviews:reviewPages.length,failed:reviewPages.filter(p=>p.returns.length!==1).map(p=>p.route)}),
  targets:()=>check('all emitted card destinations resolve without assumed production redirects',nonemptyEvery(cards,c=>c.actions.length>0&&c.actions.every(a=>statuses[a.href]===200)),{statuses}),
  retired:()=>check('unverified: complete source-bound retired-route inventory; 250/75 remain historical counts',false,{pages:inventory.length,links:links.length,retired:links.filter(a=>/^\/providers\/all(?:\/|\?|#|$)/.test(a.href))}),
  generic:()=>check('generic Find/Browse remain cheapest providers',nonemptyEvery(generic,a=>a.href==='/providers/?sort=cheapest')&&statuses['/providers/?sort=cheapest']===200,{generic}),
  selfpay:()=>check('only scoped Compare both paths destination is self-pay',nonemptyEvery(both,a=>a.href==='/self-pay/')&&statuses['/self-pay/']===200,{both}),
 };
 const retiredLinks=links.filter(a=>a.href.split(/[?#]/)[0]==='/best/online-glp-1-providers/');
 predicates.retired=()=>check('all emitted pages contain zero links to the exact retired comparison path; historical250/75 is not current',inventory.length>0&&retiredLinks.length===0,{pages_checked:inventory.length,remaining:retiredLinks});
 const intentMap=[
  ['Compounded semaglutide','/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest'],
  ['Compounded tirzepatide','/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest'],
  ['Wegovy pill','/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest'],
  ['Ozempic','/ozempic/?drug=OZEMPIC&form=BRAND_NAME&sort=cheapest'],
  ['Wegovy','/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest'],
  ['Mounjaro','/mounjaro/?drug=MOUNJARO&form=BRAND_NAME&sort=cheapest'],
  ['Zepbound','/zepbound/?drug=ZEPBOUND&form=BRAND_NAME&sort=cheapest']
 ];
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 const entryPoints=await page.evaluate(()=>Object.fromEntries([['nav','nav.gcs-nav a'],['hero','a.cs-home-quick'],['carousel','a[data-med-card]']].map(([surface,selector])=>[surface,[...document.querySelectorAll(selector)].map(a=>({text:a.querySelector('h3')?.textContent.trim()||a.textContent.trim(),href:a.getAttribute('href')}))])));
 const intentRows=[];
 for(const [label,target] of intentMap){
  const surfaces=Object.entries(entryPoints).map(([surface,anchors])=>{
   const matching=anchors.filter(a=>a.text.startsWith(label)&&!(label==='Wegovy'&&a.text.startsWith('Wegovy pill')));
   return {surface,matching:matching.length,pass:matching.length>0&&matching.every(a=>a.href===target)};
  });
  const response=await page.goto(origin+target,{waitUntil:'domcontentloaded'});
  intentRows.push({label,target,surfaces,status:response.status()});
 }
 predicates['medication nav/hero/carousel exact destination parity; distinct compounds; no collapse']=()=>check('every instance on all three entry surfaces matches its distinct declared medication destination and serves200',new Set(intentMap.map(row=>row[1])).size===7&&intentRows.every(row=>row.status===200&&row.surfaces.every(s=>s.pass)),intentRows);
 for(const id of ['mademed','skinnyrx-1-glp-weight-loss-provider-review'])predicates[id]=()=>check('exact program and review route identity',registry.some(r=>r.program_id===id&&r.review_path===`/reviews/${id}/`)&&statuses[`/reviews/${id}/`]===200,{program_id:id,status:statuses[`/reviews/${id}/`]});
 predicates['detail sitemap/declared route policy']=()=>check('every canonical review return reaches built detail present in sitemap',returnPolicy,{review_routes:reviewPages.map(p=>p.route)});
 predicates['both model lanes; sitemap policy; alias preservation; return outside card action cap']=()=>{
  const before=JSON.parse(fs.readFileSync('/home/ubuntu/business/site-system/flagship-v2/work/glp215-accepted-base/data/program-registry.json')).programs;
  const aliasesUnchanged=registry.every(r=>JSON.stringify(r.profiles?.['glp-clinic-scout']?.canonical_identity)===JSON.stringify(before.find(b=>b.program_id===r.program_id)?.profiles?.['glp-clinic-scout']?.canonical_identity));
  return check('canonical return in all review lanes; no alias reassignment; all targets and sitemap checked',returnPolicy&&aliasesUnchanged&&predicates.returns().status==='PASS',{review_routes:reviewPages.map(p=>p.route),aliases_unchanged:aliasesUnchanged});
 };
 const pharmacyRoutes=pharmacyEntries.map(e=>e.route).sort();
 const emittedPharmacyRoutes=inventory.filter(p=>/^\/pharmacies\/[^/]+\/$/.test(p.route)).map(p=>p.route).sort();
 const pharmacyNavigation=links.some(a=>a.href==='/pharmacies/'&&a.inHeaderNav);
 const pharmacyDetailParity=JSON.stringify(pharmacyRoutes)===JSON.stringify(emittedPharmacyRoutes)&&pharmacyRoutes.every(route=>statuses[route]===200)&&statuses['/pharmacies/']===200;
 predicates['pharmacy top-level navigation, hub and complete detail inventory']=()=>check('header navigation and all source-derived pharmacy detail routes; no historical count substitution',pharmacyNavigation&&pharmacyDetailParity,{expected:pharmacyRoutes,observed:emittedPharmacyRoutes,header_navigation:pharmacyNavigation});
 predicates['pharmacy top-level navigation, hub, sitemap and complete detail policy']=()=>{
  const sitemap=fs.readFileSync(path.join(root,'public/sitemap.xml'),'utf8');
  return check('current source inventory and sitemap; historical93 is not current90',pharmacyNavigation&&pharmacyDetailParity&&pharmacyRoutes.every(route=>sitemap.includes('https://glpclinicscout.com'+route)),{source_count:pharmacyRoutes.length,historical_count:93});
 };
 const rows=expected.map(id=>{const checks=requirements[id].map(key=>predicates[key]?predicates[key]():({name:key,status:'FAIL',detail:'unverified: constituent evidence/runtime assertion unavailable; not waived'}));return {id,status:checks.every(c=>c.status==='PASS')?'RESOLVED':'UNRESOLVED',checks};});
 const resolved=rows.filter(r=>r.status==='RESOLVED').map(r=>r.id);
 fs.mkdirSync(path.join(execution,'after'),{recursive:true});
 fs.writeFileSync(path.join(execution,'after',`${viewport}-identity-class.json`),JSON.stringify({viewport,class:'identity-route-eligibility',denominator:37,resolved_count:resolved.length,resolved,rows,inventory:{pages:inventory.length,cards:cards.length}},null,2)+'\n');
 console.log(`GLP34_IDENTITY ${viewport} INDIVIDUAL_RESOLVED=${resolved.length}/37`);
 return resolved;
}
