import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateAttestedRetention} from '../src/price-state.mjs';
import {resolveDeployedPricingBaseline,sha256} from '../src/pricing-coverage-floor.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const read=relative=>JSON.parse(readFileSync(new URL('../'+relative,import.meta.url)));
const baseline=resolveDeployedPricingBaseline(read('data/pricing-coverage-baseline.json'));
const matrix=read('data/provider-pricing-matrix.json');
test('historical retention survives deployed-baseline advancement without accepting lost rows',()=>{
 const retention=validateAttestedRetention(root,matrix,baseline);
 assert.equal(retention.removed_rows.length,36);
 assert.equal(sha256(readFileSync(retention.baseline_matrix_path)),read('data/price-state-retention.json').baseline_matrix_sha256);
 assert.equal(retention.baseline_coverage.medication_rows,89);
 assert.equal(matrix.providers['telos-rx'].medications.length,2);
 for(const [id,entry] of Object.entries(matrix.providers)){
  if(!entry.medications.length)continue;
  const missing=structuredClone(matrix);missing.providers[id].medications.pop();
  assert.throws(()=>validateAttestedRetention(root,missing,baseline),new RegExp('attested_set_drift:'+id));
 }
 assert.throws(()=>validateAttestedRetention(root,matrix,{...baseline,matrix_sha256:'0'.repeat(64)}),/baseline_hash/);
});
