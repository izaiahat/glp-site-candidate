import {records,finish,check,gap,allOutput,local} from './glp34-reader-copy-handler.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const ids=['RN-00567','RN-01299','RN-02582','RN-02583','RN-02689','RN-02690','RN-02691','RN-02692','RN-02699','RN-02787','RN-EXTRA-3658','RN-EXTRA-3695','RN-EXTRA-3712','RN-EXTRA-3786','RN-EXTRA-3807','RN-EXTRA-3808'];
export async function searchProbe(page){
 const toggle=page.locator('[aria-controls="cs-header-search"]').first();
 if(!await toggle.count())return {missing:true};
 const collapsed=await toggle.innerText();await toggle.click();const input=page.locator('#cs-header-search input[type=search]');await input.fill('wegovy');await page.waitForTimeout(600);
 const expanded=await page.locator('#cs-header-search').evaluate(n=>{const r=n.getBoundingClientRect();return {placeholder:n.querySelector('input').placeholder,role:n.getAttribute('role'),modal:n.getAttribute('aria-modal'),width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},results:[...n.querySelectorAll('.cs-search-results a')].map(a=>({text:a.textContent,href:a.getAttribute('href')}))};});
 await input.press('Escape');await page.waitForTimeout(260);return {collapsed,expanded,closed:await toggle.getAttribute('aria-expanded')==='false'};
}
export async function filtersClass(page,origin,viewport){
 page.setDefaultTimeout(1500);page.setDefaultNavigationTimeout(30000);
 local(origin);const rows=records('filter-query-state',ids),inventory=await allOutput(page,origin),probes=[];
 const specification=fs.readFileSync('/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass7-spec-20260902/specs/listing-template.md','utf8');
 const scoped=[...specification.matchAll(/^\| (\d{2}) \| `([^`]+)` \| ([ABCDE]) \| (.+) \|$/gm)].map(m=>({row:m[1],route:m[2],archetype:m[3]}));
 assert.equal(scoped.length,26,'independent listing mapping denominator');
 for(const p of scoped){
  let observedInitial={native:[],groups:[],stateOptions:[]};
  try {
  await page.goto(origin+p.route,{waitUntil:'domcontentloaded'});
  const trigger=page.locator('.cs-mobile-filter-trigger').first();if(await trigger.isVisible())await trigger.click();
  const initial=await page.evaluate(()=>({h1:document.querySelector('h1')?.textContent,groups:[...document.querySelectorAll('[data-filter-group]')].map(n=>({key:n.dataset.filterGroup,values:[...n.querySelectorAll('[data-filter]')].map(n=>n.dataset.value)})),native:[...document.querySelectorAll('[data-provider-filters] select,[data-pharmacy-filters] select')].map(n=>({html:n.outerHTML,options:[...n.options].map(o=>({value:o.value,text:o.textContent}))})),stateOptions:[...document.querySelectorAll('[data-state-options] [data-state],.p3-state-options [data-state]')].map(n=>({code:n.dataset.state,name:n.textContent.trim()})),h1Template:document.querySelector('h1')?.dataset.stateTitleTemplate,chip:document.querySelector('[data-state-label]')?.textContent,search:!!document.querySelector('[data-provider-search],[data-pharmacy-search]')}));
  observedInitial=initial;
  const actions=[];const controls=page.locator('[data-filter]:not([disabled]):not([data-route])');const controlList=await controls.evaluateAll(ns=>ns.map(n=>({key:n.dataset.filter,value:n.dataset.value})));
  for(const c of controlList){const locator=page.locator(`[data-filter="${c.key}"][data-value="${c.value}"]`).first();if(!await locator.isVisible())continue;await locator.click();await page.waitForTimeout(30);actions.push({control:c,url:page.url(),pressed:await page.evaluate(c=>document.querySelector(`[data-filter="${c.key}"][data-value="${c.value}"]`)?.getAttribute('aria-pressed'),c),state:await page.evaluate(()=>({visible:[...document.querySelectorAll('[data-phase3-provider]:not([hidden])')].map(n=>n.dataset.program),result:document.querySelector('[data-provider-result]')?.textContent}))});}
  let state=null;const open=page.locator('[data-state-open]').first();if(await open.isVisible()){
   await open.click();const stateSearch=page.locator('[data-state-search]').first();await stateSearch.fill('Texas');const visible=await page.locator('.p3-state-options [data-state]:visible').evaluateAll(ns=>ns.map(n=>n.dataset.state));const tx=page.locator('.p3-state-options [data-state="TX"]').first();if(await tx.isVisible()){await tx.click();state={searchVisible:visible,selected:await page.evaluate(()=>({h1:document.querySelector('h1')?.textContent,chip:document.querySelector('[data-state-label]')?.textContent,url:location.href,stored:localStorage.getItem('gcs.state.v1')}))};await page.reload({waitUntil:'domcontentloaded'});state.reload=await page.evaluate(()=>({h1:document.querySelector('h1')?.textContent,chip:document.querySelector('[data-state-label]')?.textContent,url:location.href}));await page.goto(origin+'/reviews/',{waitUntil:'domcontentloaded'});await page.goBack({waitUntil:'domcontentloaded'});state.back=await page.evaluate(()=>({h1:document.querySelector('h1')?.textContent,chip:document.querySelector('[data-state-label]')?.textContent,url:location.href}));}}
  probes.push({route:p.route,initial,actions,state});
  } catch(error) {probes.push({route:p.route,initial:observedInitial,actions:[],state:null,error:String(error.message)});}
 }
 await page.goto(origin+'/providers/?sort=cheapest',{waitUntil:'domcontentloaded'});const cheapest=await page.evaluate(()=>({url:location.href,medication:[...document.querySelectorAll('[data-filter="treatment"][aria-pressed="true"]')].map(n=>n.dataset.value),cards:[...document.querySelectorAll('[data-phase3-provider]')].map(n=>({id:n.dataset.program,hidden:n.hidden})),result:document.querySelector('[data-provider-result]')?.textContent}));
 const repeats=[];for(const [slug,drug] of [['compounded-semaglutide','SEMAGLUTIDE'],['compounded-tirzepatide','TIRZEPATIDE']]){const route=`/lp/best-providers/${slug}/?drug=${drug}&form=COMPOUNDED&sort=cheapest`;const reads=[];for(let i=0;i<2;i++){await page.goto(origin+route,{waitUntil:'domcontentloaded'});reads.push(await page.evaluate(()=>({route:location.pathname,query:location.search,groups:[...document.querySelectorAll('[data-filter][aria-pressed=true]')].map(n=>({key:n.dataset.filter,value:n.dataset.value})),cards:[...document.querySelectorAll('[data-phase3-provider]')].map(n=>n.dataset.program)})));}repeats.push({slug,reads});}
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});let search;try{search=await searchProbe(page);}catch(error){search={missing:true,error:String(error.message)};}
 const sheets=[];
 for(const route of ['/providers/','/pharmacies/']){
  try{
   await page.goto(origin+route,{waitUntil:'domcontentloaded'});
   const trigger=page.locator('.cs-mobile-filter-trigger').first();
   if(!await trigger.isVisible()){sheets.push({route,desktop:true,closed:false});continue;}
   await trigger.click();await page.waitForTimeout(300);
   const geometry=await page.locator('.p3-filterbar.is-open,.p3-pharmacy-filters.is-open').evaluate(n=>{const r=n.getBoundingClientRect();return {top:r.top,height:r.height,width:r.width,viewport:innerHeight,modal:n.getAttribute('aria-modal'),controls:[...n.querySelectorAll('button,input,select')].filter(n=>n.getClientRects().length).map(n=>({text:n.textContent.trim(),height:n.getBoundingClientRect().height}))};});
   await page.locator('.cs-mobile-filter-header button').click();sheets.push({route,geometry,closed:await trigger.getAttribute('aria-expanded')==='false'});
  }catch(error){sheets.push({route,closed:false,error:String(error.message)});}
 }
 const pharmacy=probes.filter(p=>p.route==='/pharmacies/'),states=probes.filter(p=>p.initial.h1Template);
 const stateCheck=check('all source-emitted state-personalized listing H1s retain TX through reload and Back',states.length>0&&states.every(p=>p.state&&[p.state.selected,p.state.reload,p.state.back].every(s=>/in Texas$/.test(s.h1)&&s.chip==='Texas')),states);
 const searchCheck=check('collapsed and expanded exact labels, nonempty typed results and Escape close',!search.missing&&search.collapsed.trim()==='Search providers'&&search.expanded.placeholder==='Search providers or pharmacies'&&search.expanded.results.length>0&&search.closed,search);
 const checksFor=id=>{
 if(id==='RN-01299')return [stateCheck];
 if(id==='RN-02582'||id==='RN-02583'){const p=repeats[id==='RN-02582'?0:1];return [check('repeated literal route preserves exact DOM identities and filter state',p.reads[0].cards.length>0&&JSON.stringify(p.reads[0])===JSON.stringify(p.reads[1]),p),gap('source configured drug/form comparator parity','Repeated consistency alone does not establish correct independent expected state')];}
 if(id==='RN-02689')return [check('pharmacy medication exactly Both/Semaglutide/Tirzepatide',pharmacy.length===1&&pharmacy[0].initial.native.some(n=>JSON.stringify(n.options.map(o=>o.text))===JSON.stringify(['Both','Semaglutide','Tirzepatide'])),pharmacy)];
 if(id==='RN-02690')return [check('one native additive select',pharmacy.length===1&&pharmacy[0].initial.native.filter(n=>n.html.includes('data-pharmacy-additive')).length===1,pharmacy)];
 if(id==='RN-02691'||id==='RN-02787')return [check('all listing state controls include searchable 51-choice listbox',states.length>0&&states.every(p=>p.initial.stateOptions.length===51&&p.state?.searchVisible.length===1&&p.state.searchVisible[0]==='TX'),states)];
 if(id==='RN-02692')return [check('no duplicate native medication/state/form scopes',pharmacy.length===1&&['data-pharmacy-med','data-pharmacy-state','data-pharmacy-class'].every(k=>pharmacy[0].initial.native.filter(n=>n.html.includes(k)).length<=1),pharmacy)];
 if(id==='RN-02699')return [check('cheapest URL leaves all-medications selected',cheapest.medication.length===1&&cheapest.medication[0]==='all',cheapest),gap('full eligible population and independent cheapest comparator','Registry-derived sorting denominator not exercised here')];
 if(id==='RN-EXTRA-3658')return [searchCheck];
 if(id==='RN-EXTRA-3695')return [stateCheck,check('all 51 searchable choices',states.length>0&&states.every(p=>p.initial.stateOptions.length===51),states),gap('default Choose state and geo function','Shared browser storage may already have state; static runtime has no geo function')];
 if(id==='RN-EXTRA-3786')return [stateCheck,gap('real Pages geo function','Requires parent local Pages Functions runtime; no fabricated geo response')];
 if(id==='RN-EXTRA-3807')return [searchCheck,check('search sheet fills mobile viewport with modal semantics',viewport!=='mobile'||(!search.missing&&search.expanded.modal==='true'&&Math.abs(search.expanded.height-search.expanded.viewport.height)<=2&&Math.abs(search.expanded.width-search.expanded.viewport.width)<=2),search)];
 if(id==='RN-EXTRA-3808')return [check('both mobile filter sheets open, have >=44px controls and Show results closes',sheets.length===2&&sheets.every(s=>viewport!=='mobile'||s.closed&&s.geometry.modal==='true'&&s.geometry.controls.length>0&&s.geometry.controls.every(c=>c.height>=44)),sheets),gap('literal 32%-top and source-count reconciliation','Measured geometry retained; historical22 may differ from amended compact toolbar')];
 if(id==='RN-00567')return [check('two dose controls each return nonzero cards on every compounded listing',probes.filter(p=>p.route.startsWith('/lp/best-providers/compounded-')).every(p=>p.actions.filter(a=>a.control.key==='dose'&&a.control.value!=='all'&&a.state.visible.length>0).length>=2)&&probes.some(p=>p.route.startsWith('/lp/best-providers/compounded-')),probes.filter(p=>p.route.startsWith('/lp/best-providers/compounded-'))),gap('source dose binding and independent reranking','No invented dose data supplied')];
 return [gap('redirect plus receiving handler medication intent','Local receiving controls exercised above; source redirect inventory belongs to identity handler')];};
 return finish(viewport,'filter-query-state','filters',rows.map(r=>({...r,checks:checksFor(r.id)})),{sourceScope:inventory.sourceScope,probes,cheapest,repeats,search,sheets});
}
