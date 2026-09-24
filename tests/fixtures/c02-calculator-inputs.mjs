// C02 test-input producer. Historical prices come only from the unchanged
// failing release fixture; current membership comes only from registry + matrix.
import assert from "node:assert/strict";
import { attachPricingMatrix, renderCostCalculator } from "../../src/cost-calculator.mjs";

const PROFILE = "glp-clinic-scout";
const renderId = (program) => program.review_slug || program.program_id;
const sorted = (values) => [...values].sort();

export function currentCalculatorExpectation(registry, matrix) {
  const rawIds = registry.programs.map((program) => program.program_id);
  assert.equal(new Set(rawIds).size, rawIds.length, "duplicate raw registry identity");
  const active = registry.programs.filter((program) => {
    const profile = program.profiles?.[PROFILE];
    return program.commercial_state === "live" && profile?.vertical_fit === true
      && profile?.wired === true && profile?.surfaces?.review === true;
  });
  const renderIds = active.map(renderId);
  assert.equal(new Set(renderIds).size, renderIds.length, "duplicate active render identity");
  const canonical = active.filter((program) => program.profiles[PROFILE].canonical_identity?.role !== "alias");
  const inventory = sorted(canonical.map(renderId));
  for (const program of active) {
    const declaration = program.profiles[PROFILE].canonical_identity;
    if (declaration?.role === "alias") assert.ok(inventory.includes(declaration.canonical_program_id), "missing canonical alias target");
  }
  assert.deepEqual(sorted(Object.keys(registry.provider_dynamic_profiles.profiles)), inventory,
    "raw registry and generated owner membership differ");
  const rows = new Map();
  const eligible = [];
  for (const program of canonical) {
    const id = renderId(program);
    const entry = matrix.providers[id];
    assert.ok(entry && Array.isArray(entry.medications), `${id}: matrix inventory missing`);
    assert.equal(entry.program_id, id);
    if (!entry.medications.length) assert.ok(String(entry.unavailable_reason || "").length > 20, `${id}: missing unavailable reason`);
    rows.set(id, entry.medications);
    // Independent specification, not a call to the selector under test.
    const cash = entry.medications.some((row) => !Object.hasOwn(row, "price_kind")
      && row.medication_id !== "membership-only"
      && Number.isFinite(row.month_1_usd) && row.month_1_usd > 0
      && Number.isFinite(row.ongoing_usd) && row.ongoing_usd > 0);
    if (program.profiles[PROFILE].surfaces.calculator === true && cash) eligible.push(id);
  }
  return { inventory, eligible: sorted(eligible), excluded: inventory.filter((id) => !eligible.includes(id)), rows };
}

export function historicalCalculatorFixture(preFix, config) {
  const match = /window\.GCS_COST_PROVIDERS=(\[[\s\S]*?\]);<\/script>/.exec(preFix);
  assert.ok(match, "historical release payload missing");
  const captured = JSON.parse(match[1]);
  assert.deepEqual(captured.map((provider) => provider.program_id), ["enhance-md"]);
  assert.equal(captured[0].medications.length, 3);
  const matrix = { schema: "glp-provider-pricing-matrix-v1", providers: {
    "enhance-md": { program_id: "enhance-md", medications: structuredClone(captured[0].medications) },
  } };
  const providers = structuredClone(captured);
  attachPricingMatrix(providers, matrix);
  const medications = providers.flatMap((provider) => provider.medications);
  const data = { ...config, providers, registry_calculator_ids: ["enhance-md"], pricing_coverage: {
    providers: providers.length,
    with_evidenced_pricing: providers.filter((provider) => provider.medications.length).length,
    pricing_unavailable: providers.filter((provider) => !provider.medications.length).length,
    medication_rows: medications.length,
    rows_with_intro_month_1: medications.filter((row) => row.month_1_basis === "intro").length,
  } };
  assert.deepEqual(JSON.parse(match[1]), captured, "historical input must not be mutated");
  return { matrix, providers, html: renderCostCalculator(data) };
}
