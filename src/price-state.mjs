import {readFileSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {sha256} from './pricing-coverage-floor.mjs';


// Exact S30 removals, not a coverage waiver. Baseline authentication remains
// resolveDeployedPricingBaseline's job and is mandatory before this function.
export const RETENTION_SHA256 = '0388da4c781f36911c1064c899d1f222c58a1e3e8ed7340dba76e44f5c042598';
export const REMOVED_PRICE_REASON = 'Price not attested by current reviewed evidence as a complete medication-specific first and recurring cash schedule. Prior asserted cash rows were removed under the source-bound S30 review; this does not mean the provider publishes no prices or offers free treatment.';
export function validateAttestedRetention(root, matrix, baseline) {
  const fail = why => { throw new Error('attested_price_retention:' + why); };
  const bound = (relative, hash) => {
    if (!/^data\/price-state-(?:evidence\/[a-z0-9-]+|retention)\.json$/.test(relative)) fail('path');
    const bytes=readFileSync(path.join(root,relative));
    if (sha256(bytes)!==hash) fail('source_hash');
    return JSON.parse(bytes);
  };
  const contract=bound('data/price-state-retention.json',RETENTION_SHA256);
  const successorBytes=readFileSync(path.join(root,'data/price-state-retention-v3.json'));
  if(sha256(successorBytes)!=='c24608a458cc6bd0a4b25c0370b3a1b12c819306570008e5940185b6a744004e')fail('successor_hash');
  const successor=JSON.parse(successorBytes);
  if(successor.schema!=='glp-attested-price-retention-v3'||successor.predecessor.sha256!==RETENTION_SHA256)fail('successor_binding');
  const deployedBytes=readFileSync(baseline.source.matrix_path);
  if (sha256(deployedBytes)!==baseline.matrix_sha256) fail('baseline_hash');
  // Removal indices belong to the immutable attestation preimage, not the
  // subsequently deployed matrix. Never advance the attestation to that matrix.
  const historicalMatrixPath=baseline.matrix_sha256===contract.baseline_matrix_sha256
    ? baseline.source.matrix_path
    : path.join(root,'data/predecessors/glp-price-index-weekly-20260910t190246z/provider-pricing-matrix.json');
  const bytes=readFileSync(historicalMatrixPath);
  if (sha256(bytes)!==contract.baseline_matrix_sha256) fail('historical_baseline_hash');
  const old=JSON.parse(bytes), expected=structuredClone(old.providers);
  const removals=[];
  for (const binding of contract.bindings) {
    const packet=bound(binding.path,binding.sha256);
    bound(binding.packet_path,binding.packet_sha256);
    if (packet.program_id!==binding.program_id || (packet.packet.snapshot_sha256 || packet.packet.sha256)!==binding.packet_sha256) fail('source_identity');
    const ops=packet.operations.filter(op=>op.file==='data/provider-pricing-matrix.json' && op.op==='remove');
    for (const op of ops) {
      const match=op.pointer.match(/^\/providers\/([^/]+)\/medications\/(\d+)$/);
      if (!match || match[1]!==binding.program_id || !op.notes?.[0] || !op.fields.includes('monthly_price')) fail('removal_reason');
      const [,id,index]=match;
      if (!isDeepStrictEqual(old.providers[id]?.medications[Number(index)],op.before)) fail('preimage');
      removals.push({program_id:id,baseline_index:Number(index),operation_id:op.id,reason:op.notes[0]});
    }
  }
  if (!isDeepStrictEqual(removals,contract.removed_rows)) fail('removal_accounting');
  for (const [id,entry] of Object.entries(expected)) {
    const indices=new Set(removals.filter(r=>r.program_id===id).map(r=>r.baseline_index));
    entry.medications=entry.medications.filter((_,index)=>!indices.has(index));
    entry.medications.push(...(successor.additions[id] || []));
    if (!isDeepStrictEqual(entry.medications,matrix.providers?.[id]?.medications)) fail('attested_set_drift:'+id);
    if (!entry.medications.length && (!matrix.providers[id].unavailable_reason || !['not_attested','not_published'].includes(matrix.providers[id].pricing_state))) fail('missing_reason:'+id);
    if (!entry.medications.length && matrix.providers[id].unavailable_reason !== (successor.unpriced_reasons[id] || (indices.size ? REMOVED_PRICE_REASON : old.providers[id].unavailable_reason))) fail('forged_reason:'+id);
    if (indices.size && matrix.providers[id].pricing_state!=='not_attested') fail('unsupported_absence_claim:'+id);
    if (indices.size && !isDeepStrictEqual(matrix.providers[id].price_state_evidence,contract.bindings.find(b=>b.program_id===id))) fail('missing_source_binding:'+id);
  }
  if (!isDeepStrictEqual(Object.keys(expected).sort(),Object.keys(matrix.providers || {}).sort())) fail('identity_drop');
  const entries=Object.values(old.providers);
  return {policy:'source-bound-attested-set-retention',removed_rows:removals,baseline_matrix_path:historicalMatrixPath,baseline_coverage:{medication_rows:entries.reduce((n,e)=>n+e.medications.length,0),providers_with_evidenced_pricing:entries.filter(e=>e.medications.length).length},current_coverage:matrix.coverage};
}

export function isComparableCashRow(row) {
  return !!row && !Object.hasOwn(row,'price_kind') && row.medication_id!=='membership-only'
    && Number.isFinite(row.month_1_usd) && row.month_1_usd>0
    && Number.isFinite(row.ongoing_usd) && row.ongoing_usd>0;
}
export const PRICE_STATE_DISCLOSURE = '<aside class="panel" data-price-state-disclosure><h2>Current pricing coverage and historical evidence</h2><p>Eligible live comparison identities: {{LIVE_PROVIDER_COUNT}}. All remain available for non-price comparison. The live priced subset contains {{PRICED_PROVIDER_COUNT}} identities; {{CALCULATOR_COMPARABLE_PROVIDER_COUNT}} have comparable cash schedules for calculator arithmetic. Typed floors, bundles and display-only offers are not exact monthly cash schedules.</p><p>Source review changed retained pricing rows from {{BASELINE_PRICE_ROW_COUNT}}→{{CURRENT_PRICE_ROW_COUNT}} and price-bearing matrix identities from {{BASELINE_PRICED_PROVIDER_COUNT}}→{{MATRIX_PRICED_PROVIDER_COUNT}}. The matrix includes retained held-provider history; that history grants no live eligibility. Removed claims are not zero prices. Historical index observations and captures remain unchanged, describe their original sample, and are not current offers or evidence of a market-wide price fall.</p></aside>';

export function stripPriceStateDisclosures(html,tallies) {
  const prior={LIVE_PROVIDER_COUNT:57,PRICED_PROVIDER_COUNT:22,CALCULATOR_COMPARABLE_PROVIDER_COUNT:5,BASELINE_PRICE_ROW_COUNT:89,CURRENT_PRICE_ROW_COUNT:53,BASELINE_PRICED_PROVIDER_COUNT:35,MATRIX_PRICED_PROVIDER_COUNT:23};
  // Exact accepted release2 snapshot after S32; arbitrary counts/copy stay strict.
  const release2={LIVE_PROVIDER_COUNT:57,PRICED_PROVIDER_COUNT:32,CALCULATOR_COMPARABLE_PROVIDER_COUNT:5,BASELINE_PRICE_ROW_COUNT:89,CURRENT_PRICE_ROW_COUNT:82,BASELINE_PRICED_PROVIDER_COUNT:35,MATRIX_PRICED_PROVIDER_COUNT:33};
  const versions=[PRICE_STATE_DISCLOSURE,...[prior,release2,tallies].map(t=>PRICE_STATE_DISCLOSURE.replace(/\{\{([A-Z0-9_]+)\}\}/g,(_,k)=>String(t[k])))];
  return versions.reduce((s,v)=>s.split(v).join(''),html);
}
export function renderPriceStateComparison(entries) {
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=entries.map(({id,label,review_path,entry})=>`<article class="panel" data-price-state-provider="${esc(id)}"><h3><a href="${esc(review_path)}">${esc(label)}</a></h3><p>${esc(priceStateText(entry)||'Reported pricing is available in the provider review. Floors, bundles and starting prices are not exact monthly cash schedules.')}</p></article>`).join('');
  return `<section class="section" data-price-state-comparison><h2>Compare reported provider information</h2><p>{{LIVE_PROVIDER_COUNT}} eligible identities remain available for comparison. Price not published here means the reviewed evidence does not attest a complete comparable cash schedule; it never means free treatment. Review medication options, coverage and program terms independently of price.</p><div class="p3-provider-grid">${rows}</div></section>`;
}

export function priceStateText(entry) {
  if (entry?.medications?.length) return null;
  const reason = (entry?.unavailable_reason || 'This is an evidence limitation, not a claim that the provider publishes no prices anywhere.').replace(/intro_then_ongoing/g,'introductory and renewal pricing').replace(/v2 kinds/g,'reported offer formats');
  if (entry?.pricing_state==='not_published') return 'Price not published in the reviewed sources. '+reason;
  return 'Price not published here: a complete comparable price is not attested by the reviewed evidence. '+reason;
}
