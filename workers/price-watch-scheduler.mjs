import config from "../data/resend-email-machine.json" with { type: "json" };

import { validatePublishedPriceWatchIssue } from "../src/price-watch-email.mjs";
import { emailRuntimeGate, runWeeklyPriceWatch } from "../src/resend-email-machine.mjs";

export const PRICE_WATCH_CRON = "0 15 * * 1";
export const PRICE_WATCH_ISSUE_URL = "https://glpclinicscout.com/data/price-watch-issue.json";

const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256Text = async (value) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const utcDate = (date) => date.toISOString().slice(0, 10);

export async function fetchCurrentPriceWatchIssue(fetchImpl = fetch, now = new Date()) {
  const response = await fetchImpl(PRICE_WATCH_ISSUE_URL, {
    method: "GET",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!response || response.status !== 200) throw new Error("price_watch_issue_fetch_failed");
  const text = await response.text();
  if (!text || text.length > 131072) throw new Error("price_watch_issue_bytes_invalid");
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error("price_watch_issue_json_invalid"); }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.keys(envelope).sort().join(",") !== "issue,issue_sha256,schema" || envelope.schema !== "glp-clinic-scout-published-price-watch-envelope-v1" || !/^[a-f0-9]{64}$/.test(envelope.issue_sha256 || "")) throw new Error("price_watch_issue_envelope_invalid");
  if (await sha256Text(JSON.stringify(envelope.issue)) !== envelope.issue_sha256) throw new Error("price_watch_issue_hash_invalid");
  return validatePublishedPriceWatchIssue(envelope.issue, { expectedObservedOn: utcDate(now) });
}

async function issueHash(issue) {
  const payload = JSON.stringify({
    schema: issue.schema,
    campaign_id: issue.campaignId,
    source: issue.source,
    template: issue.template,
    promotion_share_percent: issue.promotion_share_percent,
  });
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
}

export async function runPriceWatchCycle(env, now = new Date(), fetchImpl = fetch, configOverride = config) {
  if (!emailRuntimeGate(configOverride, env)) {
    return { status: "HELD", sent: 0, reason: "email_runtime_gate" };
  }
  if (!env.EMAIL_DB?.prepare) {
    return { status: "HELD", sent: 0, reason: "email_db_missing" };
  }

  let issue;
  try {
    issue = await fetchCurrentPriceWatchIssue(fetchImpl, now);
  } catch {
    return { status: "HELD", sent: 0, reason: "price_watch_issue_unavailable" };
  }
  const contentHash = await issueHash(issue);
  const approvalHash = env.EMAIL_OPERATOR_RECEIPT_SHA256;
  const prior = await env.EMAIL_DB
    .prepare("SELECT status,content_hash,operator_receipt_sha256 FROM newsletter_issues WHERE issue_id=? LIMIT 1")
    .bind(issue.campaignId)
    .first();

  if (prior && ["sent", "complete_no_eligible"].includes(prior.status)) {
    if (prior.content_hash !== contentHash || prior.operator_receipt_sha256 !== approvalHash) {
      throw new Error("price_watch_terminal_issue_binding_drift");
    }
    return { status: "ALREADY_COMPLETE", sent: 0, campaign_id: issue.campaignId };
  }

  await env.EMAIL_DB
    .prepare("INSERT OR IGNORE INTO newsletter_issues (issue_id,vertical,week_key,subject,content_hash,featured_program_id,promo_code,status,operator_receipt_sha256,created_at) VALUES (?,'glp-clinic-scout',?,?,?,?,?,'sending',?,?)")
    .bind(
      issue.campaignId,
      issue.source.observed_on,
      issue.template.subject,
      contentHash,
      issue.featuredProgram?.program_id || null,
      issue.featuredProgram?.promo_code_verified === true ? issue.featuredProgram.promo_code : null,
      approvalHash,
      now.toISOString(),
    )
    .run();

  const current = await env.EMAIL_DB
    .prepare("SELECT status,content_hash,operator_receipt_sha256 FROM newsletter_issues WHERE issue_id=? LIMIT 1")
    .bind(issue.campaignId)
    .first();
  if (!current || current.content_hash !== contentHash || current.operator_receipt_sha256 !== approvalHash) {
    throw new Error("price_watch_issue_claim_binding_failed");
  }

  const outcome = await runWeeklyPriceWatch(env, configOverride, issue, now, fetchImpl);
  const terminalStatus = outcome.status === "PASS"
    ? (outcome.sent > 0 ? "sent" : "complete_no_eligible")
    : (outcome.retries > 0 ? "retry" : "partial");
  await env.EMAIL_DB
    .prepare("UPDATE newsletter_issues SET status=?,sent_at=CASE WHEN ? IN ('sent','complete_no_eligible') THEN ? ELSE sent_at END WHERE issue_id=? AND content_hash=? AND operator_receipt_sha256=?")
    .bind(terminalStatus, terminalStatus, now.toISOString(), issue.campaignId, contentHash, approvalHash)
    .run();
  return { ...outcome, campaign_id: issue.campaignId, issue_status: terminalStatus };
}

export default {
  async scheduled(controller, env, ctx) {
    if (controller.cron !== PRICE_WATCH_CRON) throw new Error("price_watch_unexpected_cron");
    ctx.waitUntil((async () => {
      const result = await runPriceWatchCycle(env, new Date(controller.scheduledTime));
      console.log(JSON.stringify({
        status: result.status,
        campaign_id: result.campaign_id || null,
        sent: result.sent || 0,
        retries: result.retries || 0,
        failed: result.failed || 0,
        skipped: result.skipped || 0,
        pii_logged: false,
      }));
      if (!["PASS", "ALREADY_COMPLETE"].includes(result.status)) throw new Error(`price_watch_cycle_${result.status}`);
    })());
  },
};
