import test from "node:test";
import assert from "node:assert/strict";
import { historicalRetatrutideInputs } from './fixtures/historical-retatrutide-inputs.mjs';
import { evaluateQuiz, renderQuiz } from "../src/quiz.mjs";
import { projectMoneyPagesFromRegistry, projectQuizFromRegistry } from "../src/program-registry.mjs";
import { projectTherapeuticSurfaces } from "../src/therapeutic-taxonomy.mjs";

// Historical positives use one authenticated generation, including the ledger.
// Current expired capture refusal remains covered by the paired wire-in suite.
const { registry, money, quiz, contentLedger, asOf } = historicalRetatrutideInputs();
const canonicalMoney = projectMoneyPagesFromRegistry(registry, "glp-clinic-scout", money.pages, contentLedger.programs);
const canonicalQuiz = projectQuizFromRegistry(registry, "glp-clinic-scout", quiz, contentLedger);
const projected = projectTherapeuticSurfaces({
  registry,
  profileId: "glp-clinic-scout",
  pages: canonicalMoney,
  quizConfig: canonicalQuiz,
  asOf,
});

test("Build 6 projects one taxonomy into every canonical compare row and quiz candidate without reviving an alias", () => {
  assert.equal(Object.keys(registry.therapeutic_taxonomy.programs).length, registry.therapeutic_taxonomy.expected_counts.provider_rows);
  assert.equal(projected.includeProgramIds.length, registry.provider_dynamic_profiles.expected_counts.provider_identities);
  assert.ok(!projected.includeProgramIds.includes("shed"));
  assert.ok(projected.includeProgramIds.includes("shedrx"));
  const required = new Set(registry.therapeutic_taxonomy.required_surface_paths);
  for (const path of required) {
    const page = projected.pages.find((item) => item.path === path);
    assert.ok(page, path);
    assert.equal(page.therapeutic_facets_enabled, true, path);
    assert.equal(page.rows.length, projected.includeProgramIds.length, path);
    assert.deepEqual(page.rows.map((row) => row.program_id).sort(), projected.includeProgramIds, path);
    assert.ok(page.rows.every((row) => row.therapeutic_taxonomy?.normalized_sha256), path);
  }
  const expectedQuizIds = projected.includeProgramIds.filter((id) => {
    const program = registry.programs.find((row) => String(row.review_slug || row.program_id) === id);
    return program?.profiles?.["glp-clinic-scout"]?.surfaces?.quiz === true;
  }).sort();
  assert.deepEqual(projected.quizConfig.candidates.map((row) => row.program_id).sort(), expectedQuizIds);
  // 2026-08-18 content-fit LIFT: trt-nation is live-eligible and therefore in
  // the quiz pool. The rule above (pool == the set whose registry row claims
  // the quiz surface) is what actually enforces this, in both directions.
  assert.equal(projected.quizConfig.candidates.some((row) => row.program_id === "trt-nation"), true);
  const shedrx = projected.quizConfig.candidates.find((row) => row.program_id === "shedrx");
  assert.deepEqual(shedrx.therapeutic_tags, ["oral", "semaglutide", "tirzepatide", "wegovy", "zepbound"]);
});

test("Build 6b quiz preference returns only exact verified candidates and rejects unavailable retatrutide", () => {
  const tirzepatide = evaluateQuiz(projected.quizConfig, { medication_preference: "tirzepatide" }, registry);
  assert.deepEqual(tirzepatide.map(r=>r.program_id).sort(),projected.quizConfig.candidates.filter(r=>r.source_clearance===true&&r.staging_eligible===true&&r.glp_service_verified!==false&&r.therapeutic_tags.includes('tirzepatide')).map(r=>r.program_id).sort());
  assert.ok(tirzepatide.every((row) => row.therapeutic_tags.includes("tirzepatide")));
  assert.deepEqual(evaluateQuiz(projected.quizConfig, { medication_preference: "retatrutide" }, registry), []);
  assert.equal(evaluateQuiz(projected.quizConfig, { medication_preference: "not_sure" }, registry).length, projected.quizConfig.candidates.filter(r=>r.source_clearance===true&&r.staging_eligible===true&&r.glp_service_verified!==false).length);
});

test("Build 6b renders the exact Pass 2 treatment-intent question and does not authorize answer analytics", () => {
  const medication = projected.quizConfig.questions.find((item) => item.id === "medication_preference");
  assert.ok(medication);
  assert.equal(medication.label, "Do you already know which medication you want?");
  assert.deepEqual(medication.options.map((item) => item.value), [
    "semaglutide", "tirzepatide", "wegovy", "zepbound", "mounjaro", "oral", "injectable", "not_sure",
  ]);
  assert.equal(medication.options.at(-1).label, "I'm not sure yet");
  assert.equal(projected.quizConfig.analytics_answer_values, false);
  const html = renderQuiz(projected.quizConfig, registry);
  const renderedIntents = [...html.matchAll(/<button type="button" class="option" data-single="intent" data-value="([^"]+)" aria-pressed="false">([^<]+)<\/button>/g)]
    .map((match) => ({ value: match[1], label: match[2] }));
  assert.deepEqual(renderedIntents, [
    { value: "SEMAGLUTIDE", label: "Semaglutide" },
    { value: "TIRZEPATIDE", label: "Tirzepatide" },
    { value: "OZEMPIC", label: "Ozempic" },
    { value: "MOUNJARO", label: "Mounjaro" },
    { value: "WEGOVY", label: "Wegovy" },
    { value: "ZEPBOUND", label: "Zepbound" },
    { value: "WEGOVY_PILL", label: "Wegovy Pill" },
    { value: "NOT_SURE", label: "Not sure" },
  ]);
  assert.doesNotMatch(html, /data-single="intent" data-value="INJECTABLE"/);
  assert.doesNotMatch(html, /data-single="intent" data-value="RETATRUTIDE"/);
  assert.doesNotMatch(html, /analytics_answer_values[^<]*true/);
  // Privacy copy moved from the removed intro paragraphs to the qz-footnote after results.
  assert.match(html, /<p class="qz-footnote"><strong>In-progress answers stay on this device\.<\/strong>/);
  assert.match(html, /Never sent to analytics/);
  assert.match(html, /Subscribing sends only Position 7.s disclosed fields to Clinic Scout, not providers/);
  assert.doesNotMatch(html, /id="health-consent"|const consent=|if\(!consent\.checked\)return/i);
});
