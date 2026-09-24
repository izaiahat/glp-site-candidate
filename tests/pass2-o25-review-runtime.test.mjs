import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createReviewServer } from "../scripts/serve-review.mjs";

const payload = () => ({
  subject_name: "OrderlyMeds",
  experience_type: "provider",
  rating: 4,
  headline: "Synthetic storage test",
  review: "This synthetic verification row is only used to prove the review capture route and is never eligible for publication.",
  first_name: "PASS2",
  email: "pass2@example.invalid",
  occurred_month: "2026-08",
  truthful_attestation: true,
  moderation_consent: true,
  company: "",
});

const evidence = () => {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic-pass2-evidence")]);
  return {
    file_name: "evidence.png",
    mime_type: "image/png",
    size_bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    base64: bytes.toString("base64"),
  };
};

async function withServer(env, run) {
  const server = await createReviewServer(env);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function db() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              calls.push({ sql, args });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test("PASS2 O25 review server exposes the function route and fails closed without mode or D1", async () => {
  await withServer({}, async (origin) => {
    const response = await fetch(`${origin}/api/review-capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, "REVIEW_CAPTURE_HELD");
  });
});

test("PASS2 O25 review server sends an accepted submission to the held D1 insert", async () => {
  const store = db();
  await withServer({ REVIEW_CAPTURE_MODE: "local_test", GLP_DB: store }, async (origin) => {
    const response = await fetch(`${origin}/api/review-capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.status, "CAPTURED_HELD_MANUAL_REVIEW");
    assert.equal(body.published, false);
  });
  const reviewCalls = store.calls.filter(({ sql }) => /INSERT INTO review_submissions/.test(sql));
  const contactCalls = store.calls.filter(({ sql }) => /INSERT OR IGNORE INTO contact_capture_events/.test(sql));
  assert.equal(reviewCalls.length, 1);
  assert.equal(contactCalls.length, 1);
  assert.match(reviewCalls[0].sql, /held_manual_review/);
  assert.equal(contactCalls[0].args[9], "verification-only");
  assert.equal(contactCalls[0].args[10], 0);
});

test("PASS2 review evidence is hash-verified, held, and chunked beside the review", async () => {
  const store = db();
  await withServer({ REVIEW_CAPTURE_MODE: "local_test", GLP_DB: store }, async (origin) => {
    const response = await fetch(`${origin}/api/review-capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload(), evidence: evidence() }),
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.status, "CAPTURED_HELD_MANUAL_REVIEW");
    assert.equal(body.published, false);
    assert.equal(body.evidence_received, true);
  });
  const reviewCalls = store.calls.filter(({ sql }) => /INSERT INTO review_submissions/.test(sql));
  const evidenceCalls = store.calls.filter(({ sql }) => /INSERT INTO review_evidence \(/.test(sql));
  const chunkCalls = store.calls.filter(({ sql }) => /INSERT INTO review_evidence_chunks/.test(sql));
  const contactCalls = store.calls.filter(({ sql }) => /INSERT OR IGNORE INTO contact_capture_events/.test(sql));
  assert.equal(reviewCalls.length, 1);
  assert.equal(evidenceCalls.length, 1);
  assert.equal(chunkCalls.length, 1);
  assert.equal(contactCalls.length, 1);
  assert.equal(evidenceCalls[0].args[5], evidence().sha256);
});

test("PASS2 review evidence fails closed on hash or type mismatch", async () => {
  for (const invalid of [
    { ...evidence(), sha256: "0".repeat(64) },
    { ...evidence(), mime_type: "text/html" },
    { ...evidence(), file_name: "evidence.jpg" },
    { ...evidence(), base64: Buffer.from("not-a-png").toString("base64"), size_bytes: 9, sha256: createHash("sha256").update("not-a-png").digest("hex") },
    { ...evidence(), size_bytes: evidence().size_bytes + 1 },
  ]) {
    const store = db();
    await withServer({ REVIEW_CAPTURE_MODE: "local_test", GLP_DB: store }, async (origin) => {
      const response = await fetch(`${origin}/api/review-capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload(), evidence: invalid }),
      });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).status, "INVALID");
    });
    assert.equal(store.calls.length, 0);
  }
});
