import test from 'node:test';
import assert from 'node:assert/strict';
import {loaderProjection} from './a17-loader-fixtures.mjs';

import * as staged from '../src/advertising-staging-runtime.mjs';
import * as runtime from '../src/consent-runtime.mjs';
const reply=value=>({ok:true,json:async()=>value});
test('staged runtime source wires a lexical issuer and loader without changing default null authority',()=>{
 assert.equal(typeof staged.createStagedAdvertisingRuntimeSource,'function');
 const source=staged.createStagedAdvertisingRuntimeSource();
 assert.match(source,/createAdvertisingConsentAdapter/);assert.match(source,/installAdvertisingLoaders/);
 assert.match(runtime.consentRuntimeSource,/\}\)\(null\)/);
 assert.doesNotMatch(source,/window\.__TESTAdapter/);
});
const loadAdapter=()=>import('../assets/advertising-consent-adapter.mjs').catch(()=>({}));
const loadLoaders=()=>import('../src/advertising-loaders.mjs').catch(()=>({}));
test('loader predicate requires exact isolated source and transport-specific grant',async()=>{
 const {eligibleAdvertisingProjection}=await loadLoaders();assert.equal(typeof eligibleAdvertisingProjection,'function');
 for(const platform of ['meta','microsoft']){
  const view=loaderProjection(platform);const context={url:view.scope.origin+view.scope.source_path,title:view.scope.source_title,referrer:'',gpc:false,advertising:'granted'};
  assert.equal(eligibleAdvertisingProjection(view,context),true);
  assert.equal(eligibleAdvertisingProjection(view,{...context,advertising:'denied'}),false);
  assert.equal(eligibleAdvertisingProjection(view,{...context,url:'https://glpclinicscout.com/lp/quiz/'}),false);
  for(const [key,value] of [['transport','microsoft_offline'],['target_id','evil'],['permission_sha256','bad'],['source_ref',''],['eligible',false]]){
   const bad=structuredClone(view);bad.scope[key]=value;assert.equal(eligibleAdvertisingProjection(bad,context),false,key);
  }
 }
});
test('adapter starts denied and reads only the fixed same-origin issuer',async()=>{
 const {createAdvertisingConsentAdapter}=await loadAdapter();
 assert.equal(typeof createAdvertisingConsentAdapter,'function','missing real issuer adapter');
 const calls=[]; const adapter=createAdvertisingConsentAdapter({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({scope:null,receipt:null,csrf:'TEST-csrf'})}}});
 assert.equal(adapter.readCurrent(),null);
 await adapter.refresh();
 assert.equal(calls[0].url,'/api/advertising-consent');
 assert.equal(calls[0].options.credentials,'same-origin');
 assert.equal(calls[0].options.cache,'no-store');
 assert.equal(calls[0].options.redirect,'error');
});
test('choice posts only offered scope and CSRF then reads authoritative result',async()=>{
 const {createAdvertisingConsentAdapter}=await loadAdapter();const calls=[];
 const adapter=createAdvertisingConsentAdapter({fetchImpl:async(url,options)=>{calls.push({url,options});return reply({scope:{id:'TEST-scope'},receipt:calls.length===3?{choice:'explicit_opt_in'}:null,csrf:'TEST-csrf'})}});
 assert.equal(typeof adapter.choose,'function');await adapter.refresh();
 await assert.rejects(()=>adapter.choose({scope_id:'TEST-scope',choice:'explicit_opt_in',target_id:'evil'}));
 await adapter.choose({scope_id:'TEST-scope',choice:'explicit_opt_in'});
 assert.deepEqual(JSON.parse(calls[1].options.body),{scope_id:'TEST-scope',choice:'explicit_opt_in',csrf:'TEST-csrf'});
 assert.equal(calls[2].options.method,'GET');assert.equal(adapter.readCurrent().receipt.choice,'explicit_opt_in');
});
test('revoke synchronously clears projection and invalidates a late issuance response',async()=>{
 const {createAdvertisingConsentAdapter}=await loadAdapter();let finish;let revoked=false;const calls=[];
 const adapter=createAdvertisingConsentAdapter({fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/revoke')){revoked=true;return reply({acknowledged:true})}
  if(options.method==='POST')return new Promise(resolve=>{finish=()=>resolve(reply({}))});
  return reply({scope:{id:'TEST-scope'},receipt:revoked?null:{choice:'explicit_opt_in'},csrf:'TEST-csrf'});
 }});
 assert.equal(typeof adapter.revoke,'function');await adapter.refresh();
 const issuance=adapter.choose({scope_id:'TEST-scope',choice:'explicit_opt_in'});
 const revocation=adapter.revoke();assert.equal(adapter.readCurrent(),null);finish();
 await assert.rejects(issuance,/stale/);assert.deepEqual(await revocation,{acknowledged:true});
 assert.equal(adapter.readCurrent().receipt,null);
 assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('/revoke')).options.body),{csrf:'TEST-csrf'});
});

