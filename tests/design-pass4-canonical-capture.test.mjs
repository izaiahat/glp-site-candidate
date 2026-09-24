import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { handleContentUpgradeRequest } from "../src/content-upgrade.mjs";
import { handleLeadRequest } from "../src/lead-capture.mjs";
import {
  NEWSLETTER_CONSENT_SOURCE,
  NEWSLETTER_CONSENT_VERSION,
  handleNewsletterSubscribeRequest,
} from "../src/newsletter-subscribe.mjs";
import { handleReviewCaptureRequest } from "../src/review-capture.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function resultMeta(result) {
  return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
}

async function canonicalCaptureDb(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE subscribers (
      subscriber_id TEXT NOT NULL, email TEXT NOT NULL, first_name TEXT NOT NULL, vertical TEXT NOT NULL,
      funnel_stage TEXT NOT NULL, consent_status TEXT NOT NULL, consent_version TEXT NOT NULL,
      consent_source TEXT NOT NULL, consent_at TEXT NOT NULL, unsubscribe_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, next_drip_step INTEGER NOT NULL DEFAULT 1, next_send_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (email, vertical)
    );
    CREATE TABLE leads (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      phone TEXT NOT NULL, state TEXT NOT NULL, zip TEXT, source TEXT NOT NULL,
      consent_status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE lead_capture_metadata_v2 (
      lead_id TEXT PRIMARY KEY, priority TEXT NOT NULL, provider_interest TEXT, source_page TEXT NOT NULL,
      consent_version TEXT NOT NULL, privacy_consent INTEGER NOT NULL, marketing_consent INTEGER NOT NULL,
      contact_consent INTEGER NOT NULL, capture_idempotency_hash TEXT NOT NULL,
      email_send_authorized INTEGER NOT NULL, provider_share_authorized INTEGER NOT NULL,
      hold_status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE consent_ledger (
      id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, consent_type TEXT NOT NULL,
      consent_text TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  database.exec(await readFile(path.join(ROOT, "migrations/004_review_capture.sql"), "utf8"));
  database.exec(await readFile(path.join(ROOT, "migrations/005_canonical_contact_capture.sql"), "utf8"));
  let closed = false;
  const prepare = (sql) => ({
    _sql: sql,
    bind(...params) {
      return {
        _sql: sql,
        _params: params,
        async run() {
          if (closed) throw new Error("test_d1_closed");
          return resultMeta(database.prepare(sql).run(...params));
        },
        async first() {
          if (closed) throw new Error("test_d1_closed");
          return database.prepare(sql).get(...params) ?? null;
        },
        async all() {
          if (closed) throw new Error("test_d1_closed");
          return { success: true, results: database.prepare(sql).all(...params) };
        },
      };
    },
  });
  return {
    database,
    prepare,
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => resultMeta(database.prepare(statement._sql).run(...statement._params)));
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      if (closed) return;
      database.close();
      closed = true;
    },
  };
}

const jsonPost = (route, payload, headers = {}) => new Request(`https://glpclinicscout.com${route}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(payload),
});

const contentUpgradePayload = (sourcePage, email, cost = null) => ({
  source_page: sourcePage,
  lead_magnet_key: `${sourcePage}-${cost ? "cost-breakdown" : "terms-checklist"}`,
  consent_version: "glp-content-upgrade-v2-20260801",
  email,
  email_consent: "true",
  company: "",
  ...(cost || {}),
});

test("Design Pass 4 persists every email surface and attributed review evidence through one D1 binding", async () => {
  const databasePath = path.join(tmpdir(), `glp-design-pass4-captures-${randomUUID()}.sqlite3`);
  const db = await canonicalCaptureDb(databasePath);
  const evidenceBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 0x45)]);
  try {
    const newsletter = await handleNewsletterSubscribeRequest(jsonPost("/api/newsletter-subscribe", {
      email: "price-watch@example.test",
      email_consent: "true",
      consent_version: NEWSLETTER_CONSENT_VERSION,
      consent_source: NEWSLETTER_CONSENT_SOURCE,
      source_surface: "sitewide-price-watch",
      company: "",
    }), { NEWSLETTER_CAPTURE_MODE: "local_test", EMAIL_DB: db, RESEND_ENABLED: "false" });
    assert.equal(newsletter.status, 201);

    const insights = await handleContentUpgradeRequest(jsonPost("/api/content-upgrade", contentUpgradePayload("insights", "insights@example.test")), {
      CONTENT_UPGRADE_CAPTURE_MODE: "local_test",
      GLP_DB: db,
      RESEND_ENABLED: "false",
    });
    assert.equal(insights.status, 202);

    const calculator = await handleContentUpgradeRequest(jsonPost("/api/content-upgrade", contentUpgradePayload("tools-glp-1-cost-calculator", "calculator@example.test", {
      cost_breakdown_version: "cost-breakdown-v1",
      cost_provider_id: "healthrx",
      cost_provider_name: "HealthRX",
      cost_first_month_usd: "249.00",
      cost_recurring_month_usd: "299.00",
      cost_months: "3",
      cost_total_usd: "847.00",
      cost_price_context: "Published starting-price context",
      cost_checked_as_of: "2026-08-01",
    })), { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: db, RESEND_ENABLED: "false" });
    assert.equal(calculator.status, 202);

    const quiz = await handleLeadRequest(jsonPost("/api/leads", {
      first_name: "Quiz",
      email: "quiz@example.test",
      phone: "+15555550100",
      state: "OR",
      priority: "price",
      source_page: "/quiz/provider-fit/",
      provider_interest: "healthrx",
      privacy_consent: true,
      marketing_consent: true,
      contact_consent: true,
      consent_version: "glp-lead-v2-20260723",
    }, { "idempotency-key": "design-pass4-quiz-0001" }), { LEAD_CAPTURE_MODE: "local_test", GLP_DB: db });
    const quizBody = await quiz.json();
    assert.equal(quiz.status, 202, JSON.stringify(quizBody));

    const review = await handleReviewCaptureRequest(jsonPost("/api/review-capture", {
      schema_version: "review_intake_v2",
      public_display_name: "Reviewer",
      verification_email: "review@example.test",
      primary: {
        entity_name: "OrderlyMeds",
        entity_type: "provider",
        product: "compounded_semaglutide",
        rating: 4,
        review_type: "overall_experience",
        headline: "Clear intake and billing",
        review_body: "The intake steps were clear, support answered my billing question, and the delivery timing matched what I was told.",
        experience_date: "2026-08-01",
        evidence: {
          file_name: "receipt.png",
          mime_type: "image/png",
          size_bytes: evidenceBytes.length,
          sha256: createHash("sha256").update(evidenceBytes).digest("hex"),
          base64: evidenceBytes.toString("base64"),
        },
      },
      counterpart: null,
      truthful_attestation: true,
      privacy_attestation: true,
      moderation_consent: true,
      company: "",
    }), { REVIEW_CAPTURE_MODE: "local_test", GLP_DB: db });
    assert.equal(review.status, 202);
    const reviewReceipt = await review.json();

    const events = db.database.prepare("SELECT email,source_surface,purpose,marketing_consent,review_id,source_context FROM contact_capture_events ORDER BY source_surface").all();
    assert.deepEqual(events.map((row) => row.source_surface), [
      "content-upgrade/insights",
      "content-upgrade/tools-glp-1-cost-calculator",
      "quiz-provider-fit",
      "reviews/submit-v2",
      "sitewide-price-watch",
    ]);
    assert.equal(events.filter((row) => row.marketing_consent === 1 && row.purpose === "marketing").length, 4);
    const reviewEvent = events.find((row) => row.source_surface === "reviews/submit-v2");
    assert.equal(reviewEvent.email, "review@example.test");
    assert.equal(reviewEvent.purpose, "verification-only");
    assert.equal(reviewEvent.review_id, reviewReceipt.review_id);
    const calculatorEvent = events.find((row) => row.source_surface.endsWith("cost-calculator"));
    assert.equal(JSON.parse(calculatorEvent.source_context).cost_breakdown.providerId, "healthrx");

    const subscribers = db.database.prepare("SELECT email,funnel_stage,consent_status FROM subscribers ORDER BY email").all();
    assert.equal(subscribers.length, 4);
    assert.equal(subscribers.some((row) => row.email === "review@example.test"), false);
    assert.ok(subscribers.every((row) => row.consent_status === "opted-in"));

    const storedEvidence = db.database.prepare("SELECT s.verification_email,e.review_id,e.sha256,e.size_bytes,e.moderation_status,c.body_base64 FROM review_intake_submissions s JOIN review_intake_evidence e ON e.review_id=s.review_id JOIN review_intake_evidence_chunks c ON c.evidence_id=e.evidence_id WHERE e.review_id=? ORDER BY c.chunk_index").all(reviewReceipt.review_id);
    assert.equal(storedEvidence.length, 1);
    assert.equal(storedEvidence[0].verification_email, "review@example.test");
    assert.equal(storedEvidence[0].moderation_status, "held_manual_review");
    assert.equal(storedEvidence[0].sha256, createHash("sha256").update(evidenceBytes).digest("hex"));
    assert.deepEqual(Buffer.from(storedEvidence.map((row) => row.body_base64).join(""), "base64"), evidenceBytes);
  } finally {
    db.close();
    await rm(databasePath, { force: true });
  }
});
