import { buildPhase4PageData, validatePhase4Flow } from "./quiz.mjs";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function resolveCompactMatcherOutcome(config, answers = {}) {
  const flow = validatePhase4Flow(config);
  const option = flow.compact_matcher.medication_options.find((item) => item.value === answers.medication);
  if (!option) throw new Error("matches_medication_required");
  const state = String(answers.state || "").toUpperCase();
  if (!flow.jurisdictions.some((item) => item.code === state)) throw new Error("matches_state_required");
  if (option.route) return { kind: "brand", route: option.route, state, family: option.family, drug: option.drug, form: option.form };
  return { kind: "compounded", drug: option.family, state, dose: String(answers.dose || "") };
}

export function compactExploreUrl({ state, drug, dose = "" }) {
  const query = new URLSearchParams({ state, drug, form: "COMPOUNDED", sort: "cheapest" });
  if (dose && !["New Patient", "Not Sure"].includes(dose)) query.set("dose", dose);
  return `/providers/?${query.toString()}`;
}

export function renderMatchesCustomized(config, registry = null, profileId = "glp-clinic-scout", providerLogos = null) {
  const flow = validatePhase4Flow(config);
  const pageData = buildPhase4PageData(config, registry, profileId, providerLogos);
  const compact = flow.compact_matcher;
  const medicationOptions = compact.medication_options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join("");
  const stateOptions = flow.jurisdictions.map((state) => `<option value="${esc(state.code)}">${esc(state.name)}</option>`).join("");

  const matcherData = {
    schema: "glp-phase4-compact-matcher-data-v1",
    flow: pageData.flow,
    result_count: pageData.result_count,
    candidate_records: pageData.candidate_records,
    result_sets: pageData.result_sets,
  };
  return `<!doctype html><html lang="en" data-release="release-ready"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow,max-image-preview:large"><title>Customized provider matches · Clinic Scout</title><meta name="description" content="Compare a compact shortlist from Clinic Scout by state and treatment."><link rel="canonical" href="https://glpclinicscout.com/matches/customized/"><script src="/assets/matches-customized.js" defer></script></head><body data-page="matches-customized"><main class="qm-shell" data-compact-matcher><header class="qm-intro"><p class="gcs-kicker">A faster comparison</p><h1>Find providers for the treatment you want to compare.</h1><p>Choose a medication, state, and optional dose. Compare providers listed by Clinic Scout, with unknown availability, pricing, reviews, and feature support clearly marked.</p></header><form class="qm-form" data-matches-form action="/providers/" method="get" novalidate><div class="qm-grid"><label>Medication<select name="drug" data-matches-medication required aria-describedby="qm-medication-help"><option value="">Select a medication</option>${medicationOptions}</select></label><label>State or jurisdiction<select name="state" data-matches-state required><option value="">Choose your state or jurisdiction</option>${stateOptions}</select></label></div><p id="qm-medication-help" class="qz-help">Changing medication clears the dose because each medication family has a different published dose vocabulary.</p><label>Dose (optional)<select name="dose" data-matches-dose disabled><option value="">Choose a medication first</option></select></label><label>${esc(flow.contact.email_label)}<input name="email" type="email" autocomplete="email" inputmode="email" data-matches-email aria-describedby="qm-email-note"></label><p id="qm-email-note" class="qz-help">Blank is accepted. If supplied, only the email address is sent to Clinic Scout's first-party newsletter endpoint and is never shared with a provider.</p><p class="qm-error" data-matches-error role="alert"></p><p data-newsletter-status role="status" aria-live="polite"></p><div class="qm-actions"><button class="begin" type="submit" data-search-providers>Search providers</button><p>Want a more personalized comparison? <a data-full-quiz-link href="/quiz/provider-fit/">Take the full quiz</a>.</p></div></form><section class="qz-result-shell qm-results" data-matches-results aria-labelledby="qm-results-title"><p class="gcs-kicker">Your Top Picks</p><h2 id="qm-results-title">Provider records to compare</h2><p class="affiliate-note">Clinic Scout may earn a commission from affiliate links. Commissions never change our scores, rankings, or your match.</p><p data-result-summary>Select a treatment and state to scope the shortlist.</p><p data-result-newsletter-status role="status" aria-live="polite"></p><div class="qz-results" data-result-cards></div><div class="qz-empty" data-result-empty><h3>No exact source-backed match yet</h3><p>Clinic Scout will not invent fit or availability. Explore the complete comparison with compatible state and treatment filters preserved.</p></div><details class="qz-method"><summary>Learn more about top picks</summary><p>These cards follow the same rules as the full provider-fit quiz for sources, commercial eligibility, treatment information, ranking and published costs, including a consistent order when providers tie. No health-history answer, patient rating, affiliate relationship, or optional email changes the order.</p><p><a href="/how-we-rate/">Read the ranking methodology</a> and <a href="/how-we-make-money/">affiliate disclosure</a>.</p></details><p><a class="begin" data-explore-providers href="/providers/">Explore All Providers</a></p></section><noscript><section class="qz-noscript"><h2>Compare without the compact matcher</h2><p>The form remains available as a standard provider-directory search. For brand-specific pages, use the owned medication routes below.</p><ul><li><a href="/ozempic/">Ozempic</a></li><li><a href="/wegovy/">Wegovy</a></li><li><a href="/wegovy-pill/">Wegovy Pill</a></li><li><a href="/mounjaro/">Mounjaro</a></li><li><a href="/zepbound/">Zepbound</a></li></ul></section></noscript></main><script type="application/json" id="phase4-matches-data">${scriptJson(matcherData)}</script></body></html>`;
}
