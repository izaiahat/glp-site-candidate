import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { projectMoneyPagesFromRegistry, projectQuizFromRegistry } from "../src/program-registry.mjs";
import { renderQuiz, resolvePhase4Outcome } from "../src/quiz.mjs";
import { projectTherapeuticSurfaces } from "../src/therapeutic-taxonomy.mjs";

const config = JSON.parse(readFileSync(new URL("../data/quiz-config.json", import.meta.url), "utf8"));
const builtQuiz = readFileSync(new URL("../public/quiz/provider-fit/index.html", import.meta.url), "utf8");
const registry = JSON.parse(readFileSync(new URL("../data/program-registry.json", import.meta.url), "utf8"));
const money = JSON.parse(readFileSync(new URL("../data/money-page-specs.json", import.meta.url), "utf8"));
const ledger = JSON.parse(readFileSync(new URL("../data/program-content-ledger.json", import.meta.url), "utf8"));
const canonicalMoney = projectMoneyPagesFromRegistry(registry, "glp-clinic-scout", money.pages, ledger.programs);
const canonicalQuiz = projectQuizFromRegistry(registry, "glp-clinic-scout", config, ledger);
const projected = projectTherapeuticSurfaces({
  registry,
  profileId: "glp-clinic-scout",
  pages: canonicalMoney,
  quizConfig: canonicalQuiz,
  asOf: new Date(`${registry.therapeutic_taxonomy.sealed_as_of}T12:00:00Z`),
});

test("PASS 2 quiz starts without an email or privacy checkbox gate", () => {
  const html = renderQuiz(config);
  assert.match(html, /<h1>Find your GLP‑1 match\.<\/h1>/);
  // Operator-ordered presentation change: no start button — the quiz auto-initializes on load.
  assert.doesNotMatch(html, /id="begin-quiz"/);
  const document = new JSDOM(html).window.document;
  const quizControls = [...document.querySelectorAll('[data-phase4-quiz] button, [data-phase4-quiz] input, [data-phase4-quiz] a')];
  assert.doesNotMatch(quizControls.map(control => control.textContent + ' ' + (control.getAttribute('value') || '')).join('\n'), /Start the quiz/);
  // The intro is compact: kicker + h1 only, no long paragraphs before the questionnaire.
  assert.match(html, /<header class="qz-intro"><p class="gcs-kicker">[^<]+<\/p><h1>/);
  // The privacy copy now lives in the footnote after the results section.
  assert.match(html, /<p class="qz-footnote"><strong>In-progress answers stay on this device\.<\/strong>/);
  assert.match(html, /Never sent to analytics/);
  assert.match(html, /Subscribing sends only Position 7.s disclosed fields to Clinic Scout, not providers/);
  assert.doesNotMatch(html, /id="health-consent"/);
  assert.doesNotMatch(html, /const consent=/);
  assert.doesNotMatch(html, /if\(!consent\.checked\)return/);
});

test("PASS 2 quiz leads with the governed treatment-intent choice set", () => {
  const html = renderQuiz(config);
  const first = html.match(/<section class="question" data-pass2-question="intent" hidden>([\s\S]*?)<\/section>/)?.[1] || "";
  assert.match(first, /<h2>What are you looking for\?<\/h2>/);
  for (const label of ["Semaglutide", "Tirzepatide", "Ozempic", "Mounjaro", "Wegovy", "Zepbound", "Wegovy Pill", "Not sure"]) {
    assert.ok(first.includes(`>${label}</button>`), `missing ${label}`);
  }
  assert.equal((first.match(/class="option"/g) || []).length, 8);
  assert.ok(html.indexOf("What are you looking for?") < html.indexOf("Are you currently using a GLP-1 medication?"));
});

test("Phase 4 quiz keeps uncapped eligible result sets and state/treatment-scoped exploration", () => {
  const html = builtQuiz;
  const payload = JSON.parse(html.match(/<script type="application\/json" id="phase4-quiz-data">([\s\S]*?)<\/script>/)?.[1] || "null");
  assert.ok(payload);
  assert.match(html, /data-explore-providers/);
  assert.match(html, /href="\/providers\/"[^>]*>Explore all providers<\/a>/);
  for (const drug of ["SEMAGLUTIDE", "TIRZEPATIDE"]) {
    for (const goal of ["price", "coaching", "medication-form"]) {
      const ids = payload.result_sets[`${drug}|OR|${goal}`];
      assert.ok(ids.length>0, `${drug}/${goal}: supported Oregon path must remain reachable`);
      assert.equal(new Set(ids).size, ids.length, `${drug}/${goal}: result IDs must be unique`);
    }
  }
});

test("Phase 4 every treatment-intent option resolves to an owned route or governed result family", () => {
  for (const intent of config.pass2_flow.intent_options) {
    const answers = intent.value === "NOT_SURE"
      ? { intents: [intent.value], situation: "LOWEST_COST" }
      : { intents: [intent.value], current_use: "no" };
    const outcome = resolvePhase4Outcome(answers);
    if (["SEMAGLUTIDE", "TIRZEPATIDE", "NOT_SURE"].includes(intent.value)) {
      assert.equal(outcome.kind, "compounded", intent.label);
      assert.ok(["SEMAGLUTIDE", "TIRZEPATIDE"].includes(outcome.drug), intent.label);
    } else {
      assert.equal(outcome.kind, "brand", intent.label);
      assert.match(outcome.route, /^\/(?:wegovy-pill|wegovy|ozempic|mounjaro|zepbound)\/$/);
    }
  }
});
