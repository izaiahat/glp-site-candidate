import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { A12B_SCHEMA_SHA256, A12B_PLATFORMS, canonicalPermissionJSON, validA12bVocabulary } from '../src/a12-permission-contract.mjs';
const A='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/A12b';
const specs=JSON.parse(readFileSync(A+'/PLATFORM-SPECS.json')).platforms;
test('A12b exact schema and platform vocabulary pins',()=>{
  assert.equal(A12B_SCHEMA_SHA256,createHash('sha256').update(readFileSync(A+'/ISSUER-RECORD.schema.json')).digest('hex'));
  assert.deepEqual(Object.keys(A12B_PLATFORMS).sort(),specs.map(p=>p.platform).sort());
  for(const p of specs) assert.deepEqual(A12B_PLATFORMS[p.platform],{events:p.allowed_event_names,identifiers:p.allowed_identifiers,payload:p.allowed_payload_fields});
});
test('actual A6 Python canonical digest equals JS for Unicode and integer boundaries',()=>{
  const values=[{notice:'café 漢字 😀 \u007f',nested:['\b\f\n\r\t','"\\/',null,true,false,0,9007199254740991]}, {'𐀀':'supplementary key','\ue000':'BMP key'}, {value:'\ud800'}, {ascii:'source',timestamp:1788912000000}];
  const program="import sys,json,importlib.util; s=importlib.util.spec_from_file_location('send_proof','/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/A6/uploaders/send_proof.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); values=json.load(sys.stdin); print(json.dumps([{'canonical':json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False),'sha256':m.canonical_sha256(v)} for v in values]))";
  const python=JSON.parse(execFileSync('python3',['-B','-c',program],{input:JSON.stringify(values),encoding:'utf8'}));
  for(const [i,value] of values.entries()) { const bytes=canonicalPermissionJSON(value);assert.equal(bytes,python[i].canonical);assert.equal(createHash('sha256').update(bytes).digest('hex'),python[i].sha256); }
});
test('non-JSON and non-integer values cannot become canonical authority',()=>{
  for(const value of [undefined,NaN,Infinity,1.25,9007199254740992]) assert.throws(()=>canonicalPermissionJSON({value}));
});
for(const p of specs)test('closed vocabulary and split identifiers '+p.platform,()=>{
  const record={platform:p.platform,event_name:p.allowed_event_names.at(-1),allowed_identifiers:p.allowed_identifiers,allowed_payload_fields:p.allowed_payload_fields};
  assert.equal(validA12bVocabulary(record),true);
  for(const name of ['quiz_complete','affiliate_click','Purchase','Subscribe','Schedule','Contact','unknown'])assert.equal(validA12bVocabulary({...record,event_name:name}),false);
  assert.equal(validA12bVocabulary({...record,allowed_payload_fields:['permission_sha256']}),false);
  assert.equal(validA12bVocabulary({...record,allowed_identifiers:{capture:['gbraid'],export:['gclid']}}),false);
  assert.equal(validA12bVocabulary({...record,allowed_identifiers:{capture:['fbclid'],export:['fbclid']}}),false);
});
