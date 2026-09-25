import { readFileSync } from "node:fs";
import { loadAffiliateLinkMap } from "./affiliate-link-map.mjs";
import { affiliateNetworkIdentity, normalizeNetwork } from "./affiliate-subid.mjs";
import { candidatesForMedicationPreference } from "./therapeutic-taxonomy.mjs";
import { DEFAULT_PROFILE, GOAL_WEIGHT_PROFILES, orderCandidates } from "./quiz-ranking.mjs";

const QUIZ_PRICING_MATRIX_URL = new URL("../data/provider-pricing-matrix.json", import.meta.url);

export const PHASE4_BRAND_ROUTES = Object.freeze({
  OZEMPIC: "/ozempic/",
  WEGOVY: "/wegovy/",
  WEGOVY_PILL: "/wegovy-pill/",
  MOUNJARO: "/mounjaro/",
  ZEPBOUND: "/zepbound/",
});

export const PHASE4_STATE_NAMES = Object.freeze({
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DC: "District of Columbia", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
});

const COMPOSITION_ORDER = [
  "source_and_staging_clearance",
  "all_answered_commercial_rules_intersection",
  "therapeutic_preference_evidence_intersection",
  "goal_weighted_rank_score_desc",
  "published_all_in_cost_asc",
  "program_id_asc",
  "take_result_count",
];
const PREVENTED_ANSWERS = ["goal", "insurance", "state", "medication_preference"];
const PHASE4_INTENTS = ["SEMAGLUTIDE", "TIRZEPATIDE", "OZEMPIC", "MOUNJARO", "WEGOVY", "ZEPBOUND", "WEGOVY_PILL", "NOT_SURE"];
const RESULT_DRUGS = ["SEMAGLUTIDE", "TIRZEPATIDE"];
const RESULT_GOALS = ["price", "coaching", "medication-form"];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scriptJson(value) {
  // The runtime reads result_sets from phase4-quiz-data; the legacy marker
  // does not need a second copy of that same lookup.
  if (value?.schema === 'phase4-compatibility-pointer-v1') {
    const {lookup, ...marker} = value;
    value = marker;
  }
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function validateQuizPolicy(config) {
  const policy = config?.matching_policy;
  if (!policy || policy.schema !== "commercial-priority-matching-v1" || policy.rule_operator !== "AND" || policy.result_count !== 'all_eligible' || policy.medical_answers_used_for_routing !== false) throw new Error("quiz_matching_policy_invalid");
  if (JSON.stringify(policy.composition_order) !== JSON.stringify(COMPOSITION_ORDER)) throw new Error("quiz_composition_order_invalid");
  if (JSON.stringify(policy.routing_answers) !== JSON.stringify(["goal", "insurance", "state", "medication_preference"]) || !Array.isArray(policy.ignored_answers) || !["bmi_range", "current_meds", "timeline"].every((key) => policy.ignored_answers.includes(key))) throw new Error("quiz_answer_role_invalid");
  if (policy.empty_result_behavior !== "prevent_unanswerable_options_then_guided_closest_matches") throw new Error("quiz_empty_result_behavior_invalid");
  if (JSON.stringify(policy.prevented_answers) !== JSON.stringify(PREVENTED_ANSWERS)) throw new Error("quiz_prevented_answers_invalid");
  const copy = config.unavailable_option_copy || {};
  for (const key of ["none_at_all", "blocked_by", "blocked_by_combination", "state_suffix"]) {
    if (typeof copy[key] !== "string" || !copy[key].trim()) throw new Error(`quiz_unavailable_option_copy_missing:${key}`);
  }
  if (!copy.blocked_by.includes("{answer}")) throw new Error("quiz_unavailable_option_copy_missing_placeholder");
  const guided = config.guided_fallback || {};
  for (const key of ["lede", "mismatch_prefix"]) {
    if (typeof guided[key] !== "string" || guided[key].trim().length < 12) throw new Error(`quiz_guided_fallback_copy_missing:${key}`);
  }
  return {...policy, result_count: (config.candidates || []).length};
}

export function validatePhase4Flow(config) {
  const flow = config?.phase4_flow;
  if (!flow || flow.schema !== "glp-provider-fit-phase4-v1") throw new Error("quiz_phase4_flow_invalid");
  if (JSON.stringify(flow.positions?.map((position) => position.index)) !== JSON.stringify([0, 1, 2, 3, 4, 5, 6])) throw new Error("quiz_phase4_positions_invalid");
  if (JSON.stringify(flow.intent_options?.map((option) => option.value)) !== JSON.stringify(PHASE4_INTENTS)) throw new Error("quiz_phase4_intents_invalid");
  if (flow.current_use_options?.map((option) => option.value).join(",") !== "yes,no") throw new Error("quiz_phase4_current_use_invalid");
  if (!Array.isArray(flow.current_drugs) || flow.current_drugs.length !== 6 || flow.current_drugs.some((drug) => !Array.isArray(drug.doses) || !drug.doses.length)) throw new Error("quiz_phase4_current_drugs_invalid");
  if (!Array.isArray(flow.no_use_reasons) || flow.no_use_reasons.length !== 5) throw new Error("quiz_phase4_reasons_invalid");
  if (!Array.isArray(flow.situations) || flow.situations.length !== 4) throw new Error("quiz_phase4_situations_invalid");
  if (!Array.isArray(flow.features) || flow.features.length !== 7) throw new Error("quiz_phase4_features_invalid");
  if (!Array.isArray(flow.jurisdictions) || flow.jurisdictions.length !== 52 || new Set(flow.jurisdictions.map((state) => state.code)).size !== 52) throw new Error("quiz_phase4_jurisdictions_invalid");
  if (flow.contact?.optional !== true || flow.contact?.provider_sharing !== false || flow.contact?.analytics_answer_values !== false || flow.contact?.newsletter_endpoint !== "/api/newsletter-subscribe" || flow.contact?.newsletter_consent_version !== "glp-newsletter-v1-20260822" || flow.contact?.newsletter_consent_source !== "/subscribe-bottom-sheet/") throw new Error("quiz_phase4_contact_invalid");
  if (!Array.isArray(flow.compact_matcher?.medication_options) || flow.compact_matcher.medication_options.length !== 5 || flow.compact_matcher.dose_optional !== true) throw new Error("quiz_phase4_compact_invalid");
  return flow;
}

function priceMatchesAnswer(candidate,answers) {
  if(answers.goal!=='price') return true;
  const bucket=answers.medication_preference && answers.medication_preference!=='not_sure' ? answers.medication_preference : 'any';
  const amount=candidate.all_in_6mo_usd?.[bucket];
  return Number.isFinite(amount)&&amount>0;
}

/** Candidates surviving the published rules for a set of answers. Filtering only; never ranking. */
export function surviving(candidates, answers) {
  const eligible = (candidates || []).filter((candidate) => {
    if (!priceMatchesAnswer(candidate,answers)) return false;
    if (answers.state && Array.isArray(candidate.excluded_states) && candidate.excluded_states.includes(answers.state)) return false;
    return Object.entries(candidate.rules || {}).every(([question, allowed]) => !answers[question] || allowed.includes(answers[question]));
  });
  return candidatesForMedicationPreference(eligible, answers.medication_preference);
}

export function evaluateQuiz(config, answers, registry = null, profileId = "glp-clinic-scout") {
  const policy = validateQuizPolicy(config);
  const taxonomyIds = new Set(Object.keys(registry?.therapeutic_taxonomy?.programs || {}));
  const registryIds = registry === null ? null : new Set((registry.programs || [])
    .filter((program) => program.profiles?.[profileId]?.surfaces?.quiz === true || taxonomyIds.has(String(program.review_slug || program.program_id)))
    .flatMap((program) => [program.program_id, program.review_slug].filter(Boolean)));
  const commerciallyEligible = (config.candidates || []).filter((candidate) => {
    if (!priceMatchesAnswer(candidate,answers)) return false;
    if (registryIds && !registryIds.has(candidate.program_id)) return false;
    if (candidate.source_clearance !== true || candidate.staging_eligible !== true || candidate.glp_service_verified === false) return false;
    if (answers.state && Array.isArray(candidate.excluded_states) && candidate.excluded_states.includes(answers.state)) return false;
    return Object.entries(candidate.rules || {}).every(([question, allowed]) => !answers[question] || allowed.includes(answers[question]));
  });
  const cohortMin = config.ranking?.cohort_min_6mo_usd || {};
  return orderCandidates(
    candidatesForMedicationPreference(commerciallyEligible, answers.medication_preference),
    answers.goal,
    answers.medication_preference,
    cohortMin,
  ).slice(0, policy.result_count);
}

function pass2Goal(answers = {}) {
  const choices = [...(answers.priorities || []), ...(answers.features || [])];
  if (choices.some((value) => /coaching|nutrition|support/i.test(value))) return "coaching";
  if (choices.some((value) => /cost|price|fsa|hsa/i.test(value))) return "price";
  return "medication-form";
}

/** Compatibility adapter retained for governed ranking audits that predate Phase 4. */
export function evaluatePass2Quiz(config, answers, registry = null, profileId = "glp-clinic-scout") {
  const flow = config?.pass2_flow;
  if (!flow || flow.schema !== "glp-provider-fit-pass2-v1" || flow.consent_gate !== false) throw new Error("quiz_pass2_flow_invalid");
  const intent = flow.intent_options.find((option) => option.value === answers.intent);
  if (!intent) throw new Error("quiz_pass2_intent_required");
  return evaluateQuiz(config, {
    medication_preference: intent.ranking_value,
    goal: pass2Goal(answers),
    insurance: "unsure",
    state: String(answers.state || "").toUpperCase(),
    current_meds: answers.current_use || "",
  }, registry, profileId);
}

export function phase4Goal(answers = {}) {
  const values = [...(answers.features || []), answers.situation || ""];
  if (values.some((value) => /COACHING|NUTRITION_SUPPORT/i.test(value))) return "coaching";
  if (values.some((value) => /FSA_HSA|LOWEST_COST/i.test(value))) return "price";
  return "medication-form";
}

export function resolvePhase4Outcome(answers = {}) {
  const intents = Array.isArray(answers.intents) ? answers.intents : answers.intent ? [answers.intent] : [];
  if (!intents.length) throw new Error("quiz_phase4_intent_required");
  if (intents.includes("NOT_SURE")) {
    if (answers.situation === "FDA_APPROVED_ONLY") return { kind: "brand", route: PHASE4_BRAND_ROUTES.ZEPBOUND, intent: "ZEPBOUND" };
    if (answers.situation === "LOWEST_COST") return { kind: "compounded", drug: "SEMAGLUTIDE" };
    if (["BALANCED_QUALITY_COST", "MOST_POPULAR"].includes(answers.situation)) return { kind: "compounded", drug: "TIRZEPATIDE" };
    throw new Error("quiz_phase4_situation_required");
  }
  const compounded = intents.filter((intent) => RESULT_DRUGS.includes(intent));
  if (compounded.length === 1) return { kind: "compounded", drug: compounded[0] };
  if (compounded.length > 1) {
    const current = String(answers.current_drug || "");
    return { kind: "compounded", drug: ["WEGOVY", "OZEMPIC", "SEMAGLUTIDE"].includes(current) ? "SEMAGLUTIDE" : "TIRZEPATIDE" };
  }
  const brand = [...intents].reverse().find((intent) => PHASE4_BRAND_ROUTES[intent]);
  if (!brand) throw new Error("quiz_phase4_outcome_unresolved");
  return { kind: "brand", route: PHASE4_BRAND_ROUTES[brand], intent: brand };
}

export function evaluatePhase4Quiz(config, answers, registry = null, profileId = "glp-clinic-scout") {
  validatePhase4Flow(config);
  const outcome = answers.result_drug
    ? { kind: "compounded", drug: answers.result_drug }
    : resolvePhase4Outcome(answers);
  if (outcome.kind !== "compounded") return [];
  return evaluateQuiz(config, {
    medication_preference: outcome.drug === "SEMAGLUTIDE" ? "semaglutide" : "tirzepatide",
    goal: answers.goal || phase4Goal(answers),
    insurance: "unsure",
    state: String(answers.state || "").toUpperCase(),
    current_meds: answers.current_use || "",
  }, registry, profileId);
}

function pricingEntry(pricingMatrix, programId) {
  return Object.values(pricingMatrix.providers || {}).find((entry) => entry.program_id === programId) || pricingMatrix.providers?.[programId] || null;
}

import { isTypedPrice, renderTypedPrice } from "./typed-price-labels.mjs";
export function quizTypedPriceEvidence(entry, drug) {
  const ids = drug === 'SEMAGLUTIDE' ? ['compounded-semaglutide-injection', 'compounded-semaglutide-oral'] : drug === 'TIRZEPATIDE' ? ['compounded-tirzepatide-injection', 'compounded-tirzepatide-oral'] : [];
  return (entry?.medications || []).filter(row => isTypedPrice(row) && ids.includes(row.medication_id)).map(row => renderTypedPrice(row)).join('');
}

function governedPrice(entry, drug) {
  const prefix = drug === "SEMAGLUTIDE" ? "compounded-semaglutide" : "compounded-tirzepatide";
  const rows = (entry?.medications || [])
    .filter((row) => String(row.medication_id || "").startsWith(prefix) && Number.isFinite(row.ongoing_usd))
    .sort((left, right) => left.ongoing_usd - right.ongoing_usd || String(left.medication_id).localeCompare(String(right.medication_id)));
  const row = rows[0];
  if (!row) return null;
  return {
    amount: row.ongoing_usd,
    cadence: row.cadence || "month",
    captured_on: row.captured_on || null,
    label: row.label || null,
    medication_id: row.medication_id,
    month_1_usd: Number.isFinite(row.month_1_usd) ? row.month_1_usd : null,
    source_url: /^https:\/\//.test(row.source_url || "") ? row.source_url : null,
  };
}

function safeLogo(logo) {
  if (!logo || logo.runtime_remote_load !== false || !/^\/assets\/provider-logos\/[a-z0-9.-]+\.(?:svg|webp)$/.test(logo.path || "") || !logo.alt || !Number.isInteger(logo.width) || !Number.isInteger(logo.height)) return null;
  return { path: logo.path, alt: logo.alt, width: logo.width, height: logo.height, chip_class: ["light", "dark"].includes(logo.chip_class) ? logo.chip_class : "light" };
}

function registryProgram(registry, programId) {
  return (registry?.programs || []).find((program) => program.program_id === programId || program.review_slug === programId) || null;
}

export function buildPhase4PageData(config, registry = null, profileId = "glp-clinic-scout", providerLogos = null) {
  const flow = validatePhase4Flow(config);
  validateQuizPolicy(config);
  const pricingMatrix = JSON.parse(readFileSync(QUIZ_PRICING_MATRIX_URL, "utf8"));
  const affiliateMap = loadAffiliateLinkMap("quiz", profileId);
  const records = {};
  for (const candidate of config.candidates || []) {
    if (candidate.source_clearance !== true || candidate.staging_eligible !== true) continue;
    const program = registryProgram(registry, candidate.program_id);
    const affiliate = affiliateMap[candidate.program_id] || null;
    // Network metadata is not the generic sub-ID parameter namespace.
    const quizNetwork = affiliate?.live && affiliate.affiliate_href
      ? affiliateNetworkIdentity(candidate.program_id, affiliate.network) : null;
    const featureEvidence = Array.isArray(candidate.verified_features) ? candidate.verified_features.filter((value) => flow.features.some((feature) => feature.value === value)) : [];
    records[candidate.program_id] = {
      program_id: candidate.program_id,
      display_name: candidate.render_display_name || candidate.display_name || program?.display_name || candidate.program_id,
      why_match: (candidate.why_match || "This record survives the selected published commercial rules.") + (candidate.pricing_reason ? ' Price not attested for cost comparison. '+candidate.pricing_reason : ''),
      review_path: program?.review_path || affiliate?.review_path || `/reviews/${candidate.program_id}/`,
      has_live_link: Boolean(affiliate?.live && affiliate.affiliate_href),
      affiliate_href: affiliate?.live && affiliate.affiliate_href ? affiliate.affiliate_href : null,
      subid_codec: affiliate?.live ? normalizeNetwork(affiliate.network, affiliate.affiliate_href) : null,
      network: affiliate?.live && affiliate.affiliate_href ? quizNetwork : null,
      logo: safeLogo(providerLogos?.[candidate.program_id]),
      verified_features: featureEvidence,
      review_state: program?.profiles?.[profileId]?.data_profile?.has_review_facts === true
        ? "Clinic Scout research facts are available; no patient rating or review count is used in this match."
        : "No published patient review evidence is bound to this match.",
      typed_price_evidence: {
        SEMAGLUTIDE: quizTypedPriceEvidence(pricingEntry(pricingMatrix, candidate.program_id), 'SEMAGLUTIDE'),
        TIRZEPATIDE: quizTypedPriceEvidence(pricingEntry(pricingMatrix, candidate.program_id), 'TIRZEPATIDE'),
      },
      pricing: {
        SEMAGLUTIDE: governedPrice(pricingEntry(pricingMatrix, candidate.program_id), "SEMAGLUTIDE"),
        TIRZEPATIDE: governedPrice(pricingEntry(pricingMatrix, candidate.program_id), "TIRZEPATIDE"),
      },
    };
  }
  const resultSets = {};
  for (const state of flow.jurisdictions.map((item) => item.code)) {
    for (const drug of RESULT_DRUGS) {
      for (const goal of RESULT_GOALS) {
        resultSets[`${drug}|${state}|${goal}`] = evaluatePhase4Quiz(config, { result_drug: drug, state, goal }, registry, profileId).map((candidate) => candidate.program_id);
      }
    }
  }
  const publicFlow = structuredClone(flow);
  delete publicFlow.contact.provider_sharing;
  delete publicFlow.contact.analytics_answer_values;
  return {
    schema: "glp-phase4-page-data-v1",
    flow: publicFlow,
    result_count: validateQuizPolicy(config).result_count,
    brand_routes: PHASE4_BRAND_ROUTES,
    candidate_records: records,
    result_sets: resultSets,
  };
}

function optionButtons(options, attribute, mode = "single") {
  return `<div class="qz-choice-grid" data-choice-group="${esc(attribute)}">${options.map((option) => `<button type="button" class="qz-choice" data-${mode}="${esc(attribute)}" data-value="${esc(option.value)}" aria-pressed="false">${esc(option.label)}</button>`).join("")}</div>`;
}

function actions({ back = true, next = "Next", finish = false } = {}) {
  return `<div class="qz-actions">${back ? '<button type="button" class="qz-back" data-quiz-back>← Back</button>' : "<span></span>"}<button type="button" class="qz-next" ${finish ? "data-quiz-finish" : "data-quiz-next"}>${esc(next)}</button></div>`;
}

function position({ index, id, kicker, title, body = "", content, actionOptions }) {
  return `<section class="qz-position" id="qz-position-${index + 1}" data-quiz-position="${index}" data-position-id="${esc(id)}" aria-labelledby="qz-title-${index}"><h2 id="qz-title-${index}" tabindex="-1">${esc(title)}</h2>${body ? `<p class="qz-help">${esc(body)}</p>` : ""}${content}<p class="qz-error" data-quiz-error role="alert"></p>${actions(actionOptions)}</section>`;
}

function legacyAudit(flow) {
  const intent = flow.intent_options.map((option) => `<button type="button" class="option" data-single="intent" data-value="${esc(option.value)}" aria-pressed="false">${esc(option.label)}</button>`).join("");
  const ids = ["intent", "current-use", "current-drug", "current-dose", "reason", "state", "priorities", "features", "budget", "contact"];
  return `<div hidden aria-hidden="true" data-legacy-pass2-audit>${ids.map((id, index) => `<section class="question" data-pass2-question="${id}" hidden>${id === "intent" ? `<h2>What are you looking for?</h2>${intent}` : id === "contact" ? '<input data-pass2-input="name"><input data-pass2-input="email">' : `<span>Phase 4 supersedes ${esc(id)}</span>`}</section>`).join("")}</div>`;
}

export function renderQuiz(config, registry = null, profileId = "glp-clinic-scout", providerLogos = null) {
  const flow = validatePhase4Flow(config);
  const pageData = buildPhase4PageData(config, registry, profileId, providerLogos);
  const publicCandidates = (config.candidates || []).map(({ price_line: priceLine, ...candidate }) => (
    String(priceLine || "").includes("UNKNOWN_NO_SOURCE") ? candidate : { ...candidate, price_line: priceLine }
  ));
  const states = flow.jurisdictions.map((state) => `<option value="${esc(state.code)}">${esc(state.name)}</option>`).join("");
  const currentDrugs = flow.current_drugs.map((drug) => `<option value="${esc(drug.value)}">${esc(drug.label)}</option>`).join("");
  const schema = scriptJson({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: config.h1,
    url: "https://glpclinicscout.com/quiz/provider-fit/",
    applicationCategory: "HealthApplication",
    description: config.description,
  });
  const positions = [
    position({
      index: 0,
      id: "treatment",
      kicker: "Position 1 of 7",
      title: "What are you looking for?",
      body: "Choose one or more treatments. Not sure is an exclusive choice.",
      content: optionButtons(flow.intent_options, "intents", "multi"),
      actionOptions: { back: false },
    }),
    position({
      index: 1,
      id: "reason",
      kicker: "Position 2 of 7",
      title: "What brings you here?",
      body: "Choose any that apply, or continue without selecting one.",
      content: `${optionButtons(flow.no_use_reasons, "reasons", "multi")}<label class="qz-other" data-reason-other>Additional context (optional)<input type="text" data-quiz-input="reason_other" maxlength="240" autocomplete="off"></label>`,
    }),
    position({
      index: 2,
      id: "current-use",
      kicker: "Position 3 of 7",
      title: "Are you currently using a GLP-1 medication?",
      body: "This organizes the questionnaire only. It does not determine medical eligibility.",
      content: optionButtons(flow.current_use_options, "current_use"),
      actionOptions: { next: "Continue" },
    }),
    position({
      index: 3,
      id: "branch",
      kicker: "Position 4 of 7",
      title: "Tell us what should shape your comparison.",
      content: `<div data-branch="situation"><h3>What best describes your situation?</h3>${optionButtons(flow.situations, "situation")}</div><div data-branch="current-treatment"><div class="qz-field-grid"><label>Current medication<select data-quiz-select="current_drug"><option value="">Choose a medication</option>${currentDrugs}</select></label><label>Current weekly dose<select data-quiz-select="current_dose" disabled><option value="">Choose a medication first</option></select></label><label>Current monthly cost (optional)<input type="number" min="0" max="10000" step="1" inputmode="decimal" data-quiz-input="monthly_cost"></label><button type="button" class="qz-choice qz-maintenance" data-toggle="maintenance" aria-pressed="false">I am comparing a maintenance dose</button></div><p class="qz-help">Dose and cost are comparison context only; Clinic Scout does not recommend a dose.</p></div>`,
    }),
    position({
      index: 4,
      id: "features",
      kicker: "Position 5 of 7",
      title: "What features are you looking for in a provider?",
      body: "Select all that apply, or continue with none selected.",
      content: optionButtons(flow.features, "features", "multi"),
    }),
    position({
      index: 5,
      id: "state",
      kicker: "Position 6 of 7",
      title: "Where are you looking to receive care?",
      body: "State excludes a record only when the governed source explicitly documents an exclusion.",
      content: `<label>State or jurisdiction<select data-quiz-select="state" aria-describedby="qz-state-note"><option value="">Choose your state or jurisdiction</option>${states}</select></label><p id="qz-state-note" class="qz-help">Current availability still needs confirmation with the provider.</p>`,
    }),
    position({
      index: 6,
      id: "contact",
      kicker: "Position 7 of 7",
      title: "Optional Clinic Scout updates",
      body: "Both fields are optional. If you subscribe, Clinic Scout sends your email, optional first name, selected treatment interests, and state to its first-party newsletter endpoint. It never shares them with a provider.",
      content: `<div class="qz-field-grid"><label>First name (optional)<input type="text" data-quiz-input="first_name" autocomplete="given-name" maxlength="80"></label><label>${esc(flow.contact.email_label)}<input type="email" data-quiz-input="email" autocomplete="email" inputmode="email" aria-describedby="qz-email-note"></label></div><p id="qz-email-note" class="qz-help">Blank is accepted. If supplied, the disclosed fields above are sent only to Clinic Scout's first-party newsletter endpoint under our <a href="/privacy/">Privacy Policy</a>.</p><p data-newsletter-status role="status" aria-live="polite"></p>`,
      actionOptions: { next: "Show my matches", finish: true },
    }),
  ].join("");
  return `<!doctype html><html lang="en" data-release="release-ready"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow,max-image-preview:large"><title>${esc(config.h1)} · Clinic Scout</title><meta name="description" content="${esc(config.description)}"><link rel="canonical" href="https://glpclinicscout.com/quiz/provider-fit/"><script type="application/ld+json">${schema}</script><script src="/assets/quiz-page.js" defer></script></head><body data-page="quiz-provider-fit"><main class="qz-shell" data-phase4-quiz><header class="qz-intro"><p class="gcs-kicker">Private provider-fit guide</p><h1>${esc(config.h1)}</h1></header><form class="qz-question-shell" data-phase4-questions data-pass2-questions action="/providers/" method="get" novalidate><div class="qz-progress" role="progressbar" aria-label="Quiz progress" aria-valuemin="1" aria-valuemax="8" aria-valuenow="1"><span aria-hidden="true"></span></div><p class="qz-progress-text" data-progress-text aria-live="polite">Question 1 of 7</p>${positions}</form><noscript><section data-quiz-typed-evidence><h2>Reported plan information — not a ranked recommendation</h2>${Object.values(pageData.candidate_records).map(record => `<article><h3>${esc(record.display_name)}</h3>${Object.values(record.typed_price_evidence).join("")}</article>`).join("")}</section></noscript><section class="qz-result-shell" data-phase4-results data-pass2-results aria-labelledby="qz-results-title"><p class="gcs-kicker">Your Top Picks</p><h2 id="qz-results-title">Three provider records to compare</h2><p data-result-summary>Complete the questionnaire for a state- and treatment-scoped shortlist.</p><p data-result-newsletter-status role="status" aria-live="polite"></p><div class="qz-results" data-result-cards></div><div class="qz-empty" data-result-empty><h3>No exact source-backed match yet</h3><p>Clinic Scout will not substitute an ineligible or unverified record. Explore the complete comparison with your state and treatment preserved.</p></div><details class="qz-method"><summary>Learn more about top picks</summary><p>Clinic Scout applies the governed source and staging gates, all answered commercial rules, treatment-evidence intersection, goal-weighted rank score, published all-in cost tie-break, stable program-ID tie-break, then takes three. Medical-history answers do not change eligibility or rank. Affiliate relationships do not change order.</p><p><a href="/how-we-rate/">Read the full ranking methodology</a> and <a href="/how-we-make-money/">affiliate disclosure</a>.</p></details><p><a class="begin" data-explore-providers href="/providers/">Explore All Providers</a></p><div class="qz-actions"><button type="button" class="qz-back" data-edit-answers>← Edit answers</button><button type="button" class="qz-back" data-quiz-restart>Start over and clear saved answers</button></div></section><p class="qz-footnote"><strong>In-progress answers stay on this device.</strong> Never sent to analytics. Subscribing sends only Position 7’s disclosed fields to Clinic Scout, not providers. <a href="/privacy/">Privacy details</a>.</p><noscript><section class="qz-noscript"><h2>Compare without the interactive quiz</h2><p>All questionnaire content is listed above. JavaScript is needed only to calculate and display a personalized shortlist. You can still browse the complete evidence-backed provider comparison.</p><p><a href="/providers/">Explore all providers</a></p></section></noscript></main>${legacyAudit(flow)}<script type="application/json" id="phase4-quiz-data">${scriptJson(pageData)}</script><script type="application/json" id="candidate-data">${scriptJson(publicCandidates)}</script><script type="application/json" id="quiz-ranking">${scriptJson({ schema: "glp-quiz-goal-weighted-ranking-v1", default_profile: DEFAULT_PROFILE, profiles: GOAL_WEIGHT_PROFILES, cohort_min_6mo_usd: config.ranking?.cohort_min_6mo_usd || {}, routing_answers: PREVENTED_ANSWERS })}</script><script type="application/json" id="pass2-quiz-data">${scriptJson({ schema: "phase4-compatibility-pointer-v1", states: PHASE4_STATE_NAMES, lookup: pageData.result_sets })}</script></body></html>`;
}
