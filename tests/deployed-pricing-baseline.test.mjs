import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as floor from '../src/pricing-coverage-floor.mjs';

// Synthetic deployment chain, not a business evidence or waiver record.
function fixture(t, count = 48) {
  const root = mkdtempSync(path.join(tmpdir(), 'coverage-deployed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const release = path.join(root, 'release');
  mkdirSync(path.join(release, 'data'), { recursive: true });
  const save = (name, value) => {
    const bytes = JSON.stringify(value);
    const file = path.join(root, name);
    writeFileSync(file, bytes);
    return { path: file, sha256: floor.sha256(bytes) };
  };
  const matrix = { schema: 'glp-provider-pricing-matrix-v1', coverage: { medication_rows: 999 }, providers: {
    sample: { medications: Array.from({ length: count }, (_, i) => ({ medication_id: String(i) })) }
  } };
  const matrixBinding = save('release/data/provider-pricing-matrix.json', matrix);
  const tree = 'a'.repeat(64), publicTree = 'b'.repeat(64);
  const manifest = save('manifest.json', { schema: 'glp-opus-release-deployment-manifest-v1', release_root: release,
    release_tree_sha256: tree, release_rows: [{ path: 'data/provider-pricing-matrix.json',
      bytes: Buffer.byteLength(JSON.stringify(matrix)), sha256: matrixBinding.sha256 }] });
  const receipt = save('receipt.json', { schema: 'glp-opus-production-terminal-receipt-v1', status: 'PASS_PRODUCTION_TERMINAL',
    deployment: { deployment_id: 'test-deployment' }, evidence_sha256: { 'manifest.json': manifest.sha256 },
    immutable_closure: { release_tree_sha256: tree, public_tree_sha256: publicTree } });
  const pointer = { schema: 'glp-opus-current-content-base-v1', status: 'PASS', deployment_id: 'test-deployment',
    release_root: release, release_tree_sha256: tree, public_tree_sha256: publicTree, manifest, final_receipt: receipt };
  const binding = save('pointer.json', pointer);
  return { root, matrix, pointer, pointerPath: binding.path, save };
}
const historical = { schema: 'glp-pricing-coverage-baseline-v1', matrix_sha256: 'c'.repeat(64),
  release_root: 'obsolete-release', coverage: { providers_with_evidenced_pricing: 41, medication_rows: 118 },
  evidence_owner_waiver: { path: 'data/pricing-waivers/S8-coverage.json' }, release_train: 'release-train-1' };

test('deployed coverage is derived from authenticated matrix, not 118 or declared counts; 48→89 passes without waiver', t => {
  const f = fixture(t);
  assert.equal(typeof floor.resolveDeployedPricingBaseline, 'function', 'deployed baseline resolution is missing');
  const b = floor.resolveDeployedPricingBaseline(historical, f.pointerPath);
  assert.deepEqual(b.coverage, { providers_with_evidenced_pricing: 1, medication_rows: 48 });
  assert.equal(b.evidence_owner_waiver, undefined);
  assert.deepEqual(floor.pricingCoverageFloor({ providers_with_evidenced_pricing: 35, medication_rows: 89 }, b, 'candidate'), []);
});

test('48→46 fails even though loss is below the legacy 20 percent tolerance', t => {
  const f = fixture(t);
  assert.equal(typeof floor.resolveDeployedPricingBaseline, 'function');
  const b = floor.resolveDeployedPricingBaseline(historical, f.pointerPath);
  assert.match(floor.pricingCoverageFloor({ providers_with_evidenced_pricing: 1, medication_rows: 46 }, b, 'candidate').join(), /48->46/);
});

test('next deployed release moves the baseline dynamically; provider loss independently fails', t => {
  const f = fixture(t, 52);
  assert.equal(typeof floor.resolveDeployedPricingBaseline, 'function');
  const b = floor.resolveDeployedPricingBaseline(historical, f.pointerPath);
  assert.equal(b.coverage.medication_rows, 52);
  assert.equal(floor.pricingCoverageFloor({ providers_with_evidenced_pricing: 0, medication_rows: 89 }, b, 'candidate').length, 1);
});

for (const kind of ['missing pointer', 'pointer not accepted', 'manifest hash', 'matrix hash', 'receipt deployment', 'duplicate matrix', 'missing providers']) {
  test('resolution fails closed: ' + kind, t => {
    const f = fixture(t);
    assert.equal(typeof floor.resolveDeployedPricingBaseline, 'function');
    if (kind === 'missing pointer') rmSync(f.pointerPath);
    if (kind === 'pointer not accepted') f.save('pointer.json', { ...f.pointer, status: 'PENDING' });
    if (kind === 'manifest hash') writeFileSync(f.pointer.manifest.path, '{}');
    if (kind === 'matrix hash') f.save('release/data/provider-pricing-matrix.json', { ...f.matrix, providers: {} });
    if (kind === 'receipt deployment') {
      const r = { schema: 'glp-opus-production-terminal-receipt-v1', status: 'PASS_PRODUCTION_TERMINAL', deployment: { deployment_id: 'different' } };
      f.pointer.final_receipt = f.save('receipt.json', r); f.save('pointer.json', f.pointer);
    }
    if (kind === 'duplicate matrix' || kind === 'missing providers') {
      // These are authenticated malformed chains, not just hash mismatches.
      const matrix = kind === 'missing providers' ? { schema: f.matrix.schema } : f.matrix;
      const mb = f.save('release/data/provider-pricing-matrix.json', matrix);
      const row = { path: 'data/provider-pricing-matrix.json', bytes: Buffer.byteLength(JSON.stringify(matrix)), sha256: mb.sha256 };
      f.pointer.manifest = f.save('manifest.json', { schema: 'glp-opus-release-deployment-manifest-v1', release_root: f.pointer.release_root,
        release_tree_sha256: f.pointer.release_tree_sha256, release_rows: kind === 'duplicate matrix' ? [row, row] : [row] });
      f.pointer.final_receipt = f.save('receipt.json', { schema: 'glp-opus-production-terminal-receipt-v1', status: 'PASS_PRODUCTION_TERMINAL',
        deployment: { deployment_id: f.pointer.deployment_id }, evidence_sha256: { 'manifest.json': f.pointer.manifest.sha256 },
        immutable_closure: { release_tree_sha256: f.pointer.release_tree_sha256, public_tree_sha256: f.pointer.public_tree_sha256 } });
      f.save('pointer.json', f.pointer);
    }
    assert.throws(() => floor.resolveDeployedPricingBaseline(historical, f.pointerPath), /pricing_coverage_deployed_baseline/);
  });
}
