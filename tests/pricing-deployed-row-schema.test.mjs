import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDeployedPricingBaseline, sha256 } from '../src/pricing-coverage-floor.mjs';

// Synthetic unit publication chain only; never a release receipt/input.
function fixture(t, rowFields) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pricing-row-schema-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const matrix = Buffer.from(JSON.stringify({schema:'glp-provider-pricing-matrix-v2',
    providers:{fixture:{medications:[{name:'fixture'}]},empty:{medications:[]}}}));
  mkdirSync(path.join(root,'data'));
  writeFileSync(path.join(root,'data/provider-pricing-matrix.json'),matrix);
  const releaseHash = 'a'.repeat(64), publicHash = 'b'.repeat(64);
  const manifest = Buffer.from(JSON.stringify({schema:'glp-opus-release-deployment-manifest-v1',
    release_root:root,release_tree_sha256:releaseHash,
    release_rows:[{path:'data/provider-pricing-matrix.json',sha256:sha256(matrix),...rowFields(matrix)}]}));
  const manifestPath = path.join(root,'manifest.json');
  writeFileSync(manifestPath,manifest);
  const receipt = Buffer.from(JSON.stringify({schema:'glp-opus-production-terminal-receipt-v1',
    status:'PASS_PRODUCTION_TERMINAL',deployment:{deployment_id:'unit-fixture'},
    immutable_closure:{release_tree_sha256:releaseHash,public_tree_sha256:publicHash},
    evidence_sha256:{'manifest.json':sha256(manifest)}}));
  const receiptPath = path.join(root,'receipt.json');
  writeFileSync(receiptPath,receipt);
  const pointerPath = path.join(root,'pointer.json');
  writeFileSync(pointerPath,JSON.stringify({schema:'glp-opus-current-content-base-v1',status:'PASS',
    deployment_id:'unit-fixture',release_root:root,release_tree_sha256:releaseHash,public_tree_sha256:publicHash,
    manifest:{path:manifestPath,sha256:sha256(manifest)},final_receipt:{path:receiptPath,sha256:sha256(receipt)}}));
  return {pointerPath,root,matrix};
}

test('deployed pricing baseline accepts hash-bound current manifest size rows', t => {
  const f = fixture(t, bytes => ({size:bytes.length}));
  const result = resolveDeployedPricingBaseline(null,f.pointerPath);
  assert.deepEqual(result.coverage,{providers_with_evidenced_pricing:1,medication_rows:1});
  assert.equal(result.matrix_sha256,sha256(f.matrix));
});

test('deployed pricing baseline retains hash-bound historical bytes rows', t => {
  const f = fixture(t, bytes => ({bytes:bytes.length}));
  assert.equal(resolveDeployedPricingBaseline(null,f.pointerPath).coverage.medication_rows,1);
});

for (const [name, fields] of [
  ['missing length', () => ({})],
  ['ambiguous aliases', bytes => ({size:bytes.length,bytes:bytes.length})],
  ['string size', bytes => ({size:String(bytes.length)})],
  ['negative size', () => ({size:-1})],
  ['fractional size', bytes => ({size:bytes.length + 0.5})],
  ['unsafe size', () => ({size:Number.MAX_SAFE_INTEGER + 1})],
]) {
  test(`deployed pricing baseline refuses ${name}`, t => {
    const f = fixture(t,fields);
    assert.throws(() => resolveDeployedPricingBaseline(null,f.pointerPath),/matrix_manifest_entry_invalid/);
  });
}

test('deployed pricing baseline refuses wrong size even with matching SHA', t => {
  const f = fixture(t, bytes => ({size:bytes.length + 1}));
  assert.throws(() => resolveDeployedPricingBaseline(null,f.pointerPath),/matrix_hash_mismatch/);
});

test('deployed pricing baseline refuses changed matrix with unchanged length', t => {
  const f = fixture(t, bytes => ({size:bytes.length}));
  writeFileSync(path.join(f.root,'data/provider-pricing-matrix.json'),Buffer.from(f.matrix.toString().replace('fixture','changed')));
  assert.throws(() => resolveDeployedPricingBaseline(null,f.pointerPath),/matrix_hash_mismatch/);
});

test('deployed pricing baseline refuses changed bound manifest', t => {
  const f = fixture(t, bytes => ({size:bytes.length}));
  writeFileSync(path.join(f.root,'manifest.json'),'{}');
  assert.throws(() => resolveDeployedPricingBaseline(null,f.pointerPath),/binding_hash_mismatch/);
});
