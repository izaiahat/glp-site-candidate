// Tests for the 2026-08-18 quiz work: goal-aware ranking, the published-price
// tie-break, the self-correcting price lane, and the promise that no answer
// path ever hands the reader an unexplained blank.
//
// The heavy ones drive the BUILT page in jsdom rather than a re-implementation,
// because the thing that can silently rot is the inline runtime transcription of
// src/quiz-ranking.mjs - not the module the audit already calls directly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_IN_MONTHS,
  DEFAULT_PROFILE,
  GOAL_WEIGHT_PROFILES,
  allInCostByPreference,
  applyPricingToCandidates,
  cohortMinimums,
  orderCandidates,
  rankScore,
} from "../src/quiz-ranking.mjs";
import { evaluatePhase4Quiz } from "../src/quiz.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), "utf8"));
const built = await readFile(path.join(ROOT, "public/quiz/provider-fit/index.html"), "utf8");
const embedded = (id) => JSON.parse(
  new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(built)[1].replaceAll("\\u003c", "<"),
);
const CANDIDATES = embedded("candidate-data");
const RANKING = embedded("quiz-ranking");
const PHASE4 = embedded("phase4-quiz-data");
const CONFIG = await readJson("data/quiz-config.json");
const REGISTRY = await readJson("data/program-registry.json");
const MATRIX = await readJson("data/provider-pricing-matrix.json");
const SHIPPED_CONFIG = { ...CONFIG, candidates: CANDIDATES, ranking: { ...CONFIG.ranking, cohort_min_6mo_usd: RANKING.cohort_min_6mo_usd } };
const STATES = JSON.parse(await readFile(path.join(ROOT, "scripts/quiz-audit-states.json"), "utf8"));
const GOALS = [null, ...CONFIG.questions.find((q) => q.id === "goal").options.map((o) => o.value)];
// What the page actually RENDERS, not what the config lists: `retatrutide` is
// removed upstream by the consumer-availability authority gate in
// src/therapeutic-taxonomy.mjs, so a test that clicks it is testing a button
// that does not exist.
const OFFERED = (id) => [...built.matchAll(new RegExp(`data-question="${id}" data-value="([^"]+)"`, "g"))].map((m) => m[1]);
const PREFS = [null, ...OFFERED("medication_preference")];
const RESULT_COUNT = CONFIG.matching_policy.result_count;

function surviving(answers) {
  const preference = answers.medication_preference;
  return CANDIDATES.filter((candidate) => {
    if(answers.goal==='price' && !(Number.isFinite(candidate.all_in_6mo_usd?.[preference && preference!=='not_sure'?preference:'any'])&&candidate.all_in_6mo_usd[preference && preference!=='not_sure'?preference:'any']>0)) return false;
    if (answers.state && (candidate.excluded_states || []).includes(answers.state)) return false;
    if (preference && preference !== "not_sure" && !(candidate.therapeutic_tags || []).includes(preference)) return false;
    return Object.entries(candidate.rules || {}).every(([question, allowed]) => !answers[question] || allowed.includes(answers[question]));
  });
}


// ---------------------------------------------------------------- all-in cost

test("all-in cost is month one plus five ongoing months, never a headline price", () => {
  const provider = {
    medications: [
      { medication_id: "compounded-semaglutide-injection", month_1_usd: 49, ongoing_usd: 349 },
      { medication_id: "compounded-tirzepatide-injection", month_1_usd: 199, ongoing_usd: 199 },
    ],
  };
  const costs = allInCostByPreference(provider);
  assert.equal(ALL_IN_MONTHS, 6);
  // The $49 intro is the cheaper headline and the more expensive year.
  assert.equal(costs.semaglutide, 49 + 5 * 349);
  assert.equal(costs.tirzepatide, 199 + 5 * 199);
  assert.equal(costs.any, 199 + 5 * 199, "the cheapest ALL-IN wins, not the cheapest first month");
});

test("a membership fee is never treated as a medication price", () => {
  const costs = allInCostByPreference({
    medications: [{ medication_id: "membership-only", month_1_usd: 49, ongoing_usd: 49 }],
  });
  assert.deepEqual(costs, {}, "a membership-only provider has no all-in medication cost");
});

test("a row missing either half of the price is not costed", () => {
  const costs = allInCostByPreference({
    medications: [{ medication_id: "compounded-semaglutide-injection", month_1_usd: 99, ongoing_usd: null }],
  });
  assert.deepEqual(costs, {});
});

// ------------------------------------------------------------ the price lane

test("the price lane is derived from published prices, and gives a provider back when pricing goes away", () => {
  const candidates = [
    { program_id: "priced", rules: { goal: ["medication-form", "prefer-not-to-say"] } },
    { program_id: "unpriced", rules: { goal: ["price", "prefer-not-to-say"] } },
  ];
  const matrix = {
    providers: {
      priced: { medications: [{ medication_id: "compounded-semaglutide-injection", month_1_usd: 99, ongoing_usd: 99 }] },
      unpriced: { medications: [], unavailable_reason: "the captured pages publish no attributable price" },
    },
  };
  const joined = applyPricingToCandidates(candidates, matrix);
  assert.deepEqual(joined.price_lane_added, ["priced"]);
  assert.deepEqual(joined.price_lane_removed, ["unpriced"], "a provider whose pricing goes unavailable must LEAVE the price lane on the next build");
  assert.ok(joined.candidates.find((c) => c.program_id === "priced").rules.goal.includes("price"));
  assert.ok(!joined.candidates.find((c) => c.program_id === "unpriced").rules.goal.includes("price"));
  assert.equal(joined.candidates.find((c) => c.program_id === "unpriced").pricing_state, "unavailable");
});

test("every shipped price-lane candidate publishes an evidenced price, and every priced candidate is in the lane", () => {
  for (const candidate of CANDIDATES) {
    const inLane = (candidate.rules?.goal || []).includes("price");
    const priced = candidate.pricing_state === "evidenced";
    assert.equal(inLane, priced, `${candidate.program_id}: price lane membership must equal published-price evidence`);
  }
  const unavailable = CANDIDATES.filter((c) => c.pricing_state !== "evidenced").map((c) => c.program_id);
  for (const id of unavailable) {
    const entry = MATRIX.providers[id];
    assert.ok(!entry || !(entry.medications || []).some((row) => row.medication_id !== "membership-only" && Number.isFinite(row.ongoing_usd)),
      `${id} is out of the price lane but the matrix holds a medication price for it`);
  }
});

// -------------------------------------------------------------------- weights

test("the default and coaching profiles are byte-identical to the comparison rubric", async () => {
  const { RUBRIC_WEIGHTS } = await import("../src/merit-ranking.mjs");
  assert.deepEqual({ ...DEFAULT_PROFILE }, { ...RUBRIC_WEIGHTS });
  assert.deepEqual({ ...GOAL_WEIGHT_PROFILES.coaching }, { ...RUBRIC_WEIGHTS },
    "coaching is deliberately not re-weighted; the rubric has no criterion that measures coaching");
});

test("weights never change eligibility - only the published rules do", () => {
  for (const goal of GOALS) {
    for (const preference of PREFS) {
      const answers = {};
      if (goal) answers.goal = goal;
      if (preference) answers.medication_preference = preference;
      const pool = surviving(answers);
      const ordered = orderCandidates(pool, goal, preference, RANKING.cohort_min_6mo_usd);
      assert.deepEqual(
        [...ordered].map((c) => c.program_id).sort(),
        [...pool].map((c) => c.program_id).sort(),
        "ranking must be a permutation of the eligible set",
      );
    }
  }
});

test("a provider with no published price scores zero on cost and keeps its other criteria", () => {
  const candidate = { program_id: "x", criteria_scores: { price_transparency: 80, medical_oversight: 60, insurance_support: 40, public_reviews: 0, shipping_transparency: 100 }, all_in_6mo_usd: {} };
  const priceScore = rankScore(candidate, "price", null, { any: 500 });
  const expected = Math.round((0 * 40 + 80 * 30 + 100 * 15 + 60 * 15) / 100);
  assert.equal(priceScore, expected);
  // Unchanged where cost is not part of the question.
  assert.equal(rankScore(candidate, "insurance-support", null, { any: 500 }), Math.round((40 * 45 + 60 * 25 + 80 * 15 + 100 * 15) / 100));
});

test("public_reviews leaves the denominator when no comparable dataset was verified", () => {
  const candidate = { program_id: "x", criteria_scores: { price_transparency: 100, medical_oversight: 100, insurance_support: 100, public_reviews: 0, shipping_transparency: 100 }, all_in_6mo_usd: {} };
  assert.equal(rankScore(candidate, null, null, {}), 100, "an unverifiable criterion must never drag a provider down");
});

test("the published-price tie-break decides before the alphabet", () => {
  const scores = { price_transparency: 75, medical_oversight: 75, insurance_support: 55, public_reviews: 0, shipping_transparency: 55 };
  const rows = [
    { program_id: "aardvark-rx", criteria_scores: scores, all_in_6mo_usd: { any: 1200 } },
    { program_id: "zebra-rx", criteria_scores: scores, all_in_6mo_usd: { any: 600 } },
  ];
  assert.deepEqual(orderCandidates(rows, null, null, { any: 600 }).map((r) => r.program_id), ["zebra-rx", "aardvark-rx"]);
});

test("cohort minimums come from the shipped candidates and match the shipped ranking block", () => {
  const derived = cohortMinimums(Object.fromEntries(CANDIDATES.map((c) => [c.program_id, c.all_in_6mo_usd])));
  assert.deepEqual(derived, RANKING.cohort_min_6mo_usd);
});

// --------------------------------------------------- the page's own transcription
//
// The retired jsdom walkthrough helpers (bootQuiz/completeNoUsePath) drove the removed
// pass-2 begin-button flow. The quiz now auto-initializes — position 0 shows on load with
// no start control — and its runtime ships as external /assets/quiz-page.js, which this
// jsdom boot never loads. The executable walkthrough of the served flow lives in
// tests/phase4-quiz-matches.test.mjs (renderQuiz + evaluated runtime) and
// tests/browser/phase4-quiz-matches.spec.mjs. The tests below read the page's embedded
// JSON payloads, which need no script execution.

test("the page's Phase 4 result sets agree with the governed ranking module for every state, drug, and goal", () => {
  const states = PHASE4.flow.jurisdictions.map((state) => state.code);
  const drugs = ["SEMAGLUTIDE", "TIRZEPATIDE"];
  const goals = ["price", "coaching", "medication-form"];
  assert.equal(Object.keys(PHASE4.result_sets).length, states.length * drugs.length * goals.length);
  for (const drug of drugs) {
    for (const state of states) {
      for (const goal of goals) {
        const key = `${drug}|${state}|${goal}`;
        const expected = evaluatePhase4Quiz(SHIPPED_CONFIG, { result_drug: drug, state, goal }, REGISTRY).map((candidate) => candidate.program_id);
        assert.deepEqual(PHASE4.result_sets[key], expected, `page ranking drifted for ${key}`);
      }
    }
  }
});

test("every shipped Phase 4 result row is bounded, unique, source-backed, and state-honest", () => {
  const eligible = new Set(CANDIDATES.filter((candidate) => candidate.source_clearance === true && candidate.staging_eligible === true).map((candidate) => candidate.program_id));
  for (const [key, ids] of Object.entries(PHASE4.result_sets)) {
    const state = key.split("|")[1];
    assert.ok(ids.length <= eligible.size, `${key}: canonical eligibility denominator exceeded`);
    const [drug,jurisdiction,goal]=key.split('|');
    const expected=surviving({state:jurisdiction,goal,insurance:'unsure',medication_preference:drug.toLowerCase()}).filter(c=>c.source_clearance===true && c.staging_eligible===true && c.glp_service_verified!==false).map(c=>c.program_id);
    assert.deepEqual([...ids].sort(),expected.sort(),`${key}: every independently filtered eligible identity must remain reachable`);
    assert.equal(new Set(ids).size, ids.length, `${key}: duplicate provider`);
    for (const id of ids) {
      assert.ok(eligible.has(id), `${key}: ${id} lacks source/staging clearance`);
      assert.ok(PHASE4.candidate_records[id], `${key}: ${id} lacks card metadata`);
      assert.equal((PHASE4.candidate_records[id].excluded_states || []).includes(state), false, `${key}: ${id} explicitly excludes ${state}`);
    }
  }
});

test("both compounded treatment families retain all source-backed Oregon matches", () => {
  for (const drug of ["SEMAGLUTIDE", "TIRZEPATIDE"]) {
    for (const goal of ["price", "coaching", "medication-form"]) {
      const ids = PHASE4.result_sets[`${drug}|OR|${goal}`];
      assert.ok(ids.length>0 && ids.length<=CANDIDATES.length, `${drug}/${goal}: invalid canonical count`);
      assert.equal(new Set(ids).size, ids.length, `${drug}/${goal}: duplicate card`);
      assert.ok(ids.every((id) => PHASE4.candidate_records[id]), `${drug}/${goal}: missing card metadata`);
    }
  }
});

test("price-path candidate records carry exact source-backed pricing metadata", () => {
  const drug = "TIRZEPATIDE";
  const ids = PHASE4.result_sets[`${drug}|FL|price`];
  assert.ok(ids.length>0 && ids.length<=CANDIDATES.length);
  for (const id of ids) {
    const price = PHASE4.candidate_records[id].pricing[drug];
    assert.ok(price, `${id}: price-ranked card lacks source-backed minimum`);
    assert.ok(Number.isFinite(price.amount), `${id}: amount missing`);
    assert.ok(price.cadence, `${id}: cadence missing`);
    assert.match(price.captured_on, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("the ranking payload the page executes is complete", () => {
  assert.equal(RANKING.schema, "glp-quiz-goal-weighted-ranking-v1");
  for (const goal of GOALS.filter(Boolean)) assert.ok(RANKING.profiles[goal], `no shipped profile for goal=${goal}`);
  assert.deepEqual(RANKING.default_profile, { ...DEFAULT_PROFILE });
  assert.ok(Number.isFinite(RANKING.cohort_min_6mo_usd.any));
  for (const candidate of CANDIDATES) {
    assert.ok(Number.isFinite(candidate.criteria_scores?.price_transparency), `${candidate.program_id} shipped without criteria scores`);
  }
  assert.ok(STATES.length >= 51);
});
