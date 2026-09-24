import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const execution = '/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
const listingSpec = '/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass7-spec-20260902/specs/listing-template.md';
const sha = value => createHash('sha256').update(value).digest('hex');
export const listingQuery = (url, base) => new URL(url, base).searchParams;
const requirements = {
 'RN-00261':['all','field-stack cards, terms interaction, canonical review routes, funnel continuity, accessibility and original imagery'],
 'RN-00287':['all','single listing renderer integration, exact copy and approved imagery bindings'],
 'RN-00288':['funnel','outcome continuity and unchanged LP-owner source'],
 'RN-00319':['all','C2 carousel advancement and containment plus F1 terms dialog behavior'],
 'RN-00321':['funnel'], 'RN-00362':['funnel'],
 'RN-00889':['all','all per-route section9 instructions, first-card geometry, field density, two card actions, carousel advancement and self-pay destination'],
 'RN-02544':['all','one shared renderer implementation, not five independently emitted templates'],
 'RN-02545':['A','duration hydration and all A mapping instructions'],
 'RN-02546':['B','configured drug panel and all B mapping instructions'],
 'RN-02547':['C','route-derived molecule/form and all C mapping instructions'],
 'RN-02548':['D','scope, medication, additive, search and region interactions; card geometry'],
 'RN-02549':['E','full canonical live-registry identity parity, including truthful unknown cards'],
 'RN-02563':['C','route molecule/form hydration and hard LP performance budget'],
 'RN-02574':['row06','five control groups exercised, route query hydration, width and hard LP budget; sole disclosure'],
 'RN-02575':['row07','five control groups exercised, route query hydration, width and hard LP budget; sole disclosure'],
 'RN-02581':['D','all five pharmacy controls exercised, duplicate native controls removed, no card CTA, D geometry'],
 'RN-02589':['row21','full live-registry identity parity, source-driven unknowns and shared width'],
 'RN-02590':['row22','full live-registry identity parity and separately proven repeated entry-point equivalence'],
 'RN-02591':['row23','molecule/brand/form and Wegovy-pill duration interactions; full-registry default'],
 'RN-02592':['row24','Ozempic filter state exercised with full-registry default and identity parity'],
 'RN-02593':['row25','Wegovy filter state exercised with full-registry default and identity parity'],
 'RN-02594':['row26','Mounjaro filter state exercised with full-registry default and identity parity'],
 'RN-02595':['row27','Zepbound filter state exercised with full-registry default and identity parity'],
 'RN-02774':['B','clean-room copy/assets, dark surfaces without white nested pricing, B first-card budgets and panel-scoped FAQ'],
 'RN-02820':['breadcrumbs'],
};
const check = (name, pass, detail) => ({name,status:pass?'PASS':'FAIL',detail});
const gap = (name, detail) => ({name,status:'UNVERIFIED',detail});
const every = (xs, fn) => xs.length > 0 && xs.map(fn).every(Boolean);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function noJSIdentityCoverage(expected, cards) {
 if(!every(expected,id=>typeof id==='string'&&id.trim().length>0)||new Set(expected).size!==expected.length)return false;
 const readable=cards.filter(c=>c.visible);
 return every(cards,c=>expected.includes(c.id)&&(c.visible||c.lazy))
  && same([...expected].sort(),readable.map(c=>c.id).sort())
  && every(readable,c=>!c.lazy&&c.text.trim().length>0&&(c.pharmacyWholeLink||c.links.some(a=>/^\/(reviews|providers)\//.test(a.href||''))));
}
const cardSelector = 'main [data-phase3-provider],main [data-pharmacy-card]';
const filterSelector = 'main [data-provider-filters],main [data-pharmacy-filters]';
const interactionSurface = s => ({state:s.state,light:s.light,counts:s.counts,cards:s.cards.map(c=>({id:c.id,visible:c.visible,lazy:c.lazy}))});

// Browser observations, not generated-source signatures. Keep every card/control,
// including failures and hidden controls, in the evidence denominator.
export async function surfaceProbe(page) {
 return page.evaluate(() => {
  const visible = n => !!n && !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  const box = n => {if(!n)return null; const r=n.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};};
  const main=document.querySelector('main'), filter=main?.querySelector('[data-provider-filters],[data-pharmacy-filters]');
  const grid=main?.querySelector('[data-phase3-provider-grid],[data-pharmacy-grid]');
  const all=s=>[...(main?.querySelectorAll(s)||[])];
  const light=all('*').filter(visible).filter(n=>{const r=n.getBoundingClientRect(), c=getComputedStyle(n).backgroundColor.match(/[\d.]+/g)?.map(Number);return r.width*r.height>=24000&&c?.length>=3&&(c.length<4||c[3]>.1)&&c.slice(0,3).every(v=>v>=220);}).map(n=>({tag:n.tagName,classes:n.className,box:box(n)}));
  const cards=all('[data-phase3-provider],[data-pharmacy-card]').map(n=>({id:n.dataset.program||n.getAttribute('href'),visible:visible(n),box:box(n),lazy:!!n.querySelector('[data-provider-lazy-placeholder]'),text:n.innerText,
   fields:[...n.querySelectorAll('dt,dd')].map(x=>x.innerText.trim()),
   actions:[...n.querySelectorAll('.p3-card-actions a,.p3-card-actions button')].filter(visible).map(a=>({text:a.textContent.trim(),href:a.getAttribute('href'),rel:a.rel||''})),
   links:[...n.querySelectorAll('a[href]')].map(a=>({href:a.getAttribute('href'),text:a.textContent.trim(),rel:a.rel||''})),
   pharmacyWholeLink:n.matches('a[href]'),nestedActions:n.querySelectorAll('button,a,.p3-card-actions').length,
   slots:[...n.querySelectorAll('dd,td,.p3-card-chip')].map(x=>({text:x.innerText.trim(),box:box(x),lineHeight:parseFloat(getComputedStyle(x).lineHeight)}))}));
  const support=main?.querySelector('.listing__support');
  return {width:innerWidth,height:innerHeight,main:box(main),grid:box(grid),gap:grid?parseFloat(getComputedStyle(grid).columnGap):null,columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,
   first:cards.find(c=>c.visible),cards,light,documentHeight:document.documentElement.scrollHeight,
   titleSize:parseFloat(getComputedStyle(main?.querySelector('h1')||document.body).fontSize),
   support:support?{box:box(support),lineHeight:parseFloat(getComputedStyle(support).lineHeight),fontSize:parseFloat(getComputedStyle(support).fontSize),text:support.innerText}:null,
   counts:all('.listing__count,[data-filter-result],[data-pharmacy-result]').filter(visible).map(n=>({text:n.innerText,inSupport:!!n.closest('.listing__support')})),
   disclosures:[...document.querySelectorAll('[data-ftc-disclosure]')].filter(visible).map(n=>({text:n.innerText,box:box(n)})),
   groups:[...(filter?.querySelectorAll('[data-filter-group]')||[])].map(n=>({key:n.dataset.filterGroup,visible:visible(n),role:n.getAttribute('role'),values:[...n.querySelectorAll('[data-filter]')].map(b=>({value:b.dataset.value,disabled:b.disabled,visible:visible(b),role:b.getAttribute('role'),tabindex:b.tabIndex,pressed:b.getAttribute('aria-pressed'),selected:b.getAttribute('aria-selected'),box:box(b)}))})),
   natives:[...(filter?.querySelectorAll('select')||[])].map(n=>({attrs:n.getAttributeNames(),visible:visible(n)})),
   interactive:[...(filter?.querySelectorAll('button,input,select')||[])].filter(visible).map(n=>({box:box(n),name:n.getAttribute('aria-label')||n.labels?.[0]?.textContent||n.textContent})),
   genericMore:[...(filter?.querySelectorAll('summary')||[])].filter(n=>/^More filters$/i.test(n.textContent.trim())).length,
   state:all('[data-filter][aria-pressed="true"],[data-filter][aria-selected="true"]').map(n=>({key:n.dataset.filter,value:n.dataset.value})),
   images:all('img').filter(visible).map(n=>({src:n.currentSrc||n.src,loaded:n.complete&&n.naturalWidth>0,alt:n.getAttribute('alt'),box:box(n)})),
   both:[...document.querySelectorAll('a')].filter(n=>n.textContent.trim()==='Compare both paths'||n.getAttribute('aria-label')==='Compare both paths').map(n=>n.getAttribute('href'))};
 });
}
export async function noJSSurfaceProbe(page) {
 const surface=await surfaceProbe(page),cards=page.locator(cardSelector);
 for(let i=0;i<surface.cards.length;i++){
  if(!surface.cards[i].visible||surface.cards[i].lazy)continue;
  await cards.nth(i).evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  // Page timers do not run in a JavaScript-disabled context. A browser capture
  // synchronizes the actual rendered frame without enabling page scripts.
  await page.screenshot({timeout:1500});
  const observed=await cards.nth(i).evaluate(node=>{
   const rect=node.getBoundingClientRect();
   return {text:node.innerText,scrollY,inViewport:rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight};
  });
  surface.cards[i].text=observed.inViewport?observed.text:'';
  surface.cards[i].readingTrace={scrollY:observed.scrollY,inViewport:observed.inViewport};
 }
 return surface;
}
async function revealAll(page) {
 const batches=[]; const max=await page.locator(cardSelector).count();
 for(let i=0;i<=max;i++) {
  const more=page.locator('[data-provider-load-more],[data-pharmacy-load-more]').first();
  if(!await more.isVisible())break;
  const before=await page.locator('main [data-phase3-provider]:visible,main [data-pharmacy-card]:visible').count();
  try {await more.click({timeout:1500});await page.waitForTimeout(60);
   const after=await page.locator('main [data-phase3-provider]:visible,main [data-pharmacy-card]:visible').count();
   batches.push({before,after,focus:await page.evaluate(()=>document.activeElement?.closest('[data-phase3-provider]')?.dataset.program||null)});
   if(after<=before)break;
  } catch(error){batches.push({error:error.message});break;}
 }
 return {batches,surface:await surfaceProbe(page)};
}
async function waitForListingState(page) {
 if(await page.locator('[data-provider-filters]').count())
  await page.locator('[data-provider-filters][data-filter-state-ready="true"]').waitFor({state:'attached',timeout:1500});
}
export async function navigateListingMapping(page, url) {
 await page.mouse.move(0,0);
 return page.goto(url,{waitUntil:'domcontentloaded'});
}
export async function navigateListingTrial(page, url, savedState) {
 await page.evaluate(value=>{if(value===null)localStorage.removeItem('gcs.state.v1');else localStorage.setItem('gcs.state.v1',value);},savedState);
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await waitForListingState(page);
}
async function interactionProbe(page, origin, mapping, savedState) {
 await navigateListingTrial(page,origin+mapping.route,savedState);
 const controls=await page.locator(filterSelector).locator('button[data-filter],select,input[type="search"]:not([data-state-search])').evaluateAll(ns=>ns.map((n,index)=>({index,tag:n.tagName,key:n.dataset.filter||n.getAttributeNames().find(k=>/^data-(pharmacy|state)/.test(k)),value:n.dataset.value,disabled:n.disabled,visible:!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden',route:n.dataset.route||null,options:n.tagName==='SELECT'?[...n.options].filter(o=>!o.disabled).map(o=>o.value):[]})));
 const actions=[];
 // Every emitted option is independently exercised from the literal initial URL;
 // a hidden control is a failure, not a skipped successful sample.
 for(const c of controls) for(const value of c.tag==='SELECT'?c.options:[c.tag==='INPUT'?'zz-no-source-match-34':c.value]) {
  const action={control:c,value,requested:value};
  if(c.disabled){action.disabled=true;actions.push(action);continue;}
  if(!c.visible){action.visible=false;action.error='Initial census: control hidden; all its options fail exposure, none credited as exercised';actions.push(action);continue;}
  try {
   await navigateListingTrial(page,origin+mapping.route,savedState);
   const control=page.locator(filterSelector).locator('button[data-filter],select,input[type="search"]:not([data-state-search])').nth(c.index);
   action.visible=await control.isVisible();
   if(c.disabled){action.disabled=await control.isDisabled();actions.push(action);continue;}
   if(!action.visible){action.error='Configured control not exposed without a generic More filters/sheet';actions.push(action);continue;}
   const before=await surfaceProbe(page);
   action.beforeValue=c.tag==='SELECT'||c.tag==='INPUT'?await control.inputValue():null;
   if(c.tag==='SELECT')await control.selectOption(value,{timeout:1500});
   else if(c.tag==='INPUT')await control.fill(value,{timeout:1500});
   else await control.click({timeout:1500});
   await page.waitForTimeout(c.tag==='INPUT'?350:60);
   action.url=page.url();action.after=interactionSurface(await surfaceProbe(page));
   action.changed=!same(before.state,action.after.state)||!same(before.cards.filter(x=>x.visible).map(x=>x.id),action.after.cards.filter(x=>x.visible).map(x=>x.id))||action.url!==origin+mapping.route;
   action.value=c.tag==='SELECT'||c.tag==='INPUT'?await page.locator(filterSelector).locator('button[data-filter],select,input[type="search"]:not([data-state-search])').nth(c.index).inputValue():value;
   if(['D','E'].includes(mapping.archetype))action.allAfter=interactionSurface((await revealAll(page)).surface);
   await page.reload({waitUntil:'domcontentloaded'});
   await waitForListingState(page);
   const reloaded=await surfaceProbe(page);
   action.reload={state:reloaded.state,ids:reloaded.cards.filter(x=>x.visible).map(x=>x.id)};
   action.persisted=same(action.after.state,action.reload.state)&&same(action.after.cards.filter(x=>x.visible).map(x=>x.id),action.reload.ids);
  }catch(error){action.error=error.message;}
  actions.push(action);
 }
 await navigateListingTrial(page,origin+mapping.route,savedState);
 return {controls,actions};
}
async function expandedProbe(page) {
 const details=[];
 const count=await page.locator('main details').count();
 for(let i=0;i<count;i++){
  const d=page.locator('main details').nth(i),r={index:i,panel:await d.evaluate(n=>!!n.closest('[data-listing-drug-panel]'))};
  try {const summary=d.locator('summary').first();r.name=await summary.innerText();
   if(!await summary.isVisible()){r.error='summary hidden';details.push(r);continue;}
   if(await d.getAttribute('open')!==null)await summary.click({timeout:1500});
   await summary.press('Enter',{timeout:1500});r.open=await d.getAttribute('open')!==null;
   r.content=await d.innerText();r.surface=interactionSurface(await surfaceProbe(page));
   await summary.press('Enter',{timeout:1500});r.closed=await d.getAttribute('open')===null;
  }catch(error){r.error=error.message;}details.push(r);
 }
 const terms=[];
 const triggers=page.locator('main button,main a,main summary').filter({hasText:/^(?:View |See |Read )?(?:program |cancellation )?terms(?: and conditions)?$/i});
 for(let i=0;i<await triggers.count();i++){
  const trigger=triggers.nth(i),r={index:i};
  try{r.name=await trigger.innerText();const href=await trigger.getAttribute('href');
   if(href&&!href.startsWith('#')){r.error='Terms is navigation, not the required local dialog';terms.push(r);continue;}
   await trigger.click({timeout:1500});const dialog=page.locator('dialog[open],[role="dialog"]:visible').first();
   r.open=await dialog.isVisible();if(r.open){r.text=await dialog.innerText();r.modal=await dialog.getAttribute('aria-modal');
    const focusable=dialog.locator('a[href]:visible,button:enabled:visible,input:enabled:visible,select:enabled:visible,textarea:enabled:visible,[tabindex="0"]:visible');r.focusable=await focusable.count();
    if(r.focusable){await focusable.first().focus({timeout:1500});await page.keyboard.press('Shift+Tab');r.reverseTrap=await focusable.last().evaluate(n=>n===document.activeElement);await focusable.last().focus({timeout:1500});await page.keyboard.press('Tab');r.forwardTrap=await focusable.first().evaluate(n=>n===document.activeElement);}
    await page.keyboard.press('Escape');r.closed=!await dialog.isVisible();r.focus=await trigger.evaluate(n=>n===document.activeElement);
    await trigger.click({timeout:1500});const bounds=await dialog.boundingBox(),vp=page.viewportSize();
    const point=[{x:1,y:1},{x:vp.width-1,y:vp.height-1}].find(p=>bounds&&(p.x<bounds.x||p.x>bounds.x+bounds.width||p.y<bounds.y||p.y>bounds.y+bounds.height));
    if(point){await page.mouse.click(point.x,point.y);r.outsideClosed=!await dialog.isVisible();r.outsideFocus=await trigger.evaluate(n=>n===document.activeElement);}else r.outsideError='No outside-dialog coordinate available at this viewport';
    if(await dialog.isVisible())await page.keyboard.press('Escape');
   }
  }catch(error){r.error=error.message;}terms.push(r);
 }
 return {details,terms};
}
async function railProbe(page) {
 // Census actual overflowing regions; no artificial overflow or scrollTop write.
 const regions=await page.locator('main *').evaluateAll(ns=>ns.map((n,index)=>({n,index,s:getComputedStyle(n)})).filter(({n,s})=>/(auto|scroll)/.test(s.overflowY)&&n.scrollHeight>n.clientHeight+1&&n.getClientRects().length).map(({n,index})=>({index,name:n.getAttribute('aria-label')||n.getAttribute('aria-labelledby'),focusable:n.tabIndex>=0,prevent:n.hasAttribute('data-lenis-prevent'),height:n.clientHeight,scrollHeight:n.scrollHeight})));
 for(const r of regions){try{const n=page.locator('main *').nth(r.index);await n.scrollIntoViewIfNeeded({timeout:1500});await n.hover({timeout:1500});const before=await n.evaluate(n=>({top:n.scrollTop,page:scrollY}));await page.mouse.wheel(0,80);await page.waitForTimeout(120);r.wheel=await n.evaluate((n,b)=>({moved:n.scrollTop>b.top,pageFixed:Math.abs(scrollY-b.page)<2}),before);await n.focus();const top=await n.evaluate(n=>n.scrollTop);await page.keyboard.press('ArrowDown');await page.waitForTimeout(120);r.keyboard=await n.evaluate((n,t)=>n.scrollTop>t,top);}catch(error){r.error=error.message;}}
 return regions;
}
async function keyboardProbe(page) {
 const groups=page.locator('main [data-filter-group]'),results=[];
 for(let i=0;i<await groups.count();i++){
  const group=groups.nth(i),r={index:i,key:await group.getAttribute('data-filter-group'),steps:[]};
  const tabs=group.locator('[role="tab"]');r.tabs=await tabs.count();r.role=await group.getAttribute('role');
  if(r.role!=='tablist'||!r.tabs){r.error='Required tablist/roving-tab mechanism missing';results.push(r);continue;}
  try{const enabled=group.locator('[role="tab"]:not([disabled])');await enabled.first().focus({timeout:1500});
   for(const key of ['End','Home','ArrowRight','ArrowLeft']){
    await page.keyboard.press(key);const s=await group.evaluate(n=>({active:[...n.querySelectorAll('[role="tab"]:not([disabled])')].indexOf(document.activeElement),roving:[...n.querySelectorAll('[role="tab"]')].filter(t=>t.tabIndex===0).length,selected:[...n.querySelectorAll('[role="tab"]')].filter(t=>t.getAttribute('aria-selected')==='true').length}));r.steps.push({key,...s});
   }r.enabled=await enabled.count();
  }catch(error){r.error=error.message;}results.push(r);
 }
 return results;
}
async function localPriceProbe(page) {
 const cards=page.locator('main [data-phase3-provider]'),results=[];
 for(let i=0;i<await cards.count();i++){
  const card=cards.nth(i),r={id:await card.getAttribute('data-program'),controls:[],actions:[]};
  r.controls=await card.locator('select').evaluateAll(ns=>ns.map((n,index)=>({index,name:n.getAttribute('aria-label')||n.labels?.[0]?.textContent||'',options:[...n.options].map(o=>({value:o.value,text:o.textContent.trim()})),visible:!!n.getClientRects().length})));
  for(const c of r.controls)for(const option of c.options){const a={control:c.name,option};try{
   const before=await card.innerText(),url=page.url(),control=card.locator('select').nth(c.index);a.beforeValue=await control.inputValue();await control.selectOption(option.value,{timeout:1500});a.value=await control.inputValue();a.after=await card.innerText();a.changed=before!==a.after;a.routeStable=page.url()===url;
  }catch(error){a.error=error.message;}r.actions.push(a);}results.push(r);
 }
 return results;
}
async function regionProbe(page) {
 const options=await page.locator('main [data-state-options] [data-state],main .p3-state-options [data-state]').evaluateAll(ns=>ns.map(n=>({code:n.dataset.state,name:n.textContent.trim()})));
 const actions=[];let sharedFailure=null;
 for(const option of options){const r={...option};try{
  if(sharedFailure){r.error=`Not exercised: shared region mechanism failed: ${sharedFailure}`;actions.push(r);continue;}
  const trigger=page.locator('main [data-state-open]').first();if(!await trigger.isVisible())throw new Error('Region popover trigger missing or hidden');await trigger.click({timeout:1500});
  const search=page.locator('main [data-state-search]').first();await search.fill(option.name,{timeout:1500});
  const choice=page.locator(`main [data-state="${option.code}"]`).first();await choice.click({timeout:1500});
  r.selected=await page.locator('main [data-state-label]').first().innerText();r.url=page.url();
  r.closed=await trigger.getAttribute('aria-expanded')==='false';
  r.focus=await trigger.evaluate(n=>document.activeElement===n);
 }catch(error){r.error=error.message;sharedFailure=r.error;}actions.push(r);}
 return {options,actions};
}
async function carouselProbe(page) {
 const tracks=page.locator('[data-med-track]'), results=[];
 for(let i=0;i<await tracks.count();i++){
  const track=tracks.nth(i),r={index:i,steps:[]};
  const count=await track.locator('[data-med-card]').count();
  for(let step=0;step<count;step++){try{
   const before=await track.evaluate(n=>({index:n.dataset.medActiveIndex,x:n.getBoundingClientRect().x,transform:getComputedStyle(n).transform}));
   await track.locator('xpath=ancestor::*[contains(@class,"cs-home2-meds")]').locator('[data-med-next]').click({timeout:1500});await page.waitForTimeout(120);
   const after=await track.evaluate(n=>({index:n.dataset.medActiveIndex,x:n.getBoundingClientRect().x,transform:getComputedStyle(n).transform}));r.steps.push({before,after});
  }catch(error){r.error=error.message;break;}}
  results.push(r);
 }
 return results;
}
export async function listingClass(page, origin, viewport) {
 assert(['desktop','mobile'].includes(viewport));
 const base = new URL(origin);
 assert(['127.0.0.1','localhost','[::1]'].includes(base.hostname), 'loopback only');
 const histogramBytes = fs.readFileSync(path.join(execution,'histogram.json'));
 const inventoryBytes = fs.readFileSync(path.join(execution,'before/source-inventory.json'));
 const histogram = JSON.parse(histogramBytes), inventory = JSON.parse(inventoryBytes);
 const expected = histogram.primary_histogram.find(x=>x.class==='shared-listing-template').occurrence_ids;
 assert.equal(expected.length,26); assert.equal(new Set(expected).size,26);
 assert.deepEqual(Object.keys(requirements).sort(),[...expected].sort());
 const notes = expected.map(id=>{const matches=inventory.notes.filter(n=>n.id===id);assert.equal(matches.length,1,id);assert(matches[0].literal_requirement);return matches[0];});
 const root=new URL('../../',import.meta.url);
 const rendererSource=fs.readFileSync(new URL('src/phase3-page-graph.mjs',root),'utf8');
 const rendererKinds=['A','B','C','D','E'];
 const rendererCalls=Object.fromEntries(rendererKinds.map(k=>[k,rendererSource.split('listing("'+k+'",').length-1]));
 const singleRenderer=(rendererSource.match(/function renderConfiguredListing\(/g)||[]).length===1&&rendererSource.includes('const listing = (archetype, page) => renderConfiguredListing(archetype, page, listingContext)')&&rendererKinds.every(k=>rendererCalls[k]>0);

 const immutable=JSON.parse(fs.readFileSync(path.join(execution,'before/immutable-input-hashes.json')));
 const boundInput=relative=>{const bytes=fs.readFileSync(new URL(relative,root));assert.equal(sha(bytes),immutable.data[relative],`immutable listing oracle: ${relative}`);return JSON.parse(bytes);};
 const registrySource=boundInput('data/program-registry.json'),registry=registrySource.programs;
 const pharmacyInput=boundInput('data/phase3-pharmacy-render-input.json').entries;
 const factInput=boundInput('data/provider-facts-backfill-20260830.json').programs;
 const pharmacyEligible=pharmacyInput.filter(e=>e.locations?.status==='source_backed'&&e.services?.status==='source_backed'&&e.locations.items?.some(x=>typeof x==='string'?x.trim():x.address||x.city||x.state)&&e.services.items?.some(x=>String(x).trim())&&e.evidence_summary?.citation_count>0&&e.evidence_summary.source_classes?.length&&e.evidence_summary.last_researched_date);
 const live=registry.filter(p=>{const profile=p.profiles?.['glp-clinic-scout'];return p.commercial_state==='live'&&profile?.vertical_fit===true&&profile.wired===true&&profile.surfaces?.review===true&&profile.canonical_identity?.role!=='alias';});
 const expectedLive=live.map(p=>p.review_slug||p.program_id).sort();assert(expectedLive.length>0);
 const canonical=id=>{const p=registry.find(p=>p.program_id===id||p.review_slug===id);const alias=p?.profiles?.['glp-clinic-scout']?.canonical_identity;return alias?.role==='alias'?registry.find(p=>p.program_id===alias.canonical_program_id):p;};
 const mappings = [...fs.readFileSync(listingSpec,'utf8').matchAll(/^\| (\d{2}) \| `([^`]+)` \| ([ABCDE]) \| (.+) \|$/gm)].map(m=>({row:m[1],route:m[2],archetype:m[3],literal:m[4]}));
 assert.equal(mappings.length,26); assert.equal(new Set(mappings.map(x=>x.row)).size,26);
 // Mapping rows remain separate visits; repeated URLs are not collapsed into a sample.
 const visits = [...mappings,{row:'self-pay',route:'/self-pay/',archetype:'E',literal:'E configuration from section2'}];
 const blocked=[];
 const guard=async route=>{const req=route.request(),u=new URL(req.url());if(req.method()!=='GET'||u.origin!==base.origin||/^\/go(?:\/|$)/.test(u.pathname)){blocked.push({url:u.href,method:req.method()});return route.abort();}return route.continue();};
 await page.route('**/*',guard);
 const noJSContext=await page.context().browser().newContext({javaScriptEnabled:false,viewport:page.viewportSize()});
 await noJSContext.route('**/*',guard);
 const noJSPage=await noJSContext.newPage();
 const observations=[], mechanismCache=new Map();
 fs.mkdirSync(path.join(execution,'after'),{recursive:true});
 try {
  for(const mapping of visits){
   const network=[], onRequest=request=>network.push({url:request.url(),method:request.method()});
   page.on('request',onRequest);
   const response=await navigateListingMapping(page,new URL(mapping.route,origin).href);
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForLoadState('load',{timeout:5000}).catch(()=>{});
   page.off('request',onRequest);
   const performance=await page.evaluate(async()=>{
    const entries=[...globalThis.performance.getEntriesByType('navigation'),...globalThis.performance.getEntriesByType('resource')];
    const lcp=await new Promise(resolve=>{let value=null;const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())value=e.startTime;});observer.observe({type:'largest-contentful-paint',buffered:true});setTimeout(()=>{observer.disconnect();resolve(value);},100);});
    return {entries:entries.map(e=>({name:e.name,transferSize:e.transferSize,responseEnd:e.responseEnd})),bytes:entries.reduce((n,e)=>n+e.transferSize,0),lcp};
   });
   const initial=await surfaceProbe(page);
   const noJS={};try{const reply=await noJSPage.goto(origin+mapping.route,{waitUntil:'domcontentloaded',timeout:10000});noJS.status=reply?.status();noJS.surface=await noJSSurfaceProbe(noJSPage);noJS.recovery=await noJSPage.locator('main noscript,main a[href],main summary').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({tag:n.tagName,text:n.textContent.trim(),href:n.getAttribute('href')})));}catch(error){noJS.error=error.message;}
   const dom=await page.evaluate(()=>{
    const main=document.querySelector('main'); if(!main)return {missingMain:true};
    const all=s=>[...main.querySelectorAll(s)];
    const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};};
    const before=(a,b)=>!!a&&!!b&&!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);
    const h=main.querySelector('h1'),filter=main.querySelector('[data-provider-filters],[data-pharmacy-filters]'),grid=main.querySelector('[data-phase3-provider-grid],[data-pharmacy-grid]');
    const funnel=main.querySelector('[data-funnel-v2],.funnel-v2,[data-a10-funnel]');
    const schema=[...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(n=>{try{const v=JSON.parse(n.textContent);return Array.isArray(v)?v:v['@graph']||[v];}catch{return [];}});
    const crumbs=schema.filter(n=>n['@type']==='BreadcrumbList');
    return {archetype:main.dataset.listingArchetype,h1s:all('h1').length,head:h?rect(h):null,filter:filter?rect(filter):null,grid:grid?rect(grid):null,
     order:before(h,filter)&&before(filter,grid),grids:all('.p3-provider-grid,[data-pharmacy-grid]').length,
     cardCount:all('[data-phase3-provider],[data-pharmacy-card]').length,
     visibleBreadcrumbs:all('nav.breadcrumbs').length,breadcrumbSchemas:crumbs,
     validBreadcrumbSchema:crumbs.length>0&&crumbs.every(n=>Array.isArray(n.itemListElement)&&n.itemListElement.length>0&&n.itemListElement.every((x,i)=>x.position===i+1&&x.name&&/^https:\/\/glpclinicscout\.com\//.test(typeof x.item==='string'?x.item:x.item?.['@id']||''))),
     funnelAfterGrid:before(grid,funnel),funnelCount:all('[data-funnel-v2],.funnel-v2,[data-a10-funnel]').length,
     preGridObsolete:all('.gcs-kicker,.p3-hero-actions,.p3-source-disclosure,.p3-product-picker,.p3-accordions,.p3-index-hero,.p3-category-hero,.p3-bulk-hero').filter(n=>before(n,grid)).map(n=>n.className),
     drugPanels:all('[data-listing-drug-panel],.listing__drug-panel').length,
     preGridFaq:all('details,.p3-accordions').filter(n=>before(n,grid)&&!n.closest('[data-provider-filters],[data-pharmacy-filters],[data-listing-drug-panel],.listing__drug-panel')).length,
     overflow:document.documentElement.scrollWidth>innerWidth+1,
     state:[...main.querySelectorAll('[data-filter][aria-pressed="true"],[data-filter][aria-current]')].map(n=>({filter:n.dataset.filter,value:n.dataset.value})),
     controls:all('[data-filter-group]').map(n=>n.dataset.filterGroup),
    };
   });
   const shot=path.join(execution,'after',`${viewport}-listing-row-${mapping.row}.png`);
   await page.screenshot({path:shot,fullPage:false});
   const url=page.url();
   const revealed=await revealAll(page);
   const controlSchema=await page.locator(filterSelector).evaluateAll(ns=>ns.map(n=>({
    groups:[...n.querySelectorAll('[data-filter-group]')].map(g=>({key:g.dataset.filterGroup,role:g.getAttribute('role'),values:[...g.querySelectorAll('[data-filter]')].map(b=>({key:b.dataset.filter,value:b.dataset.value,route:b.dataset.route,disabled:b.disabled}))})),
    selects:[...n.querySelectorAll('select')].map(s=>({name:s.getAttribute('aria-label'),options:[...s.options].map(o=>({value:o.value,disabled:o.disabled}))}))
   })));
   const mechanismKey=JSON.stringify({archetype:mapping.archetype,path:new URL(mapping.route,origin).pathname,queryKeys:[...new URL(mapping.route,origin).searchParams.keys()].sort(),controlSchema});
   let mechanisms=mechanismCache.get(mechanismKey);
   if(!mechanisms){
    console.log(`GLP34_LISTING_MECHANISM ${viewport} row=${mapping.row} start`);
    const savedState=await page.evaluate(()=>localStorage.getItem('gcs.state.v1'));
    const localPrices=mapping.archetype==='B'?await localPriceProbe(page):[];
    const expanded=await expandedProbe(page),rails=await railProbe(page),keyboard=await keyboardProbe(page);
    const interactions=await interactionProbe(page,origin,mapping,savedState),region=await regionProbe(page);
    mechanisms={localPrices,expanded,rails,keyboard,interactions,region,evidenceRow:mapping.row};
    mechanismCache.set(mechanismKey,mechanisms);
    await page.evaluate(value=>{if(value===null)localStorage.removeItem('gcs.state.v1');else localStorage.setItem('gcs.state.v1',value);},savedState);
    console.log(`GLP34_LISTING_MECHANISM ${viewport} row=${mapping.row} done`);
   }
   const {localPrices,expanded,rails,keyboard,interactions,region}=mechanisms;
   await page.goto(origin+mapping.route,{waitUntil:'domcontentloaded'});
   observations.push({...mapping,mechanismKey,mechanismEvidenceRow:mechanisms.evidenceRow,status:response?.status()??null,url,dom,screenshot:shot,initial,noJS,network,performance,revealed,expanded,rails,keyboard,localPrices,interactions,region});
  }
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  var carousel=await carouselProbe(page);
  var bothPaths=await page.locator('a').evaluateAll(ns=>ns.filter(n=>n.textContent.trim()==='Compare both paths'||n.getAttribute('aria-label')==='Compare both paths').map(n=>n.getAttribute('href')));
 } finally {await page.unroute('**/*',guard).catch(()=>{});await noJSContext.close().catch(()=>{});}
 const select=key=>key==='all'||key==='breadcrumbs'?observations:key==='funnel'?observations.filter(x=>x.archetype==='E'):key.startsWith('row')?observations.filter(x=>x.row===key.slice(3)):observations.filter(x=>x.archetype===key);
 const rows=notes.map(note=>{
  const [key,...remaining]=requirements[note.id], seen=select(key);
  assert(seen.length>0,note.id);
  const checks=[check('all independently scoped routes served',seen.every(x=>x.status===200&&!x.dom.missingMain),seen.map(x=>({row:x.row,url:x.url,status:x.status})))];
  if(key==='breadcrumbs'){
   checks.push(check('visible listing breadcrumbs omitted; valid BreadcrumbList retained on every A/B/C/D/E route including self-pay',seen.every(x=>x.dom.visibleBreadcrumbs===0&&x.dom.validBreadcrumbSchema),seen.map(x=>({row:x.row,visible:x.dom.visibleBreadcrumbs,schema:x.dom.breadcrumbSchemas}))));
  }else if(key==='funnel'){
   checks.push(check('actual funnel appears after comparison grid on both E configurations',seen.every(x=>x.dom.funnelAfterGrid&&x.dom.funnelCount===1),seen.map(x=>({row:x.row,count:x.dom.funnelCount,after:x.dom.funnelAfterGrid}))));
  }else{
   checks.push(check('configured archetype, one heading, one grid, title-filter-grid order and no obsolete pre-grid blocks',seen.every(x=>x.dom.archetype===x.archetype&&x.dom.h1s===1&&x.dom.grids===1&&x.dom.order&&x.dom.preGridObsolete.length===0&&!x.dom.overflow),seen.map(x=>({row:x.row,dom:x.dom}))));
   checks.push(check('B configured drug-panel slot only; no pre-grid FAQ leakage',seen.every(x=>x.dom.drugPanels===(x.archetype==='B'?1:0)&&x.dom.preGridFaq===0),seen.map(x=>({row:x.row,panels:x.dom.drugPanels,faq:x.dom.preGridFaq}))));
  }
  // Attach each constituent to each applicable occurrence. Evidence is row-local;
  // no paired route, card, or control is replaced by a representative sample.
  const rowCheck=(name,predicate,project=x=>({row:x.row,route:x.route}),scope=seen)=>check(name,every(scope,predicate),scope.map(project));
  const shape=()=>rowCheck('compact support/count, no generic More filters or duplicate native concepts',x=>{
   const s=x.initial,lines=x.archetype==='B'?2:x.archetype==='D'?3:1;
   return s.titleSize<=36&&s.support&&s.support.fontSize===14&&s.support.box.height<=s.support.lineHeight*lines+1&&s.counts.length===1&&s.counts[0].inSupport&&s.genericMore===0&&s.natives.filter(n=>n.visible).every(n=>x.archetype==='D'&&n.attrs.includes('data-pharmacy-additive'));
  },x=>({row:x.row,support:x.initial.support,counts:x.initial.counts,natives:x.initial.natives,genericMore:x.initial.genericMore}));
  const geometry=()=>rowCheck('section5 measured grid/card/first-fold budgets on every scoped route',x=>{
   const s=x.initial,mobile=s.width<760,d=x.archetype==='D',gridWidth=mobile?s.width-32:d?960:992;
   const cap=mobile?(x.archetype==='B'?1400:d?600:x.route.startsWith('/6-month/')?660:380):(x.archetype==='B'?1130:d?380:x.route.startsWith('/6-month/')?440:400);
   return s.grid&&Math.abs(s.grid.width-gridWidth)<=2&&Math.abs(s.gap-(mobile||d?16:32))<=1&&s.columns===(mobile?1:3)&&s.first&&!s.first.lazy&&s.first.box.y<=cap&&s.titleSize<=36&&
    every(s.cards.filter(c=>c.visible),c=>Math.abs(c.box.width-(mobile?gridWidth:309.333))<=2&&c.box.height>=(d?400:520)&&c.box.height<=(d?620:760))&&
    (s.width!==1440||x.archetype==='B'||s.first.box.y+s.first.box.height<=900)&&(!['A','C','E'].includes(x.archetype)||s.width!==1920||s.documentHeight<=5000);
  },x=>({row:x.row,width:x.initial.width,grid:x.initial.grid,gap:x.initial.gap,first:x.initial.first?.box,cards:x.initial.cards.map(c=>({id:c.id,visible:c.visible,box:c.box})),documentHeight:x.initial.documentHeight}));
  const dark=()=>rowCheck('no computed >=24000px2 light panels initially, after every control and every opened disclosure',x=>[x.initial,x.revealed.surface,...x.expanded.details.map(d=>d.surface).filter(Boolean),...x.interactions.actions.map(a=>a.after).filter(Boolean)].every(s=>s.light.length===0),x=>({row:x.row,initial:x.initial.light,expanded:x.expanded.details.map(d=>({index:d.index,error:d.error,light:d.surface?.light})),actions:x.interactions.actions.map(a=>({key:a.control.key,value:a.value,light:a.after?.light}))}));
  const groups=()=>rowCheck('all required archetype groups exposed, no collapsed controls; all option actions and reload outcomes recorded',x=>{
   const wanted=x.archetype==='D'?[]:x.archetype==='B'?['treatment','type']:['treatment','dose','sort','plan','type'];
   return wanted.every(k=>x.initial.groups.some(g=>g.key===k&&g.visible&&g.values.some(v=>v.visible)))&&every(x.interactions.actions,a=>a.disabled===true||!a.error&&a.visible&&a.persisted&&
    (a.control.tag==='BUTTON'?a.after.state.some(s=>s.key===a.control.key&&String(s.value).toLowerCase()===String(a.value).toLowerCase()):a.value===a.requested&&(a.beforeValue===a.requested||a.changed)));
  },x=>({row:x.row,groups:x.initial.groups,actions:x.interactions.actions.map(a=>({control:a.control,value:a.value,error:a.error,persisted:a.persisted,url:a.url}))}));
  const hydration=()=>rowCheck('literal drug/form/plan/duration defaults hydrate active controls',x=>{
   const u=new URL(x.route,origin),drug=u.searchParams.get('drug')||(x.archetype==='C'?(x.route.includes('tirzepatide')?'TIRZEPATIDE':'SEMAGLUTIDE'):null);
   const form=u.searchParams.get('form')||(x.archetype==='C'?'COMPOUNDED':null),state=x.initial.state;
   const has=(keys,value)=>state.some(s=>keys.includes(s.key)&&String(s.value).toUpperCase()===value.toUpperCase());
   return (!drug||has(['treatment','molecule'],drug))&&(!form||has(['type'],form==='BRAND_NAME'?'brand':'compounded'))&&['plan','duration'].every(k=>!u.searchParams.has(k)||has([k],u.searchParams.get(k)));
  },x=>({row:x.row,route:x.route,state:x.initial.state}));
  const regionCheck=()=>rowCheck('every region option searches/selects/closes and restores trigger focus',x=>x.region.options.length===51&&every(x.region.actions,a=>!a.error&&a.selected===a.name&&a.closed&&a.focus&&['state','region'].some(k=>new URL(a.url).searchParams.get(k)===a.code)),x=>({row:x.row,region:x.region}));
  const population=()=>rowCheck('all canonical live identities reachable, unknowns not omitted; exact 12-card E batches',x=>{

   const cards=x.revealed.surface.cards;
   return same(cards.map(c=>canonical(c.id)?.review_slug||canonical(c.id)?.program_id||c.id).sort(),expectedLive)&&every(cards,c=>c.visible&&!c.lazy)&&x.initial.cards.filter(c=>c.visible&&!c.lazy).length===Math.min(12,expectedLive.length)&&x.revealed.batches.every(b=>!b.error&&b.after-b.before===Math.min(12,expectedLive.length-b.before));
  },x=>({row:x.row,expected:expectedLive,observed:x.revealed.surface.cards.map(c=>({id:c.id,visible:c.visible,lazy:c.lazy})),batches:x.revealed.batches}),seen.filter(x=>x.archetype==='E'&&x.row!=='self-pay'));
  const disclosure=()=>rowCheck('one visible natural-home FTC disclosure after grid',x=>x.initial.disclosures.length===1&&x.initial.disclosures[0].box.y>=x.initial.grid.y&&x.initial.disclosures[0].text.trim().length>0,x=>({row:x.row,disclosures:x.initial.disclosures}));
  const lp=()=>[rowCheck('mapped C request count <=15, transfer <=300KB and observed LCP <1s',x=>x.network.length>0&&x.network.length<=15&&x.network.every(r=>new URL(r.url).origin===base.origin)&&x.performance.bytes>0&&x.performance.bytes<=300*1024&&x.performance.lcp!==null&&x.performance.lcp<1000,x=>({row:x.row,network:x.network,performance:x.performance})),gap('designated cold-cache LP performance certification','PerformanceObserver and ResourceTiming are real local measurements; designated throttle/cache profile and unfinished/lazy requests are not certified by this probe.')];
  const cardChecks=()=>[
   rowCheck('every provider card retains compact field stack and <=2 actions; pharmacy cards whole-link with no nested CTA',x=>every(x.revealed.surface.cards,c=>x.archetype==='D'?c.pharmacyWholeLink&&c.nestedActions===0:c.fields.length>0&&['Medications offered','Total monthly cost','Cancellation'].every(k=>c.fields.includes(k))&&c.actions.length>0&&c.actions.length<=2&&c.slots.length<=28&&c.slots.every(s=>s.text.length<=26&&s.box.height<=s.lineHeight+1)),x=>({row:x.row,cards:x.revealed.surface.cards.map(c=>({id:c.id,fields:c.fields,slots:c.slots,actions:c.actions.length,nestedActions:c.nestedActions}))})),
   ...(seen.some(x=>x.archetype!=='D')?[rowCheck('every provider card has exact canonical first-party review/detail href, never affiliate redirect',x=>every(x.revealed.surface.cards,c=>{const p=canonical(c.id);return p&&c.links.filter(a=>/^\/(reviews|providers)\//.test(a.href||'')).length===1&&c.links.some(a=>a.href===(p.review_path||`/providers/${p.program_id}/`)&&!/sponsored/.test(a.rel));}),x=>({row:x.row,ids:x.revealed.surface.cards.map(c=>c.id)}),seen.filter(x=>x.archetype!=='D'))]:[]),
   gap('source-qualified card fact equality and sponsored href byte custody','Field presentation and canonical first-party hrefs are exercised; price/dose/cancellation ledger equality and issued sponsored bindings require the independent bound fact/authority oracle, not visible text or a copied href.')];
  const imagery=()=>[rowCheck('all visible listing images load, retain alt and pre-edit asset hashes',x=>every(x.revealed.surface.images,img=>{const url=new URL(img.src);if(url.origin!==base.origin||!img.loaded||img.alt===null)return false;const rel=url.pathname.slice(1);try{return immutable.assets[rel]===sha(fs.readFileSync(new URL('public/'+rel,root)));}catch{return false;}}),x=>({row:x.row,images:x.revealed.surface.images})),rowCheck('visible listing imagery has nonzero layout boxes without document overflow',x=>!x.dom.overflow&&every(x.initial.images,i=>i.box.width>0&&i.box.height>0),x=>({row:x.row,images:x.initial.images.map(i=>({box:i.box,loaded:i.loaded})),overflow:x.dom.overflow}))];
  const pharmacyOracle=()=>rowCheck('all D baseline and filtered facility identity sets equal pinned source records, not card attributes',x=>{
   const expected=(url,action)=>{const query=listingQuery(url,base),filter={pathway:(query.get('pharmacyType')||'all').toLowerCase(),medication:(query.get('pharmacyDrug')||'all').toLowerCase(),state:'all',additive:'all',search:''};if(filter.medication==='both')filter.medication='all';
    if(action){const field={'data-pharmacy-class':'pathway','data-pharmacy-med':'medication','data-pharmacy-state':'state','data-pharmacy-additive':'additive','data-pharmacy-search':'search'}[action.control.key];if(field)filter[field]=action.requested;}
    return pharmacyEligible.filter(e=>{
     const evidence=[e.glp1_relevance?.semaglutide?.evidence,e.glp1_relevance?.tirzepatide?.evidence].filter(Boolean).join(' ');
     const additivePatterns={'vitamin-b12':/B12\b/i,cyanocobalamin:/cyanocobalamin/i,niacinamide:/niacinamide/i,glycine:/glycine/i,pyridoxine:/pyridoxine|vit(?:amin)?\s*B6\b/i,'vitamin-b3':/vit(?:amin)?\s*B3\b/i};
     return (filter.pathway==='all'||e.classification?.['section_'+filter.pathway]?.value===true)&&(filter.medication==='all'||e.glp1_relevance?.[filter.medication]?.relevant===true)&&(filter.state==='all'||e.states_served?.regulator_verified?.some(s=>s.state.toLowerCase()===String(filter.state).toLowerCase()))&&(!filter.search||e.display_name.toLowerCase().includes(filter.search.toLowerCase()))&&(filter.additive==='all'||additivePatterns[filter.additive]?.test(evidence));
    }).map(e=>e.route).sort();};
   x.pharmacyOracle={baseline:expected(x.route),actions:x.interactions.actions.map(a=>({key:a.control.key,value:a.requested,expected:expected(x.route,a),observed:a.allAfter?.cards.filter(c=>c.visible).map(c=>c.id).sort(),error:a.error}))};
   return same(x.revealed.surface.cards.filter(c=>c.visible).map(c=>c.id).sort(),x.pharmacyOracle.baseline)&&every(x.pharmacyOracle.actions,a=>!a.error&&same(a.expected,a.observed));
  },x=>({row:x.row,source:'data/phase3-pharmacy-render-input.json',eligibleCount:pharmacyEligible.length,oracle:x.pharmacyOracle}),seen.filter(x=>x.archetype==='D'));
  const noJSCheck=()=>rowCheck('every initially emitted identity is readable/reachable with JavaScript disabled',x=>!x.noJS.error&&x.noJS.status===200&&noJSIdentityCoverage(x.initial.cards.map(c=>c.id),x.noJS.surface.cards),x=>({row:x.row,status:x.noJS.status,error:x.noJS.error,cards:x.noJS.surface?.cards.map(c=>({id:c.id,visible:c.visible,lazy:c.lazy})),recovery:x.noJS.recovery}));
  const terms=()=>rowCheck('every terms trigger opens local dialog, traps forward/reverse focus, Escape and outside-click close/return focus',x=>every(x.expanded.terms,t=>!t.error&&t.open&&t.text?.trim()&&t.closed&&t.focus&&t.forwardTrap&&t.reverseTrap&&t.outsideClosed&&t.outsideFocus),x=>({row:x.row,terms:x.expanded.terms}));
  const rails=()=>rowCheck('every actual internal rail is named/focusable and contains real wheel plus keyboard movement',x=>every(x.rails,r=>!r.error&&r.name&&r.focusable&&r.prevent&&r.wheel?.moved&&r.wheel.pageFixed&&r.keyboard),x=>({row:x.row,rails:x.rails}));
  const carouselCheck=()=>check('all medication carousel tracks advance through every slide by the real next control',every(carousel,c=>!c.error&&every(c.steps,s=>s.before.index!==s.after.index)&&c.steps.some(s=>s.before.transform!==s.after.transform)),carousel);
  const taxonomyCheck=()=>rowCheck('every E molecule/brand/form option matches independently pinned provider taxonomy IDs',x=>{
   const profiles=Object.values(registrySource.provider_dynamic_profiles.profiles);
   x.taxonomyEvidence=x.interactions.actions.filter(a=>['treatment','type'].includes(a.control.key)&&a.requested!=='WEGOVY_PILL').map(a=>{
    const value=String(a.requested).toLowerCase(), expected=live.filter(p=>{
     if(['all','both'].includes(value))return true;
     const profile=profiles.find(t=>t.program_id===p.program_id||t.registry_program_ids?.includes(p.program_id)),taxonomy=profile?.taxonomy;
     if(a.control.key==='type')return taxonomy?.treatment_type_tags?.includes(value==='brand'?'brand_name':value);
     return taxonomy?.molecule_tags?.includes(value)||taxonomy?.brand_name_tags?.includes(value);
    }).map(p=>p.review_slug||p.program_id).sort();
    const observed=a.allAfter?.cards.filter(c=>c.visible).map(c=>canonical(c.id)?.review_slug||canonical(c.id)?.program_id||c.id).sort();
    return {value:a.requested,key:a.control.key,expected,observed,error:a.error,pass:!a.error&&same(expected,observed)};
   });return every(x.taxonomyEvidence,e=>e.pass);
  },x=>({row:x.row,source:'data/program-registry.json#provider_dynamic_profiles.profiles',options:x.taxonomyEvidence}),seen.filter(x=>x.archetype==='E'&&x.row!=='self-pay'));
  const factCoverage=()=>rowCheck('every emitted provider has an independently bound fact record; reported facts carry quote/date/source',x=>every(x.revealed.surface.cards,c=>{
   const p=canonical(c.id),record=factInput.find(f=>f.program_id===p?.program_id||f.program_id===c.id);return record&&Object.values(record.facts||{}).every(f=>f.status==='UNKNOWN_NO_SOURCE'||f.status!=='SOURCE_REPORTED'||f.source_url&&f.exact_quote&&f.capture_date);
  }),x=>({row:x.row,source:'data/provider-facts-backfill-20260830.json',cards:x.revealed.surface.cards.map(c=>({id:c.id,sourceProgram:factInput.find(f=>f.program_id===canonical(c.id)?.program_id||f.program_id===c.id)?.program_id||null}))}),seen.filter(x=>x.archetype!=='D'));
  const eStates=()=>rowCheck('E molecule/brand/form/duration controls remain in E and preserve URL state on reload',x=>{
   const required=['SEMAGLUTIDE','TIRZEPATIDE','OZEMPIC','WEGOVY','WEGOVY_PILL','MOUNJARO','ZEPBOUND'];
   return required.every(v=>x.interactions.actions.some(a=>a.control.value===v&&!a.error&&a.persisted&&new URL(a.url).pathname==='/providers/'&&a.after.state.some(s=>s.value===v)))&&['type','plan','duration'].every(k=>x.interactions.actions.some(a=>a.control.key===k&&!a.error&&a.persisted));
  },x=>({row:x.row,actions:x.interactions.actions.map(a=>({key:a.control.key,value:a.control.value,url:a.url,persisted:a.persisted,error:a.error}))}),seen.filter(x=>x.archetype==='E'&&x.row!=='self-pay'));
  if(!['breadcrumbs','funnel'].includes(key))checks.push(shape(),geometry(),dark(),noJSCheck());
  if(!['breadcrumbs','funnel'].includes(key)&&note.id!=='RN-00319')checks.push(rowCheck('all segmented groups implement End/Home/arrows with a single roving stop',x=>every(x.keyboard,g=>!g.error&&g.steps.length===4&&g.steps.every(s=>s.roving===1&&s.selected===1)&&g.steps[0].active===g.enabled-1&&g.steps[1].active===0&&g.steps[2].active===(g.enabled>1?1:0)&&g.steps[3].active===0),x=>({row:x.row,keyboard:x.keyboard})),rowCheck('all visible filter targets named and >=44px high',x=>every(x.initial.interactive,c=>c.name?.trim()&&c.box.height>=44),x=>({row:x.row,controls:x.initial.interactive})));
  if(seen.some(x=>x.archetype==='B')&&!['breadcrumbs','funnel'].includes(key))checks.push(rowCheck('every B provider card exposes dose and four copay choices; each emitted choice responds locally',x=>every(x.localPrices,c=>c.controls.some(k=>/dose/i.test(k.name)&&k.visible)&&c.controls.some(k=>/copay/i.test(k.name)&&k.visible&&[0,25,50,75].every(v=>k.options.some(o=>o.text.includes(`$${v}`))))&&every(c.actions,a=>!a.error&&a.routeStable)&&c.actions.some(a=>a.changed)),x=>({row:x.row,localPrices:x.localPrices}),seen.filter(x=>x.archetype==='B')));
  const id=note.id;
  if(id==='RN-00319')checks.push(carouselCheck());
  if(id==='RN-00288')checks.push(hydration(),noJSCheck(),rowCheck('every E outcome remains on its configured listing with no brand panel',x=>new URL(x.url).pathname===new URL(x.route,origin).pathname&&x.dom.drugPanels===0));
  if(seen.some(x=>x.archetype!=='D')&&!['breadcrumbs','funnel'].includes(key))checks.push(factCoverage());
  if(['RN-00261','RN-00287','RN-00889','RN-02544','RN-02545','RN-02546','RN-02547','RN-02548','RN-02563','RN-02574','RN-02575','RN-02581'].includes(id))checks.push(groups(),hydration(),regionCheck());
  if(['RN-00261','RN-00287','RN-00889'].includes(id))checks.push(...cardChecks(),...imagery());
  if(['RN-00261','RN-00319'].includes(id))checks.push(terms(),rails(),gap('C2 touch containment and below-breakpoint transition','Wheel/key, full dialog focus cycle, Escape/outside-click and focus return are exercised; touchscreen scroll-boundary and viewport-transition rail behavior remain unexercised.'));
  if(id==='RN-00261')checks.push(rowCheck('required below-card funnel continuity',x=>x.archetype!=='E'||x.dom.funnelCount===1&&x.dom.funnelAfterGrid));
  if(['RN-00288','RN-00287','RN-02544'].includes(id))checks.push(check('single configured renderer dispatches every A/B/C/D/E kind and every mapped route integrates it',singleRenderer&&every(seen,x=>x.dom.archetype===x.archetype&&x.dom.grids===1),{rendererCalls,source_sha256:sha(rendererSource),rows:seen.map(x=>({row:x.row,archetype:x.dom.archetype}))}));
  if(id==='RN-00889')checks.push(carouselCheck(),check('Compare both paths instances point exactly to /self-pay/ without following',every([...(bothPaths||[]),...seen.flatMap(x=>x.initial.both)],href=>href==='/self-pay/'),{home:bothPaths,listings:seen.map(x=>({row:x.row,hrefs:x.initial.both}))}),gap('complete source entry-point CTA parity','Home/listing links inspected; hidden menu copies on other source entry points and seven medication/four bulk convergence require exhaustive entry-point linkage evidence.'));
  if(['RN-02547','RN-02563','RN-02574','RN-02575'].includes(id))checks.push(...lp(),disclosure());
  if(seen.some(x=>x.archetype==='D')&&!['breadcrumbs','funnel'].includes(key))checks.push(pharmacyOracle());
  if(['RN-02548','RN-02581'].includes(id))checks.push(...cardChecks());
  if(seen.some(x=>x.archetype==='E'&&x.row!=='self-pay')&&!['breadcrumbs','funnel'].includes(key)&&id!=='RN-00319')checks.push(population(),taxonomyCheck(),eStates(),gap('remaining price/product tuple oracle','Pinned registry taxonomy proves molecule/brand/form membership, but independent per-offer price ordering, self-pay qualified subset and Wegovy-pill product membership still need the offer join. provider_dynamic_profiles.taxonomy has separate brand_name_tags/delivery_form_tags, not a brand+form product tuple; do not infer pill eligibility from their cross product.'));
  if(id==='RN-02590')checks.push(rowCheck('separate row22 entry reproduces row21 initial IDs and selected state',x=>{const pair=observations.find(p=>p.row==='21');return pair&&same(x.initial.state,pair.initial.state)&&same(x.initial.cards.map(c=>c.id),pair.initial.cards.map(c=>c.id));}));
  if(['RN-02546','RN-02774'].includes(id))checks.push(rowCheck('every B FAQ opens/closes by keyboard with content inside configured panel',x=>every(x.expanded.details.filter(d=>d.panel),d=>!d.error&&d.open&&d.closed&&d.content.trim().length>d.name.trim().length),x=>({row:x.row,details:x.expanded.details.map(d=>({index:d.index,panel:d.panel,open:d.open,closed:d.closed,error:d.error}))})),...imagery(),gap('clean-room panel prose and assets','Local preserved images and dark/open-state behavior do not establish no reference-derived copy/assets; exact source provenance and semantic review remain independent.'));
  if(['RN-02545','RN-02546','RN-02547','RN-02544'].includes(id))checks.push(gap('numeric dose/copay oracle join','data/provider-facts-backfill-20260830.json was inspected and pinned: facts.total_monthly_cost.value is prose, not a normalized amount+drug+dose+duration tuple. The independent join to per-offer dose/price evidence is not implemented. No-JS, control presence/options and changed display are now measured separately.'));
  // Operator rule62 and subsequent layout-only clarification: preserve all26
  // occurrence IDs, but do not use body-copy or commercial/release certification
  // as substitutes for layout/control/state acceptance.
  const outsideLayout=new Set([
   'designated cold-cache LP performance certification',
   'source-qualified card fact equality and sponsored href byte custody',
   'every emitted provider has an independently bound fact record; reported facts carry quote/date/source',
   'remaining price/product tuple oracle','numeric dose/copay oracle join',
   'clean-room panel prose and assets',
   'independent outcome equivalence and LP-owner source custody'
  ]);
  const scopeDispositions=checks.filter(c=>outsideLayout.has(c.name)).map(c=>({predicate:c.name,disposition:'Outside listing layout/control/state acceptance under operator rule62; retained in original constituent contract'}));
  const layoutChecks=checks.filter(c=>!outsideLayout.has(c.name));
  const verified=layoutChecks.every(c=>c.status==='PASS');
  return {id:note.id,literal_requirement:note.literal_requirement,source_path:note.source_path,source_line:note.source_line,requirements_sha256:sha(note.literal_requirement),constituent_contracts:remaining,status:verified?'RESOLVED':'UNRESOLVED',scopeDispositions,checks:layoutChecks};
 });
 const resolved=rows.filter(x=>x.status==='RESOLVED').map(x=>x.id);
 const result={class:'shared-listing-template',viewport,denominator:expected.length,resolved_count:resolved.length,resolved,rows,observations,uniqueMechanisms:mechanismCache.size,mechanism_runtime_sha256:sha(fs.readFileSync(new URL('assets/site.js',root))),blocked_requests:blocked,self_certified:false,histogram_sha256:sha(histogramBytes),inventory_sha256:sha(inventoryBytes)};
 fs.mkdirSync(path.join(execution,'after'),{recursive:true});
 fs.writeFileSync(path.join(execution,'after',`${viewport}-listing-class.json`),JSON.stringify(result,null,2)+'\n');
 console.log(`GLP34_LISTING ${viewport} INDIVIDUAL_RESOLVED=${resolved.length}/26`);
 return resolved;
}
