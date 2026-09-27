import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {ga4Transport} from '../src/ga4-runtime.mjs';

// Capability regression; actual unmodified sampled SDK is exercised separately
// under context deny routing and a non-forwarding proxy (never a live collector).
test('GA diagnostics cannot use fetch/image/script after stop; collection and unrelated transports retain native behavior',async()=>{
 const dom=new JSDOM('<head></head><body></body>',{url:'https://glpclinicscout.com/about/',runScripts:'outside-only'});
 const w=dom.window,calls=[],blocked=[];
 const result={ok:true,status:204};
 w.fetch=function(...args){calls.push({kind:'fetch',self:this,args});return Promise.resolve(result)};
 w.navigator.sendBeacon=function(...args){calls.push({kind:'beacon',self:this,args});return true};
 for(const Constructor of [w.HTMLImageElement,w.HTMLScriptElement]){
  const descriptor=Object.getOwnPropertyDescriptor(Constructor.prototype,'src');
  Object.defineProperty(Constructor.prototype,'src',{...descriptor,set(value){calls.push({kind:this.tagName,value});descriptor.set.call(this,value)}});
 }
 w.GCS_ANALYTICS={enabled:true,measurement_id:'G-2WQ42JY0WK'};
 w.addEventListener('gcs:ga4-diagnostic-blocked',e=>blocked.push(e.detail));
 const runtime=w.eval(`(${ga4Transport.toString()})(()=>true)`);
 runtime.load();
 const sdk=w.document.querySelector('script');
 assert.equal(sdk.src,'https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer');
 sdk.dispatchEvent(new w.Event('load'));
 assert.equal(Array.from(w.gcsGa4Layer).filter(a=>a[0]==='event'&&a[1]==='page_view').length,1);
 const td='https://www.googletagmanager.com/td?id=G-2WQ42JY0WK&fin=1';
 const diagnostic=sdk.src+'&is_td=1&csp=test';
 const collect='https://www.google-analytics.com/g/collect?en=page_view';
 const options={method:'POST',keepalive:true,body:'original-held-event'};
 assert.equal(await w.fetch(collect,options),result);
 runtime.stop();
 // An accepted in-flight measurement retry retains the exact original arguments.
 assert.equal(await w.fetch(collect,options),result);
 const retries=calls.filter(c=>c.kind==='fetch');
 assert.equal(retries.length,2);assert.equal(retries[1].args[1],options);assert.equal(retries[1].self,w);
 const before=calls.length;
 for(const input of [td,new w.URL(td),{url:td}])await assert.rejects(w.fetch(input,{method:'POST',keepalive:true}),/diagnostic/);
 assert.equal(w.navigator.sendBeacon(td,'diagnostic'),false);
 new w.Image().src=td;
 const script=w.document.createElement('script');script.src=diagnostic;w.document.head.appendChild(script);
 const image=w.document.createElement('img');image.setAttribute('src',td);w.document.body.appendChild(image);
 script.setAttribute('SRC',diagnostic);
 assert.equal(calls.length,before,'no native diagnostic transport invoked');
 assert.equal(script.hasAttribute('src'),false);assert.equal(image.hasAttribute('src'),false);
 assert.equal(blocked.length,8,'denials remain locally observable');
 assert.ok(blocked.every(e=>Object.keys(e).sort().join(',')==='endpoint,transport'));
 assert.ok(blocked.every(e=>['/td','/gtag/js'].includes(e.endpoint)));
 // No domain substring matching, sampling changes or broader analytics shutdown.
 for(const url of ['https://www.googletagmanager.com.evil.invalid/td','https://example.invalid/td','/api/local'])assert.equal(await w.fetch(url,options),result);
 new w.Image().src='https://www.google-analytics.com/g/collect?en=page_view';
 assert.equal(calls.at(-1).kind,'IMG');
 assert.equal(w.navigator.sendBeacon(collect,'original-held-event'),true);
 dom.window.close();
 // The emitted (non-module) function must not silently lose a frozen capability.
 for(const sabotage of [w=>{delete w.fetch},w=>Object.defineProperty(w,'fetch',{value:w.fetch,writable:false})]){
  const denied=new JSDOM('<head></head>',{url:'https://glpclinicscout.com/about/',runScripts:'outside-only'});
  const w=denied.window;w.fetch=()=>Promise.resolve(result);sabotage(w);
  w.GCS_ANALYTICS={enabled:true,measurement_id:'G-2WQ42JY0WK'};
  const runtime=w.eval(`(${ga4Transport.toString()})(()=>true)`);runtime.load();
  assert.equal(w.document.querySelector('script'),null);
  assert.equal(w['ga-disable-G-2WQ42JY0WK'],true);
  denied.window.close();
 }
 });

 test('GA tag timing /a image diagnostic is denied before native transport without blocking GA',async()=>{
 const dom=new JSDOM('<head></head><body></body>',{url:'https://glpclinicscout.com/about/',runScripts:'outside-only'});
 const w=dom.window,native=[],blocked=[];
 w.fetch=(...args)=>{native.push({kind:'fetch',args});return Promise.resolve({ok:true})};
 w.navigator.sendBeacon=(...args)=>{native.push({kind:'beacon',args});return true};
 for(const Constructor of [w.HTMLImageElement,w.HTMLScriptElement]){
 const descriptor=Object.getOwnPropertyDescriptor(Constructor.prototype,'src');
 Object.defineProperty(Constructor.prototype,'src',{...descriptor,set(value){native.push({kind:this.tagName,value});descriptor.set.call(this,value)}});
 }
 w.GCS_ANALYTICS={enabled:true,measurement_id:'G-2WQ42JY0WK'};
 w.addEventListener('gcs:ga4-diagnostic-blocked',event=>blocked.push(event.detail));
 const runtime=w.eval(`(${ga4Transport.toString()})(()=>true)`);
 try{
 runtime.load();const sdk=w.document.querySelector('script');
 assert.equal(sdk.src,'https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer');
 sdk.dispatchEvent(new w.Event('load'));
 assert.equal(Array.from(w.gcsGa4Layer).filter(a=>a[0]==='event'&&a[1]==='page_view').length,1);
 runtime.stop();
 const diagnostic='https://www.googletagmanager.com/a?v=3&t=l&pid=469033750&cid=G-2WQ42JY0WK&l=L86~GA127';
 const before=native.length;
 for(const input of [diagnostic,new w.URL(diagnostic),{url:diagnostic}])await assert.rejects(w.fetch(input),/diagnostic/);
 assert.equal(w.navigator.sendBeacon(diagnostic,'tag timing'),false);
 new w.Image(1,1).src=diagnostic;
 const image=w.document.createElement('img');image.setAttribute('src',diagnostic);
 const script=w.document.createElement('script');script.src=diagnostic;
 script.setAttribute('SRC',diagnostic);
 assert.equal(native.length,before,'no diagnostic reached a native transport/CSP');
 assert.equal(image.hasAttribute('src'),false);assert.equal(script.hasAttribute('src'),false);
 assert.equal(blocked.length,8);assert.ok(blocked.every(e=>e.endpoint==='/a'&&Object.keys(e).sort().join(',')==='endpoint,transport'));
 // Same host/path with a non-timing selector and the real collection lane remain available.
 const control='https://www.googletagmanager.com/a?v=3&t=other';
 new w.Image().src=control;
 assert.equal(native.at(-1).value,control);
 const collect='https://www.google-analytics.com/g/collect?en=page_view';
 const options={method:'POST',keepalive:true,body:'original-held-event'};
 assert.equal((await w.fetch(collect,options)).ok,true);
 assert.deepEqual(native.at(-1).args,[collect,options]);
 }finally{dom.window.close()}
 });
