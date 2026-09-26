import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {consentRuntimeSource} from '../src/consent-runtime.mjs';
const source=readFileSync(new URL('../assets/analytics.js',import.meta.url),'utf8');
const original='https://affiliate-fixture.invalid/?s1=placement';
function transportFixture({unsupported=false}={}){
 const dom=new JSDOM('',{url:'https://glpclinicscout.com/providers/',runScripts:'outside-only'}),w=dom.window,requests=[];
 let finish,options,optedOut=false;
 w.fetch=unsupported?undefined:(input,init)=>{requests.push({input,init});return new Promise(resolve=>{finish=resolve})};w.Response=Response;
 w.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};w.GCS_ANALYTICS={enabled:true,measurement_id:'G-FIXTURE'};w.GCS_POSTHOG={enabled:true,api_key:'TEST',host:'https://posthog-fixture.invalid'};
 w.eval(consentRuntimeSource);w.eval(source);
 if(!unsupported){w.posthog={init:(key,o)=>{options=o},set_config:o=>{options={...options,...o}},has_opted_out_capturing:()=>optedOut,opt_out_capturing:()=>{optedOut=true},opt_in_capturing:()=>{optedOut=false}};w.document.querySelector('script').dispatchEvent(new w.Event('load'))}
 return {dom,w,requests,options:()=>options,finish:()=>finish(new Response('{}',{status:200}))};
}
test('owned SDK transport aborts held epoch and terminally rejects it after regrant',async()=>{
 const f=transportFixture();try{
 const first=f.options().fetch_options;const held=f.w.fetch('https://posthog-fixture.invalid/e/',first);assert.equal(f.requests.length,1);
 f.w.GCSConsent.apply('denied');assert.equal(first.signal.aborted,true);f.finish();assert.equal((await held).status,400);
 f.w.GCSConsent.apply('granted');assert.notEqual(f.options().fetch_options.signal,first.signal);
 assert.equal((await f.w.fetch('https://posthog-fixture.invalid/e/?retry_count=1',first)).status,400);assert.equal(f.requests.length,1);
 const fresh=f.w.fetch('https://posthog-fixture.invalid/e/',f.options().fetch_options);f.finish();assert.equal((await fresh).status,200);assert.equal(f.requests.length,2);
 }finally{f.dom.window.close()}
});
test('owned SDK transport rejects missing authority and preserves unrelated fetches',async()=>{
 const f=transportFixture();try{
 assert.equal((await f.w.fetch('https://posthog-fixture.invalid/e/',{})).status,400);assert.equal(f.requests.length,0);
 f.w.GCSConsent.apply('denied');const unrelated=f.w.fetch('https://glpclinicscout.com/local-resource',{});f.finish();assert.equal((await unrelated).status,200);assert.equal(f.requests.length,1);
 }finally{f.dom.window.close()}
});
test('SDK transport requires fetch capability instead of falling back to an unowned transport',()=>{
 const f=transportFixture({unsupported:true});try{assert.equal(f.w.document.querySelector('script'),null);assert.equal(f.requests.length,0)}finally{f.dom.window.close()}
});
test('SDK transport configuration owns outbound and unload fallback paths',()=>{
 const f=transportFixture();try{assert.equal(f.options().api_transport,'fetch');assert.equal(f.options().disable_beacon,true);assert.equal(f.options().fetch_options.referrerPolicy,'no-referrer');assert.equal(f.options().fetch_options.signal.aborted,false)}finally{f.dom.window.close()}
});
function fixture(analytics,advertising){
 const dom=new JSDOM(`<a id="affiliate" href="${original}" data-network="Affiliati" data-program="TEST" data-analytics-event="affiliate_click">Provider</a>`,{url:'https://glpclinicscout.com/providers/',runScripts:'outside-only'}),w=dom.window;
 w.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};w.GCS_ANALYTICS={enabled:false};
 w.localStorage.setItem('gcs_tracking_consent_v1',JSON.stringify({version:'gcs-cookie-v4-distinct-purposes',record_type:'preference_only',analytics,advertising}));
 w.document.addEventListener('click',e=>e.preventDefault(),true);
 w.eval(consentRuntimeSource);w.eval(source);
 return {dom,w,a:w.document.querySelector('#affiliate')};
}
for(const analytics of ['granted','denied'])for(const advertising of ['granted','denied'])test(`conversion purpose: analytics=${analytics}, advertising=${advertising}`,()=>{
 const {dom,w,a}=fixture(analytics,advertising);try{
 const allowed=advertising==='granted';assert.equal(w.GCSConsent.allowsExports('advertising'),allowed);
 assert.equal(w.GCSAnalytics.clickIdFor('API')!==null,allowed);
 a.click();assert.equal(new URL(a.href).searchParams.has('s2'),allowed);
 assert.equal(w.localStorage.getItem('cs_click_id:last:TEST')!==null,allowed);
 assert.equal(new URL(a.href).searchParams.get('s1'),'placement');
 }finally{dom.window.close()}
});
for(const mode of ['withdraw','gpc','cross-tab','advertising-only-withdraw'])test(`decorated identity cleanup: ${mode}`,()=>{
 const {dom,w,a}=fixture('granted','granted');try{
 a.click();assert.notEqual(a.href,original);assert.ok(w.localStorage.getItem('cs_click_id:last:TEST'));
 w.localStorage.setItem('cs_click_id:last:OTHER','old-browser-owned-id');w.localStorage.setItem('unrelated','keep');
 if(mode==='gpc'){Object.defineProperty(w.navigator,'globalPrivacyControl',{value:true});w.dispatchEvent(new w.Event('focus'))}
 else if(mode==='cross-tab'){w.localStorage.setItem('gcs_tracking_consent_v1',JSON.stringify({...w.GCSConsent.read(),analytics:'denied',advertising:'denied'}));w.dispatchEvent(new w.StorageEvent('storage',{key:'gcs_tracking_consent_v1'}))}
 else w.GCSConsent.apply({analytics:mode==='advertising-only-withdraw'?'granted':'denied',advertising:'denied'});
 assert.equal(a.href,original);assert.equal(w.localStorage.getItem('cs_click_id:last:TEST'),null);assert.equal(w.localStorage.getItem('cs_click_id:last:OTHER'),null);assert.equal(w.localStorage.getItem('unrelated'),'keep');
 a.click();assert.equal(a.href,original);assert.equal(w.localStorage.getItem('cs_click_id:last:TEST'),null);
 }finally{dom.window.close()}
});
