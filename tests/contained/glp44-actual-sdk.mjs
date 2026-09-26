import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
// Promoted from the independent GLP-44 actual-SDK review, retaining its strict
// request/transport/storage oracle. These are RED release gates, not expected
// failures. No SDK bytes are downloaded by this runner; use the held capture.
const root=new URL('../../',import.meta.url).pathname.replace(/\/$/,'');
const sdkPath=process.env.GLP44_SDK_FILE;
const out=process.env.GLP44_SDK_OUT;
assert.ok(sdkPath&&out,'GLP44_SDK_FILE and a NEW GLP44_SDK_OUT directory required');
assert.ok(out.startsWith('/')&&!out.startsWith(root+'/'),'report must be outside source tree');
// Refuse to overwrite evidence from a prior failed or successful execution.
mkdirSync(out,{recursive:false});
process.env.SDK_CASES ||= 'inflight-revoke-retry,active-lifecycle';
const selected=process.env.SDK_CASES.split(',');
const known=['unknown','denied','gpc','us-default','sensitive-entry','sensitive-referrer','synthetic','candidate-stage','grant-revoke','history-pushState','history-replaceState','history-hash','history-popstate','active-lifecycle','returning-grant-deny','pending-sdk-revoke','inflight-revoke-retry'];
assert.equal(new Set(selected).size,selected.length,'unique case selection required');
assert.ok(selected.every(name=>known.includes(name)),'unknown SDK_CASES selection');
const require=createRequire(root+'/package.json');
const {chromium}=require('playwright');
const {consentRuntimeSource}=await import(pathToFileURL(root+'/src/consent-runtime.mjs'));
const {releaseExportPolicy,policyMarkup}=await import(pathToFileURL(root+'/src/candidate-export-policy.mjs'));
const sdk=readFileSync(sdkPath);
const hash=x=>createHash('sha256').update(x).digest('hex');
assert.equal(hash(sdk),'c99a83ab9a4f9b26226657e466ddcefff8a009eac12c2627b857049b21a2c181','held unmodified SDK required');
const origin='https://glpclinicscout.com';
const sdkUrl='https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer';
const canary='glp44-dose-canary@example.invalid';
const headersSource=readFileSync(root+'/artifacts/build4-preservation/_headers','utf8');
assert.equal(hash(headersSource),'74fbd1c7d10c9331138bb732207c58ffb70cbaeae31e601065a588f66163c587','reviewed source-derived CSP required');
// Exact root CSP from the registered predecessor input; not a live header readback.
const csp=headersSource.split('\n').find(line=>line.trim().startsWith('Content-Security-Policy:')).trim().replace(/^Content-Security-Policy:\s*/, '');
function html(stage='production-seal') {return `<!doctype html><html><head><meta charset="utf-8"><title>Clinic Scout</title>${policyMarkup(releaseExportPolicy(stage))}<script>window.GCS_ANALYTICS={enabled:true,consent:'unknown',measurement_id:'G-2WQ42JY0WK',gtm_container_id:'GTM-PWR49VVK'};</script><script src="/assets/consent.js"></script></head><body><main style="height:2200px"><h1>Contained SDK review</h1><button id="focus">Local focus target</button></main><footer><a href="/privacy/cookies/" data-consent-open>Manage analytics</a></footer></body></html>`;}
writeFileSync(out+'/fixture.html',html());writeFileSync(out+'/consent.js',consentRuntimeSource);
const proxyDenied=[];
const server=http.createServer((req,res)=>{proxyDenied.push({kind:'http',url:req.url,time:Date.now()});res.writeHead(502);res.end();});
server.on('connect',(req,socket)=>{proxyDenied.push({kind:'connect',url:req.url,time:Date.now()});socket.end('HTTP/1.1 502 Denied\r\n\r\n');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,proxy:{server:`http://127.0.0.1:${server.address().port}`,bypass:'<-loopback>'},args:['--disable-quic','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
const summary={started_at:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sdk_sha256:hash(sdk),runtime_sha256:hash(consentRuntimeSource),source_sha256:hash(readFileSync(root+'/src/consent-runtime.mjs')),fixture_sha256:hash(html()),browser:browser.version(),playwright:require('playwright/package.json').version,containment:{context_route:'default deny; exact fixture and SDK fulfilled locally; collect locally fulfilled, aborted or held',service_workers:'blocked',proxy:'loopback deny-all HTTP/CONNECT; no forward implementation',host_resolver:'all denied except loopback',production_csp:false,fixture_csp:csp},cases:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ga=cookies=>cookies.filter(c=>c.name.startsWith('_ga'));
function events(requests) {return requests.filter(r=>r.collect).flatMap(r=>{const u=new URL(r.url);return (r.body||'').split('\n').map(line=>({...Object.fromEntries(u.searchParams),...Object.fromEntries(new URLSearchParams(line))}));});}
function wireSafe(requests) {for(const e of events(requests)){assert.equal(e.en,'page_view','only approved event');assert.equal(e.dl,origin+'/');assert.equal(e.dt,'Clinic Scout');assert.ok(!e.dr,'referrer absent/empty');assert.equal(e.npa,'1','non-personalized ads flag');}for(const r of requests.filter(r=>r.external)){assert.ok(!decodeURIComponent(JSON.stringify(r)).includes(canary),'sensitive canary on request');}}
async function scenario(name,opts,body){
 if(process.env.SDK_CASES && !process.env.SDK_CASES.split(',').includes(name))return;
 const context=await browser.newContext({serviceWorkers:'block',userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'});
 const record={name,options:opts,status:'RUNNING',requests:[],checkpoints:[],errors:[],console:[]};summary.cases.push(record);
 let phase='bootstrap',sdkRelease,collectRelease;
 const sdkBarrier=new Promise(r=>sdkRelease=r),collectBarrier=new Promise(r=>collectRelease=r);
 await context.tracing.start({screenshots:false,snapshots:true,sources:true});
 await context.addInitScript(({gpc,synthetic})=>{
  if(!synthetic)Object.defineProperty(navigator,'webdriver',{configurable:true,get:()=>false});
  if(gpc)Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,get:()=>true});
  window.__writes=[];window.__violations=[];window.__transport=[];
  const fetchOriginal=window.fetch;
  window.fetch=function(input,init){window.__transport.push({api:'fetch',url:typeof input==='string'?input:input.url,time:performance.now(),disabled:window['ga-disable-G-2WQ42JY0WK']});return fetchOriginal.apply(this,arguments);};
  const beaconOriginal=navigator.sendBeacon;
  navigator.sendBeacon=function(url,data){window.__transport.push({api:'beacon',url:String(url),time:performance.now(),disabled:window['ga-disable-G-2WQ42JY0WK']});return beaconOriginal.apply(this,arguments);};
  document.addEventListener('securitypolicyviolation',e=>window.__violations.push({directive:e.effectiveDirective,uri:e.blockedURI}));
  const descriptor=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');
  Object.defineProperty(Document.prototype,'cookie',{...descriptor,set(v){window.__writes.push({kind:'cookie',value:v,time:performance.now()});return descriptor.set.call(this,v);}});
  const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
  Storage.prototype.setItem=function(k,v){window.__writes.push({kind:this===localStorage?'local':'session',key:k,value:v,time:performance.now()});return set.call(this,k,v);};
  Storage.prototype.removeItem=function(k){window.__writes.push({kind:'remove',key:k,time:performance.now()});return remove.call(this,k);};
 },{gpc:opts.gpc,synthetic:opts.synthetic});
 context.on('request',req=>record.requests.push({url:req.url(),method:req.method(),type:req.resourceType(),body:req.postData(),headers:req.headers(),external:new URL(req.url()).origin!==origin,collect:/\/g\/collect(?:\?|$)/.test(req.url()),phase,time:Date.now(),disposition:'observed'}));
 context.on('requestfailed',req=>{const r=record.requests.findLast(r=>r.url===req.url());if(r)r.failure=req.failure();});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());const r=record.requests.findLast(r=>r.url===req.url());
  const fulfill=async response=>{await route.fulfill(response);if(r)r.disposition='local-fulfilled';};
  if(u.origin===origin && req.method()==='GET'){
   if(u.pathname==='/api/geo-state')return fulfill({status:opts.unknown?503:200,contentType:'application/json',body:JSON.stringify({schema:'glp-consent-region-v1',model:opts.us?'us-default-on':'prior-opt-in'})});
   if(u.pathname==='/assets/consent.js')return fulfill({status:200,contentType:'text/javascript',body:consentRuntimeSource});
   if(u.pathname==='/'||u.pathname==='/quiz/provider-fit/')return fulfill({status:200,headers:{'Content-Type':'text/html','Content-Security-Policy':csp,'Referrer-Policy':'strict-origin-when-cross-origin'},body:html(opts.stage)});
  }
  if(req.url()===sdkUrl){if(opts.pendingSdk){if(r)r.disposition='held-locally';await sdkBarrier;}return fulfill({status:200,contentType:'text/javascript',body:sdk});}
  if(r?.collect){if(opts.pendingCollect){r.disposition='held-locally';await collectBarrier;}if(opts.abortCollect||opts.pendingCollect){r.disposition='local-abort';return route.abort('failed');}return fulfill({status:204,body:''});}
  if(r)r.disposition='deny-abort';return route.abort('blockedbyclient');
 });
 await context.routeWebSocket('**/*',ws=>{record.requests.push({url:ws.url(),type:'websocket',phase,disposition:'deny-close'});ws.close();});
 const page=await context.newPage();page.on('pageerror',e=>record.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')record.console.push(m.text());});
 const snapshot=async label=>{const v={label,phase,time:Date.now(),cookies:await context.cookies(),...(await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},writes:window.__writes,transport:window.__transport,violations:window.__violations,disabled:window['ga-disable-G-2WQ42JY0WK'],consent:window.GCSConsent?.read(),sdkGlobal:!!window.google_tag_manager,url:location.href,title:document.title})))};record.checkpoints.push(v);return v;};
 const api={page,context,record,snapshot,phase:v=>phase=v,sdkRelease,collectRelease,wait,grant:async()=>{phase='grant';await page.getByRole('button',{name:'Turn on analytics',exact:true}).click();},revoke:async()=>{await page.getByRole('link',{name:'Manage analytics',exact:true}).click();phase='revoke';await page.getByRole('button',{name:'Turn off analytics',exact:true}).click();},loaded:async()=>{await page.waitForFunction(()=>!!window.google_tag_manager && window['ga-disable-G-2WQ42JY0WK']===false,{},{timeout:15000});await wait(3000);assert.ok(record.requests.some(r=>r.collect),'actual SDK collect required');}};
 try{await page.goto(origin+(opts.path||'/'),{waitUntil:'load',referer:opts.referrer});await page.evaluate(()=>window.GCSConsentReady);await body(api);wireSafe(record.requests);const final=await snapshot('oracle');assert.deepEqual(Object.keys(final.local),['gcs_tracking_consent_v1']);assert.deepEqual(Object.keys(final.session),[]);assert.equal(final.violations.length,0,'CSP blocking must not masquerade as SDK silence');for(const w of final.writes){if(w.kind==='local')assert.equal(w.key,'gcs_tracking_consent_v1');if(w.kind==='session')assert.fail('unexpected session storage');if(w.kind==='cookie')assert.match(w.value,/^(?:gcs_analytics_consent|_ga|_ga_2WQ42JY0WK)=/);}const revokeWrite=final.writes.findLast(w=>w.kind==='local' && JSON.parse(w.value).analytics==='denied' && JSON.parse(w.value).analytics_basis==='explicit');if(revokeWrite)assert.equal(final.writes.filter(w=>w.time>=revokeWrite.time && w.kind==='cookie' && /^_ga[^=]*=.+/.test(w.value) && !w.value.includes('Max-Age=0')).length,0,'no transient analytics cookie recreation');assert.equal(record.errors.length,0,'page errors');record.status='PASS';}
 catch(e){record.status='FAIL';record.error=String(e.stack||e);}
 finally{sdkRelease();collectRelease();await snapshot('final').catch(()=>{});await context.tracing.stop({path:out+'/'+name+'.zip'});await context.close();writeFileSync(out+'/'+name+'.json',JSON.stringify(record,null,2));writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));console.log(name,record.status,record.requests.filter(r=>r.collect).length,record.error?.split('\n').slice(0,2).join(' '));}
}
try {
 for(const [name,opts] of [['unknown',{unknown:true}],['denied',{}],['gpc',{gpc:true}],['us-default',{us:true}],['sensitive-entry',{path:'/?email='+encodeURIComponent(canary)}],['sensitive-referrer',{referrer:origin+'/quiz/provider-fit/?email='+encodeURIComponent(canary)}],['synthetic',{synthetic:true}],['candidate-stage',{stage:'candidate'}]]){
  await scenario(name,opts,async a=>{await wait(2000);if(['sensitive-entry','sensitive-referrer','synthetic','candidate-stage'].includes(name))await a.grant();if(name==='denied'){a.phase('deny');await a.page.getByRole('button',{name:'Turn off analytics',exact:true}).click();}await wait(2000);assert.equal(a.record.requests.filter(r=>r.external).length,0,'no external intent before eligible grant');const s=await a.snapshot('silent');assert.equal(ga(s.cookies).length,0);});
 }
 await scenario('grant-revoke',{},async a=>{await wait(2000);assert.equal(a.record.requests.filter(r=>r.external).length,0);await a.grant();await a.loaded();wireSafe(a.record.requests);const granted=await a.snapshot('granted');assert.equal(ga(granted.cookies).length,2,'real GA cookies');a.phase('title-only');await a.page.evaluate(c=>document.title=c,canary);await a.page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await wait(2500);wireSafe(a.record.requests);await a.revoke();const n=a.record.requests.filter(r=>r.external).length;const revoked=await a.snapshot('immediate-revoke');assert.equal(ga(revoked.cookies).length,0);assert.equal(revoked.disabled,true);await a.page.evaluate(c=>{document.title=c;history.pushState({},'', '/quiz/provider-fit/?email='+encodeURIComponent(c)+'#dose');window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.scrollTo(0,0);},canary);await wait(12000);assert.equal(a.record.requests.filter(r=>r.external).length,n,'no new post-revoke attempts');assert.equal(ga((await a.snapshot('settled-revoke')).cookies).length,0);});
 for(const method of ['pushState','replaceState','hash','popstate'])await scenario('history-'+method,{},async a=>{if(method==='popstate')await a.page.evaluate(c=>{history.pushState({},'','/?email='+encodeURIComponent(c));history.pushState({},'','/');},canary);await a.grant();await a.loaded();const n=a.record.requests.filter(r=>r.external).length;a.phase('sensitive-history');await a.page.evaluate(({method,c})=>{document.title=c;if(method==='hash')location.hash='dose-'+c;else if(method==='popstate'){history.back();}else history[method]({},'','/quiz/provider-fit/?email='+encodeURIComponent(c)+'#dose');},{method,c:canary});await wait(6000);const s=await a.snapshot('suppressed');assert.equal(s.disabled,true);assert.equal(ga(s.cookies).length,0);assert.equal(a.record.requests.filter(r=>r.external).length,n,'no history emissions');});
 await scenario('active-lifecycle',{},async a=>{await a.grant();await a.loaded();await a.page.evaluate(()=>{const f=document.createElement('form');f.innerHTML='<label>Email canary<input type="email" name="email"></label><button type="submit">Local submit</button>';f.addEventListener('submit',e=>e.preventDefault());document.querySelector('main').prepend(f);});await a.page.getByRole('textbox',{name:'Email canary'}).fill(canary);await a.page.getByRole('button',{name:'Local submit'}).click();await a.page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await wait(15000);await a.snapshot('active-stimuli');a.phase('navigate-away');await a.page.goto(origin+'/quiz/provider-fit/');await a.page.evaluate(()=>window.GCSConsentReady);await wait(3000);wireSafe(a.record.requests);});
 await scenario('returning-grant-deny',{},async a=>{await a.grant();await a.loaded();await a.snapshot('grant-first-document');a.phase('returning-grant');await a.page.reload();await a.page.evaluate(()=>window.GCSConsentReady);await a.loaded();for(let i=0;i<20 && events(a.record.requests).filter(e=>e.en==='page_view').length<2;i++)await wait(500);assert.equal(events(a.record.requests).filter(e=>e.en==='page_view').length,2);await a.snapshot('returning-explicit-grant');await a.revoke();await a.snapshot('denied-before-reload');const n=a.record.requests.filter(r=>r.external).length;a.phase('returning-denied');await a.page.reload();await a.page.evaluate(()=>window.GCSConsentReady);await wait(3000);assert.equal(a.record.requests.filter(r=>r.external).length,n);assert.equal(ga((await a.snapshot('denied-reload')).cookies).length,0);});
 await scenario('pending-sdk-revoke',{pendingSdk:true},async a=>{await a.grant();await a.page.waitForFunction(()=>!!document.querySelector('script[src*="gtag/js"]'));await wait(500);await a.revoke();a.sdkRelease();await wait(8000);assert.equal(a.record.requests.filter(r=>r.collect).length,0);assert.equal(ga((await a.snapshot('delayed-sdk')).cookies).length,0);});
 await scenario('inflight-revoke-retry',{pendingCollect:true},async a=>{await a.grant();await a.loaded();const n=a.record.requests.filter(r=>r.external).length;await a.snapshot('inflight');await a.revoke();a.collectRelease();await wait(65000);assert.equal(a.record.requests.filter(r=>r.external).length,n,'no post-revoke retries during 65s');assert.equal(ga((await a.snapshot('retry-window')).cookies).length,0);});
}finally{await browser.close();server.close();summary.proxy_denied=proxyDenied;summary.finished_at=new Date().toISOString();summary.passed=summary.cases.filter(c=>c.status==='PASS').length;summary.failed=summary.cases.filter(c=>c.status!=='PASS').length;writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({passed:summary.passed,failed:summary.failed,proxy_denied:proxyDenied.length}));}
assert.deepEqual(summary.cases.map(c=>c.name).sort(),[...selected].sort(),'every selected regression must execute');
process.exitCode=summary.failed?1:0;
