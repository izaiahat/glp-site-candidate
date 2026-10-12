// The calculator may never show a price the shipped evidence does not contain.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18: the cost calculator was rebuilt around a per-provider,
// per-medication pricing matrix so that selecting a provider actually fills in
// real month-1 and ongoing prices instead of opening blank boxes for 28 of 33
// providers. The whole value of that is that the numbers are TRUE. So the build
// re-derives the guarantee rather than trusting the file:
//
//   * every price row carries a verbatim quote, a first-party source URL, a
//     capture date and the sha256 of the captured document
//   * every number the UI renders appears LITERALLY inside that quote
//   * every live provider is present, either with evidenced pricing or with a
//     written reason it is unavailable - a silently missing provider would
//     reappear in the dropdown with blank boxes, which is the old defect
//   * evidence is inside the ≤3-month recency bar
//
// A price that cannot be evidenced is not shipped as a number. That is the
// point: "pricing unavailable" is an honest state, an invented figure is not.
//
// Exit 0 = PASS, 1 = violations.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pricingCoverageFloor, resolveDeployedPricingBaseline, sha256 } from "../src/pricing-coverage-floor.mjs";
import { validatePriceRow, validateLegacySnapshot, deriveTypedCoverage } from "../src/pricing-evidence-v2.mjs";
import { isDeepStrictEqual } from "node:util";
import { retainReceiptedHistoricalPricing } from "../src/historical-pricing-hold.mjs";
import {validateAttestedRetention} from '../src/price-state.mjs';
import {retainedManualPricingBasis} from '../src/provider-surface-append.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
//: Operator evidence-recency rule (2026-08-12): citations ≤3 months at card time.
const MAX_EVIDENCE_AGE_DAYS = 92;

const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), "utf8"));

function ageInDays(stamp, now) {
  return (now - Date.parse(`${stamp}T12:00:00Z`)) / 86400000;
}

function amountInQuote(amount, quote) {
  const tokens = new Set([
    String(amount),
    amount.toLocaleString("en-US", { useGrouping: true, maximumFractionDigits: 2 }),
    Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2),
  ]);
  return [...tokens].some((token) => quote.includes(token));
}

const matrix = await readJson("data/provider-pricing-matrix.json");
const registry = await readJson("data/program-registry.json");
const violations = [];
const now = Date.now();

const isV2 = matrix.schema === "glp-provider-pricing-matrix-v2";
if (!isV2 && matrix.schema !== "glp-provider-pricing-matrix-v1") violations.push("matrix_schema_invalid");
const LEGACY_SNAPSHOT_SHA256 = "c2272514a6587b7a8d23ab7169f5109813b85ba78af2c81aff3e08f0bf4fc8f8";
if (isV2) {
  if(sha256(await readFile(path.join(ROOT,'data/pricing-v1-legacy-snapshot.json')))!==LEGACY_SNAPSHOT_SHA256)violations.push('legacy_predecessor_drift');
  const successorHash='746a76791257e947a80d340c7e5ce427c71eef575e60440ebef482ec6af895ec';
  const expectedPath = "data/pricing-v1-legacy-snapshot-s32.json";
  if (matrix.migration?.legacy_snapshot_path !== expectedPath || matrix.migration?.legacy_snapshot_sha256 !== successorHash) {
    violations.push("legacy_snapshot_binding_invalid");
  } else {
    try {
      const bytes = await readFile(path.join(ROOT, expectedPath));
      if (sha256(bytes) !== successorHash) violations.push("legacy_snapshot_hash_mismatch");
      else {
        const baseline=resolveDeployedPricingBaseline(await readJson('data/pricing-coverage-baseline.json'));
        const retention=validateAttestedRetention(ROOT,matrix,baseline);
        const snapshot=JSON.parse(bytes);
        const removed=retention.removed_rows;
        const historical=JSON.parse(await readFile(retention.baseline_matrix_path));
        for (const [id,rows] of Object.entries(snapshot)) {
          const removedRows=removed.filter(r=>r.program_id===id).map(r=>historical.providers[id].medications[r.baseline_index]);
          snapshot[id]=rows.filter(r=>!removedRows.some(old=>isDeepStrictEqual(r,old)));
        }
        violations.push(...validateLegacySnapshot(retainedManualPricingBasis(matrix,registry,['rightwell-review','willow-review','ivim-health-review','tyde-wellness-review','feelgood-review','instarx-review','retaclinic-review']),snapshot));
      }
    } catch { violations.push("legacy_snapshot_unreadable"); }
  }
  if (!isDeepStrictEqual(matrix.typed_coverage, deriveTypedCoverage(matrix))) violations.push("typed_coverage_claim_drift");
}

const liveProfiles = Object.keys(registry.provider_dynamic_profiles?.profiles || {});
const historicalRetentions = [];
for (const programId of liveProfiles) {
  const entry = matrix.providers?.[programId];
  if (!entry) {
    violations.push(`live_provider_missing_from_pricing_matrix:${programId}`);
    continue;
  }
  if (!(entry.medications || []).length && !entry.unavailable_reason) {
    violations.push(`provider_without_pricing_has_no_written_reason:${programId}`);
  }
}
for (const programId of Object.keys(matrix.providers || {})) {
  if (!liveProfiles.includes(programId)) {
    // The exact deployed historical matrix is retained, not offered anew.
    // Receipt, hold/alias authority and actual calculator exclusion all bind it.
    let historical = false;
    try { historical = retainReceiptedHistoricalPricing(ROOT, registry, matrix, programId); }
    catch (error) { violations.push(error.message); }
    if (historical) historicalRetentions.push(programId);
    else violations.push(`pricing_matrix_carries_non_live_provider:${programId}`);
  }
}

let rows = 0;
let intro = 0;
const rowIds = new Set();
for (const [programId, entry] of Object.entries(matrix.providers || {})) {
  for (const row of entry.medications || []) {
    rows += 1;
    const where = `${programId}:${row.medication_id}`;
    if (!matrix.medication_labels?.[row.medication_id]) violations.push(`medication_id_unknown:${where}`);
    if (row.label !== matrix.medication_labels?.[row.medication_id]) violations.push(`medication_label_drift:${where}`);
    if (Object.hasOwn(row, "price_kind")) {
      if (!isV2) violations.push(`typed_row_in_v1_matrix:${where}`);
      if (typeof row.row_id !== "string" || !row.row_id.startsWith(`${programId}:`) || !row.row_id.endsWith(`:${row.medication_id}`)) violations.push(`typed_row_identity_mismatch:${where}`);
      if (rowIds.has(row.row_id)) violations.push(`duplicate_typed_row_id:${row.row_id}`);
      rowIds.add(row.row_id);
      violations.push(...validatePriceRow(row, { root: ROOT, now, maxAgeDays: MAX_EVIDENCE_AGE_DAYS }));
      continue;
    }
    if (!/^https:\/\//.test(row.source_url || "")) violations.push(`source_url_invalid:${where}`);
    if (!/^[a-f0-9]{64}$/.test(row.capture_sha256 || "")) violations.push(`capture_sha256_missing:${where}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.captured_on || "")) violations.push(`captured_on_invalid:${where}`);
    else if (ageInDays(row.captured_on, now) > MAX_EVIDENCE_AGE_DAYS) violations.push(`evidence_older_than_recency_bar:${where}:${row.captured_on}`);
    const quote = String(row.quote || "");
    if (!quote.trim()) violations.push(`quote_missing:${where}`);
    for (const field of ["month_1_usd", "ongoing_usd"]) {
      const amount = row[field];
      if (amount === null || amount === undefined) continue;
      if (!Number.isFinite(amount) || amount < 0 || amount > 100000) violations.push(`amount_out_of_range:${where}:${field}`);
      else if (!amountInQuote(amount, quote)) violations.push(`amount_not_in_quote:${where}:${field}:${amount}`);
    }
    if (!["intro", "same_as_ongoing"].includes(row.month_1_basis)) violations.push(`month_1_basis_invalid:${where}`);
    else if (row.month_1_basis === "same_as_ongoing" && row.month_1_usd !== row.ongoing_usd) violations.push(`same_as_ongoing_prices_differ:${where}`);
    else if (row.month_1_basis === "intro") {
      intro += 1;
      if (row.month_1_usd === row.ongoing_usd) violations.push(`intro_basis_without_a_different_first_month:${where}`);
    }
  }
}

const declared = matrix.coverage || {};
const derived = {
  providers_total: Object.keys(matrix.providers || {}).length,
  providers_with_evidenced_pricing: Object.values(matrix.providers || {}).filter((entry) => (entry.medications || []).length).length,
  providers_pricing_unavailable: Object.values(matrix.providers || {}).filter((entry) => !(entry.medications || []).length).length,
  medication_rows: rows,
  rows_with_intro_month_1: intro,
};
for (const [key, value] of Object.entries(derived)) {
  if (declared[key] !== value) violations.push(`coverage_claim_drift:${key}:declared=${declared[key]}:derived=${value}`);
}

let baseline = {};
try {
  baseline = resolveDeployedPricingBaseline(await readJson("data/pricing-coverage-baseline.json"));
} catch (error) {
  violations.push(error.message);
}
let waiver = null;
let waiverContext = {};
if (baseline.evidence_owner_waiver) {
  const binding = baseline.evidence_owner_waiver;
  if (typeof binding.path !== "string" || !/^data\/pricing-waivers\/[a-zA-Z0-9_-]+\.json$/.test(binding.path)) {
    violations.push("pricing_coverage_waiver_path_invalid");
  } else {
    const bytes = await readFile(path.join(ROOT, binding.path));
    if (sha256(bytes) !== binding.sha256) violations.push("pricing_coverage_waiver_hash_mismatch");
    else {
      waiver = JSON.parse(bytes);
      if (typeof binding.rulings_path !== "string" || !/^data\/pricing-waivers\/[a-zA-Z0-9_-]+\.json$/.test(binding.rulings_path)) {
        violations.push("pricing_coverage_rulings_path_invalid");
      } else {
        const rulingsHash = sha256(await readFile(path.join(ROOT, binding.rulings_path)));
        if (rulingsHash !== binding.rulings_sha256) violations.push("pricing_coverage_rulings_hash_mismatch");
        else waiverContext = { releaseTrain: baseline.release_train, rulingsSha256: rulingsHash };
      }
    }
  }
}
violations.push(...pricingCoverageFloor(derived, baseline, sha256(await readFile(path.join(ROOT, "data/provider-pricing-matrix.json"))), waiver, {...waiverContext,root:ROOT,matrix}));
const report = {
  status: violations.length ? "FAIL" : "PASS",
  captured_on: matrix.captured_on,
  coverage: derived,
  accepted_release_coverage: baseline.coverage,
  accepted_release_baseline: baseline.source,
  maximum_coverage_drop_percent: baseline.coverage_policy === 'deployed-no-regression' ? 0 : 20,
  evidence_recency_bar_days: MAX_EVIDENCE_AGE_DAYS,
  typed_coverage: deriveTypedCoverage(matrix),
  historical_retained_not_live: historicalRetentions,
  violations,
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(violations.length ? 1 : 0);
