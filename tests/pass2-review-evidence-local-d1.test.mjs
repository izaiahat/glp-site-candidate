import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createLocalReviewEnvironment } from "../src/local-review-d1.mjs";
import { handleReviewCaptureRequest } from "../src/review-capture.mjs";

test("optional review evidence lands atomically in local D1 as held chunks", async () => {
  const databasePath = path.join(tmpdir(), `glp-pass2-review-evidence-${randomUUID()}.sqlite3`);
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(329_992, 0x45)]);
  const payload = {
    subject_name: "OrderlyMeds",
    experience_type: "provider",
    rating: 4,
    headline: "Synthetic evidence storage test",
    review: "This synthetic row only verifies held evidence storage and is never eligible for publication or public review display.",
    first_name: "PASS2",
    email: "pass2@example.invalid",
    occurred_month: "2026-08",
    truthful_attestation: true,
    moderation_consent: true,
    company: "",
    evidence: {
      file_name: "synthetic-evidence.png",
      mime_type: "image/png",
      size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      base64: bytes.toString("base64"),
    },
  };
  const env = await createLocalReviewEnvironment(databasePath);
  try {
    const response = await handleReviewCaptureRequest(new Request("http://127.0.0.1/api/review-capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), env);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.published, false);
    assert.equal(body.evidence_received, true);
    env.GLP_DB.close();
    const database = new DatabaseSync(databasePath);
    try {
      const review = database.prepare("SELECT moderation_status, publish_approved FROM review_submissions WHERE review_id = ?").get(body.review_id);
      assert.equal(review.moderation_status, "held_manual_review");
      assert.equal(review.publish_approved, 0);
      const evidence = database.prepare("SELECT review_id, size_bytes, sha256, chunk_count, moderation_status FROM review_evidence WHERE review_id = ?").get(body.review_id);
      assert.equal(evidence.size_bytes, bytes.length);
      assert.equal(evidence.sha256, payload.evidence.sha256);
      assert.equal(evidence.moderation_status, "held_manual_review");
      assert.equal(evidence.chunk_count, 2);
      const chunks = database.prepare("SELECT body_base64 FROM review_evidence_chunks WHERE evidence_id = (SELECT evidence_id FROM review_evidence WHERE review_id = ?) ORDER BY chunk_index").all(body.review_id);
      assert.equal(chunks.length, 2);
      assert.deepEqual(Buffer.from(chunks.map((row) => row.body_base64).join(""), "base64"), bytes);
    } finally {
      database.close();
    }
  } finally {
    try { env.GLP_DB.close(); } catch {}
    await rm(databasePath, { force: true });
  }
});
