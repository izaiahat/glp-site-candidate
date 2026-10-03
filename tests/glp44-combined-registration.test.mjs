import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {requiredBrowserCases,checkBrowser,checkSampledDiagnosticProvenance} from '../scripts/ci-release-gate.mjs';
import config from '../playwright.config.mjs';
const selection=JSON.parse(readFileSync(new URL('../ops/release-gate.json',import.meta.url))).browser;
const diagnostic='tests/browser/ga4-diagnostic-containment.spec.mjs';
const key=r=>JSON.stringify([r.file,r.title,r.project]);
const report=()=>({config:{updateSnapshots:'none'},errors:[],suites:[{specs:requiredBrowserCases(selection).map(c=>({file:c.file.replace('tests/browser/',''),title:c.title,tests:[{projectName:c.project,expectedStatus:'passed',status:'expected',results:[{status:'passed'}]}]}))}]});
test('combined registration keeps original 168, four CTA cells and one explicit sampled cell',()=>{
 const original=selection.cases.filter(c=>!['GLP-200','GLP44-sampled-diagnostic-containment'].includes(c.requirement));
 assert.equal(original.length,42);
 // Frozen PR15 registration, not a count-only assertion or expected=current.
 assert.equal(createHash('sha256').update(JSON.stringify({projects:selection.projects,cases:original})).digest('hex'),'25fe6b6b9f4eead60f24cca25b481d163a5cefcc79b29e92ce34b1d7c060d955');
 const cells=requiredBrowserCases(selection);
 assert.equal(cells.length,173);assert.equal(new Set(cells.map(key)).size,173);
 assert.equal(cells.filter(c=>c.file.endsWith('/header-cta-contrast.spec.mjs')).length,4);
 assert.deepEqual(cells.filter(c=>c.file===diagnostic).map(c=>c.project),['chromium']);
 const long=selection.cases.filter(c=>c.title.includes('in-flight retry accepted')||c.title.includes('cannot retry for 65 seconds'));
 assert.equal(requiredBrowserCases({...selection,cases:long}).length,8);
});
test('sampled applicability is selected before execution, not a WebKit or mobile skip',()=>{
 const c=selection.cases.find(c=>c.file===diagnostic);assert.match(c.applicability,/V8/);
 for(const project of config.projects){
  assert.equal(project.testIgnore,project.name==='chromium'?undefined:'**/ga4-diagnostic-containment.spec.mjs');
 }
 assert.deepEqual(config.projects.map(p=>p.name),selection.projects);
 for(const projects of [[],['unknown'],['chromium','chromium']])assert.throws(()=>requiredBrowserCases({...selection,cases:[{...c,projects}]}),/applicability/);
 assert.throws(()=>requiredBrowserCases({...selection,cases:[{...c,applicability:''}]}),/applicability/);
});
test('combined gate refuses missing, duplicate, failed, skipped, retried and wrong-project sampled cells',()=>{
 assert.equal(checkBrowser(report(),selection).length,173);
 const index=report().suites[0].specs.findIndex(s=>s.file==='ga4-diagnostic-containment.spec.mjs');
 for(const mutate of [r=>r.suites[0].specs.splice(index,1),r=>r.suites[0].specs.push(r.suites[0].specs[index]),r=>{r.suites[0].specs[index].tests[0].projectName='webkit'}]){const r=report();mutate(r);assert.throws(()=>checkBrowser(r,selection),/denominator_mismatch/)}
 for(const state of ['failed','skipped','timedOut']){const r=report();r.suites[0].specs[index].tests[0].results[0].status=state;assert.throws(()=>checkBrowser(r,selection),/failure_or_skip/)}
 const retried=report();retried.suites[0].specs[index].tests[0].results.push({status:'passed'});assert.throws(()=>checkBrowser(retried,selection),/failure_or_skip/);
});
test('sampled gate binds its actual emitted consent and headers and rejects missing or stale attachments',()=>{
 const inventory={files:[{file:'assets/consent.js',sha256:'consent'},{file:'_headers',sha256:'headers'}]};
 const r=report(),spec=r.suites[0].specs.find(s=>s.file==='ga4-diagnostic-containment.spec.mjs');
 const receipt={consent_sha256:'consent',headers_sha256:'headers'};
 const attach=value=>({name:'ga4-sampled-diagnostic-containment',body:Buffer.from(JSON.stringify(value)).toString('base64')});
 spec.tests[0].results[0].attachments=[attach(receipt)];
 assert.equal(checkSampledDiagnosticProvenance(r,inventory).length,1);
 assert.throws(()=>checkSampledDiagnosticProvenance(r,{files:[]}),/sampled_emitted_hash/);
 spec.tests[0].results[0].attachments=[attach(receipt),attach(receipt)];assert.throws(()=>checkSampledDiagnosticProvenance(r,inventory),/sampled_receipt_count/);
 spec.tests[0].results[0].attachments=[attach(receipt)];spec.tests[0].projectName='webkit';assert.throws(()=>checkSampledDiagnosticProvenance(r,inventory),/sampled_subject_count/);spec.tests[0].projectName='chromium';
 for(const field of ['consent_sha256','headers_sha256']){spec.tests[0].results[0].attachments=[attach({...receipt,[field]:'stale'})];assert.throws(()=>checkSampledDiagnosticProvenance(r,inventory),/sampled_emitted_hash/)}
 spec.tests[0].results[0].attachments=[];assert.throws(()=>checkSampledDiagnosticProvenance(r,inventory),/sampled_receipt_count/);
 assert.throws(()=>checkSampledDiagnosticProvenance({suites:[]},inventory),/sampled_subject_count/);
});
