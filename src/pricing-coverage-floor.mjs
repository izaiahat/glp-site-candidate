import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {validateAttestedRetention} from './price-state.mjs';

// Only the deployed, accepted publication chain can move this baseline.
// Never trust coverage declarations or silently fall back to a stale snapshot.
export function resolveDeployedPricingBaseline(historical, pointerPath = '/home/ubuntu/business/reports/glp-clinic-scout/seo-machine/current-content-base.json') {
  const fail = reason => { throw new Error('pricing_coverage_deployed_baseline:' + reason); };
  const readBound = binding => {
    if (!path.isAbsolute(binding?.path || '') || !/^[a-f0-9]{64}$/.test(binding?.sha256 || '')) fail('binding_invalid');
    const bytes = readFileSync(binding.path);
    if (sha256(bytes) !== binding.sha256) fail('binding_hash_mismatch');
    return JSON.parse(bytes);
  };
  try {
    const pointerBytes = readFileSync(pointerPath), pointer = JSON.parse(pointerBytes);
    if (pointer.schema !== 'glp-opus-current-content-base-v1' || pointer.status !== 'PASS'
      || !pointer.deployment_id || !path.isAbsolute(pointer.release_root || '')
      || !/^[a-f0-9]{64}$/.test(pointer.release_tree_sha256 || '')
      || !/^[a-f0-9]{64}$/.test(pointer.public_tree_sha256 || '')) fail('pointer_invalid');
    const manifest = readBound(pointer.manifest), receipt = readBound(pointer.final_receipt);
    if (manifest.schema !== 'glp-opus-release-deployment-manifest-v1'
      || manifest.release_root !== pointer.release_root || manifest.release_tree_sha256 !== pointer.release_tree_sha256
      || receipt.schema !== 'glp-opus-production-terminal-receipt-v1' || receipt.status !== 'PASS_PRODUCTION_TERMINAL'
      || receipt.deployment?.deployment_id !== pointer.deployment_id
      || receipt.immutable_closure?.release_tree_sha256 !== pointer.release_tree_sha256
      || receipt.immutable_closure?.public_tree_sha256 !== pointer.public_tree_sha256
      || receipt.evidence_sha256?.[path.basename(pointer.manifest.path)] !== pointer.manifest.sha256) fail('publication_chain_mismatch');
    const rows = manifest.release_rows?.filter(row => row.path === 'data/provider-pricing-matrix.json');
    if (rows?.length !== 1) fail('matrix_manifest_entry_invalid');
    const matrixPath = path.join(pointer.release_root, rows[0].path), bytes = readFileSync(matrixPath);
    if (bytes.length !== rows[0].bytes || sha256(bytes) !== rows[0].sha256) fail('matrix_hash_mismatch');
    const matrix = JSON.parse(bytes);
    if (!['glp-provider-pricing-matrix-v1', 'glp-provider-pricing-matrix-v2'].includes(matrix.schema)
      || !matrix.providers || typeof matrix.providers !== 'object' || Array.isArray(matrix.providers)) fail('matrix_schema_invalid');
    const providers = Object.values(matrix.providers);
    if (!providers.length || providers.some(entry => !entry || !Array.isArray(entry.medications))) fail('matrix_rows_invalid');
    const coverage = {
      providers_with_evidenced_pricing: providers.filter(entry => entry.medications.length > 0).length,
      medication_rows: providers.reduce((total, entry) => total + entry.medications.length, 0),
    };
    if (!coverage.providers_with_evidenced_pricing || !coverage.medication_rows) fail('matrix_coverage_empty');
    if (!readFileSync(pointerPath).equals(pointerBytes)) fail('pointer_changed_during_resolution');
    return {
      schema: 'glp-pricing-coverage-baseline-v1', release_root: pointer.release_root,
      matrix_sha256: rows[0].sha256, coverage, coverage_policy: 'deployed-no-regression',
      source: { pointer_path: pointerPath, pointer_sha256: sha256(pointerBytes), deployment_id: pointer.deployment_id,
        manifest: pointer.manifest, final_receipt: pointer.final_receipt, matrix_path: matrixPath },
      // Preserve a still-current historical waiver binding, never carry it across acceptance.
      ...(historical?.matrix_sha256 === rows[0].sha256 ? {
        evidence_owner_waiver: historical.evidence_owner_waiver, release_train: historical.release_train,
      } : {}),
    };
  } catch (error) {
    if (error.message?.startsWith('pricing_coverage_deployed_baseline:')) throw error;
    fail('unreadable_or_malformed');
  }
}

export function pricingCoverageFloor(derived, baseline, matrixSha256, waiver = null, context = {}) {
  const violations = [];
  if (context.root && context.matrix) {
    try {
      validateAttestedRetention(context.root, context.matrix, baseline);
      const entries=Object.values(context.matrix.providers);
      const actual={providers_with_evidenced_pricing:entries.filter(e=>e.medications.length).length,medication_rows:entries.reduce((n,e)=>n+e.medications.length,0)};
      if (Object.keys(actual).some(k=>actual[k]!==derived[k])) return ['pricing_coverage_attested_count_drift'];
      return [];
    } catch (error) { return [error.message]; }
  }
  const fields = ['providers_with_evidenced_pricing', 'medication_rows'];
  if (baseline?.schema !== 'glp-pricing-coverage-baseline-v1' || !/^[a-f0-9]{64}$/.test(baseline.matrix_sha256 || '')) return ['pricing_coverage_baseline_invalid'];
  const waived = waiver?.schema === 'glp-pricing-coverage-waiver-v1'
    && waiver.owner === 'glp-scout' && waiver.status === 'APPROVED'
    && waiver.baseline_matrix_sha256 === baseline.matrix_sha256
    && waiver.candidate_matrix_sha256 === matrixSha256
    && context.releaseTrain === 'release-train-1'
    && waiver.waiver_for === context.releaseTrain
    && waiver.expires === 'first accepted release after this train'
    && /^[a-f0-9]{64}$/.test(context.rulingsSha256 || '')
    && waiver.rulings_sha256 === context.rulingsSha256
    && waiver.baseline?.release_root === baseline.release_root
    && fields.every(field => waiver.baseline?.[field] === baseline.coverage?.[field]
      && waiver.accepted?.[field] === derived[field])
    && typeof waiver.reason === 'string' && waiver.reason.trim().length > 0
    && fields.every(field => waiver.coverage?.[field] === derived[field]);
  for (const field of fields) {
    const before = baseline.coverage?.[field], after = derived[field];
    if (!Number.isInteger(before) || before <= 0 || !Number.isInteger(after) || after < 0) violations.push('pricing_coverage_counts_invalid:' + field);
    else if ((baseline.coverage_policy === 'deployed-no-regression' ? after < before : after * 5 < before * 4) && !waived) violations.push(`pricing_coverage_floor:${field}:${before}->${after}:evidence_owner_waiver_required`);
  }
  return violations;
}
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
