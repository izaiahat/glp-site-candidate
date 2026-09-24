import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import heldConfig from "../data/resend-email-machine.json" with { type: "json" };
import { PRICE_WATCH_CRON, PRICE_WATCH_ISSUE_URL, runPriceWatchCycle } from "../workers/price-watch-scheduler.mjs";

const configText = await readFile(new URL("../workers/price-watch/wrangler.toml", import.meta.url), "utf8");
const envelopeText = await readFile(new URL("../public/data/price-watch-issue.json", import.meta.url), "utf8");
const publishedEnvelope = JSON.parse(envelopeText);
const OBSERVED_ON = publishedEnvelope.issue.source.observed_on;
const CAMPAIGN_ID = `price-watch-${OBSERVED_ON}`;
const NOW = new Date(`${OBSERVED_ON}T23:59:59Z`);
const activeEnv = (db) => {
  const receipt = heldConfig.operator_approval.receipt_sha256;
  return {
    EMAIL_DB: db,
    EMAIL_RUNTIME_MODE: "production_operator_approved",
    EMAIL_OPERATOR_RECEIPT_SHA256: receipt,
    EMAIL_SEND_GATE: `operator-approved:${receipt}`,
    EMAIL_WARMUP_STATUS: "PASS",
    EMAIL_WEEKLY_CAP: "25",
    RESEND_API_KEY: "synthetic-test-key",
  };
};
const responseFor = (value) => new Response(typeof value === "string" ? value : JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

test("scheduled price-watch Worker is route-dark, exact-account/D1 bound, and operator-activated", () => {
  assert.match(configText, /name = "glp-clinic-scout-price-watch"/);
  assert.match(configText, /account_id = "f860943dff399ffb1db0a28dcd3dadfd"/);
  assert.match(configText, /workers_dev = false/);
  assert.match(configText, /preview_urls = false/);
  assert.match(configText, /compatibility_flags = \[ "nodejs_compat" \]/);
  assert.match(configText, /crons = \[ "0 15 \* \* 1" \]/);
  assert.match(configText, /binding = "EMAIL_DB"/);
  assert.match(configText, /database_id = "bcb91d2d-c3f1-4c55-93e3-070587e86d60"/);
  assert.match(configText, /EMAIL_RUNTIME_MODE = "production_operator_approved"/);
  assert.match(configText, /EMAIL_OPERATOR_RECEIPT_SHA256 = "fed001deeb0ba25a6ee8361249c72c5a68b2e4f2dfdef45f8e420ed8dacd2d1f"/);
  assert.match(configText, /EMAIL_WARMUP_STATUS = "PASS"/);
  assert.doesNotMatch(configText, /RESEND_API_KEY\s*=/);
  assert.equal(PRICE_WATCH_CRON, "0 15 * * 1");
  assert.equal(PRICE_WATCH_ISSUE_URL, "https://glpclinicscout.com/data/price-watch-issue.json");
  assert.equal(heldConfig.runtime_enabled, true);
  assert.equal(heldConfig.send_authorized, true);
});

test("missing runtime authority touches neither published feed, D1, nor transport", async () => {
  const issue = publishedEnvelope.issue;
  assert.equal(issue.campaignId, CAMPAIGN_ID);
  assert.equal(issue.promotion_share_percent, 0);
  assert.equal(issue.source.record_count, 35);
  let dbCalls = 0;
  let fetchCalls = 0;
  const result = await runPriceWatchCycle(
    { EMAIL_DB: { prepare() { dbCalls += 1; throw new Error("held_worker_touched_d1"); } } },
    NOW,
    async () => { fetchCalls += 1; throw new Error("held_worker_touched_fetch"); },
  );
  assert.deepEqual(result, { status: "HELD", sent: 0, reason: "email_runtime_gate" });
  assert.equal(dbCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("stale published issue fails closed before D1 claim or Resend transport", async () => {
  const stale = structuredClone(publishedEnvelope);
  const staleDate = new Date(`${OBSERVED_ON}T00:00:00Z`);
  staleDate.setUTCDate(staleDate.getUTCDate() - 7);
  const staleObservedOn = staleDate.toISOString().slice(0, 10);
  stale.issue.source.observed_on = staleObservedOn;
  stale.issue.campaignId = `price-watch-${staleObservedOn}`;
  stale.issue_sha256 = createHash("sha256").update(JSON.stringify(stale.issue)).digest("hex");
  let dbCalls = 0;
  let fetchCalls = 0;
  const db = { prepare() { dbCalls += 1; throw new Error("stale_issue_touched_d1"); } };
  const result = await runPriceWatchCycle(activeEnv(db), NOW, async (url) => {
    fetchCalls += 1;
    assert.equal(url, PRICE_WATCH_ISSUE_URL);
    return responseFor(stale);
  });
  assert.deepEqual(result, { status: "HELD", sent: 0, reason: "price_watch_issue_unavailable" });
  assert.equal(fetchCalls, 1);
  assert.equal(dbCalls, 0);
});

test("approved runtime terminalizes an honest-zero current issue without Resend transport", async () => {
  let issueRow = null;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (!issueRow) return null;
              return {
                status: issueRow.status,
                content_hash: issueRow.content_hash,
                operator_receipt_sha256: issueRow.operator_receipt_sha256,
              };
            },
            async all() {
              assert.match(sql, /FROM subscribers/);
              return { results: [] };
            },
            async run() {
              if (/INSERT OR IGNORE INTO newsletter_issues/.test(sql)) {
                issueRow = {
                  status: "sending",
                  content_hash: args[3],
                  operator_receipt_sha256: args[6],
                };
              } else if (/UPDATE newsletter_issues SET status=/.test(sql)) {
                issueRow.status = args[0];
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  let issueFetches = 0;
  const receipt = heldConfig.operator_approval.receipt_sha256;
  const result = await runPriceWatchCycle(activeEnv(db), NOW, async (url) => {
    assert.equal(url, PRICE_WATCH_ISSUE_URL);
    issueFetches += 1;
    return responseFor(envelopeText);
  });
  assert.deepEqual(result, {
    status: "PASS",
    sent: 0,
    retries: 0,
    failed: 0,
    skipped: 0,
    campaign_id: CAMPAIGN_ID,
    issue_status: "complete_no_eligible",
  });
  assert.equal(issueRow.status, "complete_no_eligible");
  assert.equal(issueRow.operator_receipt_sha256, receipt);
  assert.equal(issueFetches, 1);
});
