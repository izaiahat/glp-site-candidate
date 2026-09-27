import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
let proxy;
test.beforeAll(async()=>{
 proxy=http.createServer((req,res)=>{res.writeHead(502);res.end()});
 proxy.on('connect',(req,socket)=>socket.end('HTTP/1.1 502 Denied\r\n\r\n'));
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
});
test.afterAll(async()=>{await new Promise(resolve=>proxy.close(resolve))});
import {consentRuntimeSource} from '../../src/consent-runtime.mjs';
const ROOT=path.resolve('.'),PUBLIC=process.env.GLP_REVIEW_PUBLIC_ROOT||path.join(ROOT,'public');
const consent=process.env.GLP44_SOURCE_TEST==='1'?consentRuntimeSource:readFileSync(path.join(PUBLIC,'assets/consent.js'),'utf8');
const sdk=readFileSync(path.join(ROOT,'tests/fixtures/ga4/gtag.js'));
const SHA='c99a83ab9a4f9b26226657e466ddcefff8a009eac12c2627b857049b21a2c181';
const origin='https://glpclinicscout.com',sdkUrl='https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer';
const canary='PRIVATE_CANARY_dose_condition_email@example.invalid';
const policyText=readFileSync(process.env.GLP44_SOURCE_TEST==='1'?path.join(ROOT,'artifacts/build4-preservation/_headers'):path.join(PUBLIC,'_headers'),'utf8');
const csp=policyText.split('\n').find(l=>l.trim().startsWith('Content-Security-Policy:')).trim().replace(/^Content-Security-Policy:\s*/,'');
const referrerPolicy=policyText.split('\n').find(l=>l.trim().startsWith('Referrer-Policy:')).trim().replace(/^Referrer-Policy:\s*/,'');
import {decode,safe,recordGARequest} from '../helpers/ga4-wire-oracle.mjs';
async function fixture(browser,info,{gpc=false,pending=false}={}){
 expect(createHash('sha256').update(sdk).digest('hex')).toBe(SHA);
 const device=Object.fromEntries(['viewport','screen','isMobile','hasTouch','deviceScaleFactor'].filter(k=>info.project.use[k]!==undefined).map(k=>[k,info.project.use[k]]));
 const context=await browser.newContext({...device,proxy:{server:`http://127.0.0.1:${proxy.address().port}`,bypass:'<-loopback>'},serviceWorkers:'block',userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'});
 await context.addInitScript(({gpc})=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,get:()=>gpc});window.__violations=[];document.addEventListener('securitypolicyviolation',e=>window.__violations.push(e.blockedURI));},{gpc});
 const rows=[],requests=[],unknown=[],errors=[];let phase='initial',release,documentUrl;
 const barrier=new Promise(r=>release=r);
 // Context-wide routes precede all documents, including popups. Never continue,
 // fetch or forward: public Google bytes are hash-pinned and served from disk.
 await context.route('**/*',async route=>{
  const req=route.request(),row=recordGARequest(req,documentUrl,phase,requests,rows,unknown);
  if(row.category==='consent')return route.fulfill({contentType:'text/javascript',body:consent});
  if(row.category==='document'){
   return route.fulfill({headers:{'Content-Type':'text/html','Content-Security-Policy':csp,'Referrer-Policy':referrerPolicy},body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${canary}</title><style>main{padding-top:2rem;overflow-wrap:anywhere}main a{display:block}input,select{box-sizing:border-box;max-width:100%}</style><link rel="canonical" href="${origin}/about/"><script>window.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};window.GCS_ANALYTICS={enabled:true,measurement_id:'G-2WQ42JY0WK'};</script><script defer src="/consent.js"></script><main style="height:3200px"><h1>Contained GA test</h1><form id="${canary}" action="/?q=${canary}"><label>Private value<input name="health_condition" type="email"></label><select aria-label="Medication" name="medication_selection"><option>${canary}</option></select><button type="submit">Submit private form</button><a href="https://outbound.invalid/${canary}">Form link</a></form><a id="out" data-ga4-ordinary="outbound" href="https://outbound.invalid/${canary}?email=${canary}">${canary}</a><a id="file" data-ga4-ordinary="download" href="/files/${canary}.pdf?email=${canary}" download="${canary}">Download</a></main><footer style="position:fixed;top:0;right:0"><a href="/privacy/cookies/">Cookie choices</a></footer><script>document.addEventListener('submit',e=>e.preventDefault());document.addEventListener('click',e=>{if(e.target.closest('#out,#file,form a'))e.preventDefault()});</script>`});
  }
  if(row.category==='sdk')return route.fulfill({contentType:'text/javascript',body:sdk});
  if(row.collect){if(pending){await barrier;return route.abort('failed')}return route.fulfill({status:204,body:''});}
  return route.abort();
 });
 await context.routeWebSocket('**/*',ws=>{unknown.push({websocket:ws.url()});ws.close()});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 return {context,page,rows,unknown,release,phase:v=>phase=v,
  async load(route='/about/',referer='https://search.invalid/?q='+canary) {const target=new URL(origin+route+'?q='+encodeURIComponent(canary)+'&gclid='+canary+'&utm_campaign='+canary+'&utm_source='+canary+'&cs_click_id='+canary+'#'+canary);documentUrl=target.origin+target.pathname+target.search;await page.goto(target.href,{referer});await page.evaluate(()=>window.GCSConsentReady);},
  async loaded(){await expect.poll(()=>decode(rows).filter(e=>e.en==='page_view').length).toBe(1)},
  async revoke(){await page.getByRole('link',{name:'Cookie choices',exact:true}).click();expect(await page.evaluate(()=>Array.from(window.gcsGa4Layer).filter(x=>x[0]==='event').map(x=>x[1]))).toEqual(['page_view']);phase='withdrawn';await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();expect(await page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);expect(await page.evaluate(()=>Array.from(window.gcsGa4Layer).filter(x=>x[0]==='consent').at(-1)[2])).toEqual({analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});},
  async close(primaryError){
   if(this.closed)return;this.closed=true;release();let teardownError,violations;
   try{violations=await page.evaluate(()=>window.__violations);expect(unknown).toEqual([]);expect(errors).toEqual([]);expect(violations).toEqual([])}catch(error){teardownError=error}
   try{await info.attach('ga4-contained-wire',{body:JSON.stringify({sdk_sha256:SHA,consent_file:'assets/consent.js',consent_sha256:createHash('sha256').update(consent).digest('hex'),headers_file:'_headers',headers_sha256:createHash('sha256').update(policyText).digest('hex'),source_only_diagnostic:process.env.GLP44_SOURCE_TEST==='1',probe:process.env.GLP_CONSENT_SOURCE_PROBE==='1',requests,rows,unknown,errors,violations,teardown_error:teardownError?String(teardownError):null}),contentType:'application/json'})}catch(error){teardownError||=error}finally{await context.close().catch(error=>{teardownError||=error})}
   if(teardownError&&!primaryError)throw teardownError;
  }
 };
}
test('GLP44 default-on actual GA SDK minimizes page and enhanced events',async({browser},info)=>{
 const f=await fixture(browser,info);try{
  await f.load();await f.loaded();expect(await f.page.evaluate(()=>window.GCSConsent.read().analytics_basis)).toBe('global_default');
  await f.page.locator('form a').click();
  await f.page.locator('#out').click();await f.page.locator('#file').click();
  await f.page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await expect.poll(()=>decode(f.rows).filter(e=>['scroll','click','file_download'].includes(e.en)).map(e=>e.en).sort()).toEqual(['click','file_download','scroll']);
  await f.page.getByRole('button',{name:'Got it',exact:true}).click();
  await f.page.waitForTimeout(1200);safe(f.rows,'/about/');
  const config=await f.page.evaluate(()=>Array.from(window.gcsGa4Layer).find(x=>x[0]==='config')[2]);
  expect(config).toMatchObject({allow_google_signals:false,allow_ad_personalization_signals:false,allow_enhanced_conversions:false,ae_block_form:true,send_page_view:false});
  expect(decode(f.rows).filter(e=>e.en==='page_view')).toHaveLength(1);
  const count=decode(f.rows).length;
  await f.page.getByRole('textbox',{name:'Private value'}).fill(canary);
  await f.page.getByRole('button',{name:'Submit private form'}).click();
  await f.page.locator('#out').click();await f.page.waitForTimeout(1500);
  expect(await f.page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);
  expect(decode(f.rows)).toHaveLength(count);safe(f.rows,'/about/');
  // Counterexamples exercise this same rejecting wire oracle, not SDK traffic.
  for(const field of ['email','quiz_answers','health_condition','medication_selection','form_contents','search_term','cs_click_id','provider_slug','sub1','unknown_property']){
   const mutant=structuredClone(f.rows),row=mutant.find(r=>r.collect),url=new URL(row.url);url.searchParams.set('ep.'+field,canary);row.url=url.href;
   expect(()=>safe(mutant,'/about/')).toThrow();
  }
 }catch(error){await f.close(error);throw error}finally{await f.close()}
 // Four additional isolated harness invocations; original /about/ actions above
 // remain intact. Same registered case, all five exact emitted-runtime positives.
 for(const route of ['/','/privacy/','/privacy/cookies/','/terms/']){
  const f=await fixture(browser,info);try{await f.load(route);await f.loaded();safe(f.rows,route);expect(decode(f.rows).filter(e=>e.en==='page_view')).toHaveLength(1)}catch(error){await f.close(error);throw error}finally{await f.close()}
 }
});
test('GLP44 individualized and unclassified routes never load GA or export input events',async({browser},info)=>{
 for(const route of ['/quiz/provider-fit/','/matches/','/lp/quiz/','/results/','/providers/','/guides/semaglutide/','/about/']){
  const f=await fixture(browser,info);try{
   await f.load(route,route==='/about/'?origin+'/matches/?email='+canary:undefined);await f.page.getByRole('textbox',{name:'Private value'}).fill(canary);await f.page.getByRole('button',{name:'Submit private form'}).click();await f.page.locator('#out').click();await f.page.locator('#file').click();await f.page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await f.page.waitForTimeout(300);
   expect(f.rows).toEqual([]);expect(await f.page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);
  }catch(error){await f.close(error);throw error}finally{await f.close()}
 }
});
test('GLP44 GPC prevents GA load and collection on initial and later pages',async({browser},info)=>{
 for(const initialGpc of [true,false]){
  const f=await fixture(browser,info,{gpc:initialGpc});try{
   await f.load();
   if(!initialGpc){await f.loaded();await f.page.evaluate(()=>{Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true});window.dispatchEvent(new Event('focus'))});}
   const before=f.rows.length;
   expect(await f.page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);
   expect(await f.page.evaluate(()=>window.GCSConsent.effective())).toBe('denied');
   for(const route of ['/about/','/quiz/provider-fit/','/matches/']){await f.load(route);await f.page.waitForTimeout(300);expect(f.rows).toHaveLength(before);expect(await f.page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);expect(await f.page.evaluate(()=>window.GCSConsent.effective())).toBe('denied');}
   if(initialGpc)expect(before).toBe(0);
   expect((await f.context.cookies()).filter(c=>c.name.startsWith('_ga'))).toEqual([]);
  }catch(error){await f.close(error);throw error}finally{await f.close()}
 }
});
test('GLP44 withdrawal stops NEW loads and events on subsequent navigation; in-flight retry accepted',async({browser},info)=>{
 // Operator-authorized GA-only successor to PR3's zero-post-withdrawal oracle:
 // ops/linear/approvals/OPERATOR-DECISION-20260926-ga4-on.md, line 7.
 // A held already-created request may finish/retry. PostHog's stricter tests are
 // unchanged. This does NOT permit newly stimulated GA events after withdrawal.
 test.setTimeout(95000);
 const f=await fixture(browser,info,{pending:true});try{
  await f.load();await f.loaded();await f.revoke();f.release();
  await f.page.locator('#out').click();await f.page.locator('#file').click();await f.page.evaluate(()=>window.scrollTo(0,3200));
  await f.page.waitForTimeout(65000);
  expect(decode(f.rows).every(e=>e.en==='page_view')).toBe(true);
  const identities=decode(f.rows).map(e=>JSON.stringify([e.en,e._p,e._s,e.cid,e.sid,e.dl]));
  expect(new Set(identities).size).toBe(1); // Same held event, not newly created views.
  safe(f.rows,'/about/');
  f.phase('later-page');
  for(const route of ['/about/','/quiz/provider-fit/','/matches/']){await f.load(route);await f.page.waitForTimeout(400);expect(f.rows.filter(r=>r.phase==='later-page')).toEqual([]);expect(await f.page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);}
  expect((await f.context.cookies()).filter(c=>c.name.startsWith('_ga'))).toEqual([]);
 }catch(error){await f.close(error);throw error}finally{await f.close()}
});
