import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MEDICATION_PREFERENCES,
  THERAPEUTIC_FILTERS,
  TREATMENT_FILTERS,
  candidatesForMedicationPreference,
  deriveFacetCounts,
  matchesTherapeuticFacets,
  validateTherapeuticTaxonomy,
} from "../src/therapeutic-taxonomy.mjs";

const registry = JSON.parse(await readFile(new URL("../data/program-registry.json", import.meta.url), "utf8"));
const sealedDate = registry.therapeutic_taxonomy.sealed_as_of;
const asOf = new Date(`${sealedDate}T12:00:00Z`);
const expectedCounts = registry.therapeutic_taxonomy.expected_counts;

test("Build 6 taxonomy is a 29-provider evidence-bound projection with exact accepted counts", () => {
  const validated = validateTherapeuticTaxonomy(registry, "glp-clinic-scout", { asOf });
  assert.equal(validated.programs.size, expectedCounts.provider_rows);
  assert.deepEqual(validated.counts, expectedCounts);
  assert.deepEqual(deriveFacetCounts(validated.programs), expectedCounts);
  assert.deepEqual(THERAPEUTIC_FILTERS.map(({ value }) => value), [
    "semaglutide", "tirzepatide", "retatrutide", "wegovy", "zepbound", "mounjaro", "oral", "injectable",
  ]);
  assert.deepEqual(TREATMENT_FILTERS.map(({ value }) => value), ["compounded", "brand_name", "either"]);
  assert.deepEqual(MEDICATION_PREFERENCES, [
    "semaglutide", "tirzepatide", "retatrutide", "wegovy", "zepbound", "mounjaro", "oral", "injectable", "not_sure",
  ]);
});

test("Build 6 facets use therapeutic union and treatment intersection without guessing unknowns", () => {
  const { programs } = validateTherapeuticTaxonomy(registry, "glp-clinic-scout", { asOf });
  const rows = [...programs.values()];
  const select = (therapeutics, treatment = "all") => rows.filter((row) => matchesTherapeuticFacets(row, therapeutics, treatment));
  assert.equal(select(["semaglutide"]).length, expectedCounts.semaglutide);
  assert.equal(select(["tirzepatide"]).length, expectedCounts.tirzepatide);
  assert.equal(select(["semaglutide", "tirzepatide"]).length, new Set([...select(["semaglutide"]), ...select(["tirzepatide"])].map((row) => row.program_id)).size);
  assert.equal(select(["retatrutide"]).length, expectedCounts.retatrutide);
  assert.equal(select([], "compounded").length, expectedCounts.compounded);
  assert.equal(select([], "brand_name").length, expectedCounts.brand_name);
  assert.equal(select([], "either").length, new Set([...select([], "compounded"), ...select([], "brand_name")].map((row) => row.program_id)).size);
  assert.equal(select([], "all").length, expectedCounts.provider_rows);
  assert.equal(select(["retatrutide"], "compounded").length, 0);
  assert.deepEqual(programs.get("trt-nation").molecule_tags, ["tirzepatide"]);
  assert.deepEqual(programs.get("strut-health").molecule_tags, ["semaglutide"]);
  assert.deepEqual(programs.get("serena-health").treatment_type_tags, []);
  assert.equal(programs.get("serena-health").treatment_type_state, "not_verified");
  // 2026-08-18: AFF-TRT-001 content-fit hold lifted against a receipted
  // link-click QA on the verified weight-loss deep link, so the taxonomy's
  // commercial link state follows the registry into live on both surfaces.
  assert.equal(programs.get("trt-nation").commercial_link_state.compare, "live");
  assert.equal(programs.get("trt-nation").commercial_link_state.quiz, "live");
});

test("Build 6b medication preference is exact-tag only; unavailable retatrutide fails closed", () => {
  const { programs } = validateTherapeuticTaxonomy(registry, "glp-clinic-scout", { asOf });
  const candidates = [...programs.values()].map((row) => ({ program_id: row.program_id, therapeutic_taxonomy: row }));
  assert.equal(candidatesForMedicationPreference(candidates, "semaglutide").length, expectedCounts.semaglutide);
  assert.equal(candidatesForMedicationPreference(candidates, "tirzepatide").length, expectedCounts.tirzepatide);
  assert.equal(candidatesForMedicationPreference(candidates, "retatrutide").length, expectedCounts.retatrutide);
  assert.equal(candidatesForMedicationPreference(candidates, "not_sure").length, expectedCounts.provider_rows);
  assert.equal(candidatesForMedicationPreference(candidates, "unsupported").length, 0);
});

test("Build 6 taxonomy rejects stale evidence before a named facet or quiz can use it", () => {
  const hostile = structuredClone(registry);
  hostile.therapeutic_taxonomy.programs["trt-nation"].verified_as_of = "2020-01-01";
  assert.throws(
    () => validateTherapeuticTaxonomy(hostile, "glp-clinic-scout", { asOf }),
    /therapeutic_taxonomy_evidence_stale:trt-nation/,
  );
});
