import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {consentRuntimeSource} from '../src/consent-runtime.mjs';
import {stageCandidateExportPolicy,candidateSharedRuntime,candidateExportShellFindings,releaseExportPolicy} from '../src/candidate-export-policy.mjs';
const analytics=readFileSync(new URL('../assets/analytics.js',import.meta.url),'utf8');
const storageKey='gcs_tracking_consent_v1';
function fixture(choice,gpc=false){
 const saved=choice?JSON.stringify({analytics:choice,version:'gcs-cookie-v2-default-on-20260730',saved_at:'2026-09-05T00:00:00Z'}):null;
 const storage=new Map(saved?[[storageKey,saved]]:[]),effects=[],location=new URL('https://glpclinicscout.com/');
 const window={location,GCS_EXPORT_POLICY:releaseExportPolicy('candidate'),GCS_ANALYTICS:{enabled:false},GCS_POSTHOG:{enabled:false},GCS_CLARITY:{enabled:false},dispatchEvent(){}};
 const context=vm.createContext({window,location,URL,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({schema:'glp-consent-region-v1',model:'us-default-on'})}),navigator:{globalPrivacyControl:gpc,webdriver:false,userAgent:'Mozilla/5.0'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{readyState:'loading',addEventListener(){},querySelector(){return null},documentElement:{style:{removeProperty(){}}},head:{appendChild:()=>effects.push('script')}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}}});
 return {context,window,storage,saved,effects};
}
for(const [label,choice,gpc,expected]of [['absent',null,false,'granted'],['denied','denied',false,'denied'],['legacy-granted','granted',false,'denied'],['GPC-over-legacy','granted',true,'denied']])test(`effective ${label}: US preference, protected storage, no exports or identifiers`,async()=>{
 const f=fixture(choice,gpc);vm.runInContext(consentRuntimeSource,f.context);assert.equal(typeof f.window.GCSConsentReady?.then,'function');await f.window.GCSConsentReady;vm.runInContext(analytics,f.context);
 assert.equal(f.window.GCSConsent.model(),'us-default-on');assert.equal(f.window.GCSConsent.effective(),expected);assert.equal(f.window.GCS_ANALYTICS.consent,'denied');assert.equal(f.window.GCSConsent.allowsExports(),false);
 const raw=f.storage.get(storageKey)||null;
 if(choice&&!gpc)assert.equal(raw,f.saved);
 else {const record=JSON.parse(raw);assert.notEqual(raw,f.saved);assert.equal(record.analytics,expected);assert.equal(record.advertising,'denied');assert.equal(record.version,'gcs-cookie-v4-distinct-purposes');assert.equal(record.record_type,'preference_only');assert.equal(record.analytics_basis,'us_default');assert.equal(record.notice_acknowledged,false);assert.ok(Number.isFinite(Date.parse(record.saved_at)));}
 assert.equal(f.window.GCSConsent.purposes().advertising,'denied');assert.equal(f.window.GCSConsent.allowsExports('ad_measurement'),false);
 for(const entry of f.window.dataLayer)if(entry[0]==='consent')assert.deepEqual(Object.values(entry[2]),['denied','denied','denied','denied']);
 assert.equal(f.window.GCSAnalytics.event('quiz_complete',{result_count:3}),false);assert.equal(f.window.GCSAnalytics.clickIdFor('TEST'),null);assert.equal(f.window.GCSAnalytics.decorateOutbound({href:'https://merchant.invalid/?a=1'}),'https://merchant.invalid/?a=1');assert.deepEqual(f.effects,[]);
 assert.equal(f.window.posthog,undefined);
});
test('explicit user choice remains writable without enabling exports; GPC wins',async()=>{
 for(const gpc of [false,true]){const f=fixture(null,gpc);vm.runInContext(consentRuntimeSource,f.context);assert.equal(typeof f.window.GCSConsentReady?.then,'function');await f.window.GCSConsentReady;
 f.window.GCSConsent.apply('granted');const record=JSON.parse(f.storage.get(storageKey));assert.equal(record.analytics,gpc?'denied':'granted');assert.equal(record.advertising,'denied');assert.equal(record.analytics_basis,'explicit');assert.equal(record.notice_acknowledged,true);assert.equal(f.window.GCSConsent.effective(),gpc?'denied':'granted');assert.equal(f.window.GCSConsent.allowsExports(),false);assert.throws(()=>f.window.GCSConsent.apply('anything'));
 f.window.GCSConsent.apply('denied');assert.equal(JSON.parse(f.storage.get(storageKey)).analytics,'denied');assert.equal(f.window.GCSConsent.effective(),'denied');assert.equal(f.window.GCSConsent.allowsExports(),false);assert.deepEqual(f.effects,[]);}
});
for(const stage of ['candidate','production-seal']){
 test('policy transformation preserves arbitrary SDK/evidence URLs: '+stage,()=>{const raw='<script src="https://other.invalid/sdk.js"></script><a href="https://evidence.invalid/guides/a/?v=aaaaaaaaaaaaaaaa">Evidence</a>';assert.equal(stageCandidateExportPolicy(raw,{stage}),raw);assert.ok(candidateSharedRuntime(raw,{stage}).includes(raw));});
 test('shell observer rejects non-noop wrong-stage config, missing policy and arbitrary SDK: '+stage,()=>{
 const legacy=`<script>window.GCS_ANALYTICS={enabled:true,consent:'granted',gtm_container_id:'GTM-MOCK',operator_gate:'operator-approved:historical'};window.GCS_CLARITY={enabled:false,project_id:null};window.GCS_POSTHOG={"enabled":true,"host":"https://example.invalid","operator_gate":"operator-approved:historical"};</script>`;
 assert.ok(candidateExportShellFindings(legacy,{stage}).length);
 const h=candidateSharedRuntime(legacy,{stage});assert.deepEqual(candidateExportShellFindings(h,{stage}),[]);assert.doesNotMatch(h,/operator-approved:/);
 const wrong=h.replace(/GCS_POSTHOG=\{"enabled":(true|false)/,(_,value)=>'GCS_POSTHOG={"enabled":'+(value==='true'?'false':'true'));assert.notEqual(wrong,h);assert.ok(candidateExportShellFindings(wrong,{stage}).includes('posthog_wrong_stage'));
 assert.ok(candidateExportShellFindings(h+'<script src="https://example.invalid/sdk"></script>',{stage}).includes('eager_remote_loader_present'));
 assert.ok(candidateExportShellFindings(stageCandidateExportPolicy(legacy,{stage}),{stage}).includes('explicit_policy_missing_or_duplicate_or_wrong_stage'));
 });
}
