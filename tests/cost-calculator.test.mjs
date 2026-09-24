import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCostCalculatorData, costCalculatorDropdownProviders, renderCostCalculator } from "../src/cost-calculator.mjs";
import { validateProviderDynamicProfiles } from "../src/provider-dynamic-profiles.mjs";
import { currentCalculatorExpectation } from "./fixtures/c02-calculator-inputs.mjs";

const readJson = async (relative) => JSON.parse(await readFile(new URL(`../data/${relative}`, import.meta.url), "utf8"));

test("cost calculator inventories every live provider from dated source-ledger values", async () => {
  const config = await readJson("cost-calculator.json");
  const money = await readJson("money-page-specs.json");
  const providerPages = await readJson("provider-page-contracts.json");
  const providerFastpath = await readJson("provider-fastpath-contract.json");
  const registry = await readJson("program-registry.json");
  const matrix = await readJson("provider-pricing-matrix.json");
  const expectedInput = currentCalculatorExpectation(registry, matrix);
  const data = buildCostCalculatorData(config, money.pages, providerPages, providerFastpath, registry, "glp-clinic-scout", new Set(), matrix);
  const dynamic = validateProviderDynamicProfiles(registry, "glp-clinic-scout", {
    asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
  });
  const expected = new Set(dynamic.canonicalIds);
  assert.equal(data.providers.length, expected.size);
  assert.deepEqual(new Set(data.providers.map((provider) => provider.program_id)), expected);
  for (const provider of data.providers) {
    assert.match(provider.source_url, /^https:\/\//);
    assert.match(provider.checked_as_of, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(provider.price_context.length >= 20);
    const owner = registry.provider_dynamic_profiles.profiles[provider.program_id];
    for (const [field, value] of Object.entries(owner.calculator)) assert.deepEqual(provider[field], value, `${provider.program_id}: ${field}`);
    for (const row of provider.medications) {
      if (Object.hasOwn(row, "price_kind")) {
        assert.equal(row.display_only, true);
        for (const field of ["month_1_usd", "ongoing_usd", "month_1_basis", "cadence"]) assert.equal(Object.hasOwn(row, field), false);
      }
    }
  }
  const enhance = data.providers.find((provider) => provider.program_id === "enhance-md");
  assert.equal(enhance.mode, "manual");
  assert.equal(enhance.first_month_base_usd, null);
  assert.equal(enhance.recurring_month_base_usd, null);
  assert.ok(enhance.evidence_gap_copy.length > 20);
  const shed = data.providers.find((provider) => provider.program_id === "shedrx");
  assert.equal(shed.mode, "manual");
  assert.equal(shed.first_month_base_usd, null);
  assert.equal(shed.recurring_month_base_usd, null);
  // Synergy RX used to be the "prices published, cadence unknown" case here.
  // Katalys paused it on 2026-08-17 and its registry row was removed, so the
  // calculator must not offer it at all.
  assert.equal(data.providers.some((provider) => provider.program_id === "synergy-rx"), false);
  const dropdown = costCalculatorDropdownProviders(data);
  assert.equal(dropdown.eligible.length + dropdown.excluded.length, dynamic.counts.provider_identities);
  // Editorial membership is retained even when current pricing is display-only.
  assert.equal(data.providers.some((provider) => provider.program_id === "trt-nation"), true);
  assert.deepEqual(data.providers.map((provider) => provider.program_id).sort(), expectedInput.inventory);
  assert.deepEqual(dropdown.eligible.map((provider) => provider.program_id).sort(), expectedInput.eligible);
  assert.deepEqual(dropdown.excluded.map((provider) => provider.program_id).sort(), expectedInput.excluded);
  assert.equal(dropdown.eligible.some((provider) => provider.program_id === "enhance-md"), false);
  assert.equal(data.providers.filter((provider) => provider.mode === "autofill").length, dynamic.counts.calculator_autofill);
  assert.equal(data.providers.filter((provider) => provider.mode === "manual").length, dynamic.counts.calculator_manual);
});

test("cost calculator is shareable, local-only, and makes unknowns explicit", async () => {
  const config = await readJson("cost-calculator.json");
  const money = await readJson("money-page-specs.json");
  const providerPages = await readJson("provider-page-contracts.json");
  const providerFastpath = await readJson("provider-fastpath-contract.json");
  const registry = await readJson("program-registry.json");
  const html = renderCostCalculator(buildCostCalculatorData(config, money.pages, providerPages, providerFastpath, registry));
  for (const needle of ["cost-form", "first-base", "recurring-base", "one-time", "add-ons", "discount", "copy-cost-link", "cost_calculator_complete", "/providers/\\?sort=cheapest", "/quiz/provider-fit/"]) assert.match(html, new RegExp(needle));
  assert.match(html, /Free planning tool · no signup/);
  assert.match(html, /data-mode="manual"/);
  assert.match(html, /Every compared provider is selectable/);
  assert.match(html, /\.cost-form select\{appearance:none/);
  assert.match(html, /background-image:url\("data:image\/svg\+xml/);
  assert.match(html, /\.cost-form select:hover\{border-bottom-color:#bff5df/);
  assert.match(html, /\.cost-form select:focus-visible/);
  assert.doesNotMatch(html, /action="|fetch\(|XMLHttpRequest|email|phone|medical eligibility/i);
});
