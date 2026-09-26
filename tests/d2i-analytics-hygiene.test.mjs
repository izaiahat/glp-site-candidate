import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createConsentRuntimeSource} from '../src/consent-runtime.mjs';
import {releaseExportPolicy,candidateSharedRuntime,candidateExportShellFindings} from '../src/candidate-export-policy.mjs';
export function routeProperties(f){const u=new URL(f.window.location.href);u.search='';u.hash='';const neutral=['/','/providers/','/compare/','/privacy/','/privacy/cookies/','/terms/','/about/'].includes(u.pathname);return {distinct_id:'TEST_ANONYMOUS',$process_person_profile:false,$host:u.host,...(neutral?{$current_url:u.href,$pathname:u.pathname}:{})};}
const analytics=readFileSync(new URL('../assets/analytics.js',import.meta.url),'utf8');
// MOCK SDK sinks only. No browser, network, grants outside this isolated context.
export function fixture({url='https://glpclinicscout.com/',gpc=false,webdriver=false,stage='production-seal',saved=null,model='us-default-on'}={}) {
 const location=new URL(url),storage=new Map(saved?[['gcs_tracking_consent_v1',JSON.stringify(saved)]]:[]),scripts=[],captures=[],listeners={},cookies=[];
 const window={location,GCS_EXPORT_POLICY:releaseExportPolicy(stage),GCS_ANALYTICS:{enabled:true,consent:'unknown',measurement_id:'G-MOCK',gtm_container_id:'GTM-MOCK'},GCS_CLARITY:{enabled:false,project_id:null},GCS_POSTHOG:{enabled:true,api_key:'mock-not-a-real-key',host:'https://mock.invalid',operator_gate:'explicit-consent-v3'},addEventListener:(n,f)=>{(listeners[n]??=[]).push(f)},dispatchEvent:e=>{for(const f of listeners[e.type]||[])f(e)}};
 const document={readyState:'loading',referrer:'https://referrer.invalid/intake/?email=CANARY#dose',title:'CANARY clinical title',addEventListener(){},querySelector(){return null},querySelectorAll(){return []},documentElement:{style:{removeProperty(){}},scrollHeight:1000},createElement(){return {listeners:{},addEventListener(n,f){this.listeners[n]=f}}},head:{appendChild:s=>scripts.push(s)},set cookie(v){cookies.push(v)}};
 const context=vm.createContext({window,document,location,navigator:{globalPrivacyControl:gpc,webdriver,userAgent:'Mozilla/5.0'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},URL,URLSearchParams});
 vm.runInContext(createConsentRuntimeSource('null',JSON.stringify(model)),context);vm.runInContext(analytics,context);
 return {window,scripts,captures,storage,grant:()=>window.GCSConsent.apply('granted'),mockLoad(){let options;window.posthog={get_distinct_id:()=> 'TEST_ANONYMOUS',init:(key,o)=>{options=o},capture:(...a)=>captures.push(a),opt_out_capturing:()=>captures.push(['OPT_OUT'])};const s=scripts.find(s=>s.src.includes('array.js'));assert.ok(s,'PostHog bootstrap requested');s.listeners.load();return options}};
}
for(const stage of ['candidate','production-seal'])test('unbound Clarity stays disabled: '+stage,()=>{const h=candidateSharedRuntime(`<script>window.GCS_ANALYTICS={enabled:false,consent:'unknown',gtm_container_id:'GTM-MOCK'};window.GCS_POSTHOG={"enabled":false};window.GCS_CLARITY={enabled:false,project_id:null};</script>`,{stage});assert.match(h,/GCS_CLARITY=\{enabled:false,project_id:null/);assert.deepEqual(candidateExportShellFindings(h,{stage}),[]);assert.ok(candidateExportShellFindings(h.replace('GCS_CLARITY={enabled:false','GCS_CLARITY={enabled:true'),{stage}).includes('clarity_wrong_stage'));});
for(const suffix of ['/?utm_source=CANARY&gclid=CANARY#CANARY','/quiz/provider-fit/?answer=CANARY','/scorecard/','/tools/glp-1-cost-calculator/?dose=CANARY'])test('mock US default-on, sanitized landing '+suffix,()=>{
 const f=fixture({url:'https://glpclinicscout.com'+suffix});assert.equal(f.scripts.length,1);assert.equal(f.window.GCSConsent.read().analytics_basis,'global_default');assert.equal(f.window.GCSConsent.allowsExports(),true);const options=f.mockLoad();
 for(const name of ['comparison_sort_change','comparison_table_view','cost_calculator_used','calculator_submit']) {assert.equal(f.window.GCSAnalytics.event(name,{page_slug:'CANARY',answer:'CANARY',result_count:4,step_id:'dose',step_number:2,treatment:'CANARY',provider:'CANARY'}),true,name);assert.deepEqual(JSON.parse(JSON.stringify(f.captures.at(-1)[1])),{});}
 for(const name of ['quiz_start','quiz_step_complete','quiz_complete','scorecard_start','scorecard_step_view','scorecard_step_complete','scorecard_abandon','scorecard_complete','results_view','calculator_result_view','cost_calculator_complete','cost_calculator_medication_selected','provider_finder_complete','comparison_facets_changed','dose_selected','__proto__','constructor'])assert.equal(f.window.GCSAnalytics.event(name,{treatment:'CANARY'}),false,name);
 assert.equal(options.autocapture,false);assert.deepEqual(JSON.parse(JSON.stringify(options.fetch_options)),{referrerPolicy:'no-referrer'});assert.equal(options.capture_pageview,true);assert.equal(options.capture_pageleave,false);assert.equal(options.disable_session_recording,true);assert.equal(options.person_profiles,'never');assert.equal(options.persistence,'memory');
 const event=options.before_send({event:'comparison_sort_change',uuid:'TEST_UUID',timestamp:'2026-09-26T00:00:00Z',properties:{token:'TEST_PROJECT',distinct_id:'TEST_ANONYMOUS',$current_url:'CANARY',$referrer:'CANARY',answer:'CANARY'}});assert.deepEqual(JSON.parse(JSON.stringify(event)),{event:'comparison_sort_change',uuid:'TEST_UUID',timestamp:'2026-09-26T00:00:00Z',properties:{token:'TEST_PROJECT',distinct_id:'TEST_ANONYMOUS',...routeProperties(f)}});assert.equal(options.before_send({event:'$pageview',properties:{}}).event,'$pageview');assert.doesNotMatch(JSON.stringify(event),/CANARY/);
 assert.doesNotMatch(JSON.stringify(f.captures),/CANARY|dose|treatment|result_count/);for(const s of f.scripts)assert.equal(s.referrerPolicy,'no-referrer');
 f.window.GCSConsent.apply('denied');assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false);assert.equal(options.before_send({event:'comparison_sort_change',properties:{}}),null);f.grant();assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),true);
});
for(const [label,args]of [['candidate',{stage:'candidate'}],['GPC',{gpc:true}],['automation',{webdriver:true}],['local',{url:'http://127.0.0.1/'}],['intake',{url:'https://glpclinicscout.com/intake/'}],['results',{url:'https://glpclinicscout.com/results/'}]])test('mock negative gate '+label,()=>{const f=fixture(args);f.grant();assert.equal(f.window.GCSConsent.allowsExports(),false);assert.equal(f.scripts.length,0);assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false);assert.equal(f.window.GCSAnalytics.clickIdFor('TEST'),null);const a={href:'https://merchant.invalid/?x=1'};assert.equal(f.window.GCSAnalytics.decorateOutbound(a,'mock-id'),a.href)});
test('legacy grant is not explicit and all four defaults denied',()=>{const f=fixture({saved:{version:'gcs-cookie-v2-default-on',analytics:'granted'}});assert.equal(f.window.GCSConsent.effective(),'denied');assert.equal(f.scripts.length,0);assert.deepEqual(Object.values(f.window.dataLayer[0][2]),['denied','denied','denied','denied']);});
test('outbound decoration is allowed before denial on US default-on, suppressed after denial', () => {
 const f=fixture();
 assert.equal(f.window.GCSConsent.read().analytics_basis,'global_default');
 assert.equal(f.window.GCSConsent.allowsExports(),true);
 for (const [href,network,subidCodec,key] of [
  ['https://glpclinicscout.com/go/trt-nation?s=reviews.rv2&v=a','CJ Affiliate','CJ','cs_click_id'],
  ['https://merchant.invalid/?x=1','CJ Affiliate','CJ','sid3'],
 ]) {
  const anchor={href,dataset:{network,subidCodec,sub1:'1R',sub2:'review-test'}};
  const decorated=f.window.GCSAnalytics.decorateOutbound(anchor,'fixture-click');
  assert.equal(new URL(decorated).searchParams.get(key),'fixture-click');
  assert.equal(anchor.href,href,'decorator does not mutate the passed anchor');
 }
 f.window.GCSConsent.apply('denied');
 assert.equal(f.window.GCSConsent.allowsExports(),false);
 // Throwing dataset proves denial precedes metadata inspection or URL parsing.
 for(const href of ['https://glpclinicscout.com/go/trt-nation?s=reviews.rv2&v=a','https://merchant.invalid/?x=1']) {
  const anchor={href,get dataset(){throw new Error('denied metadata read')}};
  assert.equal(f.window.GCSAnalytics.decorateOutbound(anchor,'fixture-click'),href);
 }
});

test('pending mock SDK revocation clears historical queue; delayed load cannot initialize denied',()=>{
 const f=fixture();assert.equal(f.window.GCSConsent.read().analytics_basis,'global_default');f.window.GCSAnalytics.event('comparison_sort_change');assert.equal(f.window.posthog.__queue.length,1);f.window.GCSConsent.apply('denied');assert.equal(f.window.posthog.__queue.length,0);let initialized=false;f.window.posthog.init=()=>{initialized=true};f.scripts.find(s=>s.src.includes('array.js')).listeners.load();assert.equal(initialized,false);assert.equal(f.window.GCS_POSTHOG_LOADED,false);
});
test('all reviewed names export no caller properties or automatic identity, including affiliate events',()=>{
 const f=fixture({url:'https://glpclinicscout.com/?gclid=CANARY#CANARY'});assert.equal(f.window.GCSConsent.read().analytics_basis,'global_default');const options=f.mockLoad();
 const names=['$pageview','affiliate_click','comparison_table_view','cost_calculator_used','calculator_submit','content_upgrade_view','content_upgrade_submit','content_upgrade_success','content_upgrade_complete','scroll_75','sticky_cta_click','comparison_sort_change'];
 const poison={answer:'CANARY',treatment:'CANARY',dose:'CANARY',provider_slug:'CANARY',page_slug:'CANARY',page_path:'CANARY',subid:'CANARY',cs_click_id:'CANARY',gclid:'CANARY',result_count:999,step_id:'CANARY',step_number:999,__proto__:{email:'CANARY'}};
 for(const name of names){assert.equal(f.window.GCSAnalytics.event(name,poison),true);assert.deepEqual(JSON.parse(JSON.stringify(f.captures.at(-1)[1])),{});const event=options.before_send({event:name,properties:poison,distinct_id:'CANARY',$set:{health:'CANARY'}});assert.deepEqual(JSON.parse(JSON.stringify(event)),{event:name,properties:routeProperties(f)});}
 assert.doesNotMatch(JSON.stringify(f.window.dataLayer),/CANARY|result_count|step_number/);assert.doesNotMatch(JSON.stringify(f.captures),/CANARY|result_count|step_number/);
 f.window.GCS_EXPORT_POLICY={third_party_exports:true};assert.equal(f.window.GCSConsent.allowsExports(),false);assert.equal(f.window.GCSAnalytics.event('comparison_sort_change'),false);
});
test('P27 quiz answers never exported under default-on',()=>{
 const f=fixture({url:'https://glpclinicscout.com/quiz/provider-fit/?answer=CANARY#CANARY'});assert.equal(f.window.GCSConsent.read().analytics_basis,'global_default');const options=f.mockLoad();
 const poison={answer:'CANARY',quiz_answers:{medication:'CANARY'},email:'CANARY',step_id:'CANARY',step_number:99,result_count:99};
 f.window.dispatchEvent({type:'gcs:quiz',detail:{name:'quiz_step_complete',...poison}});assert.equal(f.window.GCSAnalytics.event('quiz_complete',poison),false);assert.equal(f.captures.length,0);
 f.window.dispatchEvent({type:'gcs:quiz',detail:{name:'comparison_sort_change',...poison}});assert.equal(f.captures.length,0,'quiz-derived events cannot be relabeled into an allowed event');
 assert.equal(f.window.GCSAnalytics.event('comparison_sort_change',poison),true);assert.equal(f.captures.length,1);
 for(const capture of f.captures)assert.deepEqual(JSON.parse(JSON.stringify(capture[1])),{},'default-on exports no quiz answer properties');
 const view=options.before_send({event:'$pageview',properties:poison});assert.equal(view.properties.$current_url,undefined);assert.equal(view.properties.$pathname,undefined);assert.equal(view.properties.$host,'glpclinicscout.com');
 assert.deepEqual(JSON.parse(JSON.stringify(options.before_send({event:'quiz_complete',properties:poison,distinct_id:'CANARY'}))),null);assert.doesNotMatch(JSON.stringify(f.captures),/CANARY|quiz_answers|step_number|result_count/);
});
for(const route of ['/matches/','/quiz/answers/','/scorecard/results/','/tools/private/'])test('P27 default-on preserves suppressed route '+route,()=>{const f=fixture({url:'https://glpclinicscout.com'+route});assert.equal(f.window.GCSConsent.effective(),'granted');assert.equal(f.window.GCSConsent.allowsExports(),false);assert.equal(f.scripts.length,0);assert.equal(f.window.GCSAnalytics.event('quiz_complete'),false)});
