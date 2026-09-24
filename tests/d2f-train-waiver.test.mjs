import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pricingCoverageFloor,sha256} from '../src/pricing-coverage-floor.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));const baseline=JSON.parse(read('data/pricing-coverage-baseline.json'));const waiver=JSON.parse(read('data/pricing-waivers/S8-coverage.json'));const matrixHash=sha256(read('tests/fixtures/train1-accepted-pricing-matrix.json'));const derived={providers_with_evidenced_pricing:18,medication_rows:48};const context={releaseTrain:'release-train-1',rulingsSha256:sha256(read('data/pricing-waivers/S8-rulings.json'))};
test('S8 exact waiver binds train, actual rulings and exact matrix',()=>{assert.equal(matrixHash,waiver.candidate_matrix_sha256);assert.equal(sha256(read('data/pricing-waivers/S8-coverage.json')),baseline.evidence_owner_waiver.sha256);assert.deepEqual(pricingCoverageFloor(derived,baseline,matrixHash,waiver,context),[])});
for(const [name,w,c,h,d] of [
 ['absent',null,context,matrixHash,derived],
 ['wrong train',waiver,{...context,releaseTrain:'release-train-2'},matrixHash,derived],
 ['waiver wrong train',{...waiver,waiver_for:'release-train-2'},context,matrixHash,derived],
 ['rulings altered',waiver,{...context,rulingsSha256:'0'.repeat(64)},matrixHash,derived],
 ['matrix altered',waiver,context,'0'.repeat(64),derived],
 ['future losses',waiver,context,matrixHash,{...derived,medication_rows:47}],
 ['expired scope',{...waiver,expires:'never'},context,matrixHash,derived],
 ['missing context',waiver,{},matrixHash,derived]
])test('coverage floor rejects '+name,()=>assert.ok(pricingCoverageFloor(d,baseline,h,w,c).length));
