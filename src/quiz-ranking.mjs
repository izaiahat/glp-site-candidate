// Quiz ranking — the editorial machinery behind /quiz/provider-fit/.
//
// WHY THIS EXISTS
// ---------------
// Until 2026-08-18 the quiz ranked every result set by ONE number:
// `priority_score`, which is `meritScore()` from src/merit-ranking.mjs — the
// comparison page's general "how completely does this provider publish its
// commercial terms" score. That is the right number for a page whose question
// is "who publishes the most?". It is the wrong number for a page whose FIRST
// question is "what matters most to you?", because the reader's answer then
// changed WHO was eligible and never changed WHO RANKED FIRST.
//
// The concrete damage, measured on the 2026-08-18 payload: a reader who
// answered "Lowest total cost" was shown OrderlyMeds ($819 published 6-month
// all-in), HealthRX ($1,049) and AgelessRx ($1,194) — while yourEra ($594) and
// Trimi ($594), the two CHEAPEST providers in the comparison, were ranked 4th
// and 5th and could never appear. The price lane was ranked by price
// TRANSPARENCY, not by price. That is not a defensible thing to show someone who
// told us cost is their priority.
//
// WHAT CHANGED (2026-08-18)
// -------------------------
// 1. The reader's `goal` answer now selects a WEIGHT PROFILE over the same
//    evidence-derived criteria the comparison page already scores. No new
//    judgement is introduced: the criteria and their scores are unchanged, only
//    how much each one counts for THIS reader.
// 2. A new evidenced dimension, `evidenced_all_in_cost`, enters the price
//    profile. It is the provider's LOWEST published 6-month all-in cost
//    (month 1 + 5 x ongoing) among the medications compatible with the reader's
//    medication answer, taken verbatim from data/provider-pricing-matrix.json —
//    31 providers, 95 rows, each carrying a quote, a source URL, a capture date
//    and the sha256 of the captured page. Using month_1 + 5 x ongoing rather
//    than the headline price is also the intro-price honesty rule: a provider
//    that advertises $49 for month one and $349 after cannot out-rank a provider
//    that charges $99 flat, because the arithmetic already knows.
// 3. Ties are broken by that same published all-in cost BEFORE program_id.
//    Three providers with identical evidence profiles used to be ordered
//    alphabetically forever, so `mademed` was always shown and `telos-rx` never
//    was. Alphabetical order is deterministic but it is not merit; a cheaper
//    published price is.
// 4. The price lane's MEMBERSHIP test is re-derived from the pricing matrix.
//    `scripts/glp_surface_unification.py` gates `goal: "price"` on
//    `comparable_price`, which predates the matrix and reads
//    `starting_price_sort` in the content ledger. A provider with a verified,
//    attributable, per-medication price in the governed matrix publishes a
//    comparable price BY DEFINITION, so it belongs in the price lane. This is
//    re-derived at every build, so when the monthly pricing-refresh machine
//    moves a provider to "pricing unavailable" it LEAVES the price lane on the
//    next build with no edit anywhere.
//
// WHAT DID NOT CHANGE
// -------------------
// * `priority_score` / `meritScore()` — untouched. It is still what the
//   comparison pages rank by and still the quiz's profile for a reader who
//   states no priority, so the two surfaces cannot disagree about a reader who
//   told us nothing.
// * Eligibility. Weights never add or remove a provider from a result set;
//   only the published rules, the state exclusions and the therapeutic
//   evidence do that. A paused or removed provider cannot be re-ranked into
//   view, because it is not a candidate at all.
// * `public_reviews`. No provider in the comparison has a verified comparable
//   public-review dataset, so the criterion leaves the denominator exactly as
//   it does in meritScore(). It is never scored zero against anyone.
//
// This file is the single source of truth for all of the above.
// data/quiz-scoring-rationale.json restates it for readers and
// scripts/validate-quiz-scoring-rationale.mjs fails the build if the two drift.

/** The comparison page's rubric — the profile for a reader who states no priority. */
export const DEFAULT_PROFILE = Object.freeze({
  price_transparency: 30,
  medical_oversight: 25,
  insurance_support: 15,
  public_reviews: 15,
  shipping_transparency: 15,
});

/**
 * One weight profile per answer to "What matters most to you?".
 *
 * Every profile is a claim about what the answer MEANS, and each one is
 * defended in data/quiz-scoring-rationale.json. Two rules govern them:
 *   - a criterion may only be re-weighted, never re-scored;
 *   - a criterion the reader's answer cannot speak to drops to 0 rather than
 *     being retained "for balance", because a dimension that does not matter to
 *     this reader is noise in their ranking.
 */
export const GOAL_WEIGHT_PROFILES = Object.freeze({
  // Lowest total cost. The thing itself (all-in cost) leads; how unambiguously
  // the price is published, with cancellation terms, is second; shipping speed
  // is third because a slow first shipment is a month of cost with no medicine.
  // Insurance support is 0: this reader is paying cash.
  price: Object.freeze({
    evidenced_all_in_cost: 40,
    price_transparency: 30,
    shipping_transparency: 15,
    medical_oversight: 15,
  }),
  // Help using insurance. The published insurance position leads by a wide
  // margin; oversight and price transparency still matter because a coverage
  // denial puts this reader on the cash price.
  "insurance-support": Object.freeze({
    insurance_support: 45,
    medical_oversight: 25,
    price_transparency: 15,
    shipping_transparency: 15,
  }),
  // Which medications and forms are available. medical_oversight is the only
  // criterion that scores the published medication set and prescription gate;
  // shipping is raised because form choice is worthless if it does not arrive.
  // Insurance support is 0 for the same reason as the price profile: it is not
  // what this reader asked about.
  "medication-form": Object.freeze({
    medical_oversight: 45,
    shipping_transparency: 30,
    price_transparency: 25,
  }),
  // Coaching and ongoing support. DELIBERATELY IDENTICAL TO THE DEFAULT.
  // The rubric has no criterion that measures coaching quality or contact
  // cadence, and we will not manufacture one to make this profile look
  // bespoke. `coaching` still narrows the candidate set through the published
  // rules; it does not re-rank, and that is written down rather than faked.
  coaching: DEFAULT_PROFILE,
});

/**
 * medication_preference answer -> the medication rows in
 * data/provider-pricing-matrix.json that answer can actually be filled by.
 * `not_sure` and "unanswered" use every row.
 */
export const PREFERENCE_MEDICATION_IDS = Object.freeze({
  semaglutide: Object.freeze(["compounded-semaglutide-injection", "compounded-semaglutide-oral"]),
  tirzepatide: Object.freeze(["compounded-tirzepatide-injection", "compounded-tirzepatide-oral"]),
  retatrutide: Object.freeze(["retatrutide"]),
  wegovy: Object.freeze(["brand-wegovy"]),
  zepbound: Object.freeze(["brand-zepbound"]),
  mounjaro: Object.freeze(["brand-mounjaro"]),
  oral: Object.freeze(["compounded-semaglutide-oral", "compounded-tirzepatide-oral"]),
  injectable: Object.freeze([
    "compounded-semaglutide-injection",
    "compounded-tirzepatide-injection",
    "compounded-liraglutide-injection",
  ]),
});

/** The bucket key a medication answer maps to. Unanswered and `not_sure` share "any". */
export const ANY_PREFERENCE = "any";
export function preferenceBucket(preference) {
  return preference && preference !== "not_sure" ? String(preference) : ANY_PREFERENCE;
}
export const PREFERENCE_BUCKETS = Object.freeze([ANY_PREFERENCE, ...Object.keys(PREFERENCE_MEDICATION_IDS)]);

/**
 * The horizon the all-in figure is quoted over. Six months is the shortest
 * window in which an intro month is honestly diluted rather than dominant, and
 * it is the window the cost calculator already renders.
 */
export const ALL_IN_MONTHS = 6;

/**
 * A provider's lowest published all-in cost over ALL_IN_MONTHS, per preference
 * bucket. Pure: matrix in, numbers out.
 *
 * `membership-only` rows are excluded — a membership fee with the medication
 * billed separately is not a medication price and must never be compared to
 * one. A provider whose only row is membership-only therefore has NO all-in
 * cost, which is the honest answer.
 */
export function allInCostByPreference(matrixProvider) {
  const out = {};
  const rows = (matrixProvider?.medications || []).filter((row) => (
    row
    && !Object.hasOwn(row, 'price_kind')
    && row.medication_id !== "membership-only"
    && Number.isFinite(row.month_1_usd)
    && Number.isFinite(row.ongoing_usd)
  ));
  for (const bucket of PREFERENCE_BUCKETS) {
    const allowed = bucket === ANY_PREFERENCE ? null : new Set(PREFERENCE_MEDICATION_IDS[bucket] || []);
    let best = null;
    for (const row of rows) {
      if (allowed && !allowed.has(row.medication_id)) continue;
      const total = row.month_1_usd + (ALL_IN_MONTHS - 1) * row.ongoing_usd;
      if (best === null || total < best) best = total;
    }
    if (best !== null) out[bucket] = best;
  }
  return out;
}

/**
 * The cheapest published all-in cost in the whole comparison, per bucket. This
 * is the denominator of the cost dimension, so the dimension answers exactly
 * "how close is this provider to the cheapest published option for what you
 * asked for?" — a ratio, so twice the price is half the score.
 */
export function cohortMinimums(allInByProgram) {
  const out = {};
  for (const bucket of PREFERENCE_BUCKETS) {
    let best = null;
    for (const costs of Object.values(allInByProgram)) {
      const value = costs?.[bucket];
      if (Number.isFinite(value) && (best === null || value < best)) best = value;
    }
    if (best !== null) out[bucket] = best;
  }
  return out;
}

/**
 * Score one candidate for one reader. Transcribed verbatim into the page's
 * inline runtime by src/quiz.mjs; the audit and the tests call THIS one, and a
 * test asserts the two agree on every shipped candidate.
 */
export function rankScore(candidate, goal, preference, cohortMin) {
  const profile = GOAL_WEIGHT_PROFILES[goal] || DEFAULT_PROFILE;
  const bucket = preferenceBucket(preference);
  const scores = { ...(candidate.criteria_scores || {}) };
  const mine = candidate.all_in_6mo_usd?.[bucket];
  const floor = cohortMin?.[bucket];
  scores.evidenced_all_in_cost = Number.isFinite(mine) && Number.isFinite(floor) && mine > 0
    ? Math.round((100 * floor) / mine)
    : 0;
  // public_reviews leaves the denominator when no comparable dataset was
  // verified — identical to meritScore(), so an unverifiable criterion never
  // drags anyone down.
  const entries = Object.entries(profile).filter(([key]) => (
    key !== "public_reviews" || Number(scores.public_reviews) > 0
  ));
  const weight = entries.reduce((total, [, value]) => total + value, 0);
  if (!weight) return 0;
  return Math.round(entries.reduce((total, [key, value]) => total + (Number(scores[key]) || 0) * value, 0) / weight);
}

/**
 * The one ordering function for quiz results: rank score desc, then the
 * published all-in cost asc, then program_id asc. Every step is a fact about
 * the provider except the last, which exists only to make the order total.
 */
export function orderCandidates(candidates, goal, preference, cohortMin) {
  const bucket = preferenceBucket(preference);
  return [...candidates].sort((left, right) => (
    rankScore(right, goal, preference, cohortMin) - rankScore(left, goal, preference, cohortMin)
    || (left.all_in_6mo_usd?.[bucket] ?? Infinity) - (right.all_in_6mo_usd?.[bucket] ?? Infinity)
    || String(left.program_id).localeCompare(String(right.program_id))
  ));
}

/**
 * Join the governed pricing matrix onto quiz candidates and re-derive the price
 * lane from it.
 *
 * Returns the decorated candidates plus a receipt of every rule the join
 * changed, so a build can never widen the price lane silently.
 */
export function applyPricingToCandidates(candidates, matrix) {
  const providers = matrix?.providers || {};
  const priceLaneAdded = [];
  const priceLaneRemoved = [];
  const decorated = candidates.map((candidate) => {
    const entry = providers[candidate.program_id] || null;
    const allIn = entry ? allInCostByPreference(entry) : {};
    const hasPrice = Object.keys(allIn).length > 0;
    const goal = [...(candidate.rules?.goal || [])];
    const had = goal.includes("price");
    // Published medication attributes, not a price, support the form lane.
    // Insurance/geography and therapeutic intersections still apply unchanged.
    if (!hasPrice && candidate.source_clearance === true && (candidate.therapeutic_tags || []).length && !goal.includes('medication-form')) goal.push('medication-form');
    if (hasPrice && !had) {
      goal.push("price");
      priceLaneAdded.push(candidate.program_id);
    } else if (!hasPrice && had) {
      // Self-correcting: a provider whose pricing goes unavailable at the next
      // monthly refresh leaves the price lane on the next build, with no edit.
      goal.splice(goal.indexOf("price"), 1);
      priceLaneRemoved.push(candidate.program_id);
    }
    return {
      ...candidate,
      rules: { ...(candidate.rules || {}), goal: goal.sort() },
      all_in_6mo_usd: allIn,
      pricing_state: hasPrice ? "evidenced" : (entry ? "unavailable" : "not_in_matrix"),
      pricing_reason: hasPrice ? null : (entry?.unavailable_reason || 'No comparable cash schedule is attested by reviewed evidence. Matching uses supported non-price attributes, not an estimated cost.'),
    };
  });
  const cohortMin = cohortMinimums(Object.fromEntries(decorated.map((c) => [c.program_id, c.all_in_6mo_usd])));
  return {
    candidates: decorated,
    cohort_min_6mo_usd: cohortMin,
    price_lane_added: priceLaneAdded.sort(),
    price_lane_removed: priceLaneRemoved.sort(),
    priced_candidates: decorated.filter((c) => c.pricing_state === "evidenced").length,
  };
}
