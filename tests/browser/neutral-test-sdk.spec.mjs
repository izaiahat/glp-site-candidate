import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import http from 'node:http';

// Actual emitted bytes + untouched hash-pinned SDK. All transport is fulfilled
// locally; a deny proxy is a second barrier. No direct SDK capture or gtag calls.
const ROOT=path.resolve('.'),PUBLIC=path.join(ROOT,'public');
const sha=b=>createHash('sha256').update(b).digest('hex');
const consent=readFileSync(path.join(PUBLIC,'assets/consent.js'));
const html=readFileSync(path.join(PUBLIC,'index.html'),'utf8');
const asset=html.match(/src="(\/assets\/analytics(?:\.[a-f0-9]+)?\.js(?:\?[^\"]*)?)"/)[1];
const analytics=readFileSync(path.join(PUBLIC,new URL(asset,'https://glpclinicscout.com').pathname));
const headers=readFileSync(path.join(PUBLIC,'_headers'),'utf8');
const sdk=readFileSync(path.join(ROOT,'tests/fixtures/posthog/array.js'));
const SDK_SHA='7b7e12b4a9459669f311e0b8e63f44e905eba385401f70dcabfe9b011e3dcd86';
const origin='https://glpclinicscout.com',host='https://posthog-fixture.invalid';
const key='TEST_PUBLIC_PROJECT_TOKEN_NOT_A_CREDENTIAL';
const routes=['/','/providers/','/compare/','/privacy/','/privacy/cookies/','/terms/','/about/'];
const manuals=['affiliate_click','comparison_table_view','cost_calculator_used','calculator_submit','content_upgrade_view','content_upgrade_submit','content_upgrade_success','content_upgrade_complete','scroll_75','sticky_cta_click','comparison_sort_change'];
let proxy;
test.beforeAll(async()=>{
 for(const flag of ['GLP44_SOURCE_TEST','GLP_CONSENT_SOURCE_PROBE'])expect(process.env[flag]).not.toBe('1');
 expect(sha(sdk)).toBe(SDK_SHA);
 expect(analytics.equals(readFileSync(path.join(ROOT,'assets/analytics.js')))).toBe(true);
 // Native Node producer binding, not Playwright-transformed Function.toString().
 const binding=JSON.parse(execFileSync(process.execPath,['scripts/consent-emitted-binding.mjs','--public',PUBLIC],{encoding:'utf8'}));
 expect(binding.exact_producer_equality).toBe(true);
 proxy=http.createServer((req,res)=>{res.writeHead(502);res.end()});
 proxy.on('connect',(req,socket)=>socket.end('HTTP/1.1 502 Denied\r\n\r\n'));
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
});
test.afterAll(async()=>{if(proxy)await new Promise(resolve=>proxy.close(resolve));});
function decode(buffer){
 if(buffer[0]===31&&buffer[1]===139)buffer=gunzipSync(buffer);
 let value;try{value=JSON.parse(buffer.toString())}catch{value=JSON.parse(Buffer.from(new URLSearchParams(buffer.toString()).get('data'),'base64').toString())}
 return Array.isArray(value)?value:(value.batch||[value]);
}
async function harness(browser,info,{route='/providers/',marked=true,gpc=false,automation=false,denied=false}={}){
 const context=await browser.newContext({serviceWorkers:'block',proxy:{server:`http://127.0.0.1:${proxy.address().port}`,bypass:'<-loopback>'},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'});
 await context.addInitScript(({gpc,automation,denied})=>{
  Object.defineProperty(navigator,'webdriver',{get:()=>automation});
  Object.defineProperty(navigator,'userAgentData',{get:()=>undefined});
  Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,get:()=>gpc});
  if(!localStorage.getItem('gcs_tracking_consent_v1'))localStorage.setItem('gcs_tracking_consent_v1',JSON.stringify({version:'gcs-cookie-v4-distinct-purposes',record_type:'preference_only',analytics:denied?'denied':'granted',advertising:'denied',analytics_basis:'explicit',notice_acknowledged:true}));
 },{gpc,automation,denied});
 const wire=[],unknown=[];let gaLoaders=0,sdkLoads=0;
 await context.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url());
  if(u.origin===origin&&u.pathname===route)return r.fulfill({contentType:'text/html',headers:{'Referrer-Policy':'no-referrer'},body:`<!doctype html><script>window.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};window.GCS_ANALYTICS={enabled:true,measurement_id:'G-2WQ42JY0WK'};window.GCS_POSTHOG={enabled:true,api_key:'${key}',host:'${host}'};</script><script defer src='/consent.js'></script><script defer src='/analytics.js'></script><main style='height:3000px'><h1>Contained neutral TEST</h1></main><footer><a href='/privacy/cookies/'>Cookie choices</a></footer>`});
  if(u.origin===origin&&u.pathname==='/consent.js')return r.fulfill({contentType:'text/javascript',body:consent});
  if(u.origin===origin&&u.pathname==='/analytics.js')return r.fulfill({contentType:'text/javascript',body:analytics});
  if(u.origin===host&&u.pathname==='/static/array.js'){sdkLoads++;return r.fulfill({contentType:'text/javascript',body:sdk});}
  if(u.origin===host&&q.method()==='POST'){wire.push(...decode(q.postDataBuffer()));return r.fulfill({status:200,contentType:'application/json',body:'{"status":1}',headers:{'access-control-allow-origin':'*'}});}
  if(u.hostname==='www.googletagmanager.com')gaLoaders++;
  unknown.push({host:u.hostname,method:q.method()});return r.abort();
 });
 await context.routeWebSocket('**/*',ws=>{unknown.push({websocket:true});ws.close()});
 const page=await context.newPage();await page.goto(origin+route+(marked?'#gcs-test':''));await page.waitForFunction(()=>!!window.GCSAnalytics);
 return {page,wire,unknown,get gaLoaders(){return gaLoaders},get sdkLoads(){return sdkLoads},async close(){
  await info.attach('neutral-test-minimized-wire',{contentType:'application/json',body:JSON.stringify({route,marked,gpc,automation,denied,consent_sha256:sha(consent),analytics_file:new URL(asset,origin).pathname,analytics_sha256:sha(analytics),headers_sha256:sha(headers),sdk_sha256:SDK_SHA,sdkLoads,gaLoaders,event_names:wire.map(e=>e.event),test_labels:wire.map(e=>e.properties.is_test===true),locally_fulfilled:true,unknown})});await context.close();
 }};
}
function assertWire(h,route){
 expect(h.wire.length).toBeGreaterThan(0);
 for(const event of h.wire){expect(event.uuid).toBeTruthy();expect(event.timestamp).toBeTruthy();expect(event.properties.distinct_id).toBeTruthy();expect(event.properties).toEqual({token:key,distinct_id:event.properties.distinct_id,$process_person_profile:false,is_test:true,$host:'glpclinicscout.com',$current_url:origin+route,$pathname:route});}
 expect(h.gaLoaders).toBe(0);expect(h.unknown).toEqual([]);
}
test('initial neutral TEST latches and labels actual automatic and every reviewed manual SDK event',async({browser},info)=>{
 for(const route of routes){const h=await harness(browser,info,{route});try{
  await expect.poll(()=>h.wire.filter(e=>e.event==='$pageview').length).toBe(1);
  expect(await h.page.evaluate(()=>GCSConsent.isTestDocument())).toBe(true);
  expect(await h.page.evaluate(()=>GCSConsent.allowsExports('advertising'))).toBe(false);
  // Fragment removal and caller poisoning cannot remove or replace the latch.
  await h.page.evaluate(()=>history.replaceState(null,'',location.pathname));
  expect(await h.page.evaluate(names=>names.map(name=>GCSAnalytics.event(name,{is_test:false,debug_mode:true,traffic_type:'ordinary',cs_click_id:'POISON',email:'POISON'})),manuals)).toEqual(manuals.map(()=>true));
  await h.page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await expect.poll(()=>new Set(h.wire.map(e=>e.event)).size).toBe(12);
  assertWire(h,route);
 }finally{await h.close()}}
});
test('TEST native withdrawal cancels NEW transport; reload deny and native regrant retain TEST without GA',async({browser},info)=>{
 const h=await harness(browser,info);try{
  await expect.poll(()=>h.wire.length).toBe(1);
  await h.page.getByRole('link',{name:'Cookie choices',exact:true}).click();await h.page.getByRole('button',{name:'Turn off tracking',exact:true}).click();
  const count=h.wire.length;expect(await h.page.evaluate(()=>GCSAnalytics.event('comparison_sort_change'))).toBe(false);
  await h.page.waitForTimeout(3500);expect(h.wire).toHaveLength(count);
  // Reload uses the actual saved denial, not an injected replacement preference.
  await h.page.reload();await h.page.waitForFunction(()=>!!window.GCSAnalytics);await h.page.waitForTimeout(3500);expect(h.wire).toHaveLength(count);
  await h.page.getByRole('link',{name:'Cookie choices',exact:true}).click();await h.page.getByRole('button',{name:'Turn on tracking',exact:true}).click();
  await expect.poll(()=>h.wire.length).toBeGreaterThan(count);assertWire(h,'/providers/');
 }finally{await h.close()}
});
test('TEST denial GPC nonneutral and automation retain hard loader and event guards',async({browser},info)=>{
 for(const options of [{denied:true},{gpc:true},{route:'/guides/semaglutide/'},{automation:true}]){const h=await harness(browser,info,options);try{
  expect(await h.page.evaluate(()=>GCSAnalytics.event('comparison_sort_change',{is_test:true}))).toBe(false);
  await h.page.waitForTimeout(700);expect(h.wire).toEqual([]);expect(h.sdkLoads).toBe(0);expect(h.gaLoaders).toBe(0);expect(h.unknown).toEqual([]);
 }finally{await h.close()}}
});
