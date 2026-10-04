import {transportCapabilities} from './ga4-vm-capabilities.mjs';
// Decision-layer contract, not SDK/wire evidence. Executes the supplied bytes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
export const ORIGIN='https://glpclinicscout.com', ID='G-2WQ42JY0WK';
export const ORDINARY=['/','/about/','/privacy/','/privacy/cookies/','/terms/'];
export function integrated(source, options={}) {
 const handlers={},scripts=[],cookies=[],storage=new Map();
 const location=new URL(options.url||ORIGIN+'/about/?PRIVATE_CANARY#PRIVATE_CANARY');
 let raw=options.raw===undefined?null:options.raw;
 if(raw!==null)storage.set('gcs_tracking_consent_v1',raw);
 const navigator={globalPrivacyControl:options.gpc===true,webdriver:options.webdriver===true,userAgent:options.ua||'ordinary browser'};
 const window={GCS_ANALYTICS:{enabled:true,measurement_id:ID,gtm_container_id:'GTM-D1-FIXTURE',...options.config},GCS_EXPORT_POLICY:{schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true,...options.policy},dataLayer:[{email:'PRIVATE_CANARY'}],innerHeight:500,scrollY:500,history:{pushState(){},replaceState(){}},addEventListener(n,f){(handlers[n]||=[]).push(f)},dispatchEvent(){}};
 const document={readyState:'loading',referrer:options.referrer??'',cookie:options.cookie||'',documentElement:{scrollHeight:1000,style:{removeProperty(){}}},querySelector(){return null},addEventListener(n,f){(handlers[n]||=[]).push(f)},createElement(){return {addEventListener(n,f){this[n]=f},remove(){this.removed=true}}},head:{appendChild(s){scripts.push(s)}}};
 Object.defineProperty(document,'cookie',{get(){return options.cookie||''},set(v){cookies.push(v)}});
 const localStorage={getItem(){if(options.unreadable)throw Error('unreadable');return raw},setItem(k,v){if(options.unwritable)throw Error('unwritable');raw=v;storage.set(k,v)}};
 transportCapabilities(window);
 vm.runInNewContext(source,{window,document,navigator,localStorage,location,URL,Date,CustomEvent:class{}},{timeout:1000});
 return {window,document,navigator,location,scripts,cookies,storage,setRaw(value){raw=value},commands:()=>Array.from(window.gcsGa4Layer||[],a=>Array.from(a)),fire(n){for(const f of handlers[n]||[])f({key:'gcs_tracking_consent_v1'})}};
}
export function assertPrivateLoader(f, route) {
 assert.deepEqual(f.scripts.map(s=>s.src),['https://www.googletagmanager.com/gtag/js?id='+ID+'&l=gcsGa4Layer']);
 assert.equal(f.scripts[0].referrerPolicy,'no-referrer');
 f.scripts[0].load();f.scripts[0].load();
 const commands=f.commands(),events=commands.filter(c=>c[0]==='event');
 assert.equal(events.length,1);assert.equal(events[0][1],'page_view');
 assert.equal(events[0][2].page_location,ORIGIN+route);assert.equal(events[0][2].page_title,'Clinic Scout');assert.equal(events[0][2].page_referrer,'');
 assert.doesNotMatch(JSON.stringify(commands),/PRIVATE_CANARY/);
 for(const c of commands.filter(c=>c[0]==='consent'))for(const key of ['ad_storage','ad_user_data','ad_personalization'])assert.equal(c[2][key],'denied');
 assert.equal(commands.find(c=>c[0]==='consent')[2].analytics_storage,'denied');
 const config=commands.find(c=>c[0]==='config')[2];
 for(const key of ['allow_google_signals','allow_ad_personalization_signals','allow_enhanced_conversions','send_page_view','url_passthrough'])assert.equal(config[key],false,key);
 for(const key of ['ae_block_form','ae_block_history','ae_block_video','ae_block_scroll','ae_block_outbound_click','ae_block_downloads','ads_data_redaction'])assert.equal(config[key],true,key);
 assert.equal(commands.find(c=>c[0]==='set')[1].user_data,null);
 assert.equal(f.window.GCS_GTM_HELD,'A11 containment unbound');
 // This VM has no SDK: only the preference owner may write persistence.
 // Check every write, not just _ga-prefixed cookies or the final store.
 assert.deepEqual([...new Set(f.cookies.map(c=>c.split('=',1)[0].trim()))].sort(),['gcs_analytics_consent']);
 assert.deepEqual([...f.storage.keys()].sort(),['gcs_tracking_consent_v1']);
}
export function assertHeld(f,label='held') {
 assert.equal(f.scripts.length,0,label+': no loader including GTM');
 assert.equal(f.commands().filter(c=>c[0]==='event').length,0,label+': no events');
 assert.equal(f.window['ga-disable-'+ID],true,label);
 assert.deepEqual(f.cookies.filter(c=>c.startsWith('_ga')),[],label+': no cold cookie writes');
}
// This semantic check replaces the obsolete comment assertion on emitted bytes.
// D1's actual browser network/storage detector remains separate and unchanged.
export function assertEmittedLoaderSemantics(source) {
 for(const route of ORDINARY)assertPrivateLoader(integrated(source,{url:ORIGIN+route+'?PRIVATE_CANARY#PRIVATE_CANARY'}),route);
 assertHeld(integrated(source,{config:{measurement_id:'G-D1-FIXTURE'}}),'wrong ID/right path');
 assertHeld(integrated(source,{url:ORIGIN+'/__d1_enabled_fixture__/'}),'right ID/excluded path');
 assertHeld(integrated(source,{webdriver:true}),'synthetic D1');
 return {ga:'private exact-ID loader, isolated guards executed',gtm:'no container loader with configured GTM ID',scope:'emitted-byte decision proof; browser D1 retains zero Google allowances'};
}
