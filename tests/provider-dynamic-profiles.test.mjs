import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { historicalRetatrutideInputs } from './fixtures/historical-retatrutide-inputs.mjs';
import {
  deriveDynamicFacetCounts,
  providerSuggestions,
  reconcileProviderDynamicProfilesWireIn,
  validateProviderDynamicProfiles,
} from "../src/provider-dynamic-profiles.mjs";
import { buildCostCalculatorData, costCalculatorDropdownProviders } from "../src/cost-calculator.mjs";
import {
  projectTherapeuticSurfaces,
  reconcileTherapeuticTaxonomyWireIn,
  testOnlyReadExactLocalCapture,
  validateConsumerTherapeuticAuthorities,
} from "../src/therapeutic-taxonomy.mjs";

const json = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
const registry = await json("../data/program-registry.json");
const money = await json("../data/money-page-specs.json");
const quiz = await json("../data/quiz-config.json");
const calculator = await json("../data/cost-calculator.json");
const providerContracts = await json("../data/provider-page-contracts.json");
const fastpath = await json("../data/provider-fastpath-contract.json");
const asOf = new Date(`${[registry.provider_dynamic_profiles.sealed_as_of, registry.therapeutic_taxonomy.sealed_as_of].sort().at(-1)}T12:00:00Z`);
// Fixture evidence is relative to the sealed clock, not a date that expires on reseal.
const fixtureEvidenceDate = asOf.toISOString().slice(0, 10);
const researchFields = [
  "calculator.checked_as_of", "calculator.evidence_gap_copy", "calculator.first_month_base_usd",
  "calculator.mode", "calculator.one_time_fee_usd", "calculator.price_context",
  "calculator.recurring_month_base_usd", "calculator.source_url", "taxonomy.brand_name_tags",
  "taxonomy.delivery_form_tags", "taxonomy.molecule_tags", "taxonomy.treatment_type_tags", "verified_as_of",
].sort();
const evidenceBinding = (source, date, text = "Synthetic Dynamic Clinic currently offers compounded oral semaglutide; exact comparable first and recurring prices are not verified.") => ({
  fields: researchFields, source_url: source, verified_as_of: date, evidence_text: text,
  evidence_sha256: createHash("sha256").update(text).digest("hex"),
});

function canonicalMoneyPages(sourceRegistry, sourceMoney) {
  const aliases = new Set(sourceRegistry.programs
    .filter((program) => program.profiles?.["glp-clinic-scout"]?.canonical_identity?.role === "alias")
    .map((program) => String(program.review_slug || program.program_id)));
  return sourceMoney.pages.map((page) => ({
    ...page,
    rows: (page.rows || []).filter((row) => !aliases.has(row.program_id)),
  }));
}

function canonicalQuiz(sourceRegistry, sourceQuiz) {
  // Mirror the build's projection: aliases never enter a list surface, and a
  // program whose registry row scopes the quiz surface off (documented
  // surface_restriction_basis — trt-nation, 2026-08-13) is not a candidate.
  const scopedOff = new Set(sourceRegistry.programs
    .filter((program) => {
      const profile = program.profiles?.["glp-clinic-scout"];
      return profile?.canonical_identity?.role === "alias" || profile?.surfaces?.quiz === false;
    })
    .map((program) => String(program.review_slug || program.program_id)));
  return { ...sourceQuiz, candidates: sourceQuiz.candidates.filter((row) => !scopedOff.has(row.program_id)) };
}

function syntheticFixture({ registry, money, quiz, asOf }) {
  const fixtureEvidenceDate = asOf.toISOString().slice(0, 10);
  const nextRegistry = structuredClone(registry);
  const nextMoney = structuredClone(money);
  const nextQuiz = structuredClone(quiz);
  const id = "synthetic-dynamic-clinic";
  const source = "https://synthetic.example/current-program";
  nextRegistry.programs.push({
    commercial_state: "live",
    display_name: "Synthetic Dynamic Clinic",
    program_id: id,
    review_path: `/reviews/${id}/`,
    source_kind: "synthetic-test-only",
    profiles: {
      "glp-clinic-scout": {
        vertical_fit: true,
        wired: true,
        surfaces: { review: true, compare: true, quiz: true, calculator: true },
        exceptions: {},
      },
    },
    research_therapeutic_taxonomy: {
      authority_path: "reports/glp-clinic-scout/affiliate-machine/synthetic-dynamic.json",
      authority_sha256: "a".repeat(64),
      source_url: source,
      verified_as_of: fixtureEvidenceDate,
      evidence_sha256: "b".repeat(64),
      classification_state: "WIRE_IN_EXPLICIT",
      molecule_tags: ["semaglutide"],
      brand_name_tags: [],
      delivery_form_tags: ["oral"],
      treatment_type_tags: ["compounded"],
      commercial_link_state: { compare: "live", quiz: "editorial_link_dark" },
    },
    research_dynamic_profile: {
      version: 1,
      verified_as_of: fixtureEvidenceDate,
      taxonomy: { molecule_tags: ["semaglutide"], brand_name_tags: [], delivery_form_tags: ["oral"], treatment_type_tags: ["compounded"] },
      evidence_bindings: [evidenceBinding(source, fixtureEvidenceDate)],
      calculator: {
        mode: "manual",
        first_month_base_usd: null,
        recurring_month_base_usd: null,
        one_time_fee_usd: null,
        price_context: "No exact comparable first and recurring prices were verified from this test source.",
        source_url: source,
        checked_as_of: fixtureEvidenceDate,
        evidence_gap_copy: "Enter the current first and recurring prices manually because comparable exact prices were not verified.",
      },
    },
  });
  for (const page of nextMoney.pages) {
    if (!nextRegistry.therapeutic_taxonomy.required_surface_paths.includes(page.path)) continue;
    page.rows.push({
      program_id: id,
      provider: "Synthetic Dynamic Clinic",
      affiliate_href: "https://synthetic.example/start",
      live_link_allowed: true,
      promotion_authorized: true,
      starting_price: "Exact comparable price not verified",
      starting_price_sort: null,
      source_url: source,
    });
  }
  nextQuiz.candidates.push({
    program_id: id,
    display_name: "Synthetic Dynamic Clinic",
    source_clearance: true,
    staging_eligible: true,
    live_link_allowed: false,
    promotion_authorized: false,
    priority_score: 999,
    rules: {},
  });
  return { registry: nextRegistry, money: nextMoney, quiz: nextQuiz, id };
}

test("29 registry rows reconcile to 28 evidence-bound identities shared by suggestions and calculator", () => {
  // Historical all-identities parity predates explicit review-only membership.
  // Keep every original assertion on one authenticated input generation, not
  // today's acquisition pool with its deliberately excluded standalone review.
  const { registry, money, calculator, providerContracts, fastpath, asOf } = historicalRetatrutideInputs();
  const validated = validateProviderDynamicProfiles(registry, "glp-clinic-scout", { asOf });
  assert.equal(registry.therapeutic_taxonomy.expected_counts.provider_rows, Object.keys(registry.therapeutic_taxonomy.programs).length);
  assert.equal(validated.canonicalIds.length, registry.provider_dynamic_profiles.expected_counts.provider_identities);
  assert.deepEqual(validated.counts, registry.provider_dynamic_profiles.expected_counts);
  const shed = validated.profiles.get("shedrx");
  assert.deepEqual(shed.registry_program_ids, ["katalys-1516", "shedrx"]);
  assert.deepEqual(shed.aliases.map((alias) => alias.render_id), ["shed"]);
  assert.equal(validated.profiles.has("shed"), false);

  const suggestions = providerSuggestions(registry, "glp-clinic-scout", { asOf });
  assert.equal(suggestions.length, validated.canonicalIds.length);
  assert.deepEqual(new Set(suggestions.map((item) => item.program_id)), new Set(validated.canonicalIds));

  const data = buildCostCalculatorData(calculator, money.pages, providerContracts, fastpath, registry);
  const dropdown = costCalculatorDropdownProviders(data);
  // Every identity: trt-nation was the one exclusion while it was
  // editorial_link_dark; the 2026-08-18 content-fit lift put it back in the
  // conversion pool with its evidenced $219/mo autofill row. The partition rule
  // is what is asserted - eligible plus excluded is exactly the identity set,
  // and nothing may be excluded without the registry documenting why.
  assert.equal(dropdown.eligible.length + dropdown.excluded.length, validated.canonicalIds.length);
  assert.deepEqual(dropdown.excluded.map((item) => item.program_id), []);
  assert.deepEqual(new Set(dropdown.eligible.map((item) => item.program_id)), new Set(validated.canonicalIds));
});

test("unknown evidence produces no positive facet match and blank manual calculator state", () => {
  const validated = validateProviderDynamicProfiles(registry, "glp-clinic-scout", { asOf });
  for (const id of ["drhouse", "oak-weight-loss-program", "serena-health"]) {
    const profile = validated.profiles.get(id);
    assert.deepEqual(profile.taxonomy.treatment_type_tags, [], id);
    assert.equal(profile.taxonomy.treatment_type_state, "not_verified", id);
  }
  const oak = validated.profiles.get("oak-weight-loss-program");
  assert.deepEqual(oak.taxonomy.molecule_tags, []);
  assert.deepEqual(oak.taxonomy.delivery_form_tags, []);
  assert.equal(oak.calculator.mode, "manual");
  assert.equal(oak.calculator.first_month_base_usd, null);
  assert.equal(oak.calculator.recurring_month_base_usd, null);
  assert.match(oak.calculator.evidence_gap_copy, /Enter the current/i);
});

test("stale, missing, and conflicting dynamic evidence fail closed", () => {
  const stale = structuredClone(registry);
  stale.provider_dynamic_profiles.profiles["oak-weight-loss-program"].verified_as_of = "2020-01-01";
  assert.throws(() => validateProviderDynamicProfiles(stale, "glp-clinic-scout", { asOf }), /provider_dynamic_profile_evidence_stale:oak-weight-loss-program/);

  const missing = structuredClone(registry);
  delete missing.provider_dynamic_profiles.profiles["oak-weight-loss-program"];
  assert.throws(() => validateProviderDynamicProfiles(missing, "glp-clinic-scout", { asOf }), /provider_dynamic_profile_canonical_membership_mismatch/);

  const conflict = structuredClone(registry);
  conflict.provider_dynamic_profiles.profiles["oak-weight-loss-program"].calculator.first_month_base_usd = 99;
  assert.throws(() => validateProviderDynamicProfiles(conflict, "glp-clinic-scout", { asOf }), /provider_dynamic_profile_calculator_manual_value_conflict:oak-weight-loss-program/);
});

test("one synthetic provider propagates to compare, quiz, calculator, counts, and suggestions", () => {
  const { registry, money, quiz, calculator, providerContracts, fastpath, asOf } = historicalRetatrutideInputs();
  const fixture = syntheticFixture({ registry, money, quiz, asOf });
  const taxonomy = reconcileTherapeuticTaxonomyWireIn({
    registry: fixture.registry,
    profileId: "glp-clinic-scout",
    pages: fixture.money.pages,
    quizConfig: fixture.quiz,
    asOf,
  });
  assert.equal(taxonomy.counts.provider_rows, registry.therapeutic_taxonomy.expected_counts.provider_rows + 1);
  const dynamic = reconcileProviderDynamicProfilesWireIn({ registry: fixture.registry, profileId: "glp-clinic-scout", asOf });
  assert.equal(dynamic.canonicalIds.length, registry.provider_dynamic_profiles.expected_counts.provider_identities + 1);
  assert.equal(dynamic.counts.provider_identities, registry.provider_dynamic_profiles.expected_counts.provider_identities + 1);
  assert.ok(providerSuggestions(fixture.registry, "glp-clinic-scout", { asOf }).some((row) => row.program_id === fixture.id));

  const projected = projectTherapeuticSurfaces({
    registry: fixture.registry,
    profileId: "glp-clinic-scout",
    pages: canonicalMoneyPages(fixture.registry, fixture.money),
    quizConfig: canonicalQuiz(fixture.registry, fixture.quiz),
    asOf,
  });
  assert.ok(projected.includeProgramIds.includes(fixture.id));
  assert.equal(projected.includeProgramIds.length, dynamic.canonicalIds.length);
  for (const path of fixture.registry.therapeutic_taxonomy.required_surface_paths) {
    const projectedPage = projected.pages.find((page) => page.path === path);
    assert.ok(projectedPage.rows.some((row) => row.program_id === fixture.id), path);
    assert.equal(projectedPage.canonical_provider_ids.length, dynamic.canonicalIds.length, path);
    assert.ok(projectedPage.canonical_provider_ids.includes(fixture.id), path);
    assert.equal(projectedPage.provider_dynamic_profile_schema, "glp-provider-dynamic-profiles-v1", path);
  }
  assert.ok(projected.quizConfig.candidates.some((row) => row.program_id === fixture.id));

  const calc = buildCostCalculatorData(calculator, fixture.money.pages, providerContracts, fastpath, fixture.registry);
  const added = costCalculatorDropdownProviders(calc).eligible.find((row) => row.program_id === fixture.id);
  assert.equal(added.mode, "manual");
  assert.equal(added.first_month_base_usd, null);
  assert.equal(added.recurring_month_base_usd, null);
});

test("retatrutide remains unavailable rather than becoming a consumer facet", async () => {
  const { registry, money, quiz, asOf } = historicalRetatrutideInputs();
  const browserSource = await readFile(new URL("../assets/site.js", import.meta.url), "utf8");
  const projected = projectTherapeuticSurfaces({ registry, profileId: "glp-clinic-scout", pages: canonicalMoneyPages(registry, money), quizConfig: canonicalQuiz(registry, quiz), asOf });
  assert.equal(projected.consumerAuthorities.retatrutide.provider_evidence_positive, false);
  assert.equal(projected.consumerAuthorities.retatrutide.lawful_regulatory_authority_positive, false);
  assert.equal(projected.consumerAuthorities.retatrutide.consumer_available, false);
  assert.equal(projected.consumerTherapeuticFilters.some((row) => row.value === "retatrutide"), false);
  assert.match(browserSource, /Retatrutide is not available as a consumer provider filter/);
  assert.match(browserSource, /fda\.gov\/drugs\/drug-alerts-and-statements\/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss/);
  assert.match(browserSource, /lilly\.com\/news\/stories\/what-to-know-about-retatrutide/);
  assert.equal(deriveDynamicFacetCounts(registry.provider_dynamic_profiles.profiles).retatrutide, 0);
});

test("existing-provider research updates apply deterministically and malformed input cannot be masked or partially mutate", () => {
  const fixture = structuredClone(registry);
  const id = "oak-weight-loss-program";
  const current = fixture.provider_dynamic_profiles.profiles[id];
  const source = current.calculator.source_url;
  const text = "Current Oak evidence confirms no exact comparable first and recurring amount; manual entry remains required.";
  const program = fixture.programs.find((row) => String(row.review_slug || row.program_id) === id);
  program.research_dynamic_profile = {
    version: 1,
    verified_as_of: fixtureEvidenceDate,
    taxonomy: Object.fromEntries(["molecule_tags", "brand_name_tags", "delivery_form_tags", "treatment_type_tags"].map((field) => [field, current.taxonomy[field]])),
    calculator: { ...current.calculator, checked_as_of: fixtureEvidenceDate, price_context: `${current.calculator.price_context} Current evidence remains non-comparable.` },
    evidence_bindings: [evidenceBinding(source, fixtureEvidenceDate, text)],
  };
  delete program.research_dynamic_profile.calculator.evidence_sha256;
  const updated = reconcileProviderDynamicProfilesWireIn({ registry: fixture, profileId: "glp-clinic-scout", asOf });
  assert.match(updated.profiles.get(id).calculator.price_context, /remains non-comparable/);
  const once = JSON.stringify(fixture.provider_dynamic_profiles.profiles[id]);
  reconcileProviderDynamicProfilesWireIn({ registry: fixture, profileId: "glp-clinic-scout", asOf });
  assert.equal(JSON.stringify(fixture.provider_dynamic_profiles.profiles[id]), once);

  const hostile = structuredClone(registry);
  const hostileProgram = hostile.programs.find((row) => String(row.review_slug || row.program_id) === id);
  hostileProgram.research_dynamic_profile = { version: 1, verified_as_of: "2020-01-01" };
  const before = JSON.stringify(hostile.provider_dynamic_profiles);
  assert.throws(() => reconcileProviderDynamicProfilesWireIn({ registry: hostile, profileId: "glp-clinic-scout", asOf }), /provider_dynamic_profile_/);
  assert.equal(JSON.stringify(hostile.provider_dynamic_profiles), before);
});

test("field-addressable exact evidence bytes and dual-authority drift fail closed", () => {
  const { registry, money, quiz, asOf } = historicalRetatrutideInputs();
  const emptyDigest = createHash("sha256").update("").digest("hex");
  for (const profile of Object.values(registry.provider_dynamic_profiles.profiles)) {
    assert.ok(profile.evidence_bindings.every((binding) => binding.evidence_text && binding.evidence_sha256 !== emptyDigest));
  }
  const badEvidence = structuredClone(registry);
  badEvidence.provider_dynamic_profiles.profiles.coivas.evidence_bindings[0].evidence_text += " drift";
  assert.throws(() => validateProviderDynamicProfiles(badEvidence, "glp-clinic-scout", { asOf }), /evidence_bytes_hash_mismatch/);
  const badAuthority = structuredClone(registry);
  badAuthority.consumer_therapeutic_authorities.molecules.retatrutide.official_evidence[0].verified_as_of = "2020-01-01";
  assert.throws(() => projectTherapeuticSurfaces({ registry: badAuthority, profileId: "glp-clinic-scout", pages: canonicalMoneyPages(badAuthority, money), quizConfig: canonicalQuiz(badAuthority, quiz), asOf }), /consumer_authority_stale/);
});

test("retatrutide authority rejects hostile hosts, capture drift, metadata drift, booleans, and unsupported provider bytes", () => {
  const { registry, money, quiz, asOf } = historicalRetatrutideInputs();
  const project = (source) => projectTherapeuticSurfaces({
    registry: source,
    profileId: "glp-clinic-scout",
    pages: canonicalMoneyPages(source, money),
    quizConfig: canonicalQuiz(source, quiz),
    asOf,
  });
  const hostileCases = [
    ["example host", (source) => {
      const record = source.consumer_therapeutic_authorities.molecules.retatrutide.official_evidence[0];
      record.source_url = "https://example.com/pretend-fda";
      record.source_host = "example.com";
    }, /consumer_authority_exact_evidence_mismatch/],
    ["all-zero capture hash", (source) => {
      source.consumer_therapeutic_authorities.molecules.retatrutide.local_capture_authority.audit_summary.sha256 = "0".repeat(64);
    }, /consumer_authority_capture_metadata_invalid/],
    ["missing capture hash", (source) => {
      delete source.consumer_therapeutic_authorities.molecules.retatrutide.local_capture_authority.research.sha256;
    }, /consumer_authority_capture_metadata_invalid/],
    ["outside capture path", (source) => {
      source.consumer_therapeutic_authorities.molecules.retatrutide.local_capture_authority.research.path = "../outside.md";
    }, /consumer_authority_capture_metadata_invalid/],
    ["capture status drift", (source) => {
      source.consumer_therapeutic_authorities.molecules.retatrutide.local_capture_authority.audit_summary.status = "SELF_DECLARED_PASS";
    }, /consumer_authority_capture_metadata_invalid/],
    ["capture time drift", (source) => {
      source.consumer_therapeutic_authorities.molecules.retatrutide.local_capture_authority.audit_summary.audited_at = "2026-08-11T00:00:00";
    }, /consumer_authority_capture_metadata_invalid/],
    ["positive boolean over negative bytes", (source) => {
      source.consumer_therapeutic_authorities.molecules.retatrutide.official_evidence[0].consumer_availability = true;
    }, /consumer_authority_disposition_semantics_mismatch/],
    ["positive text replacing captured negative semantics", (source) => {
      const record = source.consumer_therapeutic_authorities.molecules.retatrutide.official_evidence[0];
      record.evidence_text = "Retatrutide is available.";
      record.evidence_sha256 = createHash("sha256").update(record.evidence_text).digest("hex");
      record.consumer_availability = true;
    }, /consumer_authority_exact_evidence_mismatch/],
  ];
  for (const [label, mutate, expected] of hostileCases) {
    const source = structuredClone(registry);
    mutate(source);
    assert.throws(() => project(source), expected, label);
  }

  const dynamic = validateProviderDynamicProfiles(registry, "glp-clinic-scout", { asOf });
  const forged = structuredClone(dynamic.profiles.get("coivas"));
  forged.taxonomy.molecule_tags = [...forged.taxonomy.molecule_tags, "retatrutide"].sort();
  forged.evidence_bindings = forged.evidence_bindings.map((binding) => binding.fields.includes("taxonomy.molecule_tags")
    ? { ...binding, evidence_text: `${binding.evidence_text} Coivas does not offer retatrutide.` }
    : binding);
  assert.throws(
    () => validateConsumerTherapeuticAuthorities(registry, "glp-clinic-scout", {
      asOf,
      dynamic: { profiles: new Map([[forged.program_id, forged]]) },
    }),
    /consumer_authority_provider_evidence_unsupported:coivas/,
  );
});

test("local capture reader rejects traversal and symlinked evidence even when bytes and self-hash match", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "glp-authority-hostile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = path.join(root, "..", `${path.basename(root)}-outside.txt`);
  const bytes = "exact local evidence bytes";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(outside, bytes);
  t.after(() => rm(outside, { force: true }));
  assert.throws(
    () => testOnlyReadExactLocalCapture(root, { path: `../${path.basename(outside)}`, sha256 }, { path: `../${path.basename(outside)}`, sha256 }),
    /consumer_authority_capture_outside_workspace/,
  );

  await mkdir(path.join(root, "reports"));
  await symlink(outside, path.join(root, "reports", "evidence.txt"));
  assert.throws(
    () => testOnlyReadExactLocalCapture(root, { path: "reports/evidence.txt", sha256 }, { path: "reports/evidence.txt", sha256 }),
    /consumer_authority_capture_not_plain_regular/,
  );
});
