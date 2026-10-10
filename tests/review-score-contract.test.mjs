import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitlyUnscoredReview} from '../src/review-score-contract.mjs';
const binding={raw_capture_sha256:'a'.repeat(64),bundle_sha256:'b'.repeat(64)};
const row={score:null,criteria_scores:{}};
test('unscored contract requires real capture descriptors and empty criteria',()=>{
 const good={row_contract:row,source_capture_bindings:{'https://provider.example/':binding,'https://provider.example/terms':binding}};
 assert.equal(explicitlyUnscoredReview(good),true);
 assert.equal(explicitlyUnscoredReview({row_contract:{score:80,criteria_scores:{care:80}}}),false);
 for(const edit of [c=>c.source_capture_bindings={},c=>c.row_contract.criteria_scores={care:1},c=>c.source_capture_bindings['https://provider.example/'].raw_capture_sha256='forged']){
  const bad=structuredClone(good);edit(bad);
  assert.throws(()=>explicitlyUnscoredReview(bad),/unscored_review_contract_invalid/);
 }
});
