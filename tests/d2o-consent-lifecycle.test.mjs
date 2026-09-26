import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as runtime from '../src/consent-runtime.mjs';
const key='gcs_tracking_consent_v1';
export function boot({storage=new Map(),gpc=false,failRead=false,failWrite=false,adapter=null,model='us-default-on',stage='production-seal',url='https://glpclinicscout.com/',regionFetch=null,timers=null,posthog={}}={}){
 const listeners={},elements={},order=[],scripts=[];let ready;
 const navigator={globalPrivacyControl:gpc,userAgent:'Mozilla/5.0'};
 const location=new URL(url);
 const document={readyState:'loading',referrer:'',title:'',documentElement:{style:{removeProperty(k){order.push(['style-remove',k])},setProperty(k,v){order.push(['style-set',k,v])}},scrollHeight:1000},addEventListener(n,f){if(n==='DOMContentLoaded')ready=f;(listeners['document:'+n]??=[]).push(f)},querySelector:s=>elements[s]||null,querySelectorAll:()=>[],createElement(tag){return {tag,style:{},dataset:{},isConnected:true,setAttribute(){},addEventListener(n,f){this[n]=f},querySelector(s){if(!this.innerHTML)return null;const id=s.startsWith('#')?s.slice(1):null,action=s.match(/^\[data-consent="([^"]+)"\]$/)?.[1];if(!(id&&this.innerHTML.includes('id="'+id+'"'))&&!(action&&this.innerHTML.includes('data-consent="'+action+'"')))return null;this.controls??={};return this.controls[s]??={dataset:{consent:action},disabled:false,textContent:'',isConnected:true,focus(){document.activeElement=this}}},getBoundingClientRect:()=>({height:220}),remove(){this.isConnected=false;delete elements['#'+this.id]}}},head:{appendChild(s){if(s.id)elements['#'+s.id]=s;scripts.push(s);order.push(['script',s.src])}},body:{appendChild(e){elements['#'+e.id]=e}},set cookie(v){order.push(['cookie',v])}};
 const window={location,GCS_EXPORT_POLICY:{schema:'glp-release-export-policy-v2',stage,third_party_exports:stage==='production-seal'},GCS_ANALYTICS:{enabled:true,measurement_id:'G-MOCK',gtm_container_id:'GTM-MOCK'},GCS_POSTHOG:{enabled:true,api_key:'mock',host:'https://mock.invalid',...posthog},addEventListener(n,f){(listeners[n]??=[]).push(f)},dispatchEvent(e){order.push(['event',e.type]);for(const f of listeners[e.type]||[])f(e)},gtag(...args){order.push(args)}};
 const localStorage={getItem(k){if(failRead)throw Error('storage_read');return storage.has(k)?storage.get(k):null},setItem(k,v){if(failWrite)throw Error('storage_write');storage.set(k,v);order.push(['storage',k,JSON.parse(v)])}};
 const context=vm.createContext({setTimeout:timers?.setTimeout||setTimeout,clearTimeout:timers?.clearTimeout||clearTimeout,fetch:(url,options)=>{order.push(['region',url,options]);return regionFetch?regionFetch(url,options):Promise.resolve({ok:true,json:async()=>({schema:'glp-consent-region-v1',model:'us-default-on'})})},__TEST_ADAPTER:adapter,window,document,location,navigator,localStorage,URL,URLSearchParams,CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}}});
 // Region injection is lexical TEST input, never a window/config bypass. model:null uses the served fetch path.
 vm.runInContext(runtime.createConsentRuntimeSource(adapter?'__TEST_ADAPTER':'null',JSON.stringify(model)),context);vm.runInContext(readFileSync(new URL('../assets/analytics.js',import.meta.url),'utf8'),context);
 return {get c(){return window.GCSConsent},window,navigator,storage,order,scripts,document,ready:()=>ready(),whenReady:()=>window.GCSConsentReady,choose(value){const root=document.querySelector('#gcs-consent'),button=root?.querySelector('[data-consent="'+value+'"]');assert.ok(button,'rendered consent action '+value);root.click({target:{closest:()=>button}})},documentEvent(type,event){for(const f of listeners['document:'+type]||[])f(event)},event:(type,extra={})=>window.dispatchEvent({type,...extra}),failWrites:()=>{failWrite=true}};
}
test('cross-tab withdrawal synchronously clears queued work before consent event returns',()=>{
 const f=boot();assert.equal(f.c.effective(),'granted');f.window.GCSAnalytics.event('comparison_sort_change');assert.equal(f.window.posthog.__queue.length,1);
 f.storage.delete(key);f.event('storage',{key});assert.equal(f.window.posthog.__queue.length,0);assert.equal(f.window.GCS_ANALYTICS.consent,'denied');
});
test('dynamic GPC refresh clears pending work and cannot auto-restore prior grant',()=>{
 const f=boot();assert.equal(f.c.effective(),'granted');f.window.GCSAnalytics.event('comparison_sort_change');f.navigator.globalPrivacyControl=true;f.event('focus');
 assert.equal(f.window.posthog.__queue.length,0);assert.equal(f.c.effective(),'denied');f.navigator.globalPrivacyControl=false;f.event('focus');assert.equal(f.c.effective(),'denied');
});
test('failed persistence cannot prevent revocation or revive old grant in this document',()=>{
 const f=boot();f.c.apply('granted');f.failWrites();assert.doesNotThrow(()=>f.c.apply('denied'));assert.equal(f.c.effective(),'denied');assert.equal(f.window.GCS_ANALYTICS.consent,'denied');assert.equal(f.c.persistenceStatus(),'failed');
});
test('default-on record before default, update before consent event and its PostHog loader (GTM held)',()=>{
 const f=boot(),saved=f.order.findIndex(x=>x[0]==='storage'),first=f.order.findIndex(x=>x[0]==='consent'&&x[1]==='default');
 assert.ok(saved>=0&&saved<first);assert.equal(f.order[saved][2].analytics,'granted');
 assert.deepEqual(JSON.parse(JSON.stringify(f.order[first])),['consent','default',{analytics_storage:'granted',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'denied'}]);assert.equal(f.scripts.length,1);
 const update=f.order.findIndex(x=>x[0]==='consent'&&x[1]==='update'&&x[2].analytics_storage==='granted');const script=f.order.findIndex(x=>x[0]==='script');assert.ok(first<update);assert.ok(update<script);const event=f.order.findIndex(x=>x[0]==='event'&&x[1]==='gcs:consent');assert.ok(update<event);assert.ok(event<script);
 for(const x of f.order.filter(x=>x[0]==='consent')){assert.equal(x[2].ad_storage,'granted');assert.equal(x[2].ad_user_data,'granted');assert.equal(x[2].ad_personalization,'denied');}
});
test('valid reload restores analytics only; unknown and malformed records fail closed',()=>{
 const f=boot();f.c.apply('granted');assert.equal(boot({storage:f.storage}).c.effective(),'granted');
 for(const raw of ['','broken','null','{}',JSON.stringify({version:'legacy-default-on',analytics:'granted'}),JSON.stringify({...f.c.read(),advertising:'unknown'})]){const b=boot({storage:new Map([[key,raw]])});assert.equal(b.c.effective(),'denied');assert.equal(b.scripts.length,0)}
 assert.equal(boot({failRead:true}).c.effective(),'denied');
});
test('known v3 explicit opt-in migrates analytics only, never advertising',()=>{
 const f=boot({storage:new Map([[key,JSON.stringify({version:'gcs-cookie-v3-explicit-opt-in',analytics:'granted',advertising:'granted'})]])});
 assert.equal(f.c.effective(),'granted');assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.c.read().record_type,'preference_only');
});
test('banner has no checkbox, one acknowledgment and the existing cookie-choices link reopens management',()=>{
 const f=boot();f.ready();const root=f.document.querySelector('#gcs-consent'),html=root.innerHTML;
 assert.doesNotMatch(html,/type="checkbox"|<input| checked|gcs-consent-advertising/);assert.equal((html.match(/<button /g)||[]).length,1);assert.match(html,/data-consent="acknowledge">Got it/);assert.match(html,/href="\/privacy\/cookies\/" data-consent-open>Manage \/ opt out/);assert.match(html,/role="status"/);
 assert.match(root.querySelector('#gcs-consent-copy').textContent,/Analytics and advertising\/conversion measurement are on/);
 f.choose('acknowledge');assert.equal(f.document.querySelector('#gcs-consent'),null);assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'global_default');assert.equal(f.c.read().notice_acknowledged,true);
 let prevented=false;f.documentEvent('click',{target:{closest:s=>s.includes('footer a[href^="/privacy/cookies/"]')?{}:null},preventDefault(){prevented=true}});assert.equal(prevented,true);assert.ok(f.document.querySelector('#gcs-consent'));f.choose('denied');assert.equal(f.c.effective(),'denied');
});
test('P27 GPC first load stores denied and never loads PostHog',()=>{
 const f=boot({gpc:true}),record=JSON.parse(f.storage.get(key));assert.equal(record.analytics,'denied','GPC persisted analytics denial');assert.equal(record.advertising,'denied');assert.equal(record.record_type,'preference_only');assert.equal(f.scripts.length,0);assert.equal(f.c.effective(),'denied');
 assert.equal(f.c.apply('granted').analytics,'denied');f.c.acknowledge();assert.equal(f.c.read().analytics,'denied');assert.equal(f.scripts.length,0);
 for(const x of f.order.filter(x=>x[0]==='consent'))assert.deepEqual(Object.values(x[2]),['denied','denied','denied','denied']);
});
test('P27 opt-out clears default-on queue before click returns',()=>{
 const f=boot();assert.equal(f.c.read().analytics_basis,'global_default');assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),true);const queue=f.window.posthog.__queue,script=f.scripts[0];assert.equal(queue.length,1);
 f.c.open();f.choose('denied');assert.equal(queue.length,0,'opt-out cleared pending queue synchronously');assert.equal(f.c.read().analytics,'denied');assert.equal(f.window.GCS_ANALYTICS.consent,'denied');assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false);
 let initialized=0;f.window.posthog.init=()=>{initialized++};script.load();assert.equal(initialized,0);assert.equal(f.window.GCS_POSTHOG_LOADED,false);
});
test('P27 storage failures never authorize default-on',()=>{
 for(const options of [{failRead:true},{failWrite:true},{failRead:true,failWrite:true}]){const f=boot(options);assert.equal(f.c.effective(),'denied');assert.equal(f.c.persistenceStatus(),'failed');assert.equal(f.scripts.length,0);assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false)}
});
test('P27 unacknowledged notice survives reload; saved withdrawal never becomes a default grant',()=>{
 const f=boot(),again=boot({storage:f.storage});again.ready();assert.ok(again.document.querySelector('#gcs-consent'));f.c.apply('denied');const denied=boot({storage:f.storage});denied.ready();assert.equal(denied.c.effective(),'denied');assert.equal(denied.scripts.length,0);assert.equal(denied.document.querySelector('#gcs-consent'),null);
});
test('P27 legacy regional input still gets one worldwide acknowledgment without checkboxes',()=>{
 const f=boot({model:'prior-opt-in'});assert.equal(f.c.effective(),'granted');assert.equal(f.c.purposes().advertising,'granted');assert.equal(f.scripts.length,1);assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),true);f.ready();const html=f.document.querySelector('#gcs-consent').innerHTML;
 assert.doesNotMatch(html,/<input| checked|data-consent="(?:granted|denied)"/);assert.equal((html.match(/<button /g)||[]).length,1);assert.match(html,/data-consent="acknowledge"/);
 const style=f.document.querySelector('#gcs-consent-style').textContent;assert.match(style,/button\[data-consent\]\{flex:1;min-height:44px/);assert.deepEqual(Object.values(f.order.find(x=>x[0]==='consent'&&x[1]==='default')[2]),['granted','granted','granted','denied']);
 f.choose('acknowledge');assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'global_default');assert.equal(f.c.purposes().advertising,'granted');assert.equal(f.scripts.length,2);assert.equal(f.scripts.filter(x=>x.src).length,1);
});
test('P27 region changes do not change acknowledgment or opt-out preferences',()=>{
 const f=boot();f.c.acknowledge();const eu=boot({storage:f.storage,model:'prior-opt-in'});assert.equal(eu.c.effective(),'granted');assert.equal(eu.c.purposes().advertising,'granted');assert.equal(eu.scripts.length,1);eu.ready();assert.equal(eu.document.querySelector('#gcs-consent'),null);eu.c.open();eu.choose('denied');assert.equal(eu.c.effective(),'denied');assert.equal(eu.c.read().analytics_basis,'explicit');assert.equal(boot({storage:f.storage}).c.purposes().advertising,'denied');
});
// Offline preference reducer proof, not runtime eligibility or an A12 receipt.
for(const analytics of ['denied','granted'])for(const advertising of ['denied','granted'])test('isolated eligible TEST preference '+analytics+'/'+advertising,()=>{
 assert.equal(typeof runtime.consentPreference,'function');const choice={analytics,advertising};
 const record=runtime.consentPreference(choice,{advertisingEligible:true,gpc:false});assert.deepEqual(record,choice);
 assert.deepEqual(runtime.consentPreference(choice,{advertisingEligible:true,gpc:true}),{analytics:'denied',advertising:'denied'});
 assert.equal(runtime.consentPreference(choice).advertising,'denied');
});
