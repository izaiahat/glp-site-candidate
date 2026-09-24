import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveIdentityGroups } from "../../src/provider-identity.mjs";
import { validateProviderDynamicProfiles, comparablePriceProviderIds } from "../../src/provider-dynamic-profiles.mjs";
import { projectProviderDisplayLedger, projectProviderDisplayFacts } from "../../src/provider-display-evidence.mjs";
import { isComparableCashRow } from "../../src/price-state.mjs";
import { evaluatePhase4Quiz } from "../../src/quiz.mjs";
import { projectMoneyPagesFromRegistry, projectQuizFromRegistry } from "../../src/program-registry.mjs";
import { projectTherapeuticSurfaces } from "../../src/therapeutic-taxonomy.mjs";
import { applyMeritScores, meritScore } from "../../src/merit-ranking.mjs";
import { ALL_IN_MONTHS, applyPricingToCandidates } from "../../src/quiz-ranking.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8"));
const profileId = "glp-clinic-scout";
const registry = read("program-registry.json");
const matrix = read("provider-pricing-matrix.json");
const graph = read("phase3-page-graph.json");
const ledger = read("program-content-ledger.json").programs.map((entry) => projectProviderDisplayLedger(entry));
const facts = read("provider-facts-backfill-20260830.json").programs.map((entry) => projectProviderDisplayFacts(entry));
assert.equal(registry.schema, "site-program-registry-v1");

function exactIds(ids, label) {
  assert.ok(ids.length > 0, `${label}:empty`);
  assert.ok(ids.every((id) => typeof id === "string" && /^[a-z0-9-]+$/.test(id)), `${label}:identity`);
  assert.equal(new Set(ids).size, ids.length, `${label}:duplicate`);
  return ids.sort();
}

// phase3Registry (src/phase3-page-graph.mjs:823-843) excludes identity-only
// aliases before adding unbound work-order profiles. No browser output is read.
const identityOnlyAliases = new Set(registry.programs.filter((program) => {
  const profile = program.profiles?.[profileId];
  return profile?.canonical_identity?.role === "alias"
    && profile?.surfaces?.review === false && profile?.surfaces?.sitemap === false;
}).map((program) => program.program_id));
const programs = registry.programs.filter((program) => !identityOnlyAliases.has(program.program_id));
for (const addition of graph.provider_work_order_additions || []) {
  assert.ok(addition.program_id && addition.display_name && addition.governance_source);
  assert.equal(addition.commercial_facts_status, "unbound");
  if (!identityOnlyAliases.has(addition.program_id) && !programs.some((program) => program.program_id === addition.program_id)) programs.push(addition);
}
const { aliasIds } = deriveIdentityGroups({ ...registry, programs }, profileId, ledger);
const byLedger = new Map(ledger.map((entry) => [entry.program_id, entry]));
const byFacts = new Map(facts.map((entry) => [entry.program_id, entry]));
const reported = (row) => row?.status === "SOURCE_REPORTED" && Boolean(String(row.value || "").trim()) && Boolean(row.source_url) && Boolean(row.capture_date);
const qualified = (id) => {
  const research = byFacts.get(id);
  const entry = byLedger.get(id);
  return Boolean(research?.display_name && entry?.meds_offered && entry?.source_url
    && reported(research.facts?.total_monthly_cost) && reported(research.facts?.cancellation));
};
export const directoryProviderIds = exactIds(programs.filter((program) => {
  const profile = program.profiles?.[profileId];
  return program.commercial_state === "live" && profile?.vertical_fit === true
    && profile?.wired === true && profile?.surfaces?.review === true && !aliasIds.has(program.program_id);
}).flatMap((program) => {
  const renderId = program.review_slug || program.program_id;
  const cardId = qualified(renderId) ? renderId : program.program_id;
  return qualified(cardId) ? [cardId] : [];
}), "directory");

// The current matrix-bound calculator admits exact comparable cash rows,
// not every historical, typed-display-only, held, or alias matrix entry.
const dynamic = validateProviderDynamicProfiles(registry, profileId, {
  asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
});
const calculatorAllowed = new Set(registry.programs
  .filter((program) => program.profiles?.[profileId]?.surfaces?.calculator === true)
  .map((program) => String(program.review_slug || program.program_id)));
export const calculatorProviderIds = exactIds(dynamic.canonicalIds
  .filter((id) => calculatorAllowed.has(String(id))
    && (matrix.providers[id]?.medications || []).some(isComparableCashRow)), "calculator");

export function expectedQuizIds(drug, state, goal = "medication-form") {
  // Match the registered build's source stage, never its emitted result IDs.
  const sourceLedger = read("program-content-ledger.json");
  const comparablePriceIds = comparablePriceProviderIds(registry, profileId, {
    asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
  });
  applyMeritScores(sourceLedger.programs, { comparablePriceIds });
  for (const program of sourceLedger.programs) {
    const score = meritScore(program);
    if (score === null) throw new Error(`merit_score_underivable:${program.program_id}`);
    program.score = score;
  }
  const pages = projectMoneyPagesFromRegistry(registry, profileId, read("money-page-specs.json").pages, sourceLedger.programs);
  const canonicalQuiz = projectQuizFromRegistry(registry, profileId, read("quiz-config.json"), sourceLedger);
  const base = projectTherapeuticSurfaces({ registry, profileId, pages, quizConfig: canonicalQuiz }).quizConfig;
  const scores = new Map(sourceLedger.programs.map((program) => [program.program_id, program]));
  const withCriteria = (base.candidates || []).map((candidate) => {
    const entry = scores.get(candidate.program_id);
    if (!entry?.criteria_scores) throw new Error(`quiz_candidate_criteria_scores_missing:${candidate.program_id}`);
    const priced = matrix.providers?.[candidate.program_id] || null;
    return {
      ...candidate,
      criteria_scores: entry.criteria_scores,
      pricing_checked_on: (priced?.medications || []).map((row) => row.captured_on).sort().at(-1) || null,
    };
  });
  const joined = applyPricingToCandidates(withCriteria, matrix);
  const config = {
    ...base,
    candidates: joined.candidates,
    ranking: {
      schema: "glp-quiz-goal-weighted-ranking-v1",
      cohort_min_6mo_usd: joined.cohort_min_6mo_usd,
      all_in_months: ALL_IN_MONTHS,
      all_in_label: `Lowest published ${ALL_IN_MONTHS}-month all-in`,
      pricing_matrix_captured_on: matrix.captured_on,
    },
  };
  assert.equal(config.matching_policy.result_count, "all_eligible");
  const ids = evaluatePhase4Quiz(config, { result_drug: drug, state, goal }, registry, profileId).map((candidate) => candidate.program_id);
  assert.ok(ids.length > 0, "quiz:empty");
  assert.ok(ids.every((id) => typeof id === "string" && /^[a-z0-9-]+$/.test(id)), "quiz:identity");
  assert.equal(new Set(ids).size, ids.length, "quiz:duplicate");
  return ids;
}
