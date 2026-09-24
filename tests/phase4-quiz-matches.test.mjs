import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  PHASE4_BRAND_ROUTES,
  buildPhase4PageData,
  evaluatePhase4Quiz,
  renderQuiz,
  resolvePhase4Outcome,
  validatePhase4Flow,
} from "../src/quiz.mjs";
import {
  compactExploreUrl,
  renderMatchesCustomized,
  resolveCompactMatcherOutcome,
} from "../src/matches-customized.mjs";

const config = JSON.parse(readFileSync(new URL("../data/quiz-config.json", import.meta.url), "utf8"));
const quizRuntime = readFileSync(new URL("../assets/quiz-page.js", import.meta.url), "utf8");
const matchesRuntime = readFileSync(new URL("../assets/matches-customized.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/css-src/55-quiz.css", import.meta.url), "utf8");

function fixtureConfig() {
  const fixture = structuredClone(config);
  fixture.candidates = ["alpha", "bravo", "charlie", "held"].map((programId, index) => ({
    program_id: programId,
    display_name: programId[0].toUpperCase() + programId.slice(1),
    source_clearance: programId !== "held",
    staging_eligible: true,
    therapeutic_tags: ["semaglutide", "tirzepatide", "injectable"],
    criteria_scores: {
      price_transparency: 90 - index,
      medical_oversight: 80,
      insurance_support: 70,
      public_reviews: 0,
      shipping_transparency: 75,
    },
    all_in_6mo_usd: { semaglutide: 900 + index, tirzepatide: 1200 + index, any: 900 + index },
    rules: {
      goal: ["price", "coaching", "medication-form", "prefer-not-to-say"],
      insurance: ["unsure"],
    },
    why_match: `${programId} survives the fixture's published commercial rules.`,
  }));
  fixture.ranking = { ...fixture.ranking, cohort_min_6mo_usd: { semaglutide: 900, tirzepatide: 1200, any: 900 } };
  return fixture;
}

function boot(html, runtime, fetchImpl = async () => ({ ok: true }), { url = "https://glpclinicscout.com/", seed = [] } = {}) {
  const writes = [];
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url,
    beforeParse(window) {
      for (const { store, key, value } of seed) window[store].setItem(key, value);
      const setItem = window.Storage.prototype.setItem;
      window.Storage.prototype.setItem = function (key, value) {
        writes.push({ store: this === window.localStorage ? "localStorage" : "sessionStorage", key, value });
        return setItem.call(this, key, value);
      };
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.fetch = fetchImpl;
      // jsdom ships no matchMedia; the runtime reads prefers-reduced-motion in show().
      // Match "reduce" so position transitions take the instant, synchronous path —
      // the same contract the browser suite pins via reducedMotion: "reduce".
      window.matchMedia = (media) => ({
        matches: media.includes("prefers-reduced-motion"),
        media,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      });
    },
  });
  dom.window.eval(runtime);
  dom.quizStorageWrites = writes;
  return dom;
}

function assertNoSavedQuiz(dom) {
  for (const store of ["localStorage", "sessionStorage"]) {
    for (const key of ["gcs.quiz.provider-fit.preferences.v1", "gcs.quiz.provider-fit.progress.v1"]) {
      assert.equal(dom.window[store].getItem(key), null, `${store}:${key}`);
    }
  }
  for (const { store, key, value } of dom.quizStorageWrites) {
    assert.equal(store, "sessionStorage");
    assert.equal(key, "gcs.quiz.newsletter-status.v1", "no answer or derived-match write, even if later cleared");
    const status = JSON.parse(value);
    assert.deepEqual(Object.keys(status).sort(), ["saved_at", "status"]);
    assert.ok(["saved", "failed"].includes(status.status));
    assert.ok(Number.isFinite(status.saved_at));
  }
}

function assertFreshQuiz(dom) {
  const { document } = dom.window;
  assert.equal(currentPosition(document), 0);
  assert.equal(document.querySelectorAll("[data-quiz-position]:not([hidden])").length, 1);
  assert.equal(document.querySelector('[data-quiz-position="0"] [data-quiz-next]').dataset.armed, "false");
  assert.equal(document.querySelectorAll('[data-multi][aria-pressed="true"]').length, 0);
  for (const name of ["reason_other", "monthly_cost", "email", "first_name"]) {
    assert.equal(document.querySelector(`[data-quiz-input="${name}"]`).value, "");
  }
  assert.equal(document.querySelector('[data-quiz-select="state"]').value, "");
  assert.equal(document.querySelector("[data-reason-other]").hidden, true);
  assert.equal(document.querySelector("[data-phase4-results]").hidden, true);
  assertNoSavedQuiz(dom);
}

function change(dom, selector, value) {
  const control = dom.window.document.querySelector(selector);
  assert.ok(control, `missing control: ${selector}`);
  control.value = value;
  control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  return control;
}

function click(dom, selector) {
  const control = dom.window.document.querySelector(selector);
  assert.ok(control, `missing control: ${selector}`);
  control.click();
  return control;
}

function currentPosition(document) {
  return Number([...document.querySelectorAll("[data-quiz-position]")].find((position) => !position.hidden)?.dataset.quizPosition);
}

test("Phase 4 config pins seven physical positions, every branch inventory, and all 52 jurisdictions", () => {
  const flow = validatePhase4Flow(config);
  assert.deepEqual(flow.positions.map((position) => position.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(flow.intent_options.map((option) => option.value), [
    "SEMAGLUTIDE", "TIRZEPATIDE", "OZEMPIC", "MOUNJARO", "WEGOVY", "ZEPBOUND", "WEGOVY_PILL", "NOT_SURE",
  ]);
  assert.equal(flow.current_drugs.length, 6);
  assert.deepEqual(flow.current_drugs.find((drug) => drug.value === "SEMAGLUTIDE").doses, ["Microdosing", "0.25", "0.5", "1", "1.7", "2.4", "Other"]);
  assert.deepEqual(flow.current_drugs.find((drug) => drug.value === "TIRZEPATIDE").doses, ["Microdosing", "2.5", "5", "7.5", "10", "12.5", "15", "Other"]);
  assert.equal(flow.no_use_reasons.length, 5);
  assert.equal(flow.situations.length, 4);
  assert.equal(flow.features.length, 7);
  assert.equal(flow.jurisdictions.length, 52);
  assert.equal(new Set(flow.jurisdictions.map((state) => state.code)).size, 52);
  assert.ok(flow.jurisdictions.some((state) => state.code === "DC"));
  assert.ok(flow.jurisdictions.some((state) => state.code === "PR"));
  assert.equal(flow.contact.optional, true);
  assert.equal(flow.contact.provider_sharing, false);
  assert.equal(flow.contact.analytics_answer_values, false);
  assert.equal(flow.contact.newsletter_endpoint, "/api/newsletter-subscribe");
  assert.equal(flow.compact_matcher.medication_options.length, 5);
  assert.equal(flow.compact_matcher.dose_optional, true);
});

test("Phase 4 route equivalence keeps brand pages owned and compounded tie-breaks deterministic", () => {
  for (const [intent, route] of Object.entries(PHASE4_BRAND_ROUTES)) {
    assert.deepEqual(resolvePhase4Outcome({ intents: [intent] }), { kind: "brand", route, intent });
  }
  assert.deepEqual(resolvePhase4Outcome({ intents: ["NOT_SURE"], situation: "FDA_APPROVED_ONLY" }), { kind: "brand", route: "/zepbound/", intent: "ZEPBOUND" });
  assert.deepEqual(resolvePhase4Outcome({ intents: ["NOT_SURE"], situation: "LOWEST_COST" }), { kind: "compounded", drug: "SEMAGLUTIDE" });
  assert.deepEqual(resolvePhase4Outcome({ intents: ["NOT_SURE"], situation: "BALANCED_QUALITY_COST" }), { kind: "compounded", drug: "TIRZEPATIDE" });
  assert.deepEqual(resolvePhase4Outcome({ intents: ["SEMAGLUTIDE", "TIRZEPATIDE"], current_use: "no" }), { kind: "compounded", drug: "TIRZEPATIDE" });
  assert.deepEqual(resolvePhase4Outcome({ intents: ["SEMAGLUTIDE", "TIRZEPATIDE"], current_use: "yes", current_drug: "WEGOVY" }), { kind: "compounded", drug: "SEMAGLUTIDE" });

  assert.deepEqual(resolveCompactMatcherOutcome(config, { medication: "OZEMPIC_WEGOVY", state: "OR" }), { kind: "brand", route: "/ozempic/", state: "OR", family: "SEMAGLUTIDE", drug: "OZEMPIC", form: "BRAND_NAME" });
  assert.deepEqual(resolveCompactMatcherOutcome(config, { medication: "MOUNJARO_ZEPBOUND", state: "CA" }), { kind: "brand", route: "/mounjaro/", state: "CA", family: "TIRZEPATIDE", drug: "MOUNJARO", form: "BRAND_NAME" });
  assert.deepEqual(resolveCompactMatcherOutcome(config, { medication: "WEGOVY_PILL", state: "WA" }), { kind: "brand", route: "/wegovy-pill/", state: "WA", family: "SEMAGLUTIDE", drug: "WEGOVY_PILL", form: "COMPOUNDED" });
  assert.deepEqual(resolveCompactMatcherOutcome(config, { medication: "SEMAGLUTIDE", state: "OR", dose: "1" }), { kind: "compounded", drug: "SEMAGLUTIDE", state: "OR", dose: "1" });
  assert.equal(compactExploreUrl({ state: "OR", drug: "SEMAGLUTIDE", dose: "1" }), "/providers/?state=OR&drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest&dose=1");
});

test("governed evaluation returns exactly three eligible records and explicit empty sets", () => {
  const fixture = fixtureConfig();
  const matches = evaluatePhase4Quiz(fixture, { result_drug: "SEMAGLUTIDE", state: "OR", goal: "price" });
  assert.deepEqual(matches.map((candidate) => candidate.program_id), ["alpha", "bravo", "charlie"]);
  assert.equal(matches.some((candidate) => candidate.program_id === "held"), false);

  fixture.candidates = fixture.candidates.map((candidate) => ({ ...candidate, excluded_states: ["PR"] }));
  assert.deepEqual(evaluatePhase4Quiz(fixture, { result_drug: "TIRZEPATIDE", state: "PR", goal: "medication-form" }), []);
  const pageData = buildPhase4PageData(fixture);
  assert.equal(pageData.result_sets["SEMAGLUTIDE|OR|price"].length, 3);
  assert.deepEqual(pageData.result_sets["TIRZEPATIDE|PR|medication-form"], []);
});

test("completed preferences and progress are cleared, never serialized", () => {
  assert.match(quizRuntime, /gcs\.quiz\.provider-fit\.preferences\.v1/);
  assert.match(quizRuntime, /function saveCompletedPreferences\(\)/);
  const completedWriter = quizRuntime.slice(
    quizRuntime.indexOf("function saveCompletedPreferences"),
    quizRuntime.indexOf("/* Design pass", quizRuntime.indexOf("function saveCompletedPreferences")),
  );
  assert.match(completedWriter, /clearSavedQuiz\(\)/);
  assert.doesNotMatch(completedWriter, /answers|email|first_name|setItem|matches\s*:/);
  const html = renderQuiz(fixtureConfig());
  for (const savedAt of [Date.now(), Date.now() - 31 * 86400000, Date.now() + 86400000, null]) {
    const value = savedAt === null ? "{" : JSON.stringify({
      schema: "gcs-quiz-provider-fit-progress-v1", saved_at: savedAt,
      completed: true, position: 5, result_drug: "SEMAGLUTIDE",
      answers: { intents: ["SEMAGLUTIDE"], state: "OR", reason_other: "private reason", monthly_cost: "425" },
    });
    const seed = ["localStorage", "sessionStorage"].flatMap((store) => [
      { store, key: "gcs.quiz.provider-fit.progress.v1", value },
      { store, key: "gcs.quiz.provider-fit.preferences.v1", value: savedAt === null ? "{" : JSON.stringify({
        schema: "gcs-quiz-provider-fit-preferences-v1", saved_at: savedAt, matches: ["alpha", "bravo", "charlie"],
      }) },
    ]);
    const dom = boot(html, quizRuntime, undefined, { seed });
    assertFreshQuiz(dom);
    dom.window.close();
  }
});

test("in-progress answers survive live Back and state re-arms Next, but a fresh document starts empty", () => {
  const html = renderQuiz(fixtureConfig());
  const first = boot(html, quizRuntime);
  click(first, '[data-multi="intents"][data-value="SEMAGLUTIDE"]');
  click(first, '[data-quiz-position="0"] [data-quiz-next]');
  click(first, '[data-single="current_use"][data-value="no"]');
  click(first, '[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]');
  documentInput(first, '[data-quiz-input="reason_other"]', "Insurance coverage changed");
  click(first, '[data-quiz-position="1"] [data-quiz-next]');
  click(first, '[data-multi="features"][data-value="FSA_HSA"]');
  click(first, '[data-quiz-position="4"] [data-quiz-next]');
  change(first, '[data-quiz-select="state"]', "OR");
  click(first, '[data-quiz-position="5"] [data-quiz-back]');
  assert.equal(currentPosition(first.window.document), 4);
  assert.equal(first.window.document.querySelector('[data-multi="features"][data-value="FSA_HSA"]').getAttribute("aria-pressed"), "true");
  click(first, '[data-quiz-position="4"] [data-quiz-back]');
  assert.equal(currentPosition(first.window.document), 1);
  assert.equal(first.window.document.querySelector('[data-quiz-input="reason_other"]').value, "Insurance coverage changed");
  assert.equal(first.window.document.querySelector("[data-reason-other]").hidden, false);
  click(first, '[data-quiz-position="1"] [data-quiz-next]');
  click(first, '[data-quiz-position="4"] [data-quiz-next]');
  assert.equal(currentPosition(first.window.document), 5);
  assert.equal(first.window.document.querySelector('[data-quiz-select="state"]').value, "OR");
  assert.equal(first.window.document.querySelector('[data-quiz-position="5"] [data-quiz-next]').dataset.armed, "true");
  assertNoSavedQuiz(first);
  first.window.close();
  const second = boot(html, quizRuntime);
  assertFreshQuiz(second);
  second.window.close();
});

test("current-treatment dose and monthly cost survive live Back without storing contact fields", () => {
  const html = renderQuiz(fixtureConfig());
  const first = boot(html, quizRuntime);
  click(first, '[data-multi="intents"][data-value="SEMAGLUTIDE"]');
  click(first, '[data-quiz-position="0"] [data-quiz-next]');
  click(first, '[data-single="current_use"][data-value="yes"]');
  change(first, '[data-quiz-select="current_drug"]', "SEMAGLUTIDE");
  change(first, '[data-quiz-select="current_dose"]', "1");
  documentInput(first, '[data-quiz-input="monthly_cost"]', "425");
  documentInput(first, '[data-quiz-input="email"]', "reader@example.test");
  documentInput(first, '[data-quiz-input="first_name"]', "Reader");
  click(first, '[data-quiz-position="3"] [data-quiz-next]');
  click(first, '[data-quiz-position="4"] [data-quiz-back]');
  assert.equal(currentPosition(first.window.document), 3);
  assert.equal(first.window.document.querySelector('[data-quiz-select="current_dose"]').value, "1");
  assert.equal(first.window.document.querySelector('[data-quiz-input="monthly_cost"]').value, "425");
  assertNoSavedQuiz(first);
  first.window.close();
  const second = boot(html, quizRuntime);
  assertFreshQuiz(second);
  second.window.close();
});

test("source renderers expose all essential no-JS content and the exclusive runtime hooks", () => {
  const fixture = fixtureConfig();
  const quizHtml = renderQuiz(fixture);
  const quizDom = new JSDOM(quizHtml);
  const quizDocument = quizDom.window.document;
  assert.equal(quizDocument.querySelectorAll("[data-quiz-position]").length, 7);
  assert.ok([...quizDocument.querySelectorAll("[data-quiz-position]")].every((position) => !position.hasAttribute("hidden")));
  assert.equal(quizDocument.querySelector("[data-phase4-results]").hasAttribute("hidden"), false);
  assert.match(quizHtml, /\/assets\/quiz-page\.js/);
  assert.match(quizHtml, /data-quiz-select="current_drug"/);
  assert.match(quizHtml, /data-quiz-select="current_dose"/);
  assert.match(quizHtml, /Current monthly cost \(optional\)/);
  assert.match(quizHtml, /data-newsletter-status/);
  assert.match(quizHtml, /<p class="qz-footnote"><strong>In-progress answers stay on this device\.<\/strong>/);
  assert.match(quizHtml, /Never sent to analytics/);
  assert.match(quizHtml, /selected treatment interests, and state to its first-party newsletter endpoint/);
  assert.doesNotMatch(quizHtml, /First name remains local to this page|only the email address is sent/);
  const embeddedQuizData = JSON.parse(quizDocument.querySelector("#phase4-quiz-data").textContent);
  assert.equal(config.phase4_flow.contact.provider_sharing, false);
  assert.equal(config.phase4_flow.contact.analytics_answer_values, false);
  assert.equal("provider_sharing" in embeddedQuizData.flow.contact, false);
  assert.equal("analytics_answer_values" in embeddedQuizData.flow.contact, false);

  const matchesHtml = renderMatchesCustomized(fixture);
  const matchesDom = new JSDOM(matchesHtml);
  assert.equal(matchesDom.window.document.querySelector("[data-matches-results]").hasAttribute("hidden"), false);
  assert.match(matchesHtml, /\/assets\/matches-customized\.js/);
  assert.match(matchesHtml, /Search providers/);
  assert.match(matchesHtml, /Take the full quiz/);
  assert.match(matchesHtml, /Dose \(optional\)/);
  assert.match(matchesHtml, /never shared with a provider/);
  const initialDose = matchesDom.window.document.querySelector("[data-matches-dose]");
  assert.equal(initialDose.disabled, true);
  assert.deepEqual([...initialDose.options].map((option) => option.textContent), ["Choose a medication first"]);

  assert.match(css, /qz-result-confirm 180ms ease-out/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /transition:\s*(?:all|width|height|margin|padding)/);
  quizDom.window.close();
  matchesDom.window.close();
});

test("full quiz No branch retains Back and the canonical results document retains all fixture cards", () => {
  const dom = boot(renderQuiz(fixtureConfig()), quizRuntime);
  const { document } = dom.window;
  assert.equal(currentPosition(document), 0);
  assert.equal(document.querySelectorAll("[data-quiz-position]:not([hidden])").length, 1);

  click(dom, '[data-multi="intents"][data-value="TIRZEPATIDE"]');
  click(dom, '[data-quiz-position="0"] [data-quiz-next]');
  assert.equal(currentPosition(document), 2);
  click(dom, '[data-single="current_use"][data-value="no"]');
  assert.equal(currentPosition(document), 1);
  click(dom, '[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]');
  assert.equal(document.querySelector("[data-reason-other]").hidden, false);
  click(dom, '[data-quiz-position="1"] [data-quiz-next]');
  assert.equal(currentPosition(document), 4);
  click(dom, '[data-multi="features"][data-value="FSA_HSA"]');
  click(dom, '[data-quiz-position="4"] [data-quiz-back]');
  assert.equal(currentPosition(document), 1);
  assert.equal(document.querySelector('[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]').getAttribute("aria-pressed"), "true");
  click(dom, '[data-quiz-position="1"] [data-quiz-next]');
  click(dom, '[data-quiz-position="4"] [data-quiz-next]');
  change(dom, '[data-quiz-select="state"]', "OR");
  click(dom, '[data-quiz-position="5"] [data-quiz-next]');
  assert.equal(currentPosition(document), 6);
  assert.equal(document.querySelector("[data-quiz-finish]").dataset.armed, "true");
  assert.equal(document.querySelector("[data-phase4-results]").hidden, true);
  assert.equal(document.querySelector("[role=progressbar]").getAttribute("aria-valuenow"), "7");
  assert.equal(document.querySelector("[role=progressbar]").getAttribute("aria-valuemax"), "8");
  assert.equal(document.querySelector("[data-progress-text]").textContent, "Question 7 of 7");
  assertNoSavedQuiz(dom);
  dom.window.close();
  // JSDOM does not implement navigation. The browser case clicks Finish and proves
  // the hand-off; this separate document proves the same fixture's destination UI.
  const destination = boot(renderMatchesCustomized(fixtureConfig()), matchesRuntime, undefined, {
    url: "https://glpclinicscout.com/matches/customized/?state=OR&drug=TIRZEPATIDE&form=COMPOUNDED&goal=price&source=survey",
  });
  const resultDocument = destination.window.document;
  assert.equal(resultDocument.querySelector("[data-matches-results]").hidden, false);
  assert.equal(resultDocument.querySelectorAll("[data-result-cards] .qz-card").length, 3);
  assert.deepEqual([...resultDocument.querySelectorAll("[data-result-cards] .qz-card")].map((card) => card.dataset.program), ["alpha", "bravo", "charlie"]);
  assert.equal(resultDocument.querySelectorAll("[data-result-cards] .qz-card-identity").length, 3);
  assert.equal(resultDocument.querySelectorAll("[data-result-cards] .qz-card-match").length, 3);
  assert.equal(resultDocument.querySelectorAll("[data-result-cards] .qz-card-review").length, 3);
  assert.equal(resultDocument.querySelectorAll("[data-result-cards] .qz-card-actions a").length, 3, "link-dark fixture exposes only internal Learn more links");
  const explore = new URL(resultDocument.querySelector("[data-explore-providers]").href);
  assert.equal(explore.origin, destination.window.location.origin);
  assert.equal(explore.pathname, "/providers/");
  assert.equal(explore.searchParams.get("state"), "OR");
  assert.equal(explore.searchParams.get("drug"), "TIRZEPATIDE");
  assert.equal(explore.searchParams.get("form"), "COMPOUNDED");
  assert.equal(explore.searchParams.get("sort"), "cheapest");
  assert.equal(resultDocument.querySelector("[data-result-empty]").hidden, true);
  assertNoSavedQuiz(destination);
  destination.window.close();
});

test("full quiz Yes and Not sure branches use dependent controls and exclusive intent state", () => {
  const dom = boot(renderQuiz(fixtureConfig()), quizRuntime);
  const { document } = dom.window;
  click(dom, '[data-multi="intents"][data-value="SEMAGLUTIDE"]');
  click(dom, '[data-multi="intents"][data-value="NOT_SURE"]');
  assert.equal(document.querySelector('[data-multi="intents"][data-value="SEMAGLUTIDE"]').getAttribute("aria-pressed"), "false");
  assert.deepEqual([...document.querySelectorAll('[data-multi="intents"][aria-pressed="true"]')].map((button) => button.dataset.value), ["NOT_SURE"]);
  click(dom, '[data-multi="intents"][data-value="SEMAGLUTIDE"]');
  assert.equal(document.querySelector('[data-multi="intents"][data-value="NOT_SURE"]').getAttribute("aria-pressed"), "false");
  click(dom, '[data-quiz-position="0"] [data-quiz-next]');
  click(dom, '[data-single="current_use"][data-value="yes"]');
  assert.equal(currentPosition(document), 3);
  assert.equal(document.querySelector('[data-branch="current-treatment"]').hidden, false);
  assert.equal(document.querySelector('[data-branch="situation"]').hidden, true);
  change(dom, '[data-quiz-select="current_drug"]', "SEMAGLUTIDE");
  const doseOptions = [...document.querySelector('[data-quiz-select="current_dose"]').options].map((option) => option.value);
  assert.deepEqual(doseOptions, ["", "Microdosing", "0.25", "0.5", "1", "1.7", "2.4", "Other"]);
  change(dom, '[data-quiz-select="current_dose"]', "1.7");
  click(dom, '[data-quiz-position="3"] [data-quiz-next]');
  assert.equal(currentPosition(document), 4);
  click(dom, '[data-quiz-position="4"] [data-quiz-back]');
  assert.equal(document.querySelector('[data-quiz-select="current_dose"]').value, "1.7");
  dom.window.close();
});

test("optional email uses only the existing first-party newsletter payload", async () => {
  const requests = [];
  const dom = boot(renderQuiz(fixtureConfig()), quizRuntime, async (url, options) => {
    requests.push({ url, options });
    return { ok: true };
  });
  click(dom, '[data-multi="intents"][data-value="SEMAGLUTIDE"]');
  click(dom, '[data-quiz-position="0"] [data-quiz-next]');
  click(dom, '[data-single="current_use"][data-value="no"]');
  click(dom, '[data-quiz-position="1"] [data-quiz-next]');
  click(dom, '[data-quiz-position="4"] [data-quiz-next]');
  change(dom, '[data-quiz-select="state"]', "CA");
  click(dom, '[data-quiz-position="5"] [data-quiz-next]');
  documentInput(dom, '[data-quiz-input="first_name"]', "Ari");
  const email = documentInput(dom, '[data-quiz-input="email"]', "reader@example.test");
  assert.equal(email.getAttribute("aria-invalid"), null);
  click(dom, "[data-quiz-finish]");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/newsletter-subscribe");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    email: "reader@example.test",
    first_name: "Ari",
    email_consent: true,
    company: "",
    consent_version: "glp-newsletter-v1-20260822",
    consent_source: "/subscribe-bottom-sheet/",
    source_surface: "quiz-provider-fit",
    provider_context: { state: "CA", medication_intents: ["SEMAGLUTIDE"] },
  });
  assert.equal(dom.window.document.querySelector("[data-result-newsletter-status]").textContent, "Your Clinic Scout subscription was saved.");
  dom.window.close();
});

function documentInput(dom, selector, value) {
  const input = dom.window.document.querySelector(selector);
  assert.ok(input, `missing input: ${selector}`);
  input.value = value;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  return input;
}

test("compact matcher resets dependent dose and renders three state-preserving Top Picks", () => {
  const dom = boot(renderMatchesCustomized(fixtureConfig()), matchesRuntime);
  const { document } = dom.window;
  assert.equal(document.querySelector("[data-matches-results]").hidden, true);
  change(dom, "[data-matches-medication]", "SEMAGLUTIDE");
  assert.deepEqual([...document.querySelector("[data-matches-dose]").options].map((option) => option.value), ["", "New Patient", "0.25", "0.5", "1", "1.7", "2.4", "Not Sure"]);
  change(dom, "[data-matches-dose]", "2.4");
  change(dom, "[data-matches-medication]", "TIRZEPATIDE");
  assert.equal(document.querySelector("[data-matches-dose]").value, "");
  assert.deepEqual([...document.querySelector("[data-matches-dose]").options].map((option) => option.value), ["", "New Patient", "2.5", "5", "7.5", "10", "12.5", "15", "Not Sure"]);
  change(dom, "[data-matches-medication]", "SEMAGLUTIDE");
  change(dom, "[data-matches-dose]", "2.4");
  change(dom, "[data-matches-state]", "OR");
  document.querySelector("[data-matches-form]").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

  assert.equal(document.querySelector("[data-matches-results]").hidden, false);
  assert.equal(document.querySelectorAll("[data-result-cards] .qz-card").length, 3);
  assert.equal(document.querySelectorAll("[data-result-cards] .qz-card-context").length, 3);
  assert.equal(document.querySelectorAll("[data-result-cards] .qz-card-review").length, 3);
  const explore = new URL(document.querySelector("[data-explore-providers]").href);
  assert.equal(explore.searchParams.get("state"), "OR");
  assert.equal(explore.searchParams.get("drug"), "SEMAGLUTIDE");
  assert.equal(explore.searchParams.get("dose"), "2.4");
  assert.equal(document.querySelector("[data-result-newsletter-status]").textContent, "No email was submitted.");
  dom.window.close();
});

test("one-use newsletter status accepts only fresh saved or failed metadata", () => {
  for (const row of [
    { status: "saved", saved_at: Date.now(), message: "subscription was saved" },
    { status: "failed", saved_at: Date.now(), message: "subscription could not be saved" },
    { status: "saved", saved_at: Date.now() - 60001, message: "" },
    { status: "saved", saved_at: Date.now() + 86400000, message: "" },
    { status: "unexpected", saved_at: Date.now(), message: "" },
    { status: "saved", saved_at: "not-a-date", message: "" },
    { raw: "{", message: "" },
  ]) {
    const dom = boot(renderMatchesCustomized(fixtureConfig()), matchesRuntime, undefined, {
      url: "https://glpclinicscout.com/matches/customized/?state=OR&drug=SEMAGLUTIDE&form=COMPOUNDED&goal=price&source=survey",
      seed: [{ store: "sessionStorage", key: "gcs.quiz.newsletter-status.v1", value: row.raw || JSON.stringify({ status: row.status, saved_at: row.saved_at }) }],
    });
    const message = dom.window.document.querySelector("[data-result-newsletter-status]").textContent;
    if (row.message) assert.ok(message.includes(row.message));
    else assert.equal(message, "");
    assert.equal(dom.window.sessionStorage.getItem("gcs.quiz.newsletter-status.v1"), null);
    assertNoSavedQuiz(dom);
    dom.window.close();
  }
});
