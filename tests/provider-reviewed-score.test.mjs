import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildProviderReviewSpecs,renderProviderReviewPage} from '../src/provider-review.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../data/'+f,import.meta.url)));
test('capture-bound explicit unscored review survives full ledger integration',()=>{
 const contracts=read('provider-page-contracts.json'), fast=read('provider-fastpath-contract.json');
 for(const id of ['rightwell-review','willow-review','ivim-health-review']){
  const contract=contracts.providers.find(p=>p.program_id===id), integration=fast.providers.find(p=>p.program_id===id);
  const specs=buildProviderReviewSpecs([],{...contracts,providers:[contract]},{...fast,providers:[integration],fastpath_provider_count:1,expected_provider_review_count:1},null,'glp-clinic-scout',[{program_id:id,criteria_scores:{pricing_transparency:100,care_model:100},score_basis:'derived'}]);
  assert.deepEqual(specs[0].row.criteria_scores,{});
  assert.match(renderProviderReviewPage(specs[0],read('identity-registry.json')),/No comparable editorial score is assigned/);
 }
});
