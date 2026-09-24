// The derived merit ranking is the thing that killed the two-tier site: it is why
// a newly wired provider can hold a ranked comparison row without anyone inventing
// a score for it. These tests pin the properties that make that safe.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DERIVATION_ID,
  OPERATOR_BASIS_ID,
  RUBRIC_WEIGHTS,
  applyMeritScores,
  deriveCriteriaScores,
  meritOrder,
  meritScore,
} from "../src/merit-ranking.mjs";
import { scoreProvider } from "../src/money-page.mjs";

const readJson = async (relative) => JSON.parse(await readFile(new URL(`../data/${relative}`, import.meta.url), "utf8"));
const ledger = await readJson("program-content-ledger.json");
const registry = await readJson("program-registry.json");
const money = await readJson("money-page-specs.json");
const { comparablePriceProviderIds } = await import("../src/provider-dynamic-profiles.mjs");
const comparablePriceIds = comparablePriceProviderIds(registry, "glp-clinic-scout", {
  asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
});
const scored = structuredClone(ledger);
applyMeritScores(scored.programs, { comparablePriceIds });

const liveIds = new Set(registry.programs
  .filter((program) => {
    const profile = program.profiles["glp-clinic-scout"];
    return program.commercial_state === "live" && profile?.vertical_fit === true
      && profile?.wired === true && profile.surfaces.review === true;
  })
  .map((program) => String(program.review_slug || program.program_id)));

test("the rubric this file scores against is the rubric the money pages publish", () => {
  assert.deepEqual(RUBRIC_WEIGHTS, money.rubric);
  assert.equal(Object.values(RUBRIC_WEIGHTS).reduce((total, weight) => total + weight, 0), 100);
});

test("every live provider ends up with a real score and a recorded basis", () => {
  for (const entry of scored.programs) {
    if (!liveIds.has(entry.program_id)) continue;
    const score = meritScore(entry);
    assert.ok(Number.isFinite(score), `${entry.program_id} has no derivable score`);
    assert.ok(score >= 0 && score <= 100, `${entry.program_id} score out of range: ${score}`);
    assert.ok([DERIVATION_ID, OPERATOR_BASIS_ID].includes(entry.score_basis), `${entry.program_id} basis missing`);
  }
  assert.equal(scored.programs.filter((entry) => liveIds.has(entry.program_id)).length, liveIds.size);
});

test("operator-reviewed criteria are never overwritten by the derivation", () => {
  const before = new Map(ledger.programs.map((entry) => [entry.program_id, entry.criteria_scores]));
  for (const entry of scored.programs) {
    if (entry.score_basis !== OPERATOR_BASIS_ID) continue;
    assert.deepEqual(entry.criteria_scores, before.get(entry.program_id), `${entry.program_id} was overwritten`);
  }
});

test("the ranking function is the one the money page renders with", () => {
  for (const entry of scored.programs) assert.equal(meritScore(entry), scoreProvider(entry), entry.program_id);
});

test("derivation is pure: same ledger in, same numbers out", () => {
  for (const entry of ledger.programs) {
    const first = deriveCriteriaScores(entry, { comparablePriceIds });
    const second = deriveCriteriaScores(entry, { comparablePriceIds });
    assert.deepEqual(first, second, entry.program_id);
  }
});

test("public reviews are never scored from provider-hosted material", () => {
  for (const entry of scored.programs) assert.equal(entry.criteria_scores.public_reviews, 0, entry.program_id);
});

test("a provider that publishes nothing scores zero rather than a category average", () => {
  const { criteria_scores } = deriveCriteriaScores({ program_id: "synthetic-empty" });
  assert.deepEqual(criteria_scores, {
    price_transparency: 0, medical_oversight: 0, insurance_support: 0, public_reviews: 0, shipping_transparency: 0,
  });
});

test("publishing one more sourced field can only raise a score, and does raise it", () => {
  const base = {
    program_id: "synthetic",
    insurance: "Cash-pay only.",
    meds_offered: "Compounded semaglutide; prescription and clinician approval required",
    starting_price: "From $149/month",
    source_url: "https://example.test/pricing",
  };
  const withShipping = {
    ...base,
    research_shipping_wait: { value: "Ships in 3-5 business days", source_url: "https://example.test/shipping", verified_as_of: "2026-08-06" },
  };
  assert.ok(meritScore({ criteria_scores: deriveCriteriaScores(withShipping).criteria_scores })
    > meritScore({ criteria_scores: deriveCriteriaScores(base).criteria_scores }));
});

test("a not_publicly_stated finding earns no points - it is a gap, not evidence", () => {
  const withFinding = {
    program_id: "synthetic",
    research_states_served: { value: null, state: "not_publicly_stated", source_url: "https://example.test/", verified_as_of: "2026-08-06" },
  };
  assert.equal(deriveCriteriaScores(withFinding).criteria_scores.medical_oversight, 0);
});

test("an undated or unsourced research value earns no points", () => {
  const undated = { program_id: "synthetic", research_pharmacy_type: { value: "503A pharmacy", source_url: "https://example.test/" } };
  const unsourced = { program_id: "synthetic", research_pharmacy_type: { value: "503A pharmacy", verified_as_of: "2026-08-06" } };
  assert.equal(deriveCriteriaScores(undated).criteria_scores.medical_oversight, 0);
  assert.equal(deriveCriteriaScores(unsourced).criteria_scores.medical_oversight, 0);
});

test("merit order is total, stable, and reorders when a provider outscores an incumbent", () => {
  const ordered = meritOrder(scored.programs);
  assert.equal(ordered.length, scored.programs.length);
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(meritScore(ordered[index - 1]) >= meritScore(ordered[index]), "order is not monotonic");
  }
  assert.deepEqual(meritOrder(scored.programs).map((entry) => entry.program_id), ordered.map((entry) => entry.program_id));

  const incumbent = ordered[3];
  const challenger = { ...ordered[10], program_id: "synthetic-challenger", display_name: "AAA Challenger" };
  challenger.criteria_scores = { ...challenger.criteria_scores, price_transparency: 100, medical_oversight: 100, insurance_support: 100, shipping_transparency: 100, public_reviews: 0 };
  const reordered = meritOrder([...scored.programs, challenger]);
  assert.equal(reordered[0].program_id, "synthetic-challenger");
  assert.ok(reordered.indexOf(challenger) < reordered.findIndex((entry) => entry.program_id === incumbent.program_id));
});

test("no comparison row anywhere is missing its criteria - a null score would silently sink a provider", () => {
  const byId = new Map(scored.programs.map((entry) => [entry.program_id, entry]));
  for (const page of money.pages) {
    for (const row of page.rows || []) {
      const entry = byId.get(row.program_id);
      assert.ok(entry, `comparison row with no ledger entry: ${row.program_id}`);
      assert.ok(Number.isFinite(meritScore(entry)), `unscoreable comparison row: ${row.program_id}`);
    }
  }
});
