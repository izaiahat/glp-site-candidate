import {createHash} from 'node:crypto';
import {createServer} from 'node:https';
import {createServer as createProxy} from 'node:http';
import {connect} from 'node:net';
import {test as base} from '@playwright/test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createStagedAdvertisingRuntimeSource} from '../src/advertising-staging-runtime.mjs';
import {fixture} from './helpers/a17-issuer-fixture.mjs';
import {createAdvertisingIssuer,advertisingConsent,revokeAdvertisingConsent} from '../src/advertising-issuer.mjs';
export const sdkURLs={meta:'https://connect.facebook.net/en_US/fbevents.js',microsoft:'https://bat.bing.com/bat.js'};
let testTLS;
const loopbackIssuers=new Map();
export const test=base.extend({proxy:async({},use)=>{
 const sockets=new Set();
 const proxy=createProxy((req,res)=>{res.writeHead(403);res.end()});
 proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))});
 proxy.on('connect',(req,socket,head)=>{
  const port=loopbackIssuers.get(req.url);
  if(!port){socket.destroy();return}
  const upstream=connect(port,'127.0.0.1',()=>{
   socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
   if(head.length)upstream.write(head);
   socket.pipe(upstream);upstream.pipe(socket);
  });
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
 });
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve)});
 try{await use({server:`http://127.0.0.1:${proxy.address().port}`})}
 finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve))}
}});
function loopbackTLS(){
 if(testTLS)return testTLS;
 const directory=mkdtempSync(join(tmpdir(),'a17-test-tls-'));
 try{
  const key=join(directory,'key.pem'),cert=join(directory,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  return testTLS={key:readFileSync(key),cert:readFileSync(cert)};
 }finally{rmSync(directory,{recursive:true,force:true})}
}
export const vendorArtifact=platform=>`
// TEST synthetic executable artifact, NOT downloaded vendor SDK bytes.
const endpoint='https://collector.invalid/${platform}/';
function note(kind,extra={}){parent.postMessage({a17Fixture:true,kind,...extra},'*')}
document.addEventListener('securitypolicyviolation',e=>note('csp-blocked',{directive:e.effectiveDirective,uri:e.blockedURI}));
note('inherited-consent',{queue:${platform==='meta'?"window.fbq?.queue || []":"window.uetq || []"}});
function activity(){fetch(endpoint+'pageview').catch(()=>{});try{navigator.sendBeacon(endpoint+'beacon','TEST')}catch{};fetch('/api/advertising-collector').catch(()=>{});}
function storage(){
 for(const kind of ['cookie','localStorage','sessionStorage']){
  const opaque=window.origin==='null',stages=[];
  let area,before,after,baselineError,mutationError,readError,invoked=false;
  const read=()=>kind==='cookie'?document.cookie.split(';').map(v=>v.trim()).filter(v=>v.startsWith('_fbp=')):area.getItem('_uetvid');
  const absent=value=>kind==='cookie'?value.length===0:value===null;
  const matches=value=>kind==='cookie'?value.length===1&&value[0]==='_fbp=TEST':value==='TEST';
  const emit=(result,reason)=>note(result,{storage:kind,attempted:true,invoked,stages,reason});
  stages.push('access');
  try{if(kind!=='cookie')area=window[kind]}catch(error){
   emit(opaque&&error.name==='SecurityError'?'storage-blocked':'storage-unresolved','access-'+error.name);continue;
  }
  stages.push('baseline');
  try{before=read()}catch(error){baselineError=error.name}
  // Always exercise the mutation, including native opaque-origin denial.
  stages.push('mutation');invoked=true;
  try{if(kind==='cookie')document.cookie='_fbp=TEST';else area.setItem('_uetvid','TEST')}catch(error){mutationError=error.name}
  stages.push('readback');
  try{after=read()}catch(error){readError=error.name}
  // Dirty or unavailable baselines cannot establish this attempt's effect.
  if(!baselineError&&!absent(before)){emit('storage-unresolved','dirty-baseline');continue}
  // Only native opaque-origin restrictions are known denial. Generic throws,
  // empty/stale readback and normal-origin silent setters remain unresolved.
  if(opaque&&mutationError==='SecurityError'&&baselineError==='SecurityError'&&readError==='SecurityError'){
   emit('storage-blocked','opaque-security-denial');continue;
  }
  if(baselineError||mutationError||readError){emit('storage-unresolved',baselineError?'baseline-'+baselineError:mutationError?'mutation-'+mutationError:'readback-'+readError);continue}
  if(matches(after)){emit('storage-write','absent-to-test');continue}
  emit(opaque&&kind==='cookie'&&absent(after)?'storage-blocked':'storage-unresolved',opaque&&kind==='cookie'&&absent(after)?'opaque-cookie-rejection':'unconfirmed-readback');
 }
}
${platform==='meta'?"window.fbq=function(...args){note('sdk-command',{args});if(args[0]==='init'){storage();activity();setInterval(activity,30)}};":"window.UET=function(config){note('sdk-command',{args:['UET',config]});storage();activity();setInterval(activity,30);this.push=(...args)=>note('sdk-command',{args});};"}
`;
export async function harness(context,{platform='meta',state='fresh',slowSDK=false,lateInstall=false,noJS=false}={}){
 const origin=`https://a17-${platform}.invalid`,requests=[],messages=[];let releaseSDK;
 const f=fixture(null,platform,platform==='meta'?'meta_pixel':'microsoft_uet');
 // Consume actual browser-sent headers: WebKit's intercepted allHeaders()
 // omits HttpOnly cookies even when its network request sends them.
 const server=createServer(loopbackTLS(),async(req,res)=>{
  try{
   const url=new URL(req.url,origin);
   if(!['/api/advertising-consent','/api/advertising-consent/revoke'].includes(url.pathname)){res.writeHead(404);res.end();return}
   if(state==='missing-issuer'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({state:'DENIED'}));return}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
   const response=await (url.pathname.endsWith('/revoke')?revokeAdvertisingConsent:advertisingConsent)(request,f.env);
   let body=await response.text();if(req.method==='GET'&&response.ok)body=JSON.stringify(mutateView(JSON.parse(body)));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(body);
  }catch(error){res.writeHead(503);res.end('TEST fixture transport error');console.error(error.message)}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const authority=new URL(origin).hostname+':443';
 loopbackIssuers.set(authority,server.address().port);
 context.once('close',()=>{loopbackIssuers.delete(authority);server.close();server.closeAllConnections()});
 if(state==='expiry'){f.p.expires_at_ms=Date.now()+2000;f.scope.expires_at_ms=f.p.expires_at_ms;}
 f.review();const issuer=createAdvertisingIssuer(f.env);await issuer.issuePermission(f.p,f.scope);
 const session=await issuer.registerSession({scope_id:f.scope.id,subject_ref:'TEST_A17_SUBJECT',jurisdiction:'TEST_SUPPORTED',age_policy:'TEST_ADULT',gpc:false});
 const cookiePair=session.cookie.split(';')[0];
 const addCookie=async value=>{const pair=value.split(';')[0],i=pair.indexOf('=');await context.addCookies([{name:pair.slice(0,i),value:pair.slice(i+1),url:origin,secure:true,httpOnly:true,sameSite:'Strict'}])};
 await addCookie(session.cookie);
 if(!['fresh','decline','analytics-only','missing-issuer'].includes(state)){
  const req=new Request(origin+'/api/advertising-consent',{headers:{cookie:cookiePair}}),projection=await issuer.view(req);
  const response=await advertisingConsent(new Request(req.url,{method:'POST',headers:{cookie:cookiePair,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({scope_id:f.scope.id,choice:'explicit_opt_in',csrf:projection.csrf})}),f.env);
  if(response.status!==201)throw Error('fixture_issuance_failed_'+await response.text());await addCookie(response.headers.get('set-cookie'));
 }
 if(state==='unknown-jurisdiction'||state==='unknown-age'){
  const field=state==='unknown-jurisdiction'?'jurisdiction':'age_policy';
  f.db.prepare(`UPDATE a17_issuer_sessions SET session_json=json_set(session_json,'$.${field}','UNKNOWN') WHERE session_id=?`).run(session.session_id);
 }
 let mutateView=value=>value;
 if(state==='missing-scope')mutateView=v=>({...v,scope:null});
 if(state==='partial-ad-storage')mutateView=v=>({...v,receipt:{...v.receipt,ad_storage:'denied'}});
 if(state==='partial-ad-user-data')mutateView=v=>({...v,receipt:{...v.receipt,ad_user_data:'denied'}});
 if(state==='personalization-enabled')mutateView=v=>({...v,receipt:{...v.receipt,ad_personalization:'granted'}});
 if(state==='stale')mutateView=v=>({...v,receipt:{...v.receipt,expires_at_ms:1}});
 if(state==='malformed')mutateView=v=>({...v,receipt:{choice:'explicit_opt_in'}});
 if(state==='mismatched')mutateView=v=>({...v,receipt:{...v.receipt,scope_id:'OTHER'}});
 if(state==='withdrawn')mutateView=v=>({...v,receipt:{...v.receipt,withdrawn:true}});
 const boot=`await ${createStagedAdvertisingRuntimeSource({deferLoaders:lateInstall||state==='absent-cmp'})};document.querySelector('#install').onclick=()=>window.dispatchEvent(new Event('gcs:advertising-install'));${state==='absent-cmp'?"delete window.GCSConsent;window.dispatchEvent(new Event('gcs:advertising-install'));":''}window.harnessReady=true;`;
 // External traffic remains intercepted; only the local issuer uses real TLS.
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const category=Object.values(sdkURLs).includes(req.url())?'sdk':url.pathname.includes('beacon')?'beacon':url.pathname.includes('pageview')?'pageview':url.pathname.includes('collector')?'collector':url.origin===origin?'local':'unapproved';
  requests.push({url:req.url(),method:req.method(),category,resourceType:req.resourceType()});
  if(category==='sdk'){
   if(slowSDK)await new Promise(resolve=>{releaseSDK=resolve});
   return route.fulfill({status:200,contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:vendorArtifact(platform)}).catch(()=>{});
  }
  if(url.origin!==origin||['collector','pageview','beacon'].includes(category))return route.abort();
  if(['/api/advertising-consent','/api/advertising-consent/revoke'].includes(url.pathname)){
   return route.continue();
  }
  if(url.pathname==='/test-bootstrap.mjs')return route.fulfill({contentType:'application/javascript',body:boot});
  if(url.pathname==='/test/administrative/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>TEST administrative fixture</title><button data-consent-open>Cookie choices</button><button id="install">Install loader</button><script type="module" src="/test-bootstrap.mjs"></script>'});
  return route.abort();
 });
 await context.addInitScript(({state})=>{
  window.fixtureMessages=[];window.addEventListener('message',e=>{if(e.data?.a17Fixture)window.fixtureMessages.push(e.data)});
  if(state==='gpc')Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true});
  if(!['fresh','missing-issuer'].includes(state)&&!localStorage.getItem('gcs_tracking_consent_v1'))localStorage.setItem('gcs_tracking_consent_v1',JSON.stringify({version:'gcs-cookie-v4-distinct-purposes',record_type:'preference_only',analytics:state==='analytics-only'?'granted':'denied',advertising:['decline','analytics-only'].includes(state)?'denied':'granted'}));
 },{state});
 const page=await context.newPage();await page.goto(origin+'/test/administrative/');if(!noJS)await page.waitForFunction(()=>window.harnessReady);
 const freshScope=async()=>{
  f.p.revision++;f.p.evidence_ref+='_'+f.p.revision;f.p.review_ref+='_'+f.p.revision;f.p.source_revision='TEST_A17_REV'+f.p.revision;
  f.scope.id+='_'+f.p.revision;f.scope.permission_ref=f.p.evidence_ref;f.scope.review_ref=f.p.review_ref;f.scope.source_revision=f.p.source_revision;f.review();
  await issuer.issuePermission(f.p,f.scope);
  const next=await issuer.registerSession({scope_id:f.scope.id,subject_ref:'TEST_A17_SUBJECT',jurisdiction:'TEST_SUPPORTED',age_policy:'TEST_ADULT',gpc:false});await addCookie(next.cookie);
 };
 return {page,requests,messages,origin,mutateView:fn=>mutateView=fn,release:()=>releaseSDK?.(),fixture:f,freshScope,sourceHashes:{bootstrap:createHash('sha256').update(boot).digest('hex'),syntheticSDK:createHash('sha256').update(vendorArtifact(platform)).digest('hex')}};
}
export async function snapshot(h){
 const storage=await h.page.evaluate(()=>({cookies:document.cookie,local:Object.entries(localStorage),session:Object.entries(sessionStorage),messages:window.fixtureMessages||[]}));
 const cookieNames=(await h.page.context().cookies()).map(c=>c.name);
 return {sourceHashes:h.sourceHashes,necessaryCookieNames:cookieNames.filter(n=>['__Host-gcs_ads_session','__Host-gcs_ads_receipt','gcs_analytics_consent'].includes(n)),preferenceStorageKeys:storage.local.map(([k])=>k),sdk:h.requests.filter(r=>r.category==='sdk').length,pageview:h.requests.filter(r=>r.category==='pageview').length,beacon:h.requests.filter(r=>r.category==='beacon').length,collector:h.requests.filter(r=>r.category==='collector').length,storage:{advertisingCookies:cookieNames.filter(n=>/^(_fb|_uet|MUID)/i.test(n)),advertisingKeys:[...storage.local,...storage.session].filter(([n])=>/^(_fb|_uet|MUID)/i.test(n)),successfulSandboxWrites:storage.messages.filter(m=>m.kind==='storage-write'),unresolvedSandboxWrites:storage.messages.filter(m=>m.kind==='storage-unresolved')},requests:h.requests,messages:storage.messages};
}
