import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  candidatesForMedicationPreference,
  projectTherapeuticSurfaces,
  reconcileTherapeuticTaxonomyWireIn,
} from "../src/therapeutic-taxonomy.mjs";
import { reconcileProviderDynamicProfilesWireIn } from "../src/provider-dynamic-profiles.mjs";

async function readJson(relative) {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
}

const baseRegistry = await readJson("../data/program-registry.json");
const baseMoney = await readJson("../data/money-page-specs.json");
const baseQuiz = await readJson("../data/quiz-config.json");
const sealedDate = baseRegistry.therapeutic_taxonomy.sealed_as_of;
const asOf = new Date(`${sealedDate}T12:00:00Z`);

function withoutDeclaredAliases(registry, money, quiz) {
  const aliases = new Set(registry.programs
    .filter((program) => program.profiles?.["glp-clinic-scout"]?.canonical_identity?.role === "alias")
    .map((program) => String(program.review_slug || program.program_id)));
  // Mirror the build's quiz projection: a program whose registry row scopes the
  // quiz surface off (documented surface_restriction_basis — trt-nation,
  // 2026-08-13) is filtered from the candidate pool before projection.
  const quizScopedOff = new Set(registry.programs
    .filter((program) => program.profiles?.["glp-clinic-scout"]?.surfaces?.quiz === false)
    .map((program) => String(program.review_slug || program.program_id)));
  return {
    pages: money.pages.map((page) => ({
      ...page,
      rows: (page.rows || []).filter((row) => !aliases.has(row.program_id)),
    })),
    quizConfig: {
      ...quiz,
      candidates: (quiz.candidates || []).filter((candidate) => !aliases.has(candidate.program_id) && !quizScopedOff.has(candidate.program_id)),
    },
  };
}

function syntheticFixture({ includeEvidence = true } = {}) {
  const registry = structuredClone(baseRegistry);
  const money = structuredClone(baseMoney);
  const quiz = structuredClone(baseQuiz);
  const program = {
    commercial_state: "live",
    display_name: "Synthetic Evidence Clinic",
    program_id: "synthetic-evidence-clinic",
    review_path: "/reviews/synthetic-evidence-clinic/",
    source_kind: "synthetic-test-only",
    profiles: {
      "glp-clinic-scout": {
        vertical_fit: true,
        wired: true,
        surfaces: { review: true, compare: true, quiz: true, calculator: true },
        exceptions: {},
      },
    },
  };
  if (includeEvidence) {
    program.research_therapeutic_taxonomy = {
      authority_path: "reports/glp-clinic-scout/affiliate-machine/synthetic-wire-in.json",
      authority_sha256: "a".repeat(64),
      source_url: "https://synthetic.example/evidence",
      verified_as_of: sealedDate,
      evidence_sha256: "b".repeat(64),
      classification_state: "WIRE_IN_EXPLICIT",
      molecule_tags: ["semaglutide"],
      brand_name_tags: [],
      delivery_form_tags: ["oral"],
      treatment_type_tags: ["compounded"],
      commercial_link_state: { compare: "live", quiz: "editorial_link_dark" },
    };
    program.research_dynamic_profile = {
      version: 1,
      verified_as_of: sealedDate,
      taxonomy: { molecule_tags: ["semaglutide"], brand_name_tags: [], delivery_form_tags: ["oral"], treatment_type_tags: ["compounded"] },
      evidence_bindings: [{
        fields: ["calculator.checked_as_of", "calculator.evidence_gap_copy", "calculator.first_month_base_usd", "calculator.mode", "calculator.one_time_fee_usd", "calculator.price_context", "calculator.recurring_month_base_usd", "calculator.source_url", "taxonomy.brand_name_tags", "taxonomy.delivery_form_tags", "taxonomy.molecule_tags", "taxonomy.treatment_type_tags", "verified_as_of"],
        source_url: "https://synthetic.example/evidence",
        verified_as_of: sealedDate,
        evidence_text: "Synthetic Evidence Clinic currently offers compounded oral semaglutide; exact current pricing is unavailable.",
        evidence_sha256: createHash("sha256").update("Synthetic Evidence Clinic currently offers compounded oral semaglutide; exact current pricing is unavailable.").digest("hex"),
      }],
      calculator: {
        mode: "manual",
        first_month_base_usd: null,
        recurring_month_base_usd: null,
        one_time_fee_usd: null,
        price_context: "No exact comparable first and recurring prices were verified from this source.",
        source_url: "https://synthetic.example/evidence",
        checked_as_of: sealedDate,
        evidence_gap_copy: "Enter the current exact first and recurring prices manually because comparable prices are not verified.",
      },
    };
  }
  registry.programs.push(program);
  const required = new Set(registry.therapeutic_taxonomy.required_surface_paths);
  for (const page of money.pages) {
    if (!required.has(page.path)) continue;
    page.rows.push({
      program_id: program.program_id,
      provider: program.display_name,
      affiliate_href: "https://synthetic.example/start",
      live_link_allowed: true,
      promotion_authorized: true,
    });
  }
  quiz.candidates.push({
    program_id: program.program_id,
    display_name: program.display_name,
    source_clearance: true,
    staging_eligible: true,
    live_link_allowed: false,
    promotion_authorized: false,
    priority_score: 999,
    rules: {},
  });
  return { registry, money, quiz };
}

test("synthetic provider wire-in rebuilds one taxonomy into compare facets and quiz eligibility", () => {
  const fixture = syntheticFixture();
  const reconciled = reconcileTherapeuticTaxonomyWireIn({
    registry: fixture.registry,
    profileId: "glp-clinic-scout",
    pages: fixture.money.pages,
    quizConfig: fixture.quiz,
    asOf,
  });
  assert.equal(reconciled.activeProgramIds.length, baseRegistry.therapeutic_taxonomy.expected_counts.provider_rows + 1);
  assert.equal(reconciled.counts.provider_rows, baseRegistry.therapeutic_taxonomy.expected_counts.provider_rows + 1);
  assert.equal(reconciled.counts.semaglutide, baseRegistry.therapeutic_taxonomy.expected_counts.semaglutide + 1);
  assert.equal(reconciled.counts.oral, baseRegistry.therapeutic_taxonomy.expected_counts.oral + 1);
  assert.equal(reconciled.counts.retatrutide, baseRegistry.therapeutic_taxonomy.expected_counts.retatrutide);
  reconcileProviderDynamicProfilesWireIn({ registry: fixture.registry, profileId: "glp-clinic-scout", asOf });

  const canonical = withoutDeclaredAliases(fixture.registry, fixture.money, fixture.quiz);
  const projected = projectTherapeuticSurfaces({
    registry: fixture.registry,
    profileId: "glp-clinic-scout",
    pages: canonical.pages,
    quizConfig: canonical.quizConfig,
    asOf,
  });
  assert.equal(projected.includeProgramIds.length, baseRegistry.provider_dynamic_profiles.expected_counts.provider_identities + 1);
  assert.ok(!projected.includeProgramIds.includes("shed"));
  for (const route of fixture.registry.therapeutic_taxonomy.required_surface_paths) {
    const row = projected.pages.find((page) => page.path === route).rows
      .find((item) => item.program_id === "synthetic-evidence-clinic");
    assert.deepEqual(row.therapeutic_tokens, ["oral", "semaglutide"], route);
  }
  const candidate = projected.quizConfig.candidates
    .find((item) => item.program_id === "synthetic-evidence-clinic");
  assert.deepEqual(candidate.therapeutic_tags, ["oral", "semaglutide"]);
  assert.deepEqual(
    candidatesForMedicationPreference(projected.quizConfig.candidates, "oral")
      .filter((item) => item.program_id === candidate.program_id)
      .map((item) => item.program_id),
    [candidate.program_id],
  );
});

test("new wired provider without evidence fails before compare or quiz can guess", () => {
  const fixture = syntheticFixture({ includeEvidence: false });
  assert.throws(
    () => reconcileTherapeuticTaxonomyWireIn({
      registry: fixture.registry,
      profileId: "glp-clinic-scout",
      pages: fixture.money.pages,
      quizConfig: fixture.quiz,
      asOf,
    }),
    /therapeutic_taxonomy_wire_in_evidence_missing:synthetic-evidence-clinic/,
  );
});

test("wire-in taxonomy cannot claim a compare link state the carrier row does not support", () => {
  const fixture = syntheticFixture();
  const row = fixture.money.pages
    .find((page) => page.path === fixture.registry.therapeutic_taxonomy.required_surface_paths[0]).rows
    .find((item) => item.program_id === "synthetic-evidence-clinic");
  row.live_link_allowed = false;
  row.promotion_authorized = false;
  assert.throws(
    () => reconcileTherapeuticTaxonomyWireIn({
      registry: fixture.registry,
      profileId: "glp-clinic-scout",
      pages: fixture.money.pages,
      quizConfig: fixture.quiz,
      asOf,
    }),
    /therapeutic_taxonomy_wire_in_compare_link_state_mismatch:synthetic-evidence-clinic/,
  );
});
