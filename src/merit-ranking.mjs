// Merit ranking for every live provider surface.
//
// WHY THIS EXISTS
// ---------------
// Until 2026-08-06 only the 13 "money-class" programs carried hand-authored
// `criteria_scores`. Every other live provider carried `criteria_scores: {}`,
// so `scoreProvider()` returned null, so the comparison page could not rank it,
// so the registry carried a written exception saying a ranked row "would have to
// invent" a score - and 16 live providers stayed review-only. The exception was
// true only for as long as no derivation existed. This file is that derivation.
//
// WHAT IT MEASURES
// ----------------
// The site rubric (data/money-page-specs.json#rubric) measures PUBLISHED
// COMMERCIAL EVIDENCE, not clinical quality. So the derivation scores exactly
// that: how completely, and how unambiguously, a provider publishes the terms a
// buyer needs, as captured in dated first-party research artifacts. Points come
// only from a merged research field that carries a value, a source URL and a
// verified_as_of date. A field a provider does not publish scores zero - it is
// never estimated, inferred from a sibling provider, or filled from a category
// average. A low derived score means "this provider publishes less", never "this
// provider is worse care".
//
// PROVENANCE
// ----------
// Every program carries `score_basis`:
//   operator_reviewed_criteria_v1     - hand-authored criteria_scores from the
//                                       operator-approved research pass; left
//                                       exactly as they are.
//   derived_evidence_completeness_v1  - computed here from the ledger.
// Both feed the SAME rubric weights and the SAME scoreProvider() reducer, so one
// ordering function ranks all of them. When a newly wired provider publishes more
// than an incumbent, it outscores the incumbent and the build reorders the page.
// There is no manual rank array anywhere in the pipeline.

export const RUBRIC_WEIGHTS = Object.freeze({
  price_transparency: 30,
  medical_oversight: 25,
  insurance_support: 15,
  public_reviews: 15,
  shipping_transparency: 15,
});

export const DERIVATION_ID = "derived_evidence_completeness_v1";
export const OPERATOR_BASIS_ID = "operator_reviewed_criteria_v1";

// The point table. Keep it here, in one place, and keep it declarative: the
// receipt and the sensor both re-read it rather than restating it.
export const DERIVATION_RULES = Object.freeze({
  price_transparency: [
    { points: 45, id: "price_published", why: "A price statement is published with a first-party source URL and a check date." },
    { points: 25, id: "price_unambiguous", why: "That statement resolves to one comparable monthly figure (starting_price_sort is a number) rather than a conflicting or cadence-less set." },
    { points: 20, id: "consult_fee_published", why: "The consultation/membership fee position is published (including an explicit 'no separate fee')." },
    { points: 10, id: "cancellation_published", why: "Cancellation or refund terms are published." },
  ],
  medical_oversight: [
    { points: 35, id: "pharmacy_published", why: "The dispensing/compounding chain is published." },
    { points: 25, id: "accreditation_published", why: "An accreditation signal is published. Provider-claim unless independently checked; never rendered as verified." },
    { points: 25, id: "prescription_gate_published", why: "The medication set and the prescription/clinician requirement are published." },
    { points: 15, id: "states_published", why: "State or eligibility scope is published." },
  ],
  insurance_support: [
    { points: 55, id: "payment_position_published", why: "The insurance/payment position is published at all rather than left unstated." },
    { points: 45, id: "active_insurance_support", why: "That position is active insurance support (coverage check, carrier help, prior authorization) rather than cash-pay only." },
  ],
  public_reviews: [
    { points: 100, id: "comparable_review_dataset_verified", why: "A comparable independent public-review dataset was verified. Never awarded on provider-hosted testimonials; with no verified dataset this criterion is dropped from the denominator instead of scored zero." },
  ],
  shipping_transparency: [
    { points: 55, id: "shipping_published", why: "A shipping or delivery statement is published." },
    { points: 45, id: "shipping_timeframe_stated", why: "That statement gives a concrete timeframe (a number of days or weeks)." },
  ],
});

const RESEARCH_KEYS = Object.freeze({
  first_month_price: "research_first_month_price",
  consultation_fee: "research_consultation_fee",
  cancellation: "research_cancellation",
  pharmacy_type: "research_pharmacy_type",
  legitscript: "research_legitscript",
  states_served: "research_states_served",
  shipping_wait: "research_shipping_wait",
});

const ACTIVE_INSURANCE = /\b(insurance (?:check|support|verification|navigation|accepted|billing)|prior[- ]auth|carrier|coverage check|we bill|bills? (?:your )?insurance|in[- ]network|run(?:s)? through insurance|through insurance)\b/i;
const CASH_ONLY = /\b(cash[- ]pay only|does not (?:bill|accept) (?:health )?insurance|insurance is not (?:used|accepted)|no insurance required|self[- ]pay)\b/i;
const PRESCRIPTION_GATE = /\b(prescription|clinician|prescriber|licensed (?:provider|clinician|physician)|medical (?:evaluation|review))\b/i;
const TIMEFRAME = /\b\d+\s*(?:-\s*\d+\s*)?(?:business\s+)?(?:day|days|week|weeks|hour|hours)\b/i;
const NOT_STATED = /^(?:not stated|not published|unknown|pending|n\/?a)\.?$/i;

function sourced(entry, field) {
  const value = entry?.[RESEARCH_KEYS[field]];
  if (!value || typeof value !== "object") return null;
  if (value.state === "not_publicly_stated") return null;
  if (typeof value.value !== "string" || !value.value.trim()) return null;
  if (!/^https:\/\//.test(value.source_url || "") || !/^\d{4}-\d{2}-\d{2}$/.test(value.verified_as_of || "")) return null;
  return value;
}

function plainText(entry, key) {
  const value = entry?.[key];
  return typeof value === "string" && value.trim() && !NOT_STATED.test(value.trim()) ? value.trim() : "";
}

function award(rules, earned) {
  const total = rules.filter((rule) => earned.has(rule.id)).reduce((sum, rule) => sum + rule.points, 0);
  return Math.min(100, total);
}

/**
 * Derive criteria_scores for one ledger entry. Pure: same ledger in, same
 * numbers out, no clock, no network, no random.
 *
 * @returns {{criteria_scores: object, earned: string[], basis: string}}
 */
export function deriveCriteriaScores(entry, { comparablePriceIds = null } = {}) {
  const earned = new Set();

  const price = sourced(entry, "first_month_price");
  if (price || (plainText(entry, "starting_price") && /^https:\/\//.test(entry?.source_url || ""))) earned.add("price_published");
  // A comparable monthly figure is either sortable in the ledger or explicitly
  // source-backed as a calculator autofill (data/cost-calculator.json overrides).
  // Both mean the same thing: one number a reader can put beside another.
  if (Number.isFinite(entry?.starting_price_sort) || comparablePriceIds?.has(entry?.program_id)) earned.add("price_unambiguous");
  if (sourced(entry, "consultation_fee")) earned.add("consult_fee_published");
  if (sourced(entry, "cancellation")) earned.add("cancellation_published");

  if (sourced(entry, "pharmacy_type")) earned.add("pharmacy_published");
  if (sourced(entry, "legitscript")) earned.add("accreditation_published");
  if (PRESCRIPTION_GATE.test(plainText(entry, "meds_offered"))) earned.add("prescription_gate_published");
  if (sourced(entry, "states_served")) earned.add("states_published");

  const insurance = plainText(entry, "insurance");
  if (insurance) earned.add("payment_position_published");
  if (insurance && ACTIVE_INSURANCE.test(insurance) && !CASH_ONLY.test(insurance)) earned.add("active_insurance_support");

  const shipping = sourced(entry, "shipping_wait");
  const shippingText = shipping?.value || plainText(entry, "average_wait");
  if (shipping || shippingText) earned.add("shipping_published");
  if (shippingText && TIMEFRAME.test(shippingText)) earned.add("shipping_timeframe_stated");

  const criteria_scores = Object.fromEntries(
    Object.entries(DERIVATION_RULES).map(([criterion, rules]) => [criterion, award(rules, earned)]),
  );
  return { criteria_scores, earned: [...earned].sort(), basis: DERIVATION_ID };
}

/**
 * Fill criteria_scores for every ledger entry that has none, and stamp a
 * score_basis on all of them. Entries that already carry operator-reviewed
 * criteria are left untouched - this never overwrites an approved score.
 */
export function applyMeritScores(ledgerEntries, options = {}) {
  const applied = [];
  for (const entry of ledgerEntries) {
    const existing = entry.criteria_scores;
    const hasOperatorScores = existing && typeof existing === "object"
      && Object.keys(RUBRIC_WEIGHTS).every((key) => Number.isFinite(existing[key]));
    if (hasOperatorScores) {
      entry.score_basis = OPERATOR_BASIS_ID;
      continue;
    }
    const { criteria_scores, earned, basis } = deriveCriteriaScores(entry, options);
    entry.criteria_scores = criteria_scores;
    entry.score_basis = basis;
    entry.score_evidence_earned = earned;
    applied.push(entry.program_id);
  }
  return applied;
}

/**
 * The one ordering function. Mirrors money-page.mjs#scoreProvider: public
 * reviews leave the denominator when no comparable dataset was verified, so an
 * unverifiable criterion never drags a provider down.
 */
export function meritScore(row) {
  const scores = row?.criteria_scores || {};
  if (Object.keys(RUBRIC_WEIGHTS).some((key) => !Number.isFinite(scores[key]) || scores[key] < 0 || scores[key] > 100)) return null;
  const comparableReviews = row.social_proof?.status === "VERIFIED" && Number(scores.public_reviews) > 0;
  const criteria = Object.entries(RUBRIC_WEIGHTS).filter(([key]) => key !== "public_reviews" || comparableReviews);
  const weight = criteria.reduce((total, [, value]) => total + value, 0);
  return Math.round(criteria.reduce((total, [key, value]) => total + scores[key] * value, 0) / weight);
}

/** Deterministic merit order: score desc, then display name, then id. */
export function meritOrder(rows) {
  return [...rows].sort((left, right) => {
    const a = meritScore(left);
    const b = meritScore(right);
    if (a === null && b === null) return String(left.display_name || left.provider || "").localeCompare(String(right.display_name || right.provider || ""));
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a
      || String(left.display_name || left.provider || "").localeCompare(String(right.display_name || right.provider || ""))
      || String(left.program_id).localeCompare(String(right.program_id));
  });
}
