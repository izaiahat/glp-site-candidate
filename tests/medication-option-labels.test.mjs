// The operator defect of 2026-08-18, pinned from four directions at once:
//
//   1. the DERIVATION tells two evidenced tiers apart, from their own evidence;
//   2. the GATE fails on the exact bytes that shipped the defect (a fixture
//      captured verbatim from the release the operator was looking at);
//   3. the BUILT PAGE offers no duplicate label for ANY provider, and selecting
//      each option shows that option's own price, quote and capture date - the
//      part that was silently wrong, not merely ambiguous;
//   4. a link shared before the fix still resolves to the row it always did.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { currentCalculatorExpectation, historicalCalculatorFixture } from "./fixtures/c02-calculator-inputs.mjs";
import {
  auditMedicationOptionLabels,
  deriveMedicationEntries,
  priceBasisQualifier,
  scanRenderedDuplicates,
  tierNameFromQuote,
} from "../src/medication-options.mjs";

const MATRIX = JSON.parse(await readFile(new URL("../data/provider-pricing-matrix.json", import.meta.url), "utf8"));
const BUILT = await readFile(new URL("../public/tools/glp-1-cost-calculator/index.html", import.meta.url), "utf8");
const PRE_FIX = await readFile(new URL("./fixtures/pre-fix-calculator-duplicate-labels.html", import.meta.url), "utf8");
const REGISTRY = JSON.parse(await readFile(new URL("../data/program-registry.json", import.meta.url), "utf8"));
const CONFIG = JSON.parse(await readFile(new URL("../data/cost-calculator.json", import.meta.url), "utf8"));
const HISTORICAL = historicalCalculatorFixture(PRE_FIX, CONFIG);
const CURRENT = currentCalculatorExpectation(REGISTRY, MATRIX);

// ------------------------------------------------------------ 1. derivation

test("two tiers of one medication_id become two distinguishable options, named by the provider", () => {
  const rows = HISTORICAL.matrix.providers["enhance-md"].medications;
  const derived = deriveMedicationEntries("enhance-md", rows);
  const tirzepatide = derived.filter((row) => row.medication_id === "compounded-tirzepatide-injection");
  assert.equal(tirzepatide.length, 2, "enhance.md publishes two tirzepatide tiers");
  assert.deepEqual(tirzepatide.map((row) => row.display_label), [
    "Compounded tirzepatide (injection) — GLP-1 Advanced",
    "Compounded tirzepatide (injection) — Microdosing Tirzepatide",
  ]);
  assert.deepEqual(tirzepatide.map((row) => row.entry_key), [
    "compounded-tirzepatide-injection--glp-1-advanced",
    "compounded-tirzepatide-injection--microdosing-tirzepatide",
  ]);
  // The taxonomy key is untouched: the closed list still owns the molecule.
  assert.deepEqual(new Set(tirzepatide.map((row) => row.medication_id)), new Set(["compounded-tirzepatide-injection"]));
  // A provider with one row per medication keeps the key it always had, so
  // every link ever shared still resolves.
  const single = deriveMedicationEntries("enhance-md", [rows[0]]);
  assert.equal(single[0].month_1_usd, 112);
  assert.equal(single[0].ongoing_usd, 212);
  for (const row of single) {
    assert.equal(row.entry_key, row.medication_id);
    assert.equal(row.display_label, row.label);
    assert.equal(row.label_qualifier, null);
  }
});

test("every qualifier uses its OWN row evidence and typed identity - nothing invented, nothing borrowed", () => {
  for (const [programId, entry] of [...Object.entries(HISTORICAL.matrix.providers), ...Object.entries(MATRIX.providers)]) {
    for (const row of deriveMedicationEntries(programId, entry.medications || [])) {
      if (Object.hasOwn(row, "price_kind")) {
        // A structured plan label is not a verbatim numeric quote.
        const source = entry.medications.find((item) => item.row_id === row.entry_key);
        assert.ok(source, `${programId}: typed row_id changed`);
        for (const [field, value] of Object.entries(source)) assert.deepEqual(row[field], value);
        assert.equal(row.entry_key, source.row_id);
        assert.equal(row.display_label, `${source.label} — ${source.plan_label}`);
        assert.equal(row.label_qualifier, source.plan_label);
        assert.equal(row.label_qualifier_basis, "source_plan_label");
        assert.equal(row.calculator_eligibility, "display_only");
        assert.ok(row.identity_evidence?.length > 0);
        assert.ok(Object.keys(row.facts || {}).length > 0);
        for (const [name, fact] of Object.entries(row.facts)) {
          if (fact.value === "UNKNOWN" && !fact.evidence?.length) {
            assert.ok(typeof fact.artifact_needed === "string" && fact.artifact_needed.trim());
            continue;
          }
          assert.ok(fact.evidence?.length > 0, `${programId}/${name}: own evidence missing`);
          for (const witness of fact.evidence) {
            assert.match(witness.source_url, /^https:\/\//);
            assert.match(witness.capture_sha256, /^[a-f0-9]{64}$/);
            assert.match(witness.captured_at_utc, /^\d{4}-\d{2}-\d{2}T/);
            assert.ok(typeof witness.quote === "string" && witness.quote.trim());
          }
          if (name.endsWith("_usd") && fact.value !== "UNKNOWN") {
            const tokens = [String(fact.value), fact.value.toLocaleString("en-US"), fact.value.toFixed(2)];
            assert.ok(fact.evidence.some((witness) => tokens.some((token) => witness.quote.includes(token))));
          }
        }
        continue;
      }
      if (!row.label_qualifier) continue;
      if (row.label_qualifier_basis === "tier_name_from_quote") {
        assert.ok(row.quote.includes(row.label_qualifier),
          `${programId}: tier qualifier ${JSON.stringify(row.label_qualifier)} is not in its own quote`);
      } else {
        // A price basis is honest only if its number is in the row's own quote,
        // which attachPricingMatrix already proves - re-proven here at the label.
        const amount = row.label_qualifier.match(/\d[\d,]*/)?.[0].replace(/,/g, "");
        assert.ok(amount && row.quote.includes(amount),
          `${programId}: price-basis qualifier cites ${amount} which its own quote does not contain`);
      }
    }
  }
});

test("a tier name is only accepted when the provider actually printed one", () => {
  assert.equal(tierNameFromQuote("GLP-1 Advanced · tirzepatide · Starting at · $180 · first month"), "GLP-1 Advanced");
  assert.equal(tierNameFromQuote("Microdosing Tirzepatide · lower-dose tirzepatide · $169"), "Microdosing Tirzepatide");
  // Prose, prices and sentences are not tier names.
  assert.equal(tierNameFromQuote("Compounded semaglutide starts at $74/month and steps up to $149/month thereafter."), null);
  assert.equal(tierNameFromQuote("$169 · /month"), null);
  assert.equal(tierNameFromQuote(""), null);
});

test("when no tier name can be derived, the honest published price basis disambiguates", () => {
  const rows = [
    { medication_id: "compounded-tirzepatide-injection", label: "Compounded tirzepatide (injection)",
      quote: "Tirzepatide is $180 for your first month, then $280 per month thereafter, billed monthly.",
      month_1_basis: "intro", month_1_usd: 180, ongoing_usd: 280 },
    { medication_id: "compounded-tirzepatide-injection", label: "Compounded tirzepatide (injection)",
      quote: "Our lower-dose tirzepatide plan is $169 per month with no separate first-month rate.",
      month_1_basis: "same_as_ongoing", month_1_usd: 169, ongoing_usd: 169 },
  ];
  const derived = deriveMedicationEntries("fixture-md", rows);
  assert.deepEqual(derived.map((row) => row.label_qualifier_basis), ["published_price_basis", "published_price_basis"]);
  assert.deepEqual(derived.map((row) => row.display_label), [
    "Compounded tirzepatide (injection) — $180 first month",
    "Compounded tirzepatide (injection) — $169 flat",
  ]);
  assert.equal(priceBasisQualifier(rows[0]), "$180 first month");
});

test("two rows nothing can tell apart FAIL the build instead of shipping twice", () => {
  const identical = [
    { medication_id: "compounded-semaglutide-injection", label: "Compounded semaglutide (injection)",
      quote: "Semaglutide is $99 per month.", month_1_basis: "same_as_ongoing", month_1_usd: 99, ongoing_usd: 99 },
    { medication_id: "compounded-semaglutide-injection", label: "Compounded semaglutide (injection)",
      quote: "Semaglutide costs $99 per month, shipped.", month_1_basis: "same_as_ongoing", month_1_usd: 99, ongoing_usd: 99 },
  ];
  assert.throws(() => deriveMedicationEntries("fixture-md", identical), /medication_option_labels_indistinguishable/);
  const audit = auditMedicationOptionLabels({ providers: { "fixture-md": { medications: identical } } });
  assert.equal(audit.violations.length, 1);
});

test("the historical release matrix needs a qualifier for exactly the provider the operator found", () => {
  const audit = auditMedicationOptionLabels(HISTORICAL.matrix);
  assert.deepEqual(audit.violations, []);
  assert.deepEqual(audit.qualified.map((entry) => entry.program_id), ["enhance-md"]);
  assert.deepEqual(auditMedicationOptionLabels(MATRIX).violations, []);
});

// ------------------------------------------------------------------ 2. gate

test("the gate FAILS on the exact bytes that shipped the defect", () => {
  const scan = scanRenderedDuplicates(PRE_FIX, "/pre-fix-fixture");
  assert.ok(scan.violations.some((v) => v.startsWith("duplicate_option_text:")), scan.violations.join("\n"));
  assert.ok(scan.violations.some((v) => v.startsWith("duplicate_option_value:")), scan.violations.join("\n"));
  assert.ok(scan.violations.some((v) => v.startsWith("duplicate_selectable_label:")), scan.violations.join("\n"));
  assert.ok(scan.violations.some((v) => v.startsWith("duplicate_selectable_entry_key:")), scan.violations.join("\n"));
});

test("the gate passes the built calculator", () => {
  const scan = scanRenderedDuplicates(BUILT, "/tools/glp-1-cost-calculator/");
  assert.deepEqual(scan.violations, []);
  assert.ok(scan.lists > 0, "the calculator payload must actually be scanned, not silently skipped");
});

// -------------------------------------------------------------- 3. the page

function boot(html = BUILT, query = "") {
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: `https://glpclinicscout.com/tools/glp-1-cost-calculator/${query}`,
    beforeParse(window) {
      // DOM behavior only. Actual motion, focus and scrolling remain browser checks.
      window.matchMedia = () => ({ matches: false });
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.addEventListener("error", (event) => errors.push(event.message));
    },
  });
  assert.deepEqual(errors, [], "calculator bootstrap threw");
  return dom;
}

function selectProvider(dom, programId) {
  const select = dom.window.document.querySelector("#provider");
  select.value = programId;
  select.dispatchEvent(new dom.window.Event("change"));
  return dom.window.document;
}

const PAYLOAD = JSON.parse(/window\.GCS_COST_PROVIDERS=(\[[\s\S]*?\]);\(\(\)=>/.exec(BUILT)[1]);

test("no provider offers two identically labelled options, and each option shows ITS OWN price", () => {
  let checked = 0;
  const ids = PAYLOAD.map((provider) => provider.program_id);
  assert.equal(new Set(ids).size, ids.length, "duplicate emitted provider identity");
  assert.deepEqual([...ids].sort(), CURRENT.eligible, "exact source-derived eligible membership");
  const initial = boot();
  const optionIds = [...initial.window.document.querySelector("#provider").options].map((option) => option.value);
  assert.equal(new Set(optionIds).size, optionIds.length, "duplicate provider option");
  assert.deepEqual([...optionIds].sort(), ["", ...CURRENT.eligible].sort(), "provider options must match source eligibility");
  initial.window.close();
  for (const provider of PAYLOAD) {
    const meds = provider.medications || [];
    const sourceRows = CURRENT.rows.get(provider.program_id);
    const sourceEntries = deriveMedicationEntries(provider.program_id, sourceRows);
    assert.equal(meds.length, sourceRows.length, `${provider.program_id}: exact matrix row count`);
    for (const [index, source] of sourceRows.entries()) {
      assert.equal(meds[index].entry_key, sourceEntries[index].entry_key);
      assert.equal(meds[index].display_label, sourceEntries[index].display_label);
      for (const [field, value] of Object.entries(source)) {
        if (field !== "dose_pricing") assert.deepEqual(meds[index][field], value, `${provider.program_id}/${index}: ${field}`);
      }
    }
    assert.ok(meds.length > 0);
    const dom = boot();
    const document = selectProvider(dom, provider.program_id);
    const medication = document.querySelector("#medication");
    const labels = [...medication.options].map((option) => option.textContent);
    const values = [...medication.options].map((option) => option.value);
    assert.equal(new Set(labels).size, labels.length, `${provider.program_id}: duplicate dropdown label ${JSON.stringify(labels)}`);
    assert.equal(new Set(values).size, values.length, `${provider.program_id}: duplicate dropdown value ${JSON.stringify(values)}`);
    assert.equal(labels.length, meds.length);
    assert.deepEqual(labels, meds.map((row) => row.display_label));
    assert.deepEqual(values, meds.map((row) => row.entry_key));
    for (let index = 0; index < meds.length; index += 1) {
      const row = meds[index];
      medication.selectedIndex = index;
      medication.dispatchEvent(new dom.window.Event("change"));
      assert.equal(document.querySelector("#first-base").value, row.month_1_usd == null ? "" : String(row.month_1_usd),
        `${provider.program_id} option ${index} showed another row's month 1`);
      assert.equal(document.querySelector("#recurring-base").value, row.ongoing_usd == null ? "" : String(row.ongoing_usd),
        `${provider.program_id} option ${index} showed another row's ongoing price`);
      if (Object.hasOwn(row, "price_kind")) {
        assert.equal(row.entry_key, row.row_id);
        assert.equal(row.display_only, true);
        assert.equal(document.querySelector("#one-time").value, "");
        assert.equal(document.querySelector("#cost-source").hidden, true);
        assert.equal(document.querySelector("#cost-quote").hidden, true);
        assert.equal(document.querySelector("#cost-result").hidden, true);
        checked += 1;
        continue;
      }
      assert.equal(document.querySelector("#cost-quote").textContent, `“${row.quote}”`,
        `${provider.program_id} option ${index} showed another row's quote`);
      assert.equal(document.querySelector("#cost-checked").textContent, row.captured_on);
      assert.equal(document.querySelector("#cost-source-link").href, row.source_url);
      checked += 1;
    }
    dom.window.close();
  }
  const expectedRows = CURRENT.eligible.reduce((sum, id) => sum + CURRENT.rows.get(id).length, 0);
  assert.ok(expectedRows > 0, "current cash-row coverage must not be vacuous");
  assert.equal(checked, expectedRows, "every source-eligible row must be driven exactly once");
});

test("the two enhance-md tirzepatide tiers are separately reachable with their own numbers", () => {
  const dom = boot(HISTORICAL.html);
  const document = selectProvider(dom, "enhance-md");
  const medication = document.querySelector("#medication");
  const labels = [...medication.options].map((option) => option.textContent);
  assert.deepEqual(labels, [
    "Compounded semaglutide (injection)",
    "Compounded tirzepatide (injection) — GLP-1 Advanced",
    "Compounded tirzepatide (injection) — Microdosing Tirzepatide",
  ]);
  medication.value = "compounded-tirzepatide-injection--microdosing-tirzepatide";
  medication.dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("#first-base").value, "169");
  assert.equal(document.querySelector("#recurring-base").value, "169");
  assert.match(document.querySelector("#cost-quote").textContent, /Microdosing Tirzepatide/);
  assert.doesNotMatch(document.querySelector("#cost-context").textContent, /180|280/);
  medication.value = "compounded-tirzepatide-injection--glp-1-advanced";
  medication.dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("#first-base").value, "180");
  assert.equal(document.querySelector("#recurring-base").value, "280");
  assert.match(document.querySelector("#cost-quote").textContent, /GLP-1 Advanced/);
  dom.window.close();
});

// ------------------------------------------------------ 4. shared links live

test("a link shared before the fix still resolves to the row it always resolved to", () => {
  const dom = boot(HISTORICAL.html, "?provider=enhance-md&medication=compounded-tirzepatide-injection&months=6");
  const document = dom.window.document;
  assert.equal(document.querySelector("#provider").value, "enhance-md");
  assert.equal(document.querySelector("#medication").value, "compounded-tirzepatide-injection--glp-1-advanced");
  assert.equal(document.querySelector("#first-base").value, "180");
  dom.window.close();
  for (const provider of PAYLOAD) {
    for (const molecule of new Set(provider.medications.map((row) => row.medication_id))) {
      const row = provider.medications.find((entry) => entry.medication_id === molecule);
      const current = boot(BUILT, "?" + new URLSearchParams({ provider: provider.program_id, medication: molecule }));
      assert.equal(current.window.document.querySelector("#medication").value, row.entry_key);
      assert.equal(current.window.document.querySelector("#first-base").value, row.month_1_usd == null ? "" : String(row.month_1_usd));
      current.window.close();
    }
  }
});

test("a link shared with an entry key resolves to that exact tier", () => {
  const dom = boot(HISTORICAL.html, "?provider=enhance-md&medication=compounded-tirzepatide-injection--microdosing-tirzepatide&months=6");
  const document = dom.window.document;
  assert.equal(document.querySelector("#medication").value, "compounded-tirzepatide-injection--microdosing-tirzepatide");
  assert.equal(document.querySelector("#first-base").value, "169");
  assert.equal(document.querySelector("#recurring-base").value, "169");
  dom.window.close();
  for (const provider of PAYLOAD) {
    for (const row of provider.medications) {
      const current = boot(BUILT, "?" + new URLSearchParams({ provider: provider.program_id, medication: row.entry_key }));
      assert.equal(current.window.document.querySelector("#medication").value, row.entry_key);
      assert.equal(current.window.document.querySelector("#recurring-base").value, row.ongoing_usd == null ? "" : String(row.ongoing_usd));
      current.window.close();
    }
  }
  for (const [html, provider] of [[HISTORICAL.html, "enhance-md"], [BUILT, CURRENT.eligible[0]]]) {
    const unavailable = boot(html, "?" + new URLSearchParams({ provider, medication: "__c02_missing_entry__", first: "169", recurring: "169" }));
    const page = unavailable.window.document;
    assert.equal(page.querySelector("#provider").value, "", "unknown saved entry must not select a substitute");
    assert.equal(page.querySelector("#medication").value, "");
    assert.equal(page.querySelector("#first-base").value, "");
    assert.equal(page.querySelector("#recurring-base").value, "");
    assert.equal(page.querySelector("#cost-result").hidden, true);
    assert.match(page.querySelector("#copy-status").textContent, /saved medication option is unavailable/);
    unavailable.window.close();
  }
  const removed = boot(BUILT, "?provider=enhance-md&medication=compounded-tirzepatide-injection--microdosing-tirzepatide&first=169&recurring=169");
  assert.equal(removed.window.document.querySelector("#provider").value, "");
  assert.equal(removed.window.document.querySelector("#first-base").value, "");
  assert.equal(removed.window.document.querySelector("#cost-result").hidden, true);
  removed.window.close();
});
