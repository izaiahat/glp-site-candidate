import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluatePass2Quiz, renderQuiz } from "../src/quiz.mjs";

const readJson = async (relative) => JSON.parse(await readFile(new URL(`../${relative}`, import.meta.url), "utf8"));

const [quizConfig, quizHtml, providersHtml, enhanceHtml, heldHtml, reverseHtml, redirects] = await Promise.all([
  readJson("data/quiz-config.json"),
  readFile(new URL("../public/quiz/provider-fit/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/providers/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/providers/enhance-md/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/providers/measured/index.html", import.meta.url), "utf8"), // Approved direct anchor; /go remains unminted.
  readFile(new URL("../public/pharmacies/strive/compare-providers/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/_redirects", import.meta.url), "utf8"),
]);

// Exercise compiled source-attested prices rather than the pre-join raw config.
quizConfig.candidates=JSON.parse(quizHtml.match(/id="candidate-data">([\s\S]*?)<\/script>/)[1]);

test("late-audit provider listing is Option C, URL-addressable, state-aware, and fail-closed", async () => {
  const html = providersHtml;
  const payloadSource = html.match(/data-provider-card-payloads data-src="([^"]+)"/)?.[1];
  assert.ok(payloadSource);
  const deferred = await readJson(`public/${payloadSource.replace(/^\//, "")}`);
  const cardMarkup = `${html}${deferred.join("")}`;
  // Provider-card count is a monotonic floor: onboarding grows it.
  const providerCardCount = (cardMarkup.match(/data-provider-card-contract="option-c"/g) || []).length;
  assert.ok(providerCardCount >= 35, `expected at least 35 provider cards, saw ${providerCardCount}`);
  for (const label of ["Medications offered", "Total monthly cost", "Cancellation"]) {
    assert.equal((cardMarkup.match(new RegExp(`<dt>${label}<\\/dt>`, "g")) || []).length, providerCardCount);
  }
  assert.doesNotMatch(cardMarkup, /data-product-card|data-state-evidence|UNKNOWN_NO_SOURCE|>Not published</);
  for (const key of ["state", "drug", "form", "duration", "dose", "sort"]) {
    assert.match(html + redirects, new RegExp(key === "state" ? "data-state-native" : key === "drug" ? "data-filter=\\\"treatment\\\"" : key === "form" ? "data-filter=\\\"type\\\"" : key === "duration" ? "data-filter=\\\"duration\\\"" : key === "dose" ? "data-filter=\\\"dose\\\"" : "data-filter=\\\"sort\\\""));
  }
  assert.match(html, /data-state-mode="(?:all|included|excluded|unknown)"/);
  assert.match(html, /data-filter-empty hidden/);
  assert.match(html, /<div class="p3-filter-empty" data-filter-empty hidden><p>No source-backed record matches those filters\. An empty result is not a medical or availability conclusion\.<\/p><p data-active-filter-label>Active filters: none\.<\/p><button type="button" data-filter-reset>Reset filters<\/button><\/div>/);
  assert.doesNotMatch(html, /No evidence-qualified card matches those filters/); // Superseded by A2.4, not a second empty state.
  assert.doesNotMatch(redirects, /^\/(?:semaglutide|tirzepatide)\/\s/m);
  for (const medication of ["semaglutide", "tirzepatide"]) assert.ok(html.includes(`href="/${medication}/"`));
});

test("provider and pharmacy detail surfaces expose source-backed anatomy without invented CTAs", async () => {
  const provider = enhanceHtml;
  assert.match(provider, /At a glance/);
  assert.match(provider, /Editorial tradeoffs/);
  assert.match(provider, /Verified pharmacy relationships/);
  assert.match(provider, /Clinic Scout patient reviews/);
  assert.match(provider, /Share your experience/);
  assert.match(provider, /Submissions are checked before publication/);
  assert.match(provider, /Related provider records/);
  assert.match(provider, /Methodology and evidence boundary/);

  const measuredHtml = heldHtml;
  const registry = await readJson("data/program-registry.json");
  const measured = registry.programs.find(row => row.program_id === "measured");
  assert.ok(measured, "Measured identity must remain in the registry");
  assert.equal(measured.go.entry_state, "held");
  assert.equal(measured.profiles["glp-clinic-scout"].surfaces.go, false);
  assert.match(measured.profiles["glp-clinic-scout"].exceptions.go.reason, /Operator rejected Awin advertiser 126727/);
  const approval = (await readJson('data/affiliate-wire-in-approvals.json')).programs.find(row => row.existing_release_alias === 'measured');
  assert.equal(approval.approval_state, 'approved_active');
  const authority = (await readJson('data/go-runtime-promotion-authority.json')).programs.measured;
  assert.equal(authority.status, 'VERIFIED');
  assert.equal(authority.reason, 'operator_approved_glp_live');
  const anchors = measuredHtml.match(/<a\b[^>]*data-program="measured"[^>]*>Get started<\/a>/g) || [];
  assert.ok(anchors.length > 0, 'operator-approved direct enrollment remains reachable');
  for (const anchor of anchors) {
    assert.equal(anchor.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&'), approval.tracking.provider_issued_url);
    assert.match(anchor, /rel="[^"]*sponsored/);
    assert.match(anchor, /data-link-mode="transparent-direct"/);
  }
  assert.doesNotMatch(measuredHtml, /href="\/go\/measured(?:[?"/])/);

  const reverse = reverseHtml;
  for (const name of ["state", "drug", "dose", "duration"]) assert.match(reverse, new RegExp(`name="${name}"`));
  assert.match(reverse, /data-pharmacy-reverse-card/);
  assert.match(reverse, /State, medication, dose, duration, price, and patient assignment are not established/);
  assert.match(reverse, /No relationship source establishes every selected control/);
});

test("pass-2 quiz has the exact first intent set, starts immediately, and preserves exact yes/no routing", () => {
  const values = quizConfig.pass2_flow.intent_options.map((option) => option.value);
  assert.deepEqual(values, ["SEMAGLUTIDE", "TIRZEPATIDE", "OZEMPIC", "MOUNJARO", "WEGOVY", "ZEPBOUND", "WEGOVY_PILL", "NOT_SURE"]);
  const html = renderQuiz(quizConfig);
  assert.doesNotMatch(html, /health-consent-gate/);
  assert.match(html, /data-phase4-questions/);
  assert.match(html, /data-quiz-position="0"/);
  assert.match(html, /data-quiz-select="state"/);
  assert.match(html, /data-explore-providers/);

  const base = { intent: "NOT_SURE", state: "OR", priorities: ["Cost"] };
  const yes = evaluatePass2Quiz(quizConfig, { ...base, current_use: "yes", current_drug: "SEMAGLUTIDE", current_dose: "0.5" });
  const no = evaluatePass2Quiz(quizConfig, { ...base, current_use: "no", reason: "Weight loss" });
  assert.ok(yes.length>0 && yes.length<=quizConfig.candidates.length, "supported results remain reachable within canonical eligibility");
  assert.equal(new Set(yes.map((row) => row.program_id)).size, yes.length, "fixture results must not duplicate a provider");
  assert.deepEqual(no.map((row) => row.program_id), yes.map((row) => row.program_id), "current treatment history must not silently alter commercial ranking");
});

test("every compounded Phase 4 result branch has an uncapped source-backed payload", () => {
  const match = /<script type="application\/json" id="phase4-quiz-data">([\s\S]*?)<\/script>/.exec(quizHtml);
  assert.ok(match, "generated quiz payload missing");
  const payload = JSON.parse(match[1].replaceAll("\\u003c", "<"));
  for (const drug of ["SEMAGLUTIDE", "TIRZEPATIDE"]) {
    for (const goal of ["price", "coaching", "medication-form"]) {
      const ids = payload.result_sets[`${drug}|OR|${goal}`];
      assert.ok(ids.length>0 && ids.length<=Object.keys(payload.candidate_records).length, `${drug}/${goal} has valid eligible results`);
      assert.equal(new Set(ids).size, ids.length, `${drug}/${goal} should not duplicate a provider`);
    for (const id of ids) {
        assert.ok(payload.candidate_records[id], `${drug}/${goal} references an unknown candidate ${id}`);
        assert.equal((payload.candidate_records[id].excluded_states || []).includes("OR"), false, `${drug}/${goal} included a provider explicitly excluded from Oregon`);
      }
    }
  }
});

test("quiz state exclusion produces a truthful empty result instead of fallback fabrication", () => {
  const fixture = structuredClone(quizConfig);
  fixture.candidates = fixture.candidates.map((candidate) => ({ ...candidate, excluded_states: ["OR"] }));
  const results = evaluatePass2Quiz(fixture, { intent: "NOT_SURE", state: "OR", priorities: ["Cost"] });
  assert.deepEqual(results, []);
});

test("client runtime binds canonical query keys, keyboard state-picker behavior, insurance finish, and reverse empty state", async () => {
  const runtime = await readFile(new URL("../assets/site.js", import.meta.url), "utf8");
  for (const key of ["state", "drug", "form", "duration", "dose", "sort"]) assert.match(runtime, new RegExp(`searchParams\\.(?:get|set)\\('${key}'`));
  assert.match(runtime, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(runtime, /closeState\(\{ returnFocus: true \}\)/);
  assert.match(runtime, /data-insurance-finish-status/);
  assert.match(runtime, /No relationship source establishes every selected control|data-pharmacy-reverse-empty/);
});
