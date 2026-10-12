import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateTherapeuticTaxonomy,
  validateConsumerTherapeuticAuthorities,
  consumerTherapeuticFilters,
} from "../src/therapeutic-taxonomy.mjs";

// OPERATOR DECISION 2026-10-09 (workflow v3): stale evidence holds back only
// the claim it supports instead of failing the build. Default stays fail-closed.
const registry = JSON.parse(await readFile(new URL("../data/program-registry.json", import.meta.url), "utf8"));
const profile = "glp-clinic-scout";
const doc = registry.therapeutic_taxonomy;
const sealed = new Date(`${doc.sealed_as_of}T12:00:00Z`);
const staleAsOf = new Date(sealed.getTime() + (doc.freshness_max_days + 40) * 86_400_000);

test("default mode still fails closed on a stale taxonomy row", () => {
  assert.throws(() => validateTherapeuticTaxonomy(registry, profile, { asOf: staleAsOf }), /therapeutic_taxonomy_evidence_stale/);
});

test("hold mode keeps the build and names exactly the stale rows", () => {
  const validated = validateTherapeuticTaxonomy(registry, profile, { asOf: staleAsOf, staleEvidence: "hold" });
  const limit = doc.freshness_max_days;
  const expected = Object.values(doc.programs)
    .filter((row) => (staleAsOf - Date.parse(`${row.verified_as_of}T00:00:00Z`)) / 86_400_000 > limit)
    .map((row) => row.program_id).sort();
  assert.ok(expected.length > 0);
  assert.deepEqual([...validated.held_stale], expected);
  const fresh = validateTherapeuticTaxonomy(registry, profile, { asOf: sealed, staleEvidence: "hold" });
  assert.deepEqual([...fresh.held_stale], []);
});

test("hold mode never relaxes integrity: hash drift still fails", () => {
  const forged = structuredClone(registry);
  const pid = Object.keys(forged.therapeutic_taxonomy.programs)[0];
  forged.therapeutic_taxonomy.programs[pid].molecule_tags = [...forged.therapeutic_taxonomy.programs[pid].molecule_tags, "retatrutide"].sort();
  assert.throws(() => validateTherapeuticTaxonomy(forged, profile, { asOf: sealed, staleEvidence: "hold" }), /normalized_hash_mismatch|expected_counts_mismatch/);
});

test("stale consumer authority is held as unavailable, never positive", () => {
  const asOf = new Date("2027-06-01T12:00:00Z");
  const dynamicAsOf = new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`);
  assert.throws(() => validateConsumerTherapeuticAuthorities(registry, profile, { asOf }), /consumer_authority/);
  // Dynamic profiles are validated at their own sealed date; only the authority clock is stale.
  const dynamic = { profiles: new Map() };
  void dynamicAsOf;
  const held = validateConsumerTherapeuticAuthorities(registry, profile, { asOf, dynamic, staleEvidence: "hold" });
  assert.equal(held.retatrutide.claim_held_stale, true);
  assert.equal(held.retatrutide.lawful_regulatory_authority_positive, false);
  assert.equal(held.retatrutide.consumer_available, false);
  const filters = consumerTherapeuticFilters(registry, profile, { asOf, dynamic, staleEvidence: "hold" });
  assert.ok(!filters.some((item) => item.value === "retatrutide"));
});

test("GLP-361 registered-build wire-in seam carries the GLP-353 hold; default reconcile stays fail-closed", async () => {
  const { reconcileTherapeuticTaxonomyWireIn } = await import("../src/therapeutic-taxonomy.mjs");
  const pages = JSON.parse(await readFile(new URL("../data/money-page-specs.json", import.meta.url), "utf8")).pages;
  const quizConfig = JSON.parse(await readFile(new URL("../data/quiz-config.json", import.meta.url), "utf8"));
  assert.throws(() => reconcileTherapeuticTaxonomyWireIn({ registry: structuredClone(registry), profileId: profile,
    pages, quizConfig, asOf: staleAsOf }), /therapeutic_taxonomy_evidence_stale/);
  const held = structuredClone(registry);
  reconcileTherapeuticTaxonomyWireIn({ registry: held, profileId: profile, pages, quizConfig, asOf: staleAsOf, staleEvidence: "hold" });
  // The hold stays visible downstream: stale rows are still named, and default validation still refuses them.
  assert.ok(validateTherapeuticTaxonomy(held, profile, { asOf: staleAsOf, staleEvidence: "hold" }).held_stale.length > 0);
  assert.throws(() => validateTherapeuticTaxonomy(held, profile, { asOf: staleAsOf }), /therapeutic_taxonomy_evidence_stale/);
  const source = await readFile(new URL("../scripts/build-staging.mjs", import.meta.url), "utf8");
  assert.match(source, /reconcileTherapeuticTaxonomyWireIn\(\{[^}]*staleEvidence: "hold",\s*\}\);/s);
});
