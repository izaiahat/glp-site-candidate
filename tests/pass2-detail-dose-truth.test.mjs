import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPass2DoseCapture, renderDosePricing } from "../src/phase3-page-graph.mjs";

const pricingMatrix = JSON.parse(await readFile(new URL("../data/provider-pricing-matrix.json", import.meta.url), "utf8"));

// Ruling item 8: the rendered-ladder totals are COMPUTED from the matrix, never hardcoded.
// The matrix carries no dose_pricing today because the S8 pricing-waiver rulings
// mademed:0:compounded-semaglutide-injection and mademed:2:compounded-tirzepatide-injection
// moved MadeMed's exact ladders to PENDING (data/pricing-waivers/S8-rulings.json). The guard is
// NOT tautological: a historical exact ladder may only disappear WITH its own PENDING waiver
// receipt, so a ladder dropped silently - without a ruling naming it - still fails this test.
const s8Rulings = JSON.parse(await readFile(new URL("../data/pricing-waivers/S8-rulings.json", import.meta.url), "utf8"));
const exactLadderRows = (entry) => (entry?.medications || []).filter((row) =>
  row.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE" && row.dose_pricing.render_action === "RENDER");
const liveLadders = Object.values(pricingMatrix.providers || {}).flatMap((entry) =>
  exactLadderRows(entry).map((row) => ({ program_id: entry.program_id, medication_id: row.medication_id, tiers: (row.dose_pricing.tiers || []).length })));
const expectedMedicationRows = liveLadders.length;
const expectedDoseSlots = liveLadders.reduce((total, row) => total + row.tiers, 0);
const historicalLadders = s8Rulings.filter((ruling) =>
  ruling.baseline_row?.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE"
  && ruling.baseline_row.dose_pricing.render_action === "RENDER");

test("Option C dose UI renders only exact source-reported per-dose rows", () => {
  let renderedMedicationRows = 0;
  let renderedDoseSlots = 0;
  for (const provider of Object.values(pricingMatrix.providers || {})) {
    for (const medication of provider.medications || []) {
      const html = renderDosePricing({
        program_id: provider.program_id,
        medications: [medication],
      }, loadPass2DoseCapture());
      const exact = medication.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE" && medication.dose_pricing.render_action === "RENDER";
      if (!exact) {
        assert.equal(html, "", `${provider.program_id}/${medication.medication_id}: unknown dose context must be omitted`);
        continue;
      }
      renderedMedicationRows += 1;
      renderedDoseSlots += medication.dose_pricing.tiers.length;
      assert.match(html, /data-dose-model="source-reported-per-dose"/);
      assert.match(html, /data-citation="first_party_price_evidence"/);
      assert.match(html, /<span class="p3-provenance">SOURCE-REPORTED<\/span>/);
      assert.equal((html.match(/data-dose-row=/g) || []).length, medication.dose_pricing.tiers.length);
      assert.doesNotMatch(html, /UNKNOWN_NO_SOURCE|Not published|reserved/i);
    }
  }
  // Ruling item 8: computed totals + the receipted retirement guard (never a hardcoded count).
  assert.ok(historicalLadders.length >= 1, "S8-rulings.json must still carry the historical exact-ladder receipts");
  for (const ruling of historicalLadders) {
    const stillLive = liveLadders.some((row) => row.program_id === ruling.provider_id
      && row.medication_id === ruling.baseline_row.medication_id);
    if (stillLive) continue;
    assert.equal(ruling.status, "PENDING", `${ruling.row_id}: exact ladder retired without a PENDING S8 waiver ruling`);
    assert.ok(String(ruling.candidate_provider?.unavailable_reason || "").trim().length > 0,
      `${ruling.row_id}: a retired exact ladder needs its unavailable_reason receipt`);
  }
  assert.equal(renderedMedicationRows, expectedMedicationRows);
  assert.equal(renderedDoseSlots, expectedDoseSlots);
});

test("legacy flat, plan-tiered, and unpublished dose models reserve no UI", () => {
  const capture = loadPass2DoseCapture();
  for (const [programId, provider] of Object.entries(capture.providers)) {
    for (const medication of provider.medications) {
      assert.equal(renderDosePricing({
        program_id: programId,
        medications: [medication],
      }, capture), "", `${programId}/${medication.medication_id}`);
    }
  }
});
