import test from "node:test";
import assert from "node:assert/strict";
import { handleReviewCaptureRequest, validateReviewSubmission } from "../src/review-capture.mjs";

const valid = (overrides = {}) => ({
  subject_name: "OrderlyMeds",
  experience_type: "provider",
  rating: "4",
  headline: "Clear intake and billing",
  review: "The intake steps were clear, the support team answered my billing question, and the delivery timing matched what I was told.",
  first_name: "Alex",
  email: "alex@example.test",
  occurred_month: "2026-07",
  truthful_attestation: true,
  moderation_consent: true,
  company: "",
  ...overrides,
});
const request = (body = valid()) => new Request("https://glpclinicscout.com/api/review-capture", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
function db() {
  const calls = [];
  return { calls, prepare(sql) { return { bind(...args) { return { async run() { calls.push({ sql, args }); return { success: true }; } }; } }; } };
}

test("W16 review validator accepts only bounded truthful moderation submissions", () => {
  const row = validateReviewSubmission(valid(), new Date("2026-08-22T00:00:00Z"));
  assert.equal(row.email, "alex@example.test");
  assert.equal(row.rating, 4);
  assert.throws(() => validateReviewSubmission(valid({ truthful_attestation: false })), /truthful_attestation_required/);
  assert.throws(() => validateReviewSubmission(valid({ occurred_month: "2099-01" })), /occurred_month_future/);
  assert.throws(() => validateReviewSubmission(valid({ review: "My SSN is 123-45-6789 and this is long enough to pass the length gate safely." })), /sensitive_identifier_rejected/);
  assert.throws(() => validateReviewSubmission(valid({ experience_type: "pharmacy" })), /subject_entity_mismatch/);
  assert.throws(() => validateReviewSubmission(valid({ subject_name: "Unlisted provider" })), /subject_entity_mismatch/);
});

test("W16 review endpoint is fail-closed without an explicit durable binding", async () => {
  const response = await handleReviewCaptureRequest(request(), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "REVIEW_CAPTURE_HELD");
});

test("W16 review endpoint captures to D1 held for manual moderation and never publishes", async () => {
  const store = db();
  const response = await handleReviewCaptureRequest(request(), { REVIEW_CAPTURE_MODE: "local_test", REVIEWS_DB: store });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "CAPTURED_HELD_MANUAL_REVIEW");
  assert.equal(body.published, false);
  assert.equal(store.calls.length, 2);
  assert.match(store.calls[0].sql, /held_manual_review/);
  assert.match(store.calls[0].sql, /publish_approved/);
  assert.match(store.calls[1].sql, /contact_capture_events/);
  assert.ok(store.calls[1].args.includes(body.review_id));
  assert.ok(store.calls[1].args.includes("verification-only"));
});
