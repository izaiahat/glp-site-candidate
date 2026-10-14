import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=process.env.Q11_TEST_ROOT || new URL('../',import.meta.url).pathname;
const read=n=>JSON.parse(readFileSync(root+'data/'+n));
const {buildProviderReviewSpecs}=await import(pathToFileURL(root+'src/provider-review.mjs'));
const {governedBulkCohorts}=await import(pathToFileURL(root+'tests/browser/governed-cohort.mjs'));
const contracts=read('provider-page-contracts.json'), fast=read('provider-fastpath-contract.json');
test('unscored review refuses an empty capture boundary instead of silently withholding score',()=>{
 const contract=structuredClone(contracts.providers.find(p=>p.program_id==='rightwell-review'));
 contract.source_capture_bindings={};
 const integration=fast.providers.find(p=>p.program_id===contract.program_id);
 assert.throws(()=>buildProviderReviewSpecs([],{...contracts,providers:[contract]},
  {...fast,providers:[integration],fastpath_provider_count:1,expected_provider_review_count:1},null,
  'glp-clinic-scout',[{program_id:contract.program_id,criteria_scores:{price_transparency:100}}]),/unscored_review_contract_invalid/);
});
test('regenerated raw-authority shape cannot reinstate paused Try Ageless bulk membership',()=>{
 const actual=governedBulkCohorts('SEMAGLUTIDE',3);
 assert.ok(!actual.numeric.includes('try-ageless') && !actual.unpriced.includes('try-ageless'));
});
