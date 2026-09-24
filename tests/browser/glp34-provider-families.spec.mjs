import { test, expect } from '@playwright/test';
import { auditCopyClass } from './glp34-audit-copy-handler.mjs';
import { provenanceClass } from './glp34-provenance-handler.mjs';
import { identityClass } from './glp34-identity-handler.mjs';
import { layoutClass } from './glp34-layout-handler.mjs';
import { listingClass } from './glp34-listing-handler.mjs';
import { surfaceClasses } from './glp34-surface-handlers.mjs';
import { readerCopyClass } from './glp34-reader-copy-handler.mjs';
import { motionClass } from './glp34-motion-handler.mjs';
import { filtersClass } from './glp34-filters-handler.mjs';
import { reviewIntakeClass } from './glp34-review-intake-handler.mjs';
import { imageryClasses } from './glp34-imagery-handler.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
const root='/home/ubuntu/business/site-system/flagship-v2/candidates/glp34-provider-families-20260912';
const evidence='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
const freezePath='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-A/reference-freeze.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const freezeBytes=fs.readFileSync(freezePath);
const freeze=JSON.parse(freezeBytes);
const freezeSha='51dfc9ba19d71a0f4329dcab49224f398822030c64e509b23ffe98d7fa91b8f3';
const sourceRows=freeze.baseline_rows.map((row,index)=>({id:`baseline_rows/${index}`,...row})).filter(row=>row.owner_family==='D');
const notes=freeze.retained_notes.filter(row=>row.owner_family==='D');
const canonical=freeze.canonical_D_records.filter(row=>row.primary_family==='D'||JSON.stringify(row.cross_family_references).includes('D'));
const sourceStatePath='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-A/raw/recertified-d-states/pharmacies-semaglutide-desktop.json';
const state=JSON.parse(fs.readFileSync(sourceStatePath));
const stateUrl=state.after?.url;
const beforeHashes=path.join(evidence,'before','immutable-input-hashes.json');
const changed=fs.existsSync(beforeHashes)&&JSON.parse(fs.readFileSync(beforeHashes)).assets['assets/site.js']!==sha(fs.readFileSync(path.join(root,'assets/site.js')));
const dir=path.join(evidence,changed?'after':'before');
let server,origin;
function write(name,value){fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n');}
function hashes(folder){const result={};const visit=p=>{for(const entry of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,entry.name);if(entry.isDirectory())visit(f);else if(entry.isFile())result[path.relative(root,f)]=sha(fs.readFileSync(f));}};visit(folder);return result;}
test.beforeAll(async()=>{
 expect(sha(freezeBytes)).toBe(freezeSha);expect(freeze.status).toBe('FROZEN');
 expect(sourceRows.length).toBeGreaterThan(0);expect(notes.length).toBeGreaterThan(0);
 expect(typeof stateUrl).toBe('string');expect(new URL(stateUrl).searchParams.get('pharmacyDrug')).toBe('semaglutide');
 fs.mkdirSync(dir,{recursive:true});
 const inventoryPath=path.join(dir,'source-inventory.json');
 if(!fs.existsSync(inventoryPath))write('source-inventory.json',{freezePath,freezeSha,sourceRows,notes,canonical,S26:freeze.S26_disposition_rows,states:freeze.graph.interaction_states,scope:'Complete source-occurrence census; NOT a resolved unique-obligation denominator or implementation coverage.'});
 if(!fs.existsSync(path.join(dir,'immutable-input-hashes.json')))write('immutable-input-hashes.json',{assets:hashes(path.join(root,'assets')),data:hashes(path.join(root,'data'))});
 server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');let target=path.join(root,'public',decodeURIComponent(u.pathname));if(!target.startsWith(root+'/public/')){res.writeHead(403);return res.end();}try{if(fs.statSync(target).isDirectory())target=path.join(target,'index.html');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch{res.writeHead(404);res.end('Not found');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});
for(const [viewport,size] of Object.entries({desktop:{width:1440,height:1000},mobile:{width:390,height:844}})){
 test(`frozen-families ${viewport}`,async({browser})=>{
  test.setTimeout(900000);
  const context=await browser.newContext({viewport:size,serviceWorkers:'block'});
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());return u.origin===origin&&req.method()==='GET'&&!u.pathname.startsWith('/go/')?route.continue():route.abort();});
  try{
   const page=await context.newPage();
   page.setDefaultTimeout(10000);
   const auditHandled=await auditCopyClass(page,origin,viewport);
   const provenanceHandled=await provenanceClass(page,origin,viewport);
   const identityHandled=await identityClass(page,origin,viewport);
   const layoutHandled=await layoutClass(page,origin,viewport);
   const listingHandled=await listingClass(page,origin,viewport);
   const surfaceHandled=await surfaceClasses(page,origin,viewport);
   const readerHandled=await readerCopyClass(page,origin,viewport);
   const motionHandled=await motionClass(page,origin,viewport);
   const filtersHandled=await filtersClass(page,origin,viewport);
   const reviewHandled=await reviewIntakeClass(page,origin,viewport);
   const imageryHandled=await imageryClasses(page,origin,viewport);
   const u=new URL(stateUrl);const local=origin+u.pathname+'/'+u.search;
   const response=await page.goto(local,{waitUntil:'networkidle'});
   const observed=await page.locator('[data-pharmacy-med]').inputValue();
   const screenshot=path.join(dir,`${viewport}-pharmacy-query.png`);await page.screenshot({path:screenshot,fullPage:true});
   const record={viewport,sourceStatePath,sourceStateSha:sha(fs.readFileSync(sourceStatePath)),frozenUrl:stateUrl,localUrl:local,status:response.status(),expected:'semaglutide',observed,screenshot,source_occurrences:sourceRows.length,note_occurrences:notes.length,complete_family_coverage:false};
   write(`${viewport}-baseline.json`,record);console.log(`GLP34_QUERY_BASELINE ${viewport} expected=semaglutide observed=${observed} status=${response.status()} complete_family_coverage=false`);
   expect(response.status()).toBe(200);expect(observed,'Frozen pharmacyDrug must hydrate the independent medication filter; provider drug must not override it').toBe('semaglutide');
   const med=page.locator('[data-pharmacy-med]'),type=page.locator('[data-pharmacy-class]');
   const openFilters=async()=>{if(!await med.isVisible())await page.getByRole('button',{name:'Pharmacy filters',exact:true}).click();};
   const transitions=[];
   for(const pathway of ['all','503a','503b'])for(const medication of ['all','semaglutide','tirzepatide']){
    await openFilters();
    await type.selectOption(pathway);await med.selectOption(medication);
    const url=new URL(page.url());
    expect(url.searchParams.get('pharmacyType')).toBe(pathway==='all'?null:pathway.toUpperCase());
    expect(url.searchParams.get('pharmacyDrug')).toBe(medication==='all'?'BOTH':medication);
    expect(url.searchParams.get('drug')).toBe('TIRZEPATIDE');expect(url.searchParams.get('region')).toBe('CA');
    await page.reload({waitUntil:'networkidle'});expect(await type.inputValue()).toBe(pathway);expect(await med.inputValue()).toBe(medication);
    transitions.push({pathway,medication,url:page.url(),reload:true});
   }
   await openFilters();await med.selectOption('semaglutide');await med.selectOption('all');await page.goBack();expect(await med.inputValue()).toBe('semaglutide');
   write(`${viewport}-pharmacy-query-regression.json`,{transitions,back_navigation:true,source_data_unchanged:sha(fs.readFileSync(path.join(root,'data/phase3-pharmacy-render-input.json')))===JSON.parse(fs.readFileSync(beforeHashes)).data['data/phase3-pharmacy-render-input.json']});
   console.log(`GLP34_PHARMACY_QUERY_REGRESSION ${viewport} PASS 9/9 reload-and-back provider-query-preserved`);
   // This necessary gate is implemented first. Full-family acceptance is not certified until
   // source occurrences have semantic handlers. Keep unresolved obligations explicit, never green.
   await page.goto(origin+'/pharmacies/',{waitUntil:'networkidle'});
   const source=JSON.parse(fs.readFileSync(path.join(root,'data/phase3-pharmacy-render-input.json')));
   const eligible=source.entries.filter(e=>e.locations?.status==='source_backed'&&e.services?.status==='source_backed'&&e.locations.items.some(i=>typeof i==='string'?i.trim():i?.address||i?.city||i?.state)&&e.services.items.some(i=>String(i||'').trim())&&e.evidence_summary?.citation_count&&e.evidence_summary.source_classes?.length&&e.evidence_summary.last_researched_date);
   expect(eligible.length).toBeGreaterThan(0);
   const cards=await page.locator('[data-pharmacy-card]').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,href:n.getAttribute('href'),nested:n.querySelectorAll('a,button,input,select').length,name:n.querySelector('h2')?.textContent})));
   expect(cards.map(c=>c.href).sort()).toEqual(eligible.map(e=>e.route).sort());
   for(const card of cards){expect(card.tag).toBe('A');expect(card.nested).toBe(0);expect(card.name.trim()).not.toBe('');}
   const first=page.locator('[data-pharmacy-card]:visible').first();const destination=await first.getAttribute('href');await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),first.click()]);expect(new URL(page.url()).pathname).toBe(destination);expect((await page.locator('main').innerText()).length).toBeGreaterThan(100);
   const detailReadbacks=[];
   expect(source.entries.length).toBeGreaterThan(0);expect(new Set(source.entries.map(e=>e.route)).size).toBe(source.entries.length);
   for(const entry of source.entries){
    expect(entry.route.startsWith('/pharmacies/')).toBe(true);expect(entry.display_name.trim()).not.toBe('');
    const detailResponse=await page.goto(origin+entry.route,{waitUntil:'domcontentloaded'});
    const h1=await page.locator('main h1').innerText();const body=await page.locator('main').innerText();
    expect(detailResponse.status(),entry.route).toBe(200);expect(h1.toLowerCase(),entry.route).toContain(entry.display_name.toLowerCase());expect(body.length,entry.route).toBeGreaterThan(100);
    detailReadbacks.push({route:entry.route,status:detailResponse.status(),h1,body_characters:body.length});
    write(`${viewport}-all-pharmacy-details.json`,{expected:source.entries.map(e=>e.route),rows:detailReadbacks});
   }
   const handled=['RN-02758','RN-02993','RN-EXTRA-3664'];
   expect(handled.every(id=>notes.some(n=>n.id===id))).toBe(true);
   write(`${viewport}-pharmacy-card-regression.json`,{expected:eligible.map(e=>e.route),cards,clicked:destination,handled_occurrences:handled});
   console.log(`GLP34_PHARMACY_CARD_REGRESSION ${viewport} PASS ${cards.length}/${eligible.length} details=${detailReadbacks.length}/${source.entries.length} handled_occurrences=${handled.length}`);
   handled.push(...[...new Set([...auditHandled,...provenanceHandled,...identityHandled,...layoutHandled,...listingHandled,...readerHandled,...motionHandled,...filtersHandled,...reviewHandled,...Object.values(imageryHandled).flat(),...Object.values(surfaceHandled).flat()])].filter(id=>!handled.includes(id)));
   console.log(`GLP34_RESOLVED ${viewport} ${handled.length}/378`);
   const unresolved=notes.filter(note=>note.record_kind!=='source_context'&&!handled.includes(note.id)).map(note=>note.id);
   write(`${viewport}-unresolved-obligations.json`,{unresolved,handled,denominator:378,full_family_coverage:false});
   expect(unresolved.length,'Unreconciled semantic obligation handlers; no full-family PASS is authorized').toBe(0);
  }finally{await context.close();}
 });
}
