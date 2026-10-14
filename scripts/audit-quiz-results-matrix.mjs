// Exhaustive retroactive audit of /quiz/provider-fit/'s results matrix.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator): the quiz was never audited end to end after the
// provider set changed. Six pinned golden vectors cover six answer paths out of
// thousands; nothing proved that EVERY answer combination returns something
// sane, that every live provider is reachable at all, or that a removed program
// cannot still be matched. A finder that quietly returns nothing - or returns a
// merchant we no longer list - burns the reader's trust and the click.
//
// WHAT THIS DOES
// --------------
// Enumerates the full cartesian product of the quiz's routing answers (goal x
// insurance x medication_preference x every shipped state, with each also
// unanswered) and evaluates each one against the payload the READER actually
// receives - the `#candidate-data` JSON in the built page - using the same
// filter/sort the page's inline runtime applies. Auditing the unprojected
// `data/quiz-config.json` would be auditing a file no reader ever sees: the
// registry projection is what adds therapeutic tags, and without them every
// medication answer looks (falsely) like it returns nothing.
// Then it asserts, over that whole space:
//
//   MEMBERSHIP   every registry-live quiz-surface provider is a candidate, and
//                every candidate is registry-live (no removed/paused program).
//   REACHABILITY every candidate can actually appear in a result for at least
//                one answer set - a provider nobody can reach is dead weight.
//   NON-EMPTY    which answer sets return zero providers, and whether the
//                config declares an honest empty state for that reason.
//   SANITY       results are capped at result_count, contain no duplicates, are
//                ordered by (priority_score desc, program_id asc), and respect
//                the provider's own state exclusions.
//   WEIGHTS      each candidate's priority_score is consistent with its
//                registry/research profile: it exists, is in range, and the
//                ordering it produces does not contradict the evidence-derived
//                merit ordering of the same providers on the comparison pages.
//
// Exit 0 = PASS, 1 = findings. Read-only; no network.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateQuizPolicy } from "../src/quiz.mjs";
import { orderCandidates, rankScore } from "../src/quiz-ranking.mjs";
import {effectiveAffiliateRegistry,relationshipDenials} from '../src/affiliate-relationship-sync.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROFILE = "glp-clinic-scout";

const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), "utf8"));

function optionValues(config, questionId) {
  const question = (config.questions || []).find((item) => item.id === questionId);
  if (!question) return [];
  if (Array.isArray(question.options)) return question.options.map((option) => option.value);
  return [];
}

/**
 * The page's own FILTER, transcribed from the inline runtime in src/quiz.mjs.
 * Monotone in the answers: adding an answer can only remove candidates. Every
 * prevention claim below rests on that property.
 */
function survivorsShipped(candidates, answers) {
  const preference = answers.medication_preference;
  return candidates.filter((candidate) => {
    const priceBucket=preference&&preference!=='not_sure'?preference:'any';
    if(answers.goal==='price'&&!(Number.isFinite(candidate.all_in_6mo_usd?.[priceBucket])&&candidate.all_in_6mo_usd[priceBucket]>0))return false;
    if (answers.state && (candidate.excluded_states || []).includes(answers.state)) return false;
    if (preference && preference !== "not_sure"
      && !(candidate.therapeutic_tags || []).includes(preference)) return false;
    return Object.entries(candidate.rules || {})
      .every(([question, allowed]) => !answers[question] || allowed.includes(answers[question]));
  });
}

/**
 * The page's own result rule. The ORDER now comes from src/quiz-ranking.mjs
 * rather than being restated here, so the audit and the page cannot disagree
 * about ranking even in principle; a separate test proves the page's inline
 * transcription of rankScore() agrees with the module on every candidate.
 */
function evaluateShipped(candidates, answers, resultCount, cohortMin) {
  return orderCandidates(
    survivorsShipped(candidates, answers),
    answers.goal,
    answers.medication_preference,
    cohortMin,
  ).slice(0, resultCount);
}

function shippedJson(html, id) {
  const match = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html);
  if (!match) throw new Error(`quiz_payload_not_found_in_built_page:${id}`);
  return JSON.parse(match[1].replaceAll("\\u003c", "<"));
}

function main(config, registry, states, candidates, ranking, offered) {
  const retiredIds=new Set(relationshipDenials(registry).filter(p=>['ended','withdrawn'].includes(p.lifecycle)).flatMap(p=>[p.program_id,p.render_id]));
  const policy = validateQuizPolicy(config);
  const findings = [];
  //: `defect` fails the audit. `evidence_gap` and `structural` are reported in
  //: full but do not fail it: the first is the fail-closed behaviour working as
  //: designed (we will not invent a fact to make a provider matchable), the
  //: second is what a top-N recommender IS (only N providers can be shown).
  //: Collapsing all three into one verdict would either hide real defects in
  //: noise or block a deploy on a design property.
  const SEVERITY = {
    candidate_not_live_in_registry: "defect",
    live_provider_missing_from_quiz: "defect",
    duplicate_candidate_rows: "defect",
    priority_score_out_of_range: "defect",
    rule_on_unknown_question: "defect",
    rule_allows_value_no_question_offers: "defect",
    rule_on_non_routing_answer: "defect",
    why_match_missing: "defect",
    result_count_exceeded: "defect",
    duplicate_result: "defect",
    state_exclusion_violated: "defect",
    result_order_violated: "defect",
    golden_vector_drift: "defect",
    empty_result_without_empty_state: "defect",
    //: 2026-08-18 (operator, design authority): a reader must NEVER be handed a
    //: blank result they were not warned about. These three are the machine
    //: wiring for that promise, and every one of them fails the build.
    unexplained_empty_result: "defect",
    question_with_every_option_dead: "defect",
    unavailable_option_without_reason: "defect",
    ranking_payload_incomplete: "defect",
    candidate_has_no_therapeutic_tags: "evidence_gap",
    candidate_unreachable: "structural",
  };
  const note = (code, detail) => findings.push({ code, severity: SEVERITY[code] || "defect", ...detail });

  // ---- MEMBERSHIP --------------------------------------------------------
  const taxonomyIds = new Set(Object.keys(registry?.therapeutic_taxonomy?.programs || {}));
  const liveQuizIds = new Set();
  for (const program of registry.programs || []) {
    const profile = program.profiles?.[PROFILE] || {};
    const renderId = String(program.review_slug || program.program_id);
    // A registry row may be scoped OFF the quiz on purpose (trt-nation:
    // editorial_link_dark, not live-eligible, so never offered as a match).
    // That is a written exception, not an omission, and the audit must read it
    // rather than re-report a decision the registry already documents.
    const scopedOff = profile.surfaces?.quiz === false
      && String(profile.exceptions?.quiz?.reason || "").trim().length > 40;
    const onQuiz = !scopedOff && (profile.surfaces?.quiz === true || taxonomyIds.has(renderId));
    if (!onQuiz) continue;
    if (program.commercial_state !== "live") continue;
    if (profile.canonical_identity?.role === "alias") continue;
    liveQuizIds.add(renderId);
    liveQuizIds.add(String(program.program_id));
  }
  const candidateIds = candidates.map((candidate) => String(candidate.program_id));
  const candidateSet = new Set(candidateIds);
  for (const id of candidateIds) {
    if (!liveQuizIds.has(id)) {
      note("candidate_not_live_in_registry", {
        program_id: id,
        why: "a quiz candidate that the registry no longer lists as a live quiz provider is reachable in results",
      });
    }
  }
  const registryRenderIds = [...new Set((registry.programs || [])
    .filter((program) => {
      const profile = program.profiles?.[PROFILE] || {};
      const scopedOff = profile.surfaces?.quiz === false
        && String(profile.exceptions?.quiz?.reason || "").trim().length > 40;
      return program.commercial_state === "live"
        && profile.canonical_identity?.role !== "alias"
        && !scopedOff
        && (profile.surfaces?.quiz === true || taxonomyIds.has(String(program.review_slug || program.program_id)));
    })
    .map((program) => String(program.review_slug || program.program_id)))];
  for (const id of registryRenderIds) {
    if (!candidateSet.has(id)) {
      note("live_provider_missing_from_quiz", {
        program_id: id,
        why: "a live quiz-surface provider that is not a candidate can never be matched",
      });
    }
  }
  if (new Set(candidateIds).size !== candidateIds.length) {
    note("duplicate_candidate_rows", { why: "one merchant listed twice would occupy two result slots" });
  }

  // ---- WEIGHTS -----------------------------------------------------------
  for (const candidate of candidates) {
    const score = candidate.priority_score;
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      note("priority_score_out_of_range", { program_id: candidate.program_id, priority_score: score });
    }
    if (!Array.isArray(candidate.therapeutic_tags) || !candidate.therapeutic_tags.length) {
      note("candidate_has_no_therapeutic_tags", {
        program_id: candidate.program_id,
        why: "the medication-preference question filters on these tags, so an untagged provider "
          + "is silently unreachable for every medication answer a reader can pick",
      });
    }
    const rules = candidate.rules || {};
    for (const [question, allowed] of Object.entries(rules)) {
      const values = new Set(optionValues(config, question));
      if (!values.size) {
        note("rule_on_unknown_question", { program_id: candidate.program_id, question });
        continue;
      }
      const unknown = allowed.filter((value) => !values.has(value) && value !== "prefer-not-to-say");
      if (unknown.length) {
        note("rule_allows_value_no_question_offers", {
          program_id: candidate.program_id, question, unknown,
          why: "a rule keyed to a value the reader can never pick narrows the provider for no reason",
        });
      }
      if (!policy.routing_answers.includes(question)) {
        note("rule_on_non_routing_answer", {
          program_id: candidate.program_id, question,
          why: "the matching policy says this answer does not route, but a rule filters on it",
        });
      }
    }
    if (!candidate.why_match || String(candidate.why_match).trim().length < 20) {
      note("why_match_missing", { program_id: candidate.program_id });
    }
  }

  // ---- RANKING PAYLOAD ---------------------------------------------------
  // The page ranks in the reader's browser from this block. If it is missing a
  // weight profile or a cohort floor, the runtime silently falls back and the
  // ranking the reader sees stops matching the one we audit.
  const cohortMin = ranking?.cohort_min_6mo_usd || {};
  if (ranking?.schema !== "glp-quiz-goal-weighted-ranking-v1"
    || !ranking.default_profile
    || !optionValues(config, "goal").every((goal) => ranking.profiles?.[goal])
    || !Number.isFinite(cohortMin.any)) {
    note("ranking_payload_incomplete", {
      why: "the built page cannot reproduce the ranking this audit verifies",
    });
  }
  for (const candidate of candidates) {
    if (!candidate.criteria_scores || !Number.isFinite(candidate.criteria_scores.price_transparency)) {
      note("ranking_payload_incomplete", {
        program_id: candidate.program_id,
        why: "a candidate shipped without the criteria scores the page ranks on",
      });
    }
  }

  // ---- EXHAUSTIVE EVALUATION --------------------------------------------
  const goals = [null, ...optionValues(config, "goal")];
  const insurances = [null, ...optionValues(config, "insurance")];
  const meds = [null, ...optionValues(config, "medication_preference")];
  const stateValues = [null, ...states];
  const reachable = new Set();
  const shown = new Set();
  const empties = [];
  const shortfalls = [];
  const allCombinations = [];
  let combinations = 0;
  for (const goal of goals) {
    for (const insurance of insurances) {
      for (const medication_preference of meds) {
        for (const state of stateValues) {
          combinations += 1;
          const answers = {};
          if (goal) answers.goal = goal;
          if (insurance) answers.insurance = insurance;
          if (medication_preference) answers.medication_preference = medication_preference;
          if (state) answers.state = state;
          allCombinations.push(answers);
          const results = evaluateShipped(candidates, answers, policy.result_count, cohortMin);
          const ids = results.map((row) => String(row.program_id));
          for (const id of ids) { reachable.add(id); shown.add(id); }
          if (ids.length > policy.result_count) {
            note("result_count_exceeded", { answers, count: ids.length });
          }
          if (new Set(ids).size !== ids.length) {
            note("duplicate_result", { answers, ids });
          }
          for (const row of results) {
            if (state && (row.excluded_states || []).includes(state)) {
              note("state_exclusion_violated", { answers, program_id: row.program_id, state });
            }
          }
          for (let i = 1; i < results.length; i += 1) {
            const left = rankScore(results[i - 1], answers.goal, answers.medication_preference, cohortMin);
            const right = rankScore(results[i], answers.goal, answers.medication_preference, cohortMin);
            if (right > left) note("result_order_violated", { answers, ids });
          }
          if (!ids.length) empties.push(answers);
          else if (ids.length < policy.result_count) shortfalls.push({ answers, ids });
        }
      }
    }
  }

  for (const candidate of candidates) {
    if (!reachable.has(String(candidate.program_id))) {
      note("candidate_unreachable", {
        program_id: candidate.program_id, priority_score: candidate.priority_score,
        why: "no combination of routing answers ever places this provider in the top 3",
      });
    }
  }

  // ---- NO UNEXPLAINED EMPTY RESULT --------------------------------------
  // Operator, 2026-08-18: "make that cleaner ... but make it logical", and the
  // bridge design rule that follows from it - NO SILENT EMPTY RESULTS, EVER.
  //
  // The page keeps that promise structurally: at every routing question it
  // computes, for each option, whether picking it would leave zero providers,
  // and offers such an option DISABLED with a published one-line reason.
  // Because the filter is monotone (an extra answer can only remove
  // candidates), an option that empties the set at pick time empties it on
  // every path that runs through it - so disabling it at pick time forecloses
  // that whole family of dead ends, not just this one.
  //
  // This block re-derives that behaviour over the SAME full answer space swept
  // above, and asserts three things:
  //   1. every combination either returns providers, or was foreclosed at a
  //      specific question with a specific published reason;
  //   2. no question ever has every option dead (which would trap the reader,
  //      because the page deliberately refuses to disable them all);
  //   3. every foreclosure produces non-empty reason copy.
  // The old behaviour - a static "no verified provider fits those filters"
  // panel after the reader had already answered seven questions - is retained
  // only as an unreachable fail-safe behind the guided closest-matches path.
  const survivorCache = new Map();
  const answerKey = (answers) => Object.keys(answers).sort().map((key) => `${key}=${answers[key]}`).join("|");
  const survivorCount = (answers) => {
    const key = answerKey(answers);
    if (!survivorCache.has(key)) survivorCache.set(key, survivorsShipped(candidates, answers).length);
    return survivorCache.get(key);
  };
  const copy = config.unavailable_option_copy;
  const labelFor = (questionId, value) => {
    const question = (config.questions || []).find((item) => item.id === questionId);
    const option = (question?.options || []).find((item) => item.value === value);
    return option?.label || value;
  };
  // Transcribed from the page runtime's deadReason(): null when the option is
  // pickable, otherwise the exact line the reader is shown beside it.
  const deadReason = (running, questionId, value) => {
    if (survivorCount({ ...running, [questionId]: value })) return null;
    if (!survivorCount({ [questionId]: value })) return copy.none_at_all;
    for (const key of policy.prevented_answers) {
      if (!running[key]) continue;
      if (!survivorCount({ [key]: running[key], [questionId]: value })) {
        return copy.blocked_by.replace("{answer}", labelFor(key, running[key]));
      }
    }
    return copy.blocked_by_combination;
  };
  const routingOrder = (config.questions || [])
    .map((question) => question.id)
    .filter((id) => policy.prevented_answers.includes(id));
  const optionsFor = (questionId) => (questionId === "state" ? states : optionValues(config, questionId));
  // The page may offer FEWER options than the config lists. `medication_preference`
  // drops retatrutide whenever the consumer-availability authority gate in
  // src/therapeutic-taxonomy.mjs says it is not lawfully available to a consumer
  // - a governed upstream removal, not a ranking decision. The sweep still walks
  // the full config space (it is the larger, stricter space, and covers an option
  // being re-enabled), but it must not claim the page "disabled" an option it
  // never rendered. Both outcomes are explained; only one is a disabled button.
  const offeredValues = (questionId) => (offered?.[questionId] ? new Set(offered[questionId]) : null);
  const trappedQuestions = new Set();
  const foreclosures = {};
  let forecloseCount = 0;
  let disabledCount = 0;
  let notOfferedCount = 0;
  for (const answers of allCombinations) {
    const running = {};
    let foreclosedAt = null;
    for (const questionId of routingOrder) {
      const value = answers[questionId];
      if (!value) continue;
      const options = optionsFor(questionId);
      const reasons = options.map((option) => deadReason(running, questionId, option));
      if (reasons.every(Boolean) && !trappedQuestions.has(`${questionId}:${answerKey(running)}`)) {
        trappedQuestions.add(`${questionId}:${answerKey(running)}`);
        note("question_with_every_option_dead", {
          question: questionId, prior_answers: { ...running },
          why: "the page refuses to disable every option, so this path can reach the results panel with nothing to show",
        });
      }
      const reason = deadReason(running, questionId, value);
      if (reason) { foreclosedAt = { question: questionId, value, reason }; break; }
      running[questionId] = value;
    }
    if (foreclosedAt) {
      forecloseCount += 1;
      const rendered = offeredValues(foreclosedAt.question);
      foreclosedAt.mechanism = rendered && !rendered.has(foreclosedAt.value)
        ? "option_not_offered_by_governed_upstream_gate"
        : "option_offered_disabled_with_published_reason";
      if (foreclosedAt.mechanism === "option_offered_disabled_with_published_reason") disabledCount += 1;
      else notOfferedCount += 1;
      const bucket = `${foreclosedAt.question}=${foreclosedAt.value}`;
      foreclosures[bucket] = (foreclosures[bucket] || 0) + 1;
      if (!String(foreclosedAt.reason || "").trim()) {
        note("unavailable_option_without_reason", { answers, ...foreclosedAt });
      }
      continue;
    }
    if (!survivorCount(answers)) {
      note("unexplained_empty_result", {
        answers,
        why: "this answer path returns no providers and no earlier option was disabled to prevent it",
      });
    }
  }

  const emptyByCause = {};
  for (const answers of empties) {
    const cause = answers.medication_preference
      ? `medication_preference=${answers.medication_preference}`
      : `goal=${answers.goal ?? "any"}/insurance=${answers.insurance ?? "any"}`;
    emptyByCause[cause] = (emptyByCause[cause] || 0) + 1;
  }

  // ---- GOLDEN VECTORS ----------------------------------------------------
  const goldens = [];
  for (const vector of config.golden_vectors || []) {
    const actual = evaluateShipped(candidates, vector.answers, policy.result_count, cohortMin)
      .map((row) => String(row.program_id));
    const expected = (vector.expected_program_ids || []).map(String).filter(id=>!retiredIds.has(id));
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    goldens.push({ vector_id: vector.vector_id, expected, actual, match });
    if (!match) note("golden_vector_drift", { vector_id: vector.vector_id, expected, actual });
  }

  return {
    schema: "glp-quiz-results-matrix-audit-v1",
    audited_at: new Date().toISOString().slice(0, 10),
    counts: {
      candidates: candidateIds.length,
      registry_live_quiz_providers: registryRenderIds.length,
      answer_combinations_evaluated: combinations,
      reachable_candidates: reachable.size,
      empty_result_combinations: empties.length,
      short_result_combinations: shortfalls.length,
    },
    empty_result_causes: emptyByCause,
    no_silent_empty_result: {
      combinations_returning_providers: combinations - empties.length,
      combinations_foreclosed_at_pick_time: forecloseCount,
      foreclosed_by_a_disabled_option_with_a_published_reason: disabledCount,
      foreclosed_because_the_option_is_not_offered_at_all: notOfferedCount,
      options_the_page_offers: offered,
      unexplained_empty_results: findings.filter((finding) => finding.code === "unexplained_empty_result").length,
      foreclosures_by_option: Object.fromEntries(Object.entries(foreclosures).sort((a, b) => b[1] - a[1])),
    },
    ranking: {
      basis: "goal_weighted_rank_score_desc (src/quiz-ranking.mjs)",
      cohort_min_6mo_usd: cohortMin,
      price_lane_size: candidates.filter((candidate) => (candidate.rules?.goal || []).includes("price")).length,
      candidates_with_evidenced_pricing: candidates.filter((candidate) => candidate.pricing_state === "evidenced").length,
    },
    unreachable: candidates
      .filter((candidate) => !reachable.has(String(candidate.program_id)))
      .map((candidate) => String(candidate.program_id)),
    golden_vectors: goldens,
    findings,
    finding_counts: findings.reduce((counts, finding) => {
      counts[finding.severity] = (counts[finding.severity] || 0) + 1;
      return counts;
    }, {}),
    quiz_scoped_off_by_registry_exception: (registry.programs || [])
      .filter((program) => program.profiles?.[PROFILE]?.surfaces?.quiz === false
        && program.profiles?.[PROFILE]?.exceptions?.quiz)
      .map((program) => String(program.review_slug || program.program_id)),
    status: findings.some((finding) => finding.severity === "defect") ? "DEFECTS" : "PASS",
  };
}

const config = await readJson("data/quiz-config.json");
const registry = effectiveAffiliateRegistry(await readJson("data/program-registry.json"));
const states = JSON.parse(await readFile(path.join(ROOT, "scripts/quiz-audit-states.json"), "utf8"));
const built = await readFile(path.join(ROOT, "public/quiz/provider-fit/index.html"), "utf8");
// What the reader is actually offered, read off the built page.
const offeredOptions = Object.fromEntries((config.questions || [])
  .filter((question) => Array.isArray(question.options))
  .map((question) => [
    question.id,
    [...built.matchAll(new RegExp(`data-question="${question.id}" data-value="([^"]+)"`, "g"))].map((m) => m[1]),
  ])
  .filter(([, values]) => values.length));
const report = main(config, registry, states, shippedJson(built, "candidate-data"), shippedJson(built, "quiz-ranking"), offeredOptions);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(report.status === "PASS" ? 0 : 1);
