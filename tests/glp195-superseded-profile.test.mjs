import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  REQUIRED_RESEARCH_EVIDENCE_FIELDS,
  reconcileProviderDynamicProfilesWireIn,
  validateProviderDynamicProfiles,
} from "../src/provider-dynamic-profiles.mjs";

// Synthetic contract inputs, not provider facts or production evidence. No private
// registry, build output, clock override, network request or tracking URL needed.
const profileId = "glp-clinic-scout";
const id = "synthetic-profile";
const asOf = new Date("2026-09-26T12:00:00Z");
const source = "https://synthetic.example/evidence";
const taxonomy = {
  molecule_tags: ["semaglutide"], brand_name_tags: [],
  delivery_form_tags: ["oral"], treatment_type_tags: ["compounded"],
};
function research(date, tags = taxonomy) {
  const text = "Synthetic fixture: compounded oral semaglutide; comparable prices are not verified.";
  return {
    version: 1, verified_as_of: date, taxonomy: structuredClone(tags),
    calculator: {
      mode: "manual", first_month_base_usd: null, recurring_month_base_usd: null,
      one_time_fee_usd: null, source_url: source, checked_as_of: date,
      price_context: "Synthetic fixture has no comparable price evidence.",
      evidence_gap_copy: "Enter your own quoted amounts; comparable prices are not verified.",
    },
    evidence_bindings: [{
      fields: [...REQUIRED_RESEARCH_EVIDENCE_FIELDS], source_url: source,
      verified_as_of: date, evidence_text: text,
      evidence_sha256: createHash("sha256").update(text).digest("hex"),
    }],
  };
}
function fixture() {
  const registry = {
    programs: [{
      program_id: id, display_name: "Synthetic Profile", commercial_state: "live",
      profiles: { [profileId]: {
        vertical_fit: true, wired: true,
        surfaces: { review: true, compare: true, quiz: true, calculator: true },
      } },
      research_dynamic_profile: research("2026-09-26"),
    }],
    therapeutic_taxonomy: { programs: {
      [id]: { ...structuredClone(taxonomy), source_urls: [source] },
    } },
    provider_dynamic_profiles: {
      schema: "glp-provider-dynamic-profiles-v1", version: 1,
      sealed_as_of: "2026-09-26", freshness_max_days: 45,
      required_surfaces: ["compare", "quiz", "calculator", "counts", "suggestions"],
      profiles: {},
    },
  };
  reconcile(registry);
  validateProviderDynamicProfiles(registry, profileId, { asOf });
  return registry;
}
const reconcile = (registry, clock = asOf) => reconcileProviderDynamicProfilesWireIn({ registry, profileId, asOf: clock });
function rejectsWithoutMutation(registry, expected) {
  const before = structuredClone(registry);
  assert.throws(() => reconcile(registry), expected);
  assert.deepEqual(registry, before, "refusal must not partially mutate any registry state");
}

test("GLP-195: malformed old Oak-shaped payload cannot hide behind a newer valid profile", () => {
  const registry = fixture();
  registry.programs[0].research_dynamic_profile = { version: 1, verified_as_of: "2020-01-01" };
  rejectsWithoutMutation(registry, /provider_dynamic_profile_field_invalid:synthetic-profile:research.taxonomy.molecule_tags/);
});

test("superseded input still requires a calculator", () => {
  const registry = fixture();
  const old = research("2020-01-01");
  delete old.calculator;
  registry.programs[0].research_dynamic_profile = old;
  rejectsWithoutMutation(registry, /provider_dynamic_profile_field_invalid:synthetic-profile:source_urls/);
});

test("superseded input still requires exact evidence bytes", () => {
  const registry = fixture();
  const old = research("2020-01-01");
  old.evidence_bindings[0].evidence_text += " unbound drift";
  registry.programs[0].research_dynamic_profile = old;
  rejectsWithoutMutation(registry, /provider_dynamic_profile_evidence_bytes_hash_mismatch/);
});

test("superseded taxonomy still needs literal claim support", () => {
  const registry = fixture();
  registry.programs[0].research_dynamic_profile = research("2020-01-01", {
    ...taxonomy, molecule_tags: ["tirzepatide"],
  });
  rejectsWithoutMutation(registry, /provider_dynamic_profile_taxonomy_evidence_semantics_missing/);
});

test("valid historical research retains current profile and checks its own historical taxonomy", () => {
  const registry = fixture();
  // A historical unknown treatment is valid at its original clock, even though
  // the current registry has a positive compounded tag. It must not replace it.
  registry.programs[0].research_dynamic_profile = research("2020-01-01", {
    ...taxonomy, treatment_type_tags: [],
  });
  const before = structuredClone(registry);
  const result = reconcile(registry);
  assert.equal(result.profiles.get(id).verified_as_of, "2026-09-26");
  assert.deepEqual(result.profiles.get(id).taxonomy.treatment_type_tags, ["compounded"]);
  assert.deepEqual(registry, before);
  reconcile(registry);
  assert.deepEqual(registry, before, "valid historical replay is idempotent");
});

test("current research applies deterministically and preserves null unknown amounts", () => {
  const registry = fixture();
  registry.programs[0].research_dynamic_profile.calculator.price_context += " New fixture qualification.";
  const result = reconcile(registry);
  assert.match(result.profiles.get(id).calculator.price_context, /New fixture qualification/);
  assert.equal(result.profiles.get(id).calculator.first_month_base_usd, null);
  const once = structuredClone(registry);
  reconcile(registry);
  assert.deepEqual(registry, once);
});

test("historical validation cannot lend its clock to a stale current profile", () => {
  const registry = fixture();
  registry.programs[0].research_dynamic_profile = research("2020-01-01");
  const before = structuredClone(registry);
  assert.throws(() => reconcile(registry, new Date("2026-12-26T12:00:00Z")), /provider_dynamic_profile_evidence_stale/);
  assert.deepEqual(registry, before);
});
