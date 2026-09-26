import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
function events(row){
 const bytes=Buffer.from(row.body_base64,'base64');
 let value;if(bytes[0]===31&&bytes[1]===139)value=JSON.parse(gunzipSync(bytes));
 else {const body=bytes.toString();try{value=JSON.parse(body)}catch{value=JSON.parse(Buffer.from(new URLSearchParams(body).get('data'),'base64').toString())}}
 return Array.isArray(value)?value:(value.batch||[value]);
}
import {consentRuntimeSource} from '../../src/consent-runtime.mjs';
const ROOT=path.resolve('.'),PUBLIC=process.env.GLP_REVIEW_PUBLIC_ROOT||path.join(ROOT,'public');
// Source diagnostic is explicit; the registered gate always consumes emitted bytes.
const probe=process.env.GLP_CONSENT_SOURCE_PROBE==='1';
const read=p=>readFileSync(p,'utf8'),sha=b=>createHash('sha256').update(b).digest('hex');
const consent=probe?consentRuntimeSource:read(path.join(PUBLIC,'assets/consent.js'));
const asset=probe?null:read(path.join(PUBLIC,'index.html')).match(/src="(\/assets\/analytics(?:\.[a-f0-9]+)?\.js(?:\?[^\"]*)?)"/)[1];
const analytics=read(probe?path.join(ROOT,'assets/analytics.js'):path.join(PUBLIC,new URL(asset,'https://glpclinicscout.com').pathname));
const headers=read(path.join(probe?path.join(ROOT,'artifacts/build4-preservation'):PUBLIC,'_headers'));
const referrerPolicy=headers.split(/\n(?=\/)/)[0].match(/Referrer-Policy:\s*([^\n]+)/i)[1].trim();
const sdk=read(path.join(ROOT,'tests/fixtures/posthog/array.js'));
const sdkSha='7b7e12b4a9459669f311e0b8e63f44e905eba385401f70dcabfe9b011e3dcd86';
const origin='https://glpclinicscout.com',host='https://posthog-fixture.invalid',original='https://affiliate-fixture.invalid/?s1=placement';
async function harness(browser,info,{hold=false,saved=null}={}){
 expect(sha(sdk)).toBe(sdkSha);
 const context=await browser.newContext({...(process.env.PLAYWRIGHT_NOWRITE_PROXY?{proxy:{server:process.env.PLAYWRIGHT_NOWRITE_PROXY}}:{}),serviceWorkers:'block',userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'});
 await context.addInitScript(saved=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});Object.defineProperty(navigator,'userAgentData',{get:()=>undefined});if(saved)localStorage.setItem('gcs_tracking_consent_v1',JSON.stringify({version:'gcs-cookie-v4-distinct-purposes',record_type:'preference_only',...saved}));document.addEventListener('click',e=>{if(e.target.closest('#affiliate'))e.preventDefault()},true)},saved);
 const attempts=[],unknown=[];let held,phase='before-withdraw';
 const fixture=`<!doctype html><script>window.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};window.GCS_ANALYTICS={enabled:true,measurement_id:'G-FIXTURE'};window.GCS_POSTHOG={enabled:true,api_key:'TEST_PUBLIC_PROJECT_TOKEN_NOT_A_CREDENTIAL',host:'${host}'};</script><script defer src='/consent.js'></script><script defer src='/analytics.js'></script><h1>Isolated contract</h1><a id='affiliate' href='${original}' data-network='Affiliati' data-program='TEST' data-analytics-event='affiliate_click'>Fixture provider</a><footer><a href='/privacy/cookies/'>Cookie choices</a></footer>`;
 await context.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());
  if(u.origin===origin&&u.pathname==='/providers/')return r.fulfill({contentType:'text/html',headers:{'Referrer-Policy':referrerPolicy},body:fixture});
  if(u.origin===origin&&u.pathname==='/consent.js')return r.fulfill({contentType:'text/javascript',body:consent});
  if(u.origin===origin&&u.pathname==='/analytics.js')return r.fulfill({contentType:'text/javascript',body:analytics});
  if(u.origin===host&&u.pathname==='/static/array.js')return r.fulfill({contentType:'text/javascript',body:sdk});
  if(u.origin===host&&q.method()==='POST'){
   attempts.push({phase,at:Date.now(),url:q.url(),type:q.resourceType(),referrer:q.headers().referer||'',body_base64:q.postDataBuffer()?.toString('base64'),forwarded:false});
   if(hold&&!held){held=r;return}
   return r.fulfill({status:200,contentType:'application/json',body:'{"status":1}',headers:{'access-control-allow-origin':'*'}});
  }
  unknown.push(q.url());return r.abort();
 });
 const page=await context.newPage();await page.goto(origin+'/providers/?CANARY_QUERY#CANARY_FRAGMENT');await page.waitForFunction(()=>!!window.GCSAnalytics);
 return {page,context,attempts,unknown,failHeld:()=>held.abort('failed'),withdraw:async()=>{await page.getByRole('link',{name:'Cookie choices',exact:true}).click();await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();phase='after-withdraw';expect(await page.evaluate(()=>GCSConsent.purposes())).toEqual({analytics:'denied',advertising:'denied'})},close:async()=>{await info.attach('strict-sdk-receipt',{contentType:'application/json',body:JSON.stringify({probe,headers_sha256:sha(headers),referrerPolicy,consent_sha256:sha(consent),analytics_sha256:sha(analytics),sdk_sha256:sdkSha,attempts,unknown})});await context.close()}};
}
test('D1 real SDK held pageview cannot retry for 65 seconds after native withdrawal',async({browser},info)=>{
 test.setTimeout(100000);const h=await harness(browser,info,{hold:true});try{
 await expect.poll(()=>h.attempts.length,{timeout:15000}).toBe(1);
 expect(await h.page.evaluate(()=>posthog.__loaded)).toBe(true);
 const initial=events(h.attempts[0]);expect(initial).toHaveLength(1);expect(initial[0].event).toBe('$pageview');expect(initial[0].uuid).toBeTruthy();expect(initial[0].properties.distinct_id).toBeTruthy();
 await h.withdraw();expect(await h.page.evaluate(()=>posthog.has_opted_out_capturing())).toBe(true);
 const count=h.attempts.length;await h.failHeld();await h.page.waitForTimeout(65000);
 expect(h.attempts.slice(count)).toEqual([]);
 await h.page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}))});await h.page.waitForTimeout(1000);
 expect(h.attempts).toHaveLength(count);expect(h.unknown).toEqual([]);
 }finally{await h.close()}
});
test('D1 native outbound transport has no Referer under emitted document headers',async({browser},info)=>{
 const h=await harness(browser,info);try{
 await expect.poll(()=>h.attempts.length,{timeout:15000}).toBe(1);await h.page.getByRole('button',{name:'Got it',exact:true}).click();await h.page.locator('#affiliate').click();await expect.poll(()=>h.attempts.length).toBe(2);
 expect(h.attempts.map(r=>r.referrer)).toEqual(['','']);expect(h.unknown).toEqual([]);
 }finally{await h.close()}
});
test('D1 native decorated destinations and owned storage clear on withdrawal and GPC',async({browser},info)=>{
 for(const mode of ['withdraw','gpc']){const h=await harness(browser,info);try{
 await h.page.getByRole('button',{name:'Got it',exact:true}).click();await h.page.locator('#affiliate').click();
 const id=await h.page.evaluate(()=>JSON.parse(localStorage.getItem('cs_click_id:last:TEST')).clickId);expect(id).toBeTruthy();expect(new URL(await h.page.locator('#affiliate').getAttribute('href')).searchParams.get('s2')).toBe(id);
 if(mode==='withdraw')await h.withdraw();else await h.page.evaluate(()=>{Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true});window.dispatchEvent(new Event('focus'))});
 expect(await h.page.evaluate(()=>localStorage.getItem('cs_click_id:last:TEST'))).toBe(null);await expect(h.page.locator('#affiliate')).toHaveAttribute('href',original);
 await h.page.locator('#affiliate').click();await expect(h.page.locator('#affiliate')).toHaveAttribute('href',original);expect(await h.page.evaluate(()=>localStorage.getItem('cs_click_id:last:TEST'))).toBe(null);expect(h.unknown).toEqual([]);
 }finally{await h.close()}}
});
test('D1 stored purpose matrix gates native conversion clicks on advertising not analytics',async({browser},info)=>{
 for(const analytics of ['granted','denied'])for(const advertising of ['granted','denied']){
 const h=await harness(browser,info,{saved:{analytics,advertising}});try{
 expect(await h.page.evaluate(()=>GCSConsent.purposes())).toEqual({analytics,advertising});await h.page.locator('#affiliate').click();
 const result=await h.page.evaluate(()=>({href:document.querySelector('#affiliate').href,id:localStorage.getItem('cs_click_id:last:TEST')}));
 expect(result.id!==null).toBe(advertising==='granted');expect(new URL(result.href).searchParams.has('s2')).toBe(advertising==='granted');expect(new URL(result.href).searchParams.get('s1')).toBe('placement');expect(h.unknown).toEqual([]);
 }finally{await h.close()}}
});
