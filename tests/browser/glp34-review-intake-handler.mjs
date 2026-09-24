import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {records,finish,check,root,execution,local} from './glp34-reader-copy-handler.mjs';
const ids=['RN-00110','RN-00113','RN-00150','RN-00151','RN-02087','RN-02095','RN-02140','RN-02141','RN-02142'];
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
// Independent source projection: no renderer, generated HTML, or runtime map supplies expectations.
function expectedRoster(){
 const registry=JSON.parse(read('data/program-registry.json')).programs;
 const pharmacies=JSON.parse(read('data/phase3-pharmacy-render-input.json')).entries;
 const excluded=registry.filter(p=>p.profiles?.['glp-clinic-scout']?.canonical_identity?.role==='alias');
 const providers=registry.filter(p=>!excluded.includes(p)&&/^\/reviews\/[a-z0-9-]+\/$/.test(p.review_path||''));
 const rows=[...providers.map(p=>({name:p.display_name,type:'provider'})),...pharmacies.filter(p=>String(p.display_name||'').trim()).map(p=>({name:p.display_name.trim(),type:'pharmacy'}))];
 const unique=[...new Map(rows.map(r=>[r.name,r])).values()].sort((a,b)=>a.name.localeCompare(b.name));
 return {rows:unique,excluded:excluded.map(p=>({id:p.program_id,name:p.display_name})),trace:['scripts/build-staging.mjs: program-registry.json -> assertDeclaredIdentityGroups -> reviewHubPrograms excludes aliasIds; same exclusion for homepage reviewPrograms','scripts/build-staging.mjs: phase3-pharmacy-render-input.json -> phase3PharmacyInput -> both intake renderers','src/pass2-review-hub.mjs: normalizedReviewRows requires review_path; governedEntityOptions deduplicates sorted display names; aliases disabled','assets/review-intake.js: exactEntityMap reads nondisabled datalist options; initializeCombobox filters by name/type'],sourceFiles:['data/program-registry.json','data/phase3-pharmacy-render-input.json','src/provider-identity.mjs'].map(file=>({file,sha256:hash(read(file))}))};
}
async function options(list){return list.locator('[role=option]:not(.cs-combobox__option--new) .cs-combobox__name').allTextContents();}
async function exercise(page,prefix,roster){
 const input=page.locator(`[data-review-entity="${prefix}"]`),list=page.locator(`[data-review-combobox="${prefix}"] [data-review-combobox-list]`);
 await input.fill('');await input.focus();await input.press('ArrowDown');
 const initial=await options(list),state=await input.evaluate(n=>({role:n.getAttribute('role'),list:n.getAttribute('list'),controls:n.getAttribute('aria-controls'),expanded:n.getAttribute('aria-expanded'),label:n.labels?.[0]?.textContent,placeholder:n.placeholder,value:n.value}));
 const geometry=await list.evaluate(n=>({height:n.clientHeight,scrollHeight:n.scrollHeight,overflow:getComputedStyle(n).overflowY}));
 await list.hover();await page.mouse.wheel(0,10000);await page.waitForTimeout(180);
 const wheel=await list.evaluate(n=>({top:n.scrollTop,lastBottom:n.lastElementChild?.getBoundingClientRect().bottom,bottom:n.getBoundingClientRect().bottom}));
 const mouse=[],keyboard=[],filter=[];
 // Each independently expected entity is chosen by real pointer, then real keyboard.
 // Full-list mouse selection forces scrolling rather than hiding the original truncation.
 for(const entity of roster){
  await input.fill('');await input.press('ArrowDown');
  const names=await options(list),index=names.indexOf(entity.name);
  if(index<0){mouse.push({name:entity.name,pass:false,reason:'absent from unfiltered list'});continue;}
  await list.locator('[role=option]').nth(index).click();
  mouse.push({name:entity.name,pass:await input.inputValue()===entity.name&&await input.getAttribute('aria-expanded')==='false'&&await input.evaluate(n=>n===document.activeElement)});
 }
 for(const entity of roster){
  await input.fill('');await input.pressSequentially(entity.name,{delay:0});
  const names=await options(list),expected=roster.filter(r=>r.name.toLocaleLowerCase().includes(entity.name.toLocaleLowerCase())).map(r=>r.name);
  filter.push({query:entity.name,expected,actual:names,pass:JSON.stringify(names)===JSON.stringify(expected)});
  const index=names.indexOf(entity.name);
  if(index<0){keyboard.push({name:entity.name,pass:false});continue;}
  for(let i=0;i<=index;i++)await input.press('ArrowDown');
  const active=await input.evaluate(n=>{const o=document.getElementById(n.getAttribute('aria-activedescendant'));return {id:o?.id,selected:o?.getAttribute('aria-selected'),name:o?.querySelector('.cs-combobox__name')?.textContent};});
  await input.press('Enter');keyboard.push({name:entity.name,active,pass:active.name===entity.name&&active.selected==='true'&&await input.inputValue()===entity.name&&await input.getAttribute('aria-expanded')==='false'});
 }
 await input.fill('');await input.press('ArrowDown');const first=await input.getAttribute('aria-activedescendant');
 await input.press('End');const end=await input.evaluate(n=>document.getElementById(n.getAttribute('aria-activedescendant'))?.querySelector('.cs-combobox__name')?.textContent);
 await input.press('Home');const home=await input.evaluate(n=>document.getElementById(n.getAttribute('aria-activedescendant'))?.querySelector('.cs-combobox__name')?.textContent);
 await input.press('Escape');await page.waitForTimeout(220);const escape=await input.getAttribute('aria-expanded')==='false';
 if(!await input.isVisible()&&await page.locator('[data-review-open]').count())await page.locator('[data-review-open]').first().click();
 await input.press('ArrowDown');await input.press('Tab');const tab=await input.getAttribute('aria-expanded')==='false';
 return {prefix,expected:roster,initial,state,geometry,wheel,mouse,keyboard,filter,first,end,home,escape,tab};
}
export async function reviewIntakeClass(page,origin,viewport){
 local(origin);const rows=records('review-intake-controls',ids),source=expectedRoster(),probes=[],requests=[];
 const guard=async route=>{const req=route.request();if(req.method()!=='GET'&&req.method()!=='HEAD'){requests.push({method:req.method(),path:new URL(req.url()).pathname});return route.abort();}if(new URL(req.url()).origin!==new URL(origin).origin)return route.abort();return route.continue();};
 await page.route('**/*',guard);
 try {
  for(const route of ['/reviews/submit/','/']){
   await page.goto(origin+route,{waitUntil:'domcontentloaded'});
   const notice=page.locator('#gcs-consent');if(await notice.isVisible()){const reject=notice.getByRole('button',{name:/reject|necessary|decline|not now/i}).first();if(await reject.count())await reject.click();}
   if(route==='/')await page.locator('[data-review-open]').first().click();
   await page.waitForSelector('[data-review-initialized="true"]');
   const form=page.locator('[data-review-intake]');
   const datalist=await page.locator('#review-provider-options option:not(:disabled)').evaluateAll(ns=>ns.map(n=>({name:n.value,type:n.dataset.reviewEntityType})));
   const honeypots=await form.locator('input[name=company]').evaluateAll(ns=>ns.map(n=>({type:n.type,tabindex:n.tabIndex,ariaHidden:n.getAttribute('aria-hidden'),disabled:n.disabled,rects:n.getClientRects().length,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,right:n.getBoundingClientRect().right,bottom:n.getBoundingClientRect().bottom,clip:getComputedStyle(n).clip,position:getComputedStyle(n).position,visibility:getComputedStyle(n).visibility,display:getComputedStyle(n).display})));
   const primary=await exercise(page,'primary',source.rows);
   await page.locator('[data-review-entity="primary"]').fill('');
   const action=form.locator('[data-review-next],[data-review-submit]').first();await action.click();
   const errors=await form.evaluate(f=>({summary:!f.querySelector('[data-review-summary]').hidden,focus:document.activeElement?.name,summaryFocused:document.activeElement===f.querySelector('[data-review-summary]'),actionEnabled:[...f.querySelectorAll('[data-review-next],[data-review-submit]')].every(n=>!n.disabled),fields:[...f.querySelectorAll('[required]')].filter(n=>n.getClientRects().length||n.type==='radio').map(n=>({name:n.name,type:n.type,valid:n.validity.valid,label:!!n.labels?.length||!!n.closest('fieldset')?.querySelector('legend'),invalid:n.getAttribute('aria-invalid'),described:n.getAttribute('aria-describedby'),inline:!!n.closest('.p5-field,.cs-combobox,.p5-check,fieldset')?.querySelector('.cs-field-error')}))}));
   const counterpart=[];
   if(route!=='/'){
    // Safe local fixture fields only; never advance into any submit/skip action.
    await form.locator('[name=public_display_name]').fill('UI test');await form.locator('[name=verification_email]').fill('ui-test@example.invalid');
    await form.locator('[name=primary_headline]').fill('Local UI validation');await form.locator('[name=primary_review_body]').fill('Local browser-only form navigation fixture without personal or health information.');
    await form.locator('[name=primary_experience_date]').fill('2026-01-01');
    await form.locator('label:has(input[name="rating"][value="3"])').click();
    assert.equal(await form.locator('[name=rating][value="3"]').isChecked(),true,'associated star label selects its radio');
    await form.locator('[name=combined_attestation]').check();
    for(const type of ['provider','pharmacy']){
     await page.locator('[data-review-entity="primary"]').fill(source.rows.find(r=>r.type===type).name);
     await form.locator('[data-review-next]').click();
     counterpart.push(await exercise(page,'counterpart',source.rows.filter(r=>r.type!==type)));
     await form.locator('[data-review-back]').click();
    }
   }
   probes.push({route,datalist,honeypots,primary,counterpart,errors,action:await form.getAttribute('action'),method:await form.getAttribute('method')});
  }
 } finally {await page.unroute('**/*',guard);}
 const all=probes.flatMap(p=>[p.primary,...p.counterpart]);
 const roster=check('independent source roster equals data source on both surfaces',source.rows.length>9&&probes.every(p=>JSON.stringify(p.datalist)===JSON.stringify(source.rows)),source);
 const reach=check('every source entity selectable by pointer and keyboard; exact type filtering',all.every(p=>p.mouse.length===p.expected.length&&p.keyboard.length===p.expected.length&&p.mouse.every(r=>r.pass)&&p.keyboard.every(r=>r.pass)&&p.filter.every(r=>r.pass)&&JSON.stringify(p.initial)===JSON.stringify(p.expected.map(r=>r.name))),all.map(p=>({prefix:p.prefix,count:p.expected.length,mouse:p.mouse.filter(r=>!r.pass),keyboard:p.keyboard.filter(r=>!r.pass),filter:p.filter.filter(r=>!r.pass)})));
 const scroll=check('existing list has overflow and real wheel scroll reaches final option',all.every(p=>p.geometry.scrollHeight>p.geometry.height&&['auto','scroll'].includes(p.geometry.overflow)&&p.wheel.top>0&&p.wheel.lastBottom<=p.wheel.bottom+2),all.map(p=>({geometry:p.geometry,wheel:p.wheel})));
 const semantic=check('one custom popup with real label/search placeholder and ARIA state',all.every(p=>!p.state.list&&p.state.role==='combobox'&&p.state.controls&&p.state.label&&p.state.value===''&&p.escape&&p.tab),all.map(p=>p.state));
 const hidden=check('real honeypot retained, enabled, invisible and excluded from tab order',probes.every(p=>p.honeypots.length>0&&p.honeypots.every(h=>!h.disabled&&h.tabindex===-1&&(h.rects===0||h.display==='none'||h.visibility==='hidden'||h.width<=1&&h.height<=1||h.position==='absolute'&&(h.right<=0||h.bottom<=0)||h.clip==='rect(0px, 0px, 0px, 0px)'))),probes.map(p=>p.honeypots));
 const accessible=check('all invalid fields have accessible names, inline errors and ARIA error descriptions; summary focus',probes.every(p=>p.errors.summary&&p.errors.summaryFocused&&p.errors.actionEnabled&&p.errors.fields.every(f=>f.label&&(f.valid||f.invalid==='true'&&f.described&&f.inline))),probes.map(p=>p.errors));
 const keys=check('Home/End reach first/last option',all.every(p=>p.home===p.expected[0].name&&p.end===p.expected.at(-1).name),all.map(p=>({home:p.home,end:p.end,expected:p.expected.map(r=>r.name)})));
 const script=read('assets/review-intake.js'),template=read('src/pass2-review-hub.mjs');
 const preserved=JSON.parse(fs.readFileSync(path.join(execution,'before/review-intake-preservation.json'),'utf8'));
 const effects=check('existing submission handler and effect path bytes preserved; local binding and zero write attempts',hash(script.slice(script.indexOf('  const submitIntake = async'),script.indexOf('  form.addEventListener("input"')))===preserved.submissionSha256&&hash(script.slice(0,script.indexOf('/* ---- styled inline validation')))===preserved.payloadSha256&&probes.every(p=>p.action==='/api/review-capture'&&p.method==='post')&&requests.length===0,{submissionSha256:preserved.submissionSha256,payloadSha256:preserved.payloadSha256,requests});
 const comboLine=template.split('\n').find(l=>l.includes('data-review-combobox="${prefix}"'));
 const noNative=check('renderer custom combobox source omits list= while retaining datalist',!!comboLine&&!comboLine.includes('list="review-provider-options"')&&template.includes('<datalist id="review-provider-options">'),comboLine);
 const byID={'RN-00110':[hidden],'RN-00113':[roster,reach,scroll,semantic],'RN-00150':[roster,reach,scroll],'RN-00151':[roster,reach,scroll,semantic],'RN-02087':[roster,reach,scroll],'RN-02095':[noNative,roster,semantic],'RN-02140':[noNative,accessible],'RN-02141':[semantic,keys,effects],'RN-02142':[scroll]};
 return finish(viewport,'review-intake-controls','review-intake',rows.map(r=>({...r,checks:byID[r.id],verified_compounds:byID[r.id].every(c=>c.status==='PASS')?(r.compound_effects||[]).map(c=>c.effect):[]})),{source,probes,requests,effects});
}
