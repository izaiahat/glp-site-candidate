// Acceptance boundary shared by the registered gate and its pure regressions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const DIAGNOSTIC_FLAGS=['GLP44_SOURCE_TEST','GLP_CONSENT_SOURCE_PROBE'];
export function rejectDiagnosticFlags(env) {
 for(const key of DIAGNOSTIC_FLAGS)assert.ok(env[key]===undefined||env[key]===''||env[key]==='0','D1_diagnostic_override:'+key);
}
export function checkExecutedProvenance(report,inventory) {
 const hashes=new Map(inventory.files.map(r=>[r.file,r.sha256])),receipts=[];
 const required={
  'GLP44 default-on actual GA SDK minimizes page and enhanced events':['ga4-contained-wire',5],
  'GLP44 individualized and unclassified routes never load GA or export input events':['ga4-contained-wire',7],
  'GLP44 GPC prevents GA load and collection on initial and later pages':['ga4-contained-wire',2],
  'GLP44 withdrawal stops NEW loads and events on subsequent navigation; in-flight retry accepted':['ga4-contained-wire',1],
  'D1 real SDK held pageview cannot retry for 65 seconds after native withdrawal':['strict-sdk-receipt',1],
  'D1 native outbound transport has no Referer under emitted document headers':['strict-sdk-receipt',1],
  'D1 native decorated destinations and owned storage clear on withdrawal and GPC':['strict-sdk-receipt',2],
  'D1 stored purpose matrix gates native conversion clicks on advertising not analytics':['strict-sdk-receipt',4],
 };
 function visit(suite){
  for(const spec of suite.specs||[])if(required[spec.title])for(const test of spec.tests||[]){
   const [name,count]=required[spec.title],attachments=(test.results||[]).flatMap(r=>r.attachments||[]).filter(a=>a.name===name);
   assert.equal(attachments.length,count,'D1_executed_receipt_count:'+spec.title+':'+test.projectName);
   for(const a of attachments){
    const r=JSON.parse(a.path?readFileSync(a.path,'utf8'):Buffer.from(a.body,'base64').toString());
    assert.equal(r.probe,false,'D1_source_probe_receipt');assert.equal(r.source_only_diagnostic,false,'D1_source_diagnostic_receipt');
    for(const [kind,file] of [['consent','assets/consent.js'],['headers','_headers'],...(name==='strict-sdk-receipt'?[['analytics',r.analytics_file]]:[])]){
     assert.equal(r[kind+'_file'],file,'D1_executed_file:'+kind);
     assert.ok(hashes.has(file),'D1_missing_emitted_file:'+file);
     assert.equal(r[kind+'_sha256'],hashes.get(file),'D1_executed_hash:'+kind);
    }
    if(name==='strict-sdk-receipt')assert.match(r.analytics_file,/^assets\/analytics(?:\.[a-f0-9]+)?\.js$/);
    receipts.push({title:spec.title,project:test.projectName,name,consent_sha256:r.consent_sha256,headers_sha256:r.headers_sha256,...(r.analytics_sha256?{analytics_file:r.analytics_file,analytics_sha256:r.analytics_sha256}:{})});
   }
  }
  for(const child of suite.suites||[])visit(child);
 }
 for(const suite of report.suites||[])visit(suite);
 // checkBrowser independently requires the complete 168-cell exact selection.
 assert.equal(new Set(receipts.map(r=>r.title)).size,Object.keys(required).length,'D1_missing_SDK_provenance_subject');
 return receipts;
}
