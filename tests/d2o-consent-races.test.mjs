import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './d2o-consent-lifecycle.test.mjs';
import {fixtureAdapter} from './d2o-server-consent.test.mjs';
const choice={analytics:'granted',advertising:'granted'},key='gcs_tracking_consent_v1';
test('A11 unbound generic GTM stays unloaded even with analytics and TEST advertising consent',async()=>{
 const f=boot({adapter:fixtureAdapter()});f.window.GCS_ANALYTICS.gtm_containment_verified=true;f.c.apply(choice);await f.c.whenSettled();
 assert.equal(f.scripts.filter(x=>x.src?.includes('googletagmanager')).length,0);assert.equal(f.scripts.filter(x=>x.src?.includes('array.js')).length,1);
 assert.equal(f.window['ga-disable-G-MOCK'],true);f.window.GCSAnalytics.event('comparison_sort_change');assert.equal(f.order.filter(x=>x[0]==='event'&&x[1]==='comparison_sort_change').length,0,'no UI event forwarded to uncontained GTM');
});
test('dynamic GPC checked at event gate clears pending SDK work synchronously',()=>{
 const f=boot();assert.equal(f.c.effective(),'granted');f.window.GCSAnalytics.event('comparison_sort_change');f.navigator.globalPrivacyControl=true;
 assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false);assert.equal(f.window.posthog.__queue.length,0);
});
test('pending issuance invalidated by cross-tab withdrawal cannot revive on forged preference return',async()=>{
 const adapter=fixtureAdapter(),original=adapter.choose;let finish;adapter.choose=async input=>{await new Promise(r=>finish=r);await original(input)};
 const f=boot({adapter});f.c.apply(choice);await Promise.resolve();const pending=f.c.whenSettled(),saved=f.storage.get(key);
 f.storage.delete(key);f.event('storage',{key});f.storage.set(key,saved);finish();await pending;
 assert.equal(f.c.purposes().advertising,'denied');
});
test('late issuance after reject remains denied and unknown remote effect requires reconciliation',async()=>{
 const adapter=fixtureAdapter(),original=adapter.choose;let finish;adapter.choose=async input=>{await new Promise(r=>finish=r);await original(input)};
 const f=boot({adapter});f.c.apply(choice);await Promise.resolve();const pending=f.c.whenSettled();f.c.apply('denied');await f.c.whenSettled();finish();await pending;
 assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.c.advertisingStatus().server_revocation,'reconcile');
});
test('delayed stale revoke acknowledgment cannot clear late-issuance reconciliation',async()=>{
 const adapter=fixtureAdapter(),choose=adapter.choose,revoke=adapter.revoke;let finishChoose,finishAck;
 adapter.choose=async x=>{await new Promise(r=>finishChoose=r);await choose(x)};
 adapter.revoke=async()=>{await revoke();await new Promise(r=>finishAck=r);return {acknowledged:true}};
 const f=boot({adapter});f.c.apply(choice);await Promise.resolve();const issue=f.c.whenSettled();f.c.apply('denied');await Promise.resolve();await Promise.resolve();const withdrawal=f.c.whenSettled();
 finishChoose();await issue;assert.equal(f.c.advertisingStatus().server_revocation,'reconcile');finishAck();await withdrawal;
 assert.equal(f.c.advertisingStatus().server_revocation,'reconcile');assert.equal(f.c.advertisingStatus().available,false);
});
test('failed server revocation remains denied, does not claim acknowledgment',async()=>{
 const adapter=fixtureAdapter(),f=boot({adapter});f.c.apply(choice);await f.c.whenSettled();adapter.revoke=async()=>{throw Error('timeout')};
 f.c.apply('denied');assert.equal(f.window.posthog.__queue.length,0);assert.equal(f.c.purposes().advertising,'denied');await f.c.whenSettled();assert.equal(f.c.advertisingStatus().server_revocation,'reconcile');assert.equal(f.c.advertisingStatus().available,false);f.c.apply(choice);await f.c.whenSettled();assert.equal(f.c.purposes().advertising,'denied');
});
test('real TEST receipt is overridden by GPC and fresh default GPC never asks issuer',async()=>{
 const a=fixtureAdapter(),f=boot({adapter:a});f.c.apply(choice);await f.c.whenSettled();f.navigator.globalPrivacyControl=true;f.event('focus');
 assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.window.posthog.__queue.length,0);await f.c.whenSettled();assert.equal(a.receipt(),null);
 const b=fixtureAdapter(),g=boot({adapter:b,gpc:true});g.c.apply(choice);await g.c.whenSettled();assert.equal(g.c.advertisingStatus().available,false);assert.equal(b.calls.length,0);assert.equal(g.scripts.length,0);
});
test('SDK failed-load retry cannot strand a stale queue outside revocation',()=>{
 const f=boot();assert.equal(f.c.effective(),'granted');const first=f.scripts.find(s=>s.src?.includes('array.js'));first.error();f.c.apply('granted');
 f.window.GCSAnalytics.event('comparison_sort_change');const queue=f.window.posthog.__queue;assert.equal(queue.length,1);f.c.apply('denied');assert.equal(queue.length,0);
});
for(const libraryArrived of [false,true])test('late pre-withdrawal SDK callback cannot initialize after a new grant: library arrived '+libraryArrived,()=>{
 const f=boot();assert.equal(f.c.effective(),'granted');const first=f.scripts.find(s=>s.src?.includes('array.js'));let initialized=0;if(libraryArrived)f.window.posthog.init=()=>{initialized++};f.c.apply('denied');f.c.apply('granted');f.window.posthog.init=()=>{initialized++};
 first.load();assert.equal(initialized,0);const current=f.scripts.filter(s=>s.src?.includes('array.js')).at(-1);assert.notEqual(current,first);current.load();assert.equal(initialized,1);
});
test('server scope and receipt validity remain independent from browser preference on every read',async()=>{
 const adapter=fixtureAdapter(),f=boot({adapter});f.c.apply(choice);await f.c.whenSettled();
 assert.equal(boot({adapter,storage:f.storage}).c.purposes().advertising,'granted');assert.equal(boot({storage:f.storage}).c.purposes().advertising,'granted','served browser preference is not a server receipt');
 const r=adapter.receipt();for(const [field,value] of [['scope_id','OTHER'],['scope_revision',2],['notice_version','OTHER'],['withdrawn',true],['gpc',true],['ad_personalization','granted'],['expires_at_ms',0]]){const old=r[field];r[field]=value;assert.equal(f.c.purposes().advertising,'denied',field);r[field]=old}
 for(const field of ['containment','notice_approved','retention_approved','eligible']){adapter.scope[field]=false;assert.equal(f.c.advertisingStatus().available,false,field);assert.equal(f.c.purposes().advertising,'denied');adapter.scope[field]=true}
});
test('throwing or empty issuer read denies instead of trusting choose return payload',async()=>{
 const adapter=fixtureAdapter();adapter.choose=async()=>({ad_storage:'granted'});const f=boot({adapter});f.c.apply(choice);await f.c.whenSettled();assert.equal(f.c.purposes().advertising,'denied');
 adapter.readCurrent=()=>{throw Error('unavailable')};assert.equal(f.c.advertisingStatus().available,false);
});
test('P27 no regional wait can override a saved withdrawal at bootstrap',async()=>{
 const other=boot();other.c.apply('denied');let calls=0;const f=boot({storage:other.storage,model:null,regionFetch:()=>{calls++;return new Promise(()=>{})}});assert.equal(f.c.effective(),'denied');assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false);await f.whenReady();assert.equal(calls,0);assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.scripts.length,0);
});
test('P27 acknowledgment cannot revive a cross-tab withdrawal or dynamic GPC',()=>{
 for(const gpc of [false,true]){const f=boot();f.window.GCSAnalytics.event('comparison_sort_change');const queue=f.window.posthog.__queue;if(gpc)f.navigator.globalPrivacyControl=true;else{f.storage.delete(key);f.event('storage',{key})}f.c.acknowledge();assert.equal(queue.length,0);assert.equal(f.c.read().analytics,'denied');assert.equal(f.c.effective(),'denied')}
});
