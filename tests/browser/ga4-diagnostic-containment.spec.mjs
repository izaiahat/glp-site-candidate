import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import {decode,recordGARequest} from '../helpers/ga4-wire-oracle.mjs';

// One bounded regression plus its real allowed-pageview positive precondition.
// Uses served emitter bytes, unchanged hash-pinned SDK, and its real rare branch.
// No production settings/sampling change, external forwarding or count waiver.
test('GLP44 sampled diagnostics remain contained through GPC pagehide',async({browser},info)=>{
 const root=process.cwd(),publicRoot=process.env.GLP_REVIEW_PUBLIC_ROOT||path.join(root,'public');
 const consent=readFileSync(path.join(publicRoot,'assets/consent.js'),'utf8');
 const headers=readFileSync(path.join(publicRoot,'_headers'),'utf8');
 const sdk=readFileSync(path.join(root,'tests/fixtures/ga4/gtag.js'));
 const sha='c99a83ab9a4f9b26226657e466ddcefff8a009eac12c2627b857049b21a2c181';
 expect(createHash('sha256').update(sdk).digest('hex')).toBe(sha);
 const origin='https://glpclinicscout.com',sdkUrl='https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer';
 const header=name=>headers.split('\n').find(l=>l.trim().startsWith(name+':')).trim().slice(name.length+1).trim();
 const requests=[],rows=[],unknown=[],observations=[],errors=[],proxyAttempts=[];
 const proxy=http.createServer((req,res)=>{proxyAttempts.push(req.url);res.writeHead(502);res.end()});
 proxy.on('connect',(req,socket)=>{proxyAttempts.push(req.url);socket.end('HTTP/1.1 502 Denied\r\n\r\n')});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 let context,phase='initial',documentUrl=origin+'/about/';
 try{
  context=await browser.newContext({userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',proxy:{server:`http://127.0.0.1:${proxy.address().port}`,bypass:'<-loopback>'},serviceWorkers:'block'});
  await context.exposeBinding('__gaDiagnosticObservation',(_,value)=>observations.push(value));
  await context.addInitScript(({sdkUrl})=>{
   Object.defineProperty(navigator,'webdriver',{get:()=>false});
   Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,get:()=>false});
   const report=value=>window.__gaDiagnosticObservation({...value,gpc:navigator.globalPrivacyControl,disabled:window['ga-disable-G-2WQ42JY0WK']===true}).catch(()=>{});
   const random=Math.random;
   Math.random=function(){if((new Error().stack||'').includes(sdkUrl+':403:')){report({kind:'sample'});return 0.995}return random.call(Math)};
   window.addEventListener('gcs:ga4-diagnostic-blocked',e=>report({kind:'blocked',...e.detail}));
   document.addEventListener('securitypolicyviolation',e=>report({kind:'csp',blockedURI:e.blockedURI,directive:e.effectiveDirective}));
   window.addEventListener('pagehide',()=>report({kind:'pagehide'}));
  },{sdkUrl});
  await context.route('**/*',async route=>{
   const row=recordGARequest(route.request(),documentUrl,phase,requests,rows,unknown);
   if(row.category==='consent')return route.fulfill({contentType:'text/javascript',body:consent});
   if(row.category==='sdk')return route.fulfill({contentType:'text/javascript',body:sdk});
   if(row.collect)return route.fulfill({status:204,body:''});
   if(row.category==='document')return route.fulfill({headers:{'Content-Type':'text/html','Content-Security-Policy':header('Content-Security-Policy'),'Referrer-Policy':header('Referrer-Policy')},body:'<!doctype html><title>Private canary</title><script>window.GCS_EXPORT_POLICY={schema:"glp-release-export-policy-v2",stage:"production-seal",third_party_exports:true};window.GCS_ANALYTICS={enabled:true,measurement_id:"G-2WQ42JY0WK"};</script><script defer src="/consent.js"></script><main>Contained diagnostic regression</main>'});
   return route.abort();
  });
  await context.routeWebSocket('**/*',ws=>{unknown.push({websocket:ws.url()});ws.close()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(documentUrl);await page.evaluate(()=>window.GCSConsentReady);
  await expect.poll(()=>decode(rows).filter(e=>e.en==='page_view').length).toBe(1);
  expect(decode(rows).map(e=>[e.en,e.dl,e.dt,e.dr||''])).toEqual([['page_view',origin+'/about/','Clinic Scout','']]);
  expect(observations.filter(o=>o.kind==='sample')).toHaveLength(1);
  phase='gpc';await page.evaluate(()=>{Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true});window.dispatchEvent(new Event('focus'))});
  expect(await page.evaluate(()=>window.GCSConsent.effective())).toBe('denied');
  expect(await page.evaluate(()=>window['ga-disable-G-2WQ42JY0WK'])).toBe(true);
  const before=rows.length;expect(before).toBe(2); // SDK + the actual pageview.
  documentUrl=origin+'/quiz/provider-fit/';await page.goto(documentUrl);await page.evaluate(()=>window.GCSConsentReady);
  await page.waitForTimeout(300); // Same bounded unload window as the original GPC oracle.
  expect(rows).toHaveLength(before);expect(unknown).toEqual([]);expect(errors).toEqual([]);expect(proxyAttempts).toEqual([]);
  expect(observations.filter(o=>o.kind==='blocked'&&o.gpc).map(o=>o.transport).sort()).toEqual(['fetch','image','script']);
  expect(observations.filter(o=>o.kind==='blocked'&&!o.gpc).map(o=>[o.transport,o.endpoint])).toEqual([['image','/td']]);
  expect(observations.filter(o=>o.kind==='csp')).toEqual([]);
  expect(observations.some(o=>o.kind==='pagehide'&&o.gpc&&o.disabled)).toBe(true);
  expect((await context.cookies()).filter(c=>c.name.startsWith('_ga'))).toEqual([]);
 }finally{
  await info.attach('ga4-sampled-diagnostic-containment',{body:JSON.stringify({sdk_sha256:sha,consent_sha256:createHash('sha256').update(consent).digest('hex'),headers_sha256:createHash('sha256').update(headers).digest('hex'),requests,rows,unknown,observations,errors,proxyAttempts}),contentType:'application/json'});
  await context?.close();await new Promise(resolve=>proxy.close(resolve));
 }
});
