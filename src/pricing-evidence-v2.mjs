// Six typed offer kinds. Literal source checks are necessary, not semantic approval.
// Standard library only; import has no I/O. Raw captures are local, not fetched.
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
export const KINDS = Object.freeze({
  floor_from: ['amount_usd', 'period'],
  prepaid_bundle: ['amount_usd', 'supply_period'],
  monthly_equivalent_of_billing_period: ['equivalent_usd', 'equivalent_period', 'billing_period', 'amount_usd'],
  membership_plus_medication: ['membership_usd', 'membership_period', 'medication_usd', 'medication_period'],
  intro_then_ongoing: ['intro_usd', 'intro_period', 'ongoing_usd', 'ongoing_period'],
  monthly_cash: ['amount_usd', 'period', 'cash_schedule'],
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const month = /\bmonth(?:ly)?\b|\/mo\b/i;
function amountInQuote(amount, quote) {
  const variants = new Set([String(amount), amount.toLocaleString('en-US', { maximumFractionDigits:2 }), amount.toFixed(2)]);
  return [...variants].some(token => new RegExp('(?:\\$\\s*|USD\\s+)' + escape(token) + '(?![\\d,.])', 'i').test(quote));
}
function validDate(stamp) {
  if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(stamp)) return false;
  const parsed = Date.parse(stamp);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === stamp.slice(0,10);
}
export function validatePriceRow(row, { root, now = Date.now(), maxAgeDays = 92 } = {}) {
  const errors = [];
  const add = message => errors.push(`${message}:${row?.row_id || 'UNKNOWN_ROW'}`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ['row_not_object'];
  const allowed = new Set(['row_id','medication_id','label','price_kind','plan_label','facts','evidence','identity_evidence','qualifiers','unknown_components','calculator_eligibility']);
  for (const key of Object.keys(row)) if (!allowed.has(key)) add(['month_1_usd','ongoing_usd','month_1_basis','cadence'].includes(key) ? 'legacy_cash_field' : `row_field_unknown:${key}`);
  for (const key of ['row_id','medication_id','label','plan_label']) if (!nonempty(row[key])) add(`row_field_missing:${key}`);
  if (!Object.hasOwn(KINDS,row.price_kind || '')) add('price_kind_invalid');
  if (row.calculator_eligibility !== 'display_only') add('calculator_eligibility_invalid');
  for (const key of ['qualifiers','unknown_components']) if (!Array.isArray(row[key]) || !row[key].every(nonempty) || (key === 'unknown_components' && !row[key].length)) add(`${key}_invalid`);
  const checked = new Map();
  function witness(w) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) { add('witness_invalid'); return; }
    const key = JSON.stringify(w);
    if (checked.has(key)) return;
    checked.set(key,true);
    if (Object.keys(w).some(k=>!['quote','capture_path','capture_sha256','captured_at_utc','source_url'].includes(k))) add('witness_unknown_field');
    if (!nonempty(w.quote)) add('quote_missing');
    try { const url = new URL(w.source_url); if (url.protocol !== 'https:' || url.username || url.password) add('source_url_invalid'); } catch { add('source_url_invalid'); }
    if (!validDate(w.captured_at_utc) || Date.parse(w.captured_at_utc) > now) add('capture_date_invalid');
    else if ((now - Date.parse(w.captured_at_utc)) / 86400000 > maxAgeDays) add('evidence_older_than_recency_bar');
    if (!/^[a-f0-9]{64}$/.test(w.capture_sha256 || '')) add('capture_hash_invalid');
    if (!/^data\/pricing-evidence\/[a-f0-9]{64}\.md$/.test(w.capture_path || '')) { add('capture_path_invalid'); return; }
    if (w.capture_path !== `data/pricing-evidence/${w.capture_sha256}.md`) add('capture_hash_path_mismatch');
    try {
      const absolute = realpathSync(path.resolve(root,w.capture_path));
      const allowedRoot = realpathSync(path.resolve(root,'data/pricing-evidence')) + path.sep;
      if (!absolute.startsWith(allowedRoot)) { add('capture_path_escape'); return; }
      const bytes = readFileSync(absolute);
      if (hash(bytes) !== w.capture_sha256) add('capture_hash_mismatch');
      if (!nonempty(w.quote) || !bytes.toString('utf8').includes(w.quote)) add('quote_not_literal');
    } catch { add('capture_unreadable'); }
  }
  for (const name of ['evidence','identity_evidence']) {
    if (!Array.isArray(row[name]) || !row[name].length) add(`${name}_missing`);
    else row[name].forEach(witness);
  }
  const identity = (row.identity_evidence || []).map(w=>w.quote || '').join('\n').toLowerCase();
  const medication = row.medication_id || '';
  const molecule = medication.replace(/^compounded-/,'').replace(/-(injection|oral)$/,'');
  if (medication.startsWith('compounded-')) {
    if (!identity.includes(molecule)) add('identity_molecule_missing');
    if (!/compound/.test(identity)) add('identity_compound_missing');
    if (medication.endsWith('-injection') && !/inject|subcutaneous|vial/.test(identity)) add('identity_injection_missing');
    if (medication.endsWith('-oral') && !/oral|sublingual|lozenge|tablet/.test(identity)) add('identity_oral_missing');
  } else if (medication.startsWith('brand-') && !identity.includes(medication.slice(6))) add('identity_brand_missing');
  else if (medication === 'membership-only' && !/membership|clinical care|care plan/.test(identity)) add('identity_membership_missing');
  const facts = row.facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) { add('facts_missing'); return errors; }
  for (const name of KINDS[row.price_kind] || []) if (!Object.hasOwn(facts,name)) add(`required_fact_missing:${name}`);
  for (const [name, fact] of Object.entries(facts)) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) { add(`fact_invalid:${name}`); continue; }
    if (Object.keys(fact).some(k=>!['value','evidence','artifact_needed'].includes(k))) add(`fact_unknown_field:${name}`);
    if (!Array.isArray(fact.evidence)) { add(`fact_evidence_invalid:${name}`); continue; }
    fact.evidence.forEach(witness);
    if (fact.value === 'UNKNOWN') {
      if (!nonempty(fact.artifact_needed)) add(`unknown_without_artifact:${name}`);
      const nullable = row.price_kind === 'membership_plus_medication' || (row.price_kind === 'floor_from' && name === 'period') || (row.price_kind === 'monthly_equivalent_of_billing_period' && name === 'amount_usd') || !(KINDS[row.price_kind] || []).includes(name);
      if (!nullable) add(`required_fact_unknown:${name}`);
      continue;
    }
    if (!fact.evidence.length) add(`fact_evidence_missing:${name}`);
    if (fact.artifact_needed !== null) add(`known_fact_artifact_must_be_null:${name}`);
    if (name.endsWith('_usd')) {
      if (typeof fact.value !== 'number' || !Number.isFinite(fact.value) || fact.value < 0 || fact.value > 100000) add(`amount_invalid:${name}`);
      else if (!fact.evidence.some(w=>amountInQuote(fact.value,String(w.quote || '')))) add(`amount_not_in_own_quote:${name}`);
    } else if (!nonempty(fact.value) || !fact.evidence.some(w=>String(w.quote || '').includes(fact.value))) add(`fact_not_literal:${name}`);
  }
  const quotesFor = name => (facts[name]?.evidence || []).map(w=>w.quote || '').join('\n');
  if (row.price_kind === 'floor_from' && !/\bfrom\b|\bstarting\b|\bas low as\b/i.test(quotesFor('amount_usd'))) add('floor_qualifier_not_in_quote');
  if (row.price_kind === 'prepaid_bundle' && !/\bsupply\b|\bprotocol\b|\bbundle\b|\bprepaid\b|\bprepay\b|\bupfront\b/i.test(quotesFor('amount_usd') + quotesFor('supply_period'))) add('bundle_context_missing');
  if (row.price_kind === 'monthly_equivalent_of_billing_period') {
    if (!month.test(facts.equivalent_period?.value || '')) add('equivalent_month_unit_missing');
    if (!/bill|charg|prepay|prepaid|upfront/i.test(quotesFor('billing_period'))) add('billing_period_context_missing');
  }
  if (row.price_kind === 'membership_plus_medication') {
    if (facts.membership_usd?.value === 'UNKNOWN' && facts.medication_usd?.value === 'UNKNOWN') add('both_components_unknown');
    if (!/membership|clinical care|care plan/i.test(quotesFor('membership_usd') + (row.evidence || []).map(w=>w.quote).join('\n'))) add('membership_context_missing');
  }
  if (row.price_kind === 'intro_then_ongoing' && !/first|initial|intro|start|new patient/i.test(quotesFor('intro_usd') + quotesFor('intro_period'))) add('intro_context_missing');
  if (row.price_kind === 'monthly_cash') {
    if (!month.test(facts.period?.value || '')) add('monthly_cash_period_invalid');
    const schedule = facts.cash_schedule?.value || '';
    // A selected Monthly option with an explicit recurring amount is a schedule,
    // unlike an isolated $/mo floor or monthly equivalent of a longer plan.
    if (!/bill|charg|pay|debit/i.test(schedule) && !/\bMonthly\s*\$[\d,]+(?:\.\d{2})?\s+every month\b/i.test(schedule)) add('cash_schedule_missing');
  }
  return errors;
}
export function validateLegacySnapshot(matrix, snapshot) {
  const errors = [];
  const actual = Object.fromEntries(Object.entries(matrix.providers || {}).map(([id,p])=>[id,(p.medications || []).filter(r=>!Object.hasOwn(r,'price_kind'))]));
  if (!isDeepStrictEqual(actual,snapshot)) errors.push('legacy_snapshot_drift');
  return errors;
}
export function deriveTypedCoverage(matrix) {
  const result = { legacy_rows:0, typed_rows:0, by_kind:Object.fromEntries(Object.keys(KINDS).map(k=>[k,0])) };
  for (const entry of Object.values(matrix.providers || {})) for (const row of entry.medications || []) {
    if (Object.hasOwn(row,'price_kind')) { result.typed_rows++; if (Object.hasOwn(result.by_kind,row.price_kind)) result.by_kind[row.price_kind]++; }
    else result.legacy_rows++;
  }
  return result;
}
