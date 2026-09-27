import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {consentRuntimeSource} from '../src/consent-runtime.mjs';
test('R1 Node emitted binding survives the real Playwright transform without a browser',()=>{
 const scratch=mkdtempSync(path.join(os.tmpdir(),'glp-consent-binding-'));
 try{
  mkdirSync(path.join(scratch,'public/assets'),{recursive:true});
  writeFileSync(path.join(scratch,'public/assets/consent.js'),consentRuntimeSource);
  const cli=createRequire(import.meta.url).resolve('@playwright/test/cli');
  const result=spawnSync(process.execPath,[cli,'test','--config','tests/fixtures/consent-binding/playwright.config.mjs'],{encoding:'utf8',env:{...process.env,GLP_BINDING_FIXTURE_PUBLIC:path.join(scratch,'public'),GLP_BINDING_FIXTURE_RESULTS:path.join(scratch,'results')}});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  writeFileSync(path.join(scratch,'public/assets/consent.js'),consentRuntimeSource+'\n');
  const stale=spawnSync(process.execPath,['scripts/consent-emitted-binding.mjs','--public',path.join(scratch,'public')],{encoding:'utf8'});
  assert.equal(stale.status,1);assert.match(stale.stderr,/emitted bytes differ from registered Node producer/);
 }finally{rmSync(scratch,{recursive:true,force:true})}
});
import {safe,decode,recordGARequest,origin,sdkUrl} from './helpers/ga4-wire-oracle.mjs';
import {rejectDiagnosticFlags,checkExecutedProvenance} from '../scripts/release-executed-provenance.mjs';
import {assertGAPositiveStorage} from './helpers/ga4-storage-oracle.mjs';
test('R1 positive SDK storage oracle rejects unknown and transient owners without filtering',()=>{
 const healthy={cookie:['_ga','_ga_2WQ42JY0WK','gcs_analytics_consent'].map(name=>({name})),local:[{key:'gcs_tracking_consent_v1'}],session:[]};
 assertGAPositiveStorage(healthy,[]);
 for(const area of ['cookie','local','session']){
  const extra=structuredClone(healthy);extra[area].push(area==='cookie'?{name:'unapproved_ga_side_cookie'}:{key:'unapproved_storage'});
  const before=JSON.stringify(extra);assert.throws(()=>assertGAPositiveStorage(extra,[]));assert.equal(JSON.stringify(extra),before);
  assert.throws(()=>assertGAPositiveStorage(healthy,[{area,key:'transient_unknown',operation:'set'}]),/unapproved storage write/);
 }
 const missing=structuredClone(healthy);missing.cookie.pop();assert.throws(()=>assertGAPositiveStorage(missing,[]));
 const duplicate=structuredClone(healthy);duplicate.cookie.push({name:'_ga'});assert.throws(()=>assertGAPositiveStorage(duplicate,[]));
});
const healthy=()=>({method:'POST',type:'fetch',url:'https://www.google-analytics.com/g/collect?'+new URLSearchParams({v:'2',tid:'G-2WQ42JY0WK',en:'page_view',dl:origin+'/about/',dt:'Clinic Scout',npa:'1'}),body:'',headers:{},collect:true,forwarded:false});
test('R1 duplicate dl regression preserves raw URL/body and refuses query, body and cross-boundary duplicates',()=>{
 safe([healthy()],'/about/');
 for(const make of [r=>r.url=r.url.replace('?', '?dl=https%3A%2F%2Fexample.invalid%2Fsensitive&'),r=>r.body='dl='+encodeURIComponent(origin+'/about/'),r=>{r.url=r.url.replace(/&dl=[^&]*/,'');r.body='dl='+encodeURIComponent(origin+'/private/')+'&dl='+encodeURIComponent(origin+'/about/')}]){
  const r=healthy();make(r);const before=JSON.stringify(r);assert.throws(()=>decode([r]),/duplicate protocol field/);assert.equal(JSON.stringify(r),before);
 }
});
test('R1 uid regression and explicit field method origin path contract reject unknowns',()=>{
 for(const field of ['uid','ep.unknown_property','up.secret','unapproved_protocol']){const r=healthy();r.url+='&'+field+'=SYNTHETIC_TEST_ONLY';assert.throws(()=>safe([r],'/about/'),/unapproved field/)}
 for(const change of [{method:'PUT'},{url:'https://unknown.invalid/g/collect'},{url:'https://www.google-analytics.com/other'}])assert.throws(()=>safe([{...healthy(),...change}],'/about/'),/method\/origin\/path/);
});
test('R1 arbitrary first-party GET regression uses actual route recording and unknown rejection',()=>{
 const request=(url,method='GET',type='fetch')=>({url:()=>url,method:()=>method,resourceType:()=>type,headers:()=>({}),postData:()=>null});
 const all=[],rows=[],unknown=[],doc=origin+'/about/?q=fixture';
 for(const [url,type,category] of [[doc,'document','document'],[origin+'/consent.js','script','consent'],[sdkUrl,'script','sdk'],[origin+'/unexpected-first-party?opaque=SYNTHETIC_TEST_ONLY','fetch','unknown'],[doc,'fetch','unknown'],[origin+'/consent.js?payload=synthetic','script','unknown']])assert.equal(recordGARequest(request(url,'GET',type),doc,'initial',all,rows,unknown).category,category);
 assert.equal(all.length,6);assert.equal(rows.length,4);assert.equal(unknown.length,3);assert.ok(unknown.every(r=>r.method==='GET'&&!r.forwarded));
 assert.throws(()=>assert.deepEqual(unknown,[]));
});
test('R1 acceptance refuses both ambient diagnostic flags independently',()=>{
 rejectDiagnosticFlags({});rejectDiagnosticFlags({GLP44_SOURCE_TEST:'0',GLP_CONSENT_SOURCE_PROBE:'0'});
 for(const flag of ['GLP44_SOURCE_TEST','GLP_CONSENT_SOURCE_PROBE'])for(const value of ['1','true'])assert.throws(()=>rejectDiagnosticFlags({[flag]:value}),new RegExp(flag));
});
test('R1 executed provenance rejects absent receipts, diagnostic flags and each mismatched emitted hash',()=>{
 const selection=JSON.parse(readFileSync(new URL('../ops/release-gate.json',import.meta.url)));
 const cases=selection.browser.cases.filter(c=>/\/(ga4-sdk-contract|consent-withdrawal-sdk)\.spec\.mjs$/.test(c.file));
 const counts=[5,7,2,1,1,1,2,4];
 // Order in registry is explicitly checked rather than deriving evidence from verifier.
 assert.equal(cases.length,8);assert.match(cases[0].title,/default-on/);assert.match(cases[4].title,/held pageview/);
 const inventory={files:[{file:'assets/consent.js',sha256:'consent'},{file:'assets/analytics.abc123.js',sha256:'analytics'},{file:'_headers',sha256:'headers'}]};
 const receipt={probe:false,source_only_diagnostic:false,consent_file:'assets/consent.js',consent_sha256:'consent',headers_file:'_headers',headers_sha256:'headers',analytics_file:'assets/analytics.abc123.js',analytics_sha256:'analytics'};
 const report=()=>({suites:[{specs:cases.map((c,i)=>({title:c.title,tests:[{projectName:'synthetic-only',results:[{attachments:Array.from({length:counts[i]},()=>({name:i<4?'ga4-contained-wire':'strict-sdk-receipt',body:Buffer.from(JSON.stringify(receipt)).toString('base64')}))}]}]}))}]});
 assert.equal(checkExecutedProvenance(report(),inventory).length,23);
 for(const [key,value] of [['probe',true],['source_only_diagnostic',true],['consent_sha256','wrong'],['headers_sha256','wrong'],['analytics_sha256','wrong']]){
  const r=report(),a=r.suites[0].specs[key==='analytics_sha256'?4:0].tests[0].results[0].attachments[0];a.body=Buffer.from(JSON.stringify({...receipt,[key]:value})).toString('base64');assert.throws(()=>checkExecutedProvenance(r,inventory),/D1_/);
 }
 const missing=report();missing.suites[0].specs[0].tests[0].results[0].attachments.pop();assert.throws(()=>checkExecutedProvenance(missing,inventory),/receipt_count/);
 assert.throws(()=>checkExecutedProvenance({suites:[]},inventory),/missing_SDK_provenance/);
});
