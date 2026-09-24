import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createLocalReviewEnvironment } from "../src/local-review-d1.mjs";
import { renderReviewSubmissionPage } from "../src/pass2-review-hub.mjs";
import {
  governedReviewEntityCounts,
  handleReviewCaptureRequest,
  validateReviewSubmission,
} from "../src/review-capture.mjs";
import {
  finalizeReviewIntakeHtml,
  isEditorialReviewDetailRoute,
} from "../scripts/wave2-repairs.mjs";
import {
  REVIEW_CAPTURE_ENDPOINT,
  REVIEW_EVIDENCE_LIMIT_BYTES,
  isLocalReviewEndpoint,
  oppositeEntityType,
} from "../assets/review-intake.js";

const registry = JSON.parse(await readFile(new URL("../data/program-registry.json", import.meta.url), "utf8"));
const pharmacyInput = JSON.parse(await readFile(new URL("../data/phase3-pharmacy-render-input.json", import.meta.url), "utf8"));
const runtimeSource = await readFile(new URL("../assets/review-intake.js", import.meta.url), "utf8");
const intakeCss = await readFile(new URL("../assets/css-src/31-review-intake.css", import.meta.url), "utf8");

const validItem = (overrides = {}) => ({
  entity_name: "OrderlyMeds",
  entity_type: "provider",
  product: "compounded_semaglutide",
  rating: 4,
  review_type: "overall_experience",
  headline: "Clear support and billing experience",
  review_body: "Support answered my service and billing questions clearly, and the fulfillment timeline matched the public estimate I reviewed.",
  experience_date: "2026-08-01",
  ...overrides,
});

const validIntake = (overrides = {}) => ({
  schema_version: "review_intake_v2",
  public_display_name: "ScoutReader",
  verification_email: "phase5@example.invalid",
  primary: validItem(),
  counterpart: {
    ...validItem(),
    entity_name: "Hallandale Pharmacy",
    entity_type: "pharmacy",
    product: "compounded_semaglutide",
    rating: 3,
    review_type: "fulfillment",
    headline: "Shipment communication was easy to follow",
    review_body: "The shipment notices were clear and arrived in a useful sequence, while the packaging status stayed understandable throughout the process.",
  },
  truthful_attestation: true,
  privacy_attestation: true,
  moderation_consent: true,
  company: "",
  ...overrides,
});

const requestFor = (payload) => new Request("http://127.0.0.1/api/review-capture", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

function pngEvidence(byteCount = 330_000) {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(byteCount - 8, 0x50),
  ]);
  return {
    bytes,
    value: {
      file_name: "phase5-proof.png",
      mime_type: "image/png",
      size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      base64: bytes.toString("base64"),
    },
  };
}

test("Phase 5 renderer exposes compact two-step local intake with the exact canonical entity boundary", () => {
  const html = renderReviewSubmissionPage({ programs: registry.programs, pharmacies: pharmacyInput });
  const optionTags = [...html.matchAll(/<option value="[^"]+"[^>]*data-review-entity-type="(?:provider|pharmacy)"[^>]*>/g)].map((match) => match[0]);
  const enabled = optionTags.filter((tag) => !/\sdisabled(?:\s|>)/.test(tag));
  const counts = governedReviewEntityCounts();
  // Identity-only aliases are transport redirects, never declared intake routes.
  for (const program of registry.programs) {
    const profile = program.profiles?.['glp-clinic-scout'];
    if (profile?.canonical_identity?.role === 'alias' && profile?.surfaces?.review === false) {
      assert.equal(program.review_path ?? null, null, `${program.program_id}: identity-only alias cannot declare a review path`);
    }
  }

  const expectedProviderCount = registry.programs.filter((program) => {
    const profile = program.profiles?.["glp-clinic-scout"];
    return /^\/reviews\/[a-z0-9-]+\/$/.test(program.review_path || "")
      && profile?.canonical_identity?.role !== "alias";
  }).length;
  const expectedAliasCount = registry.programs.filter((program) => {
    const profile = program.profiles?.["glp-clinic-scout"];
    return /^\/reviews\/[a-z0-9-]+\/$/.test(program.review_path || "")
      && profile?.canonical_identity?.role === "alias";
  }).length;
  const expectedCounts = {
    provider: expectedProviderCount,
    pharmacy: pharmacyInput.entries.length,
    total: expectedProviderCount + pharmacyInput.entries.length,
  };
  assert.deepEqual(counts, expectedCounts);
  assert.equal(optionTags.length, counts.total + expectedAliasCount);
  assert.equal(enabled.length, counts.total);
  assert.equal(enabled.filter((tag) => /data-review-entity-type="provider"/.test(tag)).length, counts.provider);
  assert.equal(enabled.filter((tag) => /data-review-entity-type="pharmacy"/.test(tag)).length, counts.pharmacy);
  assert.equal(optionTags.filter((tag) => /disabled data-review-entity-alias="true"/.test(tag)).length, expectedAliasCount);
  assert.equal((html.match(/data-review-step="(?:primary|counterpart)"/g) || []).length, 2);
  assert.equal((html.match(/type="radio" name="rating"/g) || []).length, 5);
  assert.equal((html.match(/type="radio" name="counterpart_rating"/g) || []).length, 5);
  assert.match(html, /method="post" action="\/api\/review-capture" enctype="multipart\/form-data"/);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /form-action 'self'/);
  assert.match(html, /data-review-skip>Skip and submit my first review/);
  // 2026-08-26 redesign: ONE required checkbox whose label carries all three
  // attestation substances (truthful + PHI removed + pre-publication review/contact).
  // The validator still requires each attestation individually (tested below).
  assert.match(html, /name="combined_attestation" required/);
  assert.match(html, /my own truthful experience/i);
  assert.match(html, /removed private health details/i);
  assert.match(html, /review this submission and contact me to verify it before publication/i);
  assert.doesNotMatch(html, /held for manual moderation/i);
  // redesign surfaces: combobox + registration flag, stars, dropzone, summary
  assert.match(html, /data-review-combobox="primary"/);
  assert.match(html, /name="entity_registration"/);
  assert.match(html, /data-review-rating/);
  assert.match(html, /data-review-dropzone="primary"/);
  assert.match(html, /data-review-summary/);
  assert.match(html, /<noscript>/);
  assert.match(html, /src="\/assets\/review-intake\.js"/);
  assert.doesNotMatch(html, /How to audit the captured|review-depth-supplement|<img\b/i);
});

test("Phase 5 browser runtime is local-only and motion remains purposeful, short, and reducible", () => {
  assert.equal(REVIEW_CAPTURE_ENDPOINT, "/api/review-capture");
  assert.equal(REVIEW_EVIDENCE_LIMIT_BYTES, 2_097_152);
  assert.equal(oppositeEntityType("provider"), "pharmacy");
  assert.equal(oppositeEntityType("pharmacy"), "provider");
  assert.equal(isLocalReviewEndpoint("/api/review-capture", "https://glpclinicscout.com"), true);
  assert.equal(isLocalReviewEndpoint("https://example.com/api/review-capture", "https://glpclinicscout.com"), false);
  assert.equal((runtimeSource.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(runtimeSource, /fetch\(REVIEW_CAPTURE_ENDPOINT/);
  assert.match(runtimeSource, /credentials: "same-origin"/);
  assert.match(runtimeSource, /referrerPolicy: "no-referrer"/);
  assert.doesNotMatch(runtimeSource, /https?:\/\/|analytics|posthog|clarity|gtag/i);
  assert.match(intakeCss, /@media \(prefers-reduced-motion: reduce\)/);
  const durations = [...intakeCss.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].map((match) => Number(match[1]) * (match[2] === "s" ? 1000 : 1));
  assert.ok(durations.length > 0);
  assert.ok(durations.every((duration) => duration < 300), `found long duration: ${Math.max(...durations)}ms`);
});

test("Phase 5 validator preserves structured public fields and rejects unknown, mismatched, same-type, future, and private content", () => {
  const validated = validateReviewSubmission(validIntake(), new Date("2026-08-25T12:00:00Z"));
  assert.equal(validated.schemaVersion, "review_intake_v2");
  assert.equal(validated.publicDisplayName, "ScoutReader");
  assert.equal(validated.verificationEmail, "phase5@example.invalid");
  assert.equal(validated.primary.entityName, "OrderlyMeds");
  assert.equal(validated.primary.product, "compounded_semaglutide");
  assert.equal(validated.counterpart.entityName, "Hallandale Pharmacy");
  assert.equal(validated.counterpart.entityType, "pharmacy");

  const invalidCases = [
    [validIntake({ primary: validItem({ entity_name: "Unknown Clinic" }) }), /primary_entity_mismatch/],
    [validIntake({ primary: validItem({ entity_type: "pharmacy" }) }), /primary_entity_mismatch/],
    [validIntake({ counterpart: validItem() }), /counterpart_must_be_opposite_entity_type/],
    [validIntake({ primary: validItem({ experience_date: "2026-09-01" }) }), /primary_experience_date_future/],
    [validIntake({ primary: validItem({ review_body: "Support was responsive, but my dose was listed in a private message that should never be accepted in public review text." }) }), /sensitive_private_detail_rejected/],
    [validIntake({ primary: validItem({ review_body: "Support was responsive, but my member ID was printed in a message that should never be accepted in public review text." }) }), /sensitive_private_detail_rejected/],
    [validIntake({ primary: validItem({ review_body: "Support was responsive, but card number 4111 1111 1111 1111 appeared in a message that should never be accepted publicly." }) }), /sensitive_private_detail_rejected/],
    [validIntake({ privacy_attestation: false }), /privacy_attestation_required/],
    [validIntake({ primary: validItem({ entity_registration: "banana" }) }), /primary_entity_registration_invalid/],
    // a "proposed" flag can NEVER bypass the exact-type match for governed names
    [validIntake({ primary: validItem({ entity_type: "pharmacy", entity_registration: "proposed" }) }), /primary_entity_mismatch/],
    [validIntake({ primary: validItem({ entity_name: "My member ID is on file somewhere", entity_registration: "proposed" }) }), /sensitive_private_detail_rejected/],
  ];
  for (const [payload, reason] of invalidCases) {
    assert.throws(() => validateReviewSubmission(payload, new Date("2026-08-25T12:00:00Z")), reason);
  }

  // Explicit add-as-new path: unknown entity + "proposed" flag is accepted
  // into the held moderation queue and marked proposed for the moderator.
  const proposed = validateReviewSubmission(
    validIntake({ counterpart: null, primary: validItem({ entity_name: "Fresh Example Clinic", entity_registration: "proposed" }) }),
    new Date("2026-08-25T12:00:00Z"),
  );
  assert.equal(proposed.primary.entityName, "Fresh Example Clinic");
  assert.equal(proposed.primary.entityRegistration, "proposed");
  const registered = validateReviewSubmission(validIntake(), new Date("2026-08-25T12:00:00Z"));
  assert.equal(registered.primary.entityRegistration, "registered");
});

test("Phase 5 v2 intake lands atomically in local D1, remains held, and cannot enter approved public counts", async () => {
  const databasePath = path.join(tmpdir(), `glp-phase5-review-${randomUUID()}.sqlite3`);
  const evidence = pngEvidence();
  const payload = validIntake({ primary: validItem({ evidence: evidence.value }) });
  const env = await createLocalReviewEnvironment(databasePath);
  try {
    const response = await handleReviewCaptureRequest(requestFor(payload), env);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.published, false);
    assert.equal(body.counterpart_received, true);
    assert.equal(body.evidence_received, true);
    assert.doesNotMatch(JSON.stringify(body), /phase5@example|ScoutReader/);

    env.GLP_DB.close();
    const database = new DatabaseSync(databasePath);
    try {
      const row = database.prepare("SELECT * FROM review_intake_submissions WHERE review_id = ?").get(body.review_id);
      assert.equal(row.public_display_name, payload.public_display_name);
      assert.equal(row.verification_email, payload.verification_email);
      assert.equal(row.primary_entity_name, payload.primary.entity_name);
      assert.equal(row.primary_entity_type, payload.primary.entity_type);
      assert.equal(row.primary_product, payload.primary.product);
      assert.equal(row.primary_rating, payload.primary.rating);
      assert.equal(row.primary_review_type, payload.primary.review_type);
      assert.equal(row.primary_headline, payload.primary.headline);
      assert.equal(row.primary_review_body, payload.primary.review_body);
      assert.equal(row.primary_experience_date, payload.primary.experience_date);
      assert.equal(row.counterpart_entity_name, payload.counterpart.entity_name);
      assert.equal(row.counterpart_entity_type, payload.counterpart.entity_type);
      assert.equal(row.moderation_status, "held_manual_review");
      assert.equal(row.publish_approved, 0);
      assert.match(row.submitted_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(database.prepare("SELECT count(*) AS count FROM approved_review_publication").get().count, 0);

      const storedEvidence = database.prepare("SELECT * FROM review_intake_evidence WHERE review_id = ?").get(body.review_id);
      assert.equal(storedEvidence.review_role, "primary");
      assert.equal(storedEvidence.size_bytes, evidence.bytes.length);
      assert.equal(storedEvidence.sha256, evidence.value.sha256);
      assert.equal(storedEvidence.chunk_count, 2);
      assert.equal(storedEvidence.moderation_status, "held_manual_review");
      const chunks = database.prepare("SELECT body_base64 FROM review_intake_evidence_chunks WHERE evidence_id = ? ORDER BY chunk_index").all(storedEvidence.evidence_id);
      assert.equal(chunks.length, 2);
      assert.deepEqual(Buffer.from(chunks.map((row) => row.body_base64).join(""), "base64"), evidence.bytes);
    } finally {
      database.close();
    }
  } finally {
    try { env.GLP_DB.close(); } catch {}
    await rm(databasePath, { force: true });
  }
});

test("Phase 5 no-JS multipart fallback uses established field names and persists one held review", async () => {
  const databasePath = path.join(tmpdir(), `glp-phase5-no-js-${randomUUID()}.sqlite3`);
  const form = new FormData();
  const fields = {
    schema_version: "review_intake_v2",
    public_display_name: "NoJsScout",
    verification_email: "no-js@example.invalid",
    experience_type: "provider",
    subject_name: "OrderlyMeds",
    primary_product: "compounded_semaglutide",
    rating: "5",
    primary_review_type: "service_and_support",
    primary_headline: "No JavaScript moderation path stayed clear",
    primary_review_body: "This synthetic no-JavaScript submission verifies the same local moderation boundary without publishing any public review content.",
    primary_experience_date: "2026-08-01",
    truthful_attestation: "on",
    privacy_attestation: "on",
    moderation_consent: "on",
    company: "",
  };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const env = await createLocalReviewEnvironment(databasePath);
  try {
    const response = await handleReviewCaptureRequest(new Request("http://127.0.0.1/api/review-capture", { method: "POST", body: form }), env);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.published, false);
    assert.equal(body.counterpart_received, false);
    env.GLP_DB.close();
    const database = new DatabaseSync(databasePath);
    try {
      const row = database.prepare("SELECT primary_entity_name, primary_rating, counterpart_entity_name, moderation_status, publish_approved FROM review_intake_submissions WHERE review_id = ?").get(body.review_id);
      assert.deepEqual({ ...row }, {
        primary_entity_name: "OrderlyMeds",
        primary_rating: 5,
        counterpart_entity_name: null,
        moderation_status: "held_manual_review",
        publish_approved: 0,
      });
      assert.equal(database.prepare("SELECT count(*) AS count FROM approved_review_publication").get().count, 0);
    } finally {
      database.close();
    }
  } finally {
    try { env.GLP_DB.close(); } catch {}
    await rm(databasePath, { force: true });
  }
});

test("Phase 5 v2 fails closed without atomic batch persistence", async () => {
  const response = await handleReviewCaptureRequest(requestFor(validIntake({ counterpart: null })), {
    REVIEW_CAPTURE_MODE: "local_test",
    REVIEWS_DB: { prepare() { return {}; } },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "REVIEW_CAPTURE_HELD" });
});

test("Phase 5 route finalizer removes action-page audits and analytics while preserving editorial review depth", () => {
  const intake = '<main><section class="panel evidence-line review-depth-supplement"><h2>How to audit the captured intake record</h2></section><section class="panel evidence-line review-depth">generated depth</section><section class="panel evidence-line related-coverage">links</section></main><script>window.GCS_ANALYTICS={enabled:true};window.GCS_POSTHOG={enabled:true};</script><script src="/assets/analytics.js?v=abc" defer></script><script src="/assets/review-intake.js"></script>';
  const finalized = finalizeReviewIntakeHtml(intake);
  assert.doesNotMatch(finalized, /How to audit|review-depth|related-coverage|GCS_ANALYTICS|GCS_POSTHOG|assets\/analytics\.js/);
  assert.match(finalized, /assets\/review-intake\.js/);

  const detail = '<main><section class="panel evidence-line review-depth-supplement">editorial depth</section></main>';
  assert.equal(finalizeReviewIntakeHtml(detail, "/reviews/orderlymeds/"), detail);
  assert.equal(isEditorialReviewDetailRoute("/reviews/orderlymeds/"), true);
  assert.equal(isEditorialReviewDetailRoute("/reviews/submit/"), false);
  assert.equal(isEditorialReviewDetailRoute("/reviews/"), false);
});
