import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './d2o-consent-lifecycle.test.mjs';
import {consentRuntimeSource,createConsentRuntimeSource} from '../src/consent-runtime.mjs';
import {detectConsentModel,onRequestGet} from '../functions/api/geo-state.js';
const key='gcs_tracking_consent_v1';
const request=country=>new Request('https://glpclinicscout.com/api/geo-state?purpose=consent',{headers:country?{'cf-ipcountry':country}: {}});
for(const country of ['US','GB','DE','FR','IE','NO','CH','CA',''])test('P27 served regional bootstrap '+(country||'unknown'),async()=>{
 const response=await onRequestGet({request:request(country)}),body=await response.json();
 assert.equal(detectConsentModel(request(country)),country==='US'?'us-default-on':'prior-opt-in');
 assert.deepEqual(body,{schema:'glp-consent-region-v1',model:country==='US'?'us-default-on':'prior-opt-in'});assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'CF-IPCountry');
 const f=boot({model:null,regionFetch:async()=>onRequestGet({request:request(country)})});assert.equal(f.c,undefined);assert.equal(f.scripts.length,0);assert.equal(f.window.GCSAnalytics.event('quiz_start'),false);await f.whenReady();
 assert.equal(f.c.model(),body.model);assert.equal(f.c.read().analytics,country==='US'?'granted':'denied');assert.equal(f.c.read().advertising,'denied');assert.equal(f.c.read().record_type,'preference_only');assert.equal(f.c.read().notice_acknowledged,false);assert.equal(f.c.allowsExports(),country==='US');assert.equal(f.scripts.length,country==='US'?1:0);
 const lookup=f.order.find(x=>x[0]==='region');assert.equal(lookup[1],'/api/geo-state?purpose=consent');assert.deepEqual(JSON.parse(JSON.stringify(lookup[2])),{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
 const saved=f.order.findIndex(x=>x[0]==='storage'),defaults=f.order.findIndex(x=>x[0]==='consent'&&x[1]==='default');assert.ok(saved>=0&&saved<defaults);assert.equal(f.order[defaults][2].analytics_storage,country==='US'?'granted':'denied');
});
test('P27 default exported runtime cannot be configured into the injected TEST model',()=>{assert.equal(consentRuntimeSource,createConsentRuntimeSource());assert.ok(consentRuntimeSource.endsWith('})(null),null);\n'));assert.doesNotMatch(consentRuntimeSource,/window\.GCS_CONSENT_MODEL/)});
test('P27 served GPC first load and delayed GPC both persist denial',async()=>{
 for(const initial of [true,false]){let respond;const f=boot({model:null,gpc:initial,regionFetch:()=>new Promise(resolve=>{respond=resolve})});await Promise.resolve();f.navigator.globalPrivacyControl=true;respond(await onRequestGet({request:request('US')}));await f.whenReady();assert.equal(JSON.parse(f.storage.get(key)).analytics,'denied','served GPC persisted analytics denial');assert.equal(f.c.effective(),'denied');assert.equal(f.scripts.length,0);assert.equal(f.window.GCSAnalytics.event('quiz_start'),false)}
});
for(const [label,regionFetch]of [
 ['network error',async()=>{throw Error('offline')}],
 ['HTTP failure',async()=>({ok:false,json:async()=>({schema:'glp-consent-region-v1',model:'us-default-on'})})],
 ['bad JSON',async()=>({ok:true,json:async()=>{throw Error('bad JSON')}})],
 ['wrong schema',async()=>({ok:true,json:async()=>({schema:'glp-geo-state-v1',model:'us-default-on'})})],
 ['unknown model',async()=>({ok:true,json:async()=>({schema:'glp-consent-region-v1',model:'unknown'})})],
 ['null response',async()=>({ok:true,json:async()=>null})],
])test('P27 regional failure keeps prior opt-in: '+label,async()=>{const f=boot({model:null,regionFetch});await f.whenReady();assert.equal(f.c.model(),'prior-opt-in');assert.equal(f.c.read().analytics,'denied');assert.equal(f.scripts.length,0);assert.equal(f.window.GCSAnalytics.event('quiz_start'),false)});
test('P27 state endpoint response is unchanged outside the consent query',async()=>{
 const r=new Request('https://glpclinicscout.com/api/geo-state',{headers:{'cf-ipcountry':'US','cf-region-code':'CA'}});assert.deepEqual(await (await onRequestGet({request:r})).json(),{schema:'glp-geo-state-v1',available:true,state:'CA'});
 Object.defineProperty(r,'cf',{value:{country:'GB',regionCode:'ENG'}});assert.equal(detectConsentModel(r),'prior-opt-in');assert.deepEqual(await (await onRequestGet({request:r})).json(),{schema:'glp-geo-state-v1',available:false,state:null});
});
test('P27 hung region lookup shows prior opt-in and late US cannot upgrade it',async()=>{
 let expire,respond,cleared=false;const f=boot({model:null,timers:{setTimeout(fn,ms){assert.equal(ms,1500);expire=fn;return 1},clearTimeout(id){assert.equal(id,1);cleared=true}},regionFetch:()=>new Promise(resolve=>{respond=resolve})});await Promise.resolve();expire();await f.whenReady();assert.equal(cleared,true);assert.equal(f.c.model(),'prior-opt-in');assert.equal(f.c.read().analytics,'denied');assert.equal(f.scripts.length,0);f.ready();assert.ok(f.document.querySelector('#gcs-consent'));
 respond({ok:true,json:async()=>({schema:'glp-consent-region-v1',model:'us-default-on'})});await new Promise(setImmediate);assert.equal(f.c.model(),'prior-opt-in');assert.equal(f.c.read().analytics,'denied');assert.equal(f.scripts.filter(s=>s.src).length,0);
});
