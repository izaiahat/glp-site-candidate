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
function decode(rows){return rows.filter(r=>r.collect).flatMap(r=>(r.body||'').split('\n').map(line=>({...Object.fromEntries(new URL(r.url).searchParams),...Object.fromEntries(new URLSearchParams(line))})));}
function safe(rows,pagePath){
 const events=decode(rows);expect(events.length).toBeGreaterThan(0);
 for(const event of events){
  expect(['page_view','scroll','click','file_download','user_engagement']).toContain(event.en);
  expect(event.dl).toBe(origin+pagePath);expect(event.dt).toBe('Clinic Scout');expect(event.dr||'').toBe('');expect(event.npa).toBe('1');
  for(const [key,value] of Object.entries(event).filter(([key])=>key.startsWith('ep.ae_block_')))expect(value).toBe('true');
  expect(Object.keys(event).filter(k=>!k.startsWith('ep.ae_block_')&&/form|search_term|user_data|email|quiz|condition|medication|link_url|link_text|file_name/i.test(k))).toEqual([]);
 }
 expect(decodeURIComponent(JSON.stringify(rows))).not.toMatch(/PRIVATE_CANARY|gclid=|quiz_answers|health_condition|form_contents|medication_selection/);
}
async function fixture(browser,info,{gpc=false,pending=false}={}){
 expect(createHash('sha256').update(sdk).digest('hex')).toBe(SHA);
 const context=await browser.newContext({proxy:{server:`http://127.0.0.1:${proxy.address().port}`,bypass:'<-loopback>'},serviceWorkers:'block',userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'});
 await context.addInitScript(({gpc})=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,get:()=>gpc});window.__violations=[];document.addEventListener('securitypolicyviolation',e=>window.__violations.push(e.blockedURI));},{gpc});
 const rows=[],unknown=[],errors=[];let phase='initial',release;
 const barrier=new Promise(r=>release=r);
 // Context-wide routes precede all documents, including popups. Never continue,
 // fetch or forward: public Google bytes are hash-pinned and served from disk.
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===origin&&req.method()==='GET'){
   if(url.pathname==='/consent.js')return route.fulfill({contentType:'text/javascript',body:consent});
   return route.fulfill({headers:{'Content-Type':'text/html','Content-Security-Policy':csp,'Referrer-Policy':referrerPolicy},body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${canary}</title><link rel="canonical" href="${origin}/providers/"><script>window.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};window.GCS_ANALYTICS={enabled:true,measurement_id:'G-2WQ42JY0WK'};</script><script defer src="/consent.js"></script><main style="height:3200px"><h1>Contained GA test</h1><form id="${canary}" action="/?q=${canary}"><label>Private value<input name="health_condition" type="email"></label><select aria-label="Medication" name="medication_selection"><option>${canary}</option></select><button type="submit">Submit private form</button><a href="https://outbound.invalid/${canary}">Form link</a></form><a id="out" href="https://outbound.invalid/${canary}?email=${canary}">${canary}</a><a id="file" href="/files/${canary}.pdf?email=${canary}" download="${canary}">Download</a></main><footer><a href="/privacy/cookies/">Cookie choices</a></footer><script>document.addEventListener('submit',e=>e.preventDefault());document.addEventListener('click',e=>{if(e.target.closest('#out,#file,form a'))e.preventDefault()});</script>`});
  }
  const row={url:req.url(),body:req.postData(),headers:req.headers(),phase,collect:/\/g\/collect(?:\?|$)/.test(req.url()),forwarded:false};rows.push(row);
  if(req.url()===sdkUrl)return route.fulfill({contentType:'text/javascript',body:sdk});
  if(row.collect){if(pending){await barrier;return route.abort('failed')}return route.fulfill({status:204,body:''});}
  unknown.push(row);return route.abort();
 });
 await context.routeWebSocket('**/*',ws=>{unknown.push({websocket:ws.url()});ws.close()});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 return {context,page,rows,unknown,release,phase:v=>phase=v,
  async load(route='/providers/') {await page.goto(origin+route+'?q='+encodeURIComponent(canary)+'&gclid='+canary+'#'+canary);await page.evaluate(()=>window.GCSConsentReady);},
  async loaded(){await expect.poll(()=>decode(rows).filter(e=>e.en==='page_view').length).toBe(1)},
  async revoke(){await page.getByRole('link',{name:'Cookie choices',exact:true}).click();phase='withdrawn';await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();expect(await page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);expect(await page.evaluate(()=>Array.from(window.gcsGa4Layer).filter(x=>x[0]==='consent').at(-1)[2])).toEqual({analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});},
  async close(){release();await info.attach('ga4-contained-wire',{body:JSON.stringify({sdk_sha256:SHA,consent_sha256:createHash('sha256').update(consent).digest('hex'),source_only_diagnostic:process.env.GLP44_SOURCE_TEST==='1',rows,unknown,errors}),contentType:'application/json'});expect(unknown).toEqual([]);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__violations)).toEqual([]);await context.close();}
 };
}
test('GLP44 default-on actual GA SDK minimizes page and enhanced events',async({browser},info)=>{
 const f=await fixture(browser,info);try{
  await f.load();await f.loaded();expect(await f.page.evaluate(()=>window.GCSConsent.read().analytics_basis)).toBe('global_default');
  await f.page.getByRole('textbox',{name:'Private value'}).fill(canary);
  await f.page.getByRole('button',{name:'Submit private form'}).click();
  await f.page.locator('form a').click();
  await f.page.locator('#out').click();await f.page.locator('#file').click();
  await f.page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await expect.poll(()=>decode(f.rows).filter(e=>['scroll','click','file_download'].includes(e.en)).map(e=>e.en).sort()).toEqual(['click','file_download','scroll']);
  await f.page.getByRole('button',{name:'Got it',exact:true}).click();
  await f.page.waitForTimeout(1200);safe(f.rows,'/providers/');
  const config=await f.page.evaluate(()=>Array.from(window.gcsGa4Layer).find(x=>x[0]==='config')[2]);
  expect(config).toMatchObject({allow_google_signals:false,allow_ad_personalization_signals:false,allow_enhanced_conversions:false,ae_block_form:true,send_page_view:false});
  expect(decode(f.rows).filter(e=>e.en==='page_view')).toHaveLength(1);
 }finally{await f.close()}
});
test('GLP44 quiz and matches send neutral page views without input or search events',async({browser},info)=>{
 for(const route of ['/quiz/provider-fit/','/matches/','/lp/quiz/']){
  const f=await fixture(browser,info);try{
   await f.load(route);await f.loaded();await f.page.getByRole('textbox',{name:'Private value'}).fill(canary);await f.page.getByRole('button',{name:'Submit private form'}).click();await f.page.locator('#out').click();await f.page.locator('#file').click();await f.page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await f.page.waitForTimeout(1500);
   safe(f.rows,'/private/');expect(decode(f.rows).map(e=>e.en)).toEqual(['page_view']);
  }finally{await f.close()}
 }
});
test('GLP44 GPC prevents GA load and collection on initial and later pages',async({browser},info)=>{
 const f=await fixture(browser,info,{gpc:true});try{
  for(const route of ['/providers/','/quiz/provider-fit/','/matches/']){await f.load(route);await f.page.waitForTimeout(300);expect(f.rows).toEqual([]);expect(await f.page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);expect(await f.page.evaluate(()=>window.GCSConsent.effective())).toBe('denied');}
 }finally{await f.close()}
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
  safe(f.rows,'/providers/');
  f.phase('later-page');
  for(const route of ['/providers/','/quiz/provider-fit/','/matches/']){await f.load(route);await f.page.waitForTimeout(400);expect(f.rows.filter(r=>r.phase==='later-page')).toEqual([]);expect(await f.page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);}
  expect((await f.context.cookies()).filter(c=>c.name.startsWith('_ga'))).toEqual([]);
 }finally{await f.close()}
});
