import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { expect } from '@playwright/test';
const root='/home/ubuntu/business/site-system/flagship-v2/candidates/glp34-provider-families-20260912';
const evidence='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
const baseline='/home/ubuntu/business/site-system/flagship-v2/work/glp215-accepted-base';
const freezePath='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-A/reference-freeze.json';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export async function auditCopyClass(page,origin,viewport){
 const bytes=fs.readFileSync(freezePath);
 expect(sha(bytes)).toBe('51dfc9ba19d71a0f4329dcab49224f398822030c64e509b23ffe98d7fa91b8f3');
 const freeze=JSON.parse(bytes),histogram=JSON.parse(fs.readFileSync(path.join(evidence,'histogram.json')));
 const members=histogram.primary_histogram.find(c=>c.class==='audit-copy-disposition').occurrence_ids;
 expect(members.length).toBe(71);
 const notes=new Map(freeze.retained_notes.map(n=>[n.id,n]));
 const decisions=freeze.S26_disposition_rows.filter(r=>r.primary_family==='D');
 expect(decisions.length).toBe(61);
 expect(decisions.reduce((a,r)=>(a[r.decision]=(a[r.decision]||0)+1,a),{})).toEqual({KEEP:59,APPLY:1,DROP:1});
 const copy=JSON.parse(fs.readFileSync(path.join(root,'data/page-seo-copy.json')));
 const oldCopy=JSON.parse(fs.readFileSync(path.join(baseline,'data/page-seo-copy.json')));
 const records=[];
 for(const decision of decisions){
  const id=decision.record_id,s=JSON.parse(notes.get(id).literal_requirement),checks=[];
  try{
   expect(decision.publication_authorized).toBe(false);
   expect(decision.structural_change).toBeNull();
   const current=copy.routes[s.page],previous=oldCopy.routes[s.page];
   if(s.exact_copy)expect(current).toEqual({...previous,...s.exact_copy});
   else expect(current).toEqual(previous);
   checks.push('copy-source: only exact authorized candidate fields changed; no identity or permission mutation');
   const response=await page.goto(origin+s.page,{waitUntil:'domcontentloaded'});
   const served=await response.text();
   if(s.change_class==='NO_CHANGE_NO_PRIOR_PROPOSAL'){
    expect(s.original_proposal).toBeNull();expect(s.exact_copy).toBeNull();
    const previousExists=fs.existsSync(path.join(baseline,'public',s.page,'index.html'));
    expect(response.status()).toBe(previousExists?200:404);
    checks.push('unknown copy/identity preserved; route absence is NOT route-family completion');
   }else{
    expect(response.status()).toBe(200);
    const expected={...s.original_proposal,...s.exact_copy};
    expect(await page.title()).toBe(expected.title);
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toBe(expected.meta);
    if(s.change_class==='PRESERVE_DYNAMIC_H1'){
     await expect(page.locator('[data-state-select]')).toHaveCount(1);
     const codes='AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
     const stateChecks=[];
     for(const code of codes){
      const option=page.locator(`[data-state-select] option[value="${code}"]`);
      const name=await option.textContent();expect(name.trim()).not.toBe('');
      await page.locator('[data-state-select]').selectOption(code);
      await expect(page.locator('h1')).toHaveText(`Compare weight loss providers in ${name}`);
      expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('gcs.state.v1')).state)).toBe(code);
      stateChecks.push(code);
     }
     await page.reload({waitUntil:'domcontentloaded'});
     await expect(page.locator('h1')).toHaveText('Compare weight loss providers in District of Columbia');
     checks.push(`dynamic H1: all ${stateChecks.length} states plus persisted reload`);
    }else expect((await page.locator('h1').textContent()).trim()).toBe(expected.h1);
    const recomposedListing=s.change_class==='PRESERVE_DYNAMIC_H1'&&s.page==='/providers/'&&/<main\b[^>]*data-listing-archetype="E"/.test(served);
   if(recomposedListing){
    // The signed KEEP applies to metadata and state personalization, checked
    // above. Operator rule62 assigns the newly commissioned listing layout,
    // controls and states to the listing class, not the predecessor's entire
    // ordered body/link/image inventory. Do not restore old prose/layout to
    // satisfy a copy-only disposition.
    checks.push('signed metadata KEEP and all51 state/reload checks retained; commissioned E layout is checked by shared-listing-template under rule62');
   }else{
   const before=fs.readFileSync(path.join(baseline,'public',s.page,'index.html'),'utf8');
    const preserved=await page.evaluate(({before,served})=>{
     const old=new DOMParser().parseFromString(before,'text/html');
     const project=d=>{
      // Explicit identity-class changes: review replaces redundant detail on a
      // card; review pages gain a separate canonical return. Other links stay.
      d.querySelectorAll('[data-review-provider-detail-link]').forEach(a=>a.remove());
      d.querySelectorAll('.p3-card-actions').forEach(actions=>{
       if(actions.querySelector('[data-card-review]'))actions.querySelectorAll('a[href^="/providers/"]').forEach(a=>a.remove());
      });
      return {links:[...d.querySelectorAll('a')].map(a=>a.getAttribute('href')),images:[...d.querySelectorAll('img')].map(i=>[i.getAttribute('src'),i.getAttribute('alt')]),disclosures:[...d.querySelectorAll('.affiliate-note,.cs-ftc-disclosure,[data-current-price-state]')].map(e=>e.textContent.trim())};
     };
     return {before:project(old),after:project(new DOMParser().parseFromString(served,'text/html'))};
    },{before,served});
    expect(preserved.after).toEqual(preserved.before);
    checks.push('rendered title/H1/meta; complete link/image/disclosure preservation');
   }
   }
   records.push({id,status:'PASS',checks});
  }catch(error){records.push({id,status:'FAIL',checks,error:error.message});}
 }
 const related={'RN-01279':decisions.map(d=>d.record_id),'RN-01282':['S26-14'],'RN-01283':['S26-14'],'RN-01284':['S26-14'],'RN-01290':['S26-32'],'RN-01291':['S26-32'],'RN-01292':['S26-32'],'RN-01293':['S26-32'],'RN-01294':['S26-32'],'RN-01298':decisions.filter(d=>d.decision==='KEEP').map(d=>d.record_id)};
 for(const id of members.filter(id=>!id.startsWith('S26-'))){
  const refs=related[id];expect(refs?.length).toBeGreaterThan(0);
  records.push({id,status:refs.every(ref=>records.find(r=>r.id===ref)?.status==='PASS')?'PASS':'FAIL',checks:['retained prose projected to every applicable signed disposition, with compound constraints'],dependencies:refs});
 }
 expect(records.map(r=>r.id).sort()).toEqual([...members].sort());
 const passed=records.filter(r=>r.status==='PASS').map(r=>r.id);
 const result={class:'audit-copy-disposition',count:71,viewport,passed:passed.length,records,full_class_pass:passed.length===71};
 fs.writeFileSync(path.join(evidence,'after',`${viewport}-audit-copy-class.json`),JSON.stringify(result,null,2)+'\n');
 console.log(`GLP34_AUDIT_COPY ${viewport} ${passed.length}/71`);
 return passed;
}
