import {readFileSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {resolveDeployedPricingBaseline, sha256} from './pricing-coverage-floor.mjs';
import {validateAttestedRetention} from './price-state.mjs';

// Validation-only retention of the deployed historical matrix. Never returns a
// commercial registry, selects a provider, changes prices, or grants promotion.
export function validateReceiptedHoldSource(root, registry, programId, readBytes = readFileSync) {
  if (programId !== 'telos-rx') return false;
  const fail = (reason) => { throw new Error('historical_pricing_hold:' + reason); };
  const read = (relative) => readBytes(path.join(root, relative));
  const json = (relative) => JSON.parse(read(relative));
  const receiptPath = 'data/telos-research-hold-receipt.json';
  const receiptHash = 'f18426e9dea271a1c8ae5b234324ddbb57c3c524e61c1494dd8c281174c9c585';
  const bytes = read(receiptPath);
  if (sha256(bytes) !== receiptHash) fail('receipt_hash');
  const receipt = JSON.parse(bytes);
  if (receipt.schema !== 'glp-receipted-research-hold-v1' || receipt.program_id !== programId
      || receipt.network !== 'Katalys' || receipt.network_program_id !== '1612' || receipt.sheet_row !== 93
      || receipt.disposition !== 'HOLD' || receipt.live_link_allowed !== false
      || receipt.promotion_authorized !== false || receipt.research_intake_authorized !== false) fail('receipt_scope');
  for (const ref of [receipt.operator_ack, receipt.row_readback]) {
    if (!path.isAbsolute(ref?.path || '') || !/^[a-f0-9]{64}$/.test(ref?.sha256 || '')
        || sha256(readBytes(ref.path)) !== ref.sha256) fail('receipt_authority');
  }
  const rows = registry.programs.filter(row => row.program_id === programId);
  if (rows.length !== 1 || rows[0].commercial_state !== 'held' || rows[0].go?.entry_state !== 'held') fail('commercial_state');
  const profile = rows[0].profiles?.['glp-clinic-scout'];
  if (profile?.canonical_identity?.role !== 'canonical' || profile.canonical_identity.canonical_program_id !== programId
      || profile.wired !== false) fail('canonical_identity');
  for (const surface of ['go', 'compare', 'quiz', 'calculator']) {
    const exception = profile.exceptions?.[surface];
    if (profile.surfaces?.[surface] !== false || exception?.enabled !== true
        || exception.authority_path !== receiptPath || exception.authority_sha256 !== receiptHash) fail('surface_authority:' + surface);
  }
  const aliases = registry.programs.filter(row => row.program_id === 'telos-rx-review');
  if (aliases.length !== 1) fail('alias_identity');
  const alias = aliases[0].profiles?.['glp-clinic-scout'];
  if (alias?.canonical_identity?.role !== 'alias' || alias.canonical_identity.canonical_program_id !== programId
      || aliases[0].commercial_state !== 'held' || alias.wired !== false
      || ['go','compare','quiz','calculator','review','sitemap'].some(surface => alias.surfaces?.[surface] !== false)) fail('alias_authority');
  for (const file of ['data/program-content-ledger.json', 'data/program-page-eligibility.json']) {
    const matches = json(file).programs.filter(row => row.program_id === programId);
    const row = matches[0];
    if (matches.length !== 1 || row.live_link_allowed !== false || row.promotion_authorized !== false
        || row.research_hold_receipt?.path !== receiptPath || row.research_hold_receipt.sha256 !== receiptHash) fail('source_hold:' + file);
  }
  return true;
}

export function retainReceiptedHistoricalPricing(root, registry, matrix, programId, readBytes = readFileSync) {
  if (!validateReceiptedHoldSource(root, registry, programId, readBytes)) return false;
  const fail = (reason) => { throw new Error('historical_pricing_hold:' + reason); };
  const read = (relative) => readBytes(path.join(root, relative));
  const json = (relative) => JSON.parse(read(relative));
  const baseline = resolveDeployedPricingBaseline(json('data/pricing-coverage-baseline.json'));
  const currentBytes = read('data/provider-pricing-matrix.json');
  if (!isDeepStrictEqual(matrix, JSON.parse(currentBytes))) fail('matrix_not_exact_current');
  if (sha256(currentBytes) !== baseline.matrix_sha256) validateAttestedRetention(root,matrix,baseline);
  const historical=JSON.parse(readBytes(baseline.source.matrix_path));
  if (!isDeepStrictEqual(matrix.providers[programId].medications,historical.providers[programId].medications)) fail('held_history_changed');
  if (registry.provider_dynamic_profiles?.profiles?.[programId] || !matrix.providers?.[programId]) fail('live_or_missing_profile');
  const calculator = String(read('public/tools/glp-1-cost-calculator/index.html'));
  if (/<option\b[^>]*\bvalue\s*=\s*(?:["']telos-rx(?:-review)?["']|telos-rx(?:-review)?(?:\s|>))/i.test(calculator)) fail('calculator_exposes_hold');
  return true;
}
