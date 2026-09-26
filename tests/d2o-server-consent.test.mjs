import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './d2o-consent-lifecycle.test.mjs';
// In-memory TEST adapter projection, not A12b issuer records or live authority.
// A future server adapter must validate full A12b records before projecting.
export function fixtureAdapter(){
 const scope={id:'TEST-scope',revision:1,platform:'google',purpose:'ad_measurement',notice:'TEST Google: advertising measurement; observed click ID; retained for 15 minutes; withdraw here.',notice_version:'TEST-notice',expires_at_ms:Date.now()+60000,eligible:true,containment:true,notice_approved:true,retention_approved:true};
 let receipt=null;const calls=[];
 return {scope,calls,readCurrent(){return {scope,receipt}},async choose(input){calls.push(['choose',input]);receipt={scope_id:scope.id,scope_revision:scope.revision,notice_version:scope.notice_version,choice:'explicit_opt_in',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'denied',gpc:false,withdrawn:false,expires_at_ms:Date.now()+60000};},async revoke(){calls.push(['revoke']);receipt=null;return {acknowledged:true}},receipt:()=>receipt};
}
for(const analytics of ['denied','granted'])for(const advertising of ['denied','granted'])test('actual runtime TEST server receipt '+analytics+'/'+advertising,async()=>{
 const adapter=fixtureAdapter(),f=boot({adapter,model:'prior-opt-in'});assert.equal(f.scripts.length,1);assert.equal(f.c.advertisingStatus().available,true);
 f.c.apply({analytics,advertising});await f.c.whenSettled();
 assert.deepEqual(JSON.parse(JSON.stringify(f.c.purposes())),{analytics,advertising});
 assert.equal(adapter.calls.filter(x=>x[0]==='choose').length,advertising==='granted'?1:0);
 const update=f.order.filter(x=>x[0]==='consent'&&x[1]==='update').at(-1)[2];
 assert.equal(update.ad_storage,advertising);assert.equal(update.ad_user_data,advertising);assert.equal(update.ad_personalization,'denied');assert.equal(update.analytics_storage,analytics);
 assert.equal(f.scripts.some(x=>x.src?.includes('array.js')),true,'default-on requests SDK before subsequent preference');assert.equal(f.window.GCSAnalytics.event('quiz_start'),analytics==='granted');
 assert.equal(f.c.allowsExports('ad_measurement'),advertising==='granted','measurement permission follows effective purpose; vendor holds stay separate');
 console.log('D2O_RUNTIME_PROOF '+JSON.stringify({test_only:true,requested:{analytics,advertising},effective:f.c.purposes(),consent_mode:update,issuer_choose_calls:adapter.calls.filter(x=>x[0]==='choose').length,receipt_projection_present:!!adapter.receipt(),sdk_sources:f.scripts.filter(x=>x.src).map(x=>x.src),advertising_export:false}));
});
