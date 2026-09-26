import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './d2o-consent-lifecycle.test.mjs';
import {consentRuntimeSource,createConsentRuntimeSource} from '../src/consent-runtime.mjs';
import {detectConsentModel,onRequestGet} from '../functions/api/geo-state.js';
const key='gcs_tracking_consent_v1';
const request=country=>new Request('https://glpclinicscout.com/api/geo-state?purpose=consent',{headers:country?{'cf-ipcountry':country}: {}});
for(const country of ['US','GB','DE','FR','IE','NO','CH','CA',''])test('P27 worldwide bootstrap '+(country||'unknown'),async()=>{
 const response=await onRequestGet({request:request(country)}),body=await response.json();
 assert.equal(detectConsentModel(request(country)),'global-default-on');
 assert.deepEqual(body,{schema:'glp-consent-region-v1',model:'global-default-on'});assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'CF-IPCountry');
 const f=boot({model:null,regionFetch:async()=>onRequestGet({request:request(country)})});
 assert.equal(f.c.model(),body.model);assert.equal(f.c.read().analytics,'granted');assert.equal(f.c.read().advertising,'granted');assert.equal(f.c.read().record_type,'preference_only');assert.equal(f.c.read().notice_acknowledged,false);assert.equal(f.c.allowsExports(),true);assert.equal(f.c.allowsExports('advertising'),true);assert.equal(f.scripts.length,1);
 assert.equal(f.order.filter(x=>x[0]==='region').length,0,'geography cannot delay defaults');
 const saved=f.order.findIndex(x=>x[0]==='storage'),defaults=f.order.findIndex(x=>x[0]==='consent'&&x[1]==='default');assert.ok(saved>=0&&saved<defaults);assert.deepEqual(Object.values(f.order[defaults][2]),['granted','granted','granted','denied']);
});
test('P27 exported runtime has one model and no geographic or window-config bypass',()=>{assert.equal(consentRuntimeSource,createConsentRuntimeSource());assert.doesNotMatch(consentRuntimeSource,/window\.GCS_CONSENT_MODEL|fetch\(|prior-opt-in|us-default-on/)});
test('P27 served GPC first load and dynamic GPC both persist denial',async()=>{
 for(const initial of [true,false]){const f=boot({model:null,gpc:initial});const previous=f.scripts.length;assert.equal(previous,initial?0:1);f.navigator.globalPrivacyControl=true;f.event('focus');await f.whenReady();assert.equal(JSON.parse(f.storage.get(key)).analytics,'denied');assert.equal(f.c.effective(),'denied');assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.scripts.length,previous);assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false);assert.equal(f.c.allowsExports('advertising'),false)}
});
for(const [label,regionFetch]of [
 ['network error',async()=>{throw Error('offline')}],
 ['HTTP failure',async()=>({ok:false})],
 ['bad JSON',async()=>({ok:true,json:async()=>{throw Error('bad JSON')}})],
 ['wrong schema',async()=>({ok:true,json:async()=>({schema:'other'})})],
 ['unknown model',async()=>({ok:true,json:async()=>({schema:'glp-consent-region-v1',model:'unknown'})})],
 ['null response',async()=>({ok:true,json:async()=>null})],
])test('P27 geography is not requested and cannot disable worldwide defaults: '+label,async()=>{let calls=0;const f=boot({model:null,regionFetch:(...args)=>{calls++;return regionFetch(...args)}});await f.whenReady();assert.equal(calls,0);assert.equal(f.c.model(),'global-default-on');assert.equal(f.c.read().analytics,'granted');assert.equal(f.c.purposes().advertising,'granted');assert.equal(f.scripts.length,1);assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),true)});
test('P27 state endpoint response is unchanged outside the consent query',async()=>{
 const r=new Request('https://glpclinicscout.com/api/geo-state',{headers:{'cf-ipcountry':'US','cf-region-code':'CA'}});assert.deepEqual(await (await onRequestGet({request:r})).json(),{schema:'glp-geo-state-v1',available:true,state:'CA'});
 Object.defineProperty(r,'cf',{value:{country:'GB',regionCode:'ENG'}});assert.equal(detectConsentModel(r),'global-default-on');assert.deepEqual(await (await onRequestGet({request:r})).json(),{schema:'glp-geo-state-v1',available:false,state:null});
});
test('P27 hung geography cannot delay notice or restore an opt-out',async()=>{
 let calls=0;const f=boot({model:null,regionFetch:()=>{calls++;return new Promise(()=>{})}});await f.whenReady();assert.equal(calls,0);assert.equal(f.c.model(),'global-default-on');assert.equal(f.c.read().analytics,'granted');assert.equal(f.scripts.length,1);f.ready();assert.ok(f.document.querySelector('#gcs-consent'));f.c.open();f.choose('denied');await new Promise(setImmediate);assert.equal(f.c.effective(),'denied');assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.scripts.filter(s=>s.src).length,1);
});
