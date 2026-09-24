import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { composePriceWatchIssue, validatePublishedPriceWatchIssue } from "../src/price-watch-email.mjs";
import { frozenPriceLedger } from "../src/price-index-nonprice-binding.mjs";
import {
  buildMessage,
  emailRuntimeGate,
  isWeeklyPriceWatchSubscriber,
  resendMachinePolicy,
} from "../src/resend-email-machine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CURRENT_BASE = process.env.GLP_CURRENT_CONTENT_BASE || "/home/ubuntu/business/reports/glp-clinic-scout/seo-machine/current-content-base.json";
const REPORT_ROOT = "/home/ubuntu/business/reports/glp-clinic-scout/growth/build-4/activation-20260808-r3";
const FRESH_READBACK_PATH = "/home/ubuntu/business/reports/glp-clinic-scout/growth/build-4/newsletter-amendment-fresh-readback-20260809.json";
const CONFIG_PATH = process.env.GLP_EMAIL_CONFIG_PATH || path.join(ROOT, "data/resend-email-machine.json");
const MIRROR_PATH = process.env.GLP_EMAIL_MIRROR_PATH || path.join(ROOT, "artifacts/ops/resend-email-machine.json");
const EXACT_FROM = "GLP Clinic Scout <izaiah@glpclinicscout.com>";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const load = async (file) => JSON.parse(await readFile(file, "utf8"));

async function sourceInput() {
  const names = ["price-tracker.json", "original-data-study.json", "program-registry.json", "program-content-ledger.json"];
  const entries = await Promise.all(names.map(async (name) => [name, await readFile(path.join(ROOT, "data", name))]));
  const files = Object.fromEntries(entries);
  const priceLedger = frozenPriceLedger(files["program-content-ledger.json"],
    await readFile(path.join(ROOT, "data/price-index-frozen-content-ledger.json")),
    await load(path.join(ROOT, "data/price-index-nonprice-binding.json")));
  return {
    tracker: JSON.parse(files["price-tracker.json"]),
    study: JSON.parse(files["original-data-study.json"]),
    programRegistry: JSON.parse(files["program-registry.json"]),
    contentLedger: priceLedger.ledger,
    sourceHashes: {
      original_data_study_sha256: sha256(files["original-data-study.json"]),
      program_content_ledger_sha256: sha256(priceLedger.bytes),
      program_registry_sha256: sha256(files["program-registry.json"]),
    },
  };
}

async function tree(root) {
  const rows = [];
  async function walk(current) {
    for (const name of (await readdir(current)).sort()) {
      const target = path.join(current, name);
      const info = await stat(target);
      if (info.isDirectory()) await walk(target);
      else if (info.isFile()) rows.push([path.relative(root, target), sha256(await readFile(target))]);
    }
  }
  await walk(root);
  const digest = createHash("sha256");
  for (const [name, hash] of rows) digest.update(`${name}\0${hash}\n`);
  return { files: rows.length, sha256: digest.digest("hex"), rows: Object.fromEntries(rows) };
}

const config = await load(CONFIG_PATH);
const mirror = await load(MIRROR_PATH);
const sample = await load(path.join(REPORT_ROOT, "price-watch-approved-sample.json"));
const authorityBytes = await readFile(path.join(REPORT_ROOT, "operator-authority.json"));
const authority = JSON.parse(authorityBytes);
const freshReadbackBytes = await readFile(FRESH_READBACK_PATH);
const freshReadback = JSON.parse(freshReadbackBytes);
const currentBase = await load(CURRENT_BASE);
const predecessorRoot = currentBase.release_root;
assert.equal(path.isAbsolute(predecessorRoot), true);
const currentRootEqualsRoot = path.resolve(predecessorRoot) === ROOT;
if (!currentRootEqualsRoot) assert.notEqual(path.resolve(predecessorRoot), ROOT);
const predecessorFeedExists = await stat(path.join(predecessorRoot, "public/data/price-watch-issue.json")).then((info) => info.isFile()).catch(() => false);
const priceIndexManifest = await load(path.join(ROOT, "artifacts/ops/price-index-manifest.json"));

assert.deepEqual(mirror, config);
assert.equal(config.status, "LIVE_SCHEDULED_ZERO_ELIGIBLE");
assert.equal(config.runtime_enabled, true);
assert.equal(config.send_authorized, true);
assert.equal(config.operator_approval.receipt_sha256, sha256(authorityBytes));
assert.equal(authority.status, "APPROVED_SUCCESSOR_SENDER_OVERRIDE");
assert.equal(authority.approved_scope.sender, EXACT_FROM);
assert.equal(config.domain.from_name, "GLP Clinic Scout");
assert.equal(config.domain.from_identity, EXACT_FROM);
assert.equal(config.domain.warmup_status, "PASS");
assert.equal(config.activation_evidence.status, "PASS_LIVE_SCHEDULED_ZERO_ELIGIBLE");
assert.equal(config.activation_evidence.readback_path, FRESH_READBACK_PATH);
assert.equal(config.activation_evidence.readback_sha256, sha256(freshReadbackBytes));
assert.equal(config.activation_evidence.current_release_root, ROOT);
assert.equal(config.activation_evidence.from_identity, EXACT_FROM);
assert.equal(config.activation_evidence.reply_to, "izaiah@glpclinicscout.com");
assert.equal(config.activation_evidence.operator_receipt_sha256, config.operator_approval.receipt_sha256);
assert.equal(config.activation_evidence.provider_module_sha256, freshReadback.worker.module_sha256);
if (currentRootEqualsRoot) {
  assert.equal(config.activation_evidence.status, freshReadback.status);
  assert.equal(path.resolve(config.activation_evidence.current_release_root), ROOT);
}
const activeEnv = {
  EMAIL_RUNTIME_MODE: "production_operator_approved",
  EMAIL_OPERATOR_RECEIPT_SHA256: config.operator_approval.receipt_sha256,
  EMAIL_SEND_GATE: `operator-approved:${config.operator_approval.receipt_sha256}`,
  EMAIL_WARMUP_STATUS: "PASS",
  RESEND_API_KEY: "synthetic-validator-only",
};
assert.equal(emailRuntimeGate(config, activeEnv), true);
assert.equal(emailRuntimeGate(config, { ...activeEnv, EMAIL_OPERATOR_RECEIPT_SHA256: "f".repeat(64), EMAIL_SEND_GATE: `operator-approved:${"f".repeat(64)}` }), false);
assert.equal(config.domain.sending_domain, "glpclinicscout.com");
assert.equal(config.domain.sender_alias, "izaiah@glpclinicscout.com");
assert.equal(config.domain.reply_to, "izaiah@glpclinicscout.com");
assert.equal(config.domain.resend_domain_verified, true);
assert.equal(config.domain.resend_domain_status, "verified");
assert.equal(config.domain.resend_sending_capability, "enabled");
assert.equal(config.domain.alias_routing_verified, true);
assert.equal(config.alias_decision.alias_mutations, 0);
assert.equal(config.alias_decision.label_mutations, 0);
assert.equal(config.alias_decision.filter_mutations, 0);
assert.match(await readFile(path.join(ROOT, config.postal_address.evidence_path), "utf8"), /Tilton Group LLC, 2108 N St, Ste N, Sacramento, CA 95816/);
assert.equal(freshReadback.status, "PASS_LIVE_SCHEDULED_ZERO_ELIGIBLE");
assert.equal(freshReadback.mailbox.canonical_address, "izaiah@glpclinicscout.com");
assert.equal(freshReadback.mailbox.lifecycle, "active");
assert.equal(freshReadback.mailbox.gmail_profile_match, true);
assert.equal(freshReadback.worker.sender_exact, true);
assert.equal(freshReadback.worker.reply_to_exact, true);
assert.equal(freshReadback.worker.custom_resend_user_agent_present, true);
assert.equal(freshReadback.worker.postal_address_present, true);
assert.equal(freshReadback.worker.list_unsubscribe_present, true);
assert.equal(freshReadback.worker.runtime_mode_exact, true);
assert.equal(freshReadback.worker.operator_receipt_exact, true);
assert.equal(freshReadback.worker.send_gate_exact, true);
assert.equal(freshReadback.worker.warmup_status_exact, true);
assert.equal(freshReadback.worker.d1_binding_exact, true);
assert.equal(freshReadback.worker.cron_exact, true);
assert.equal(freshReadback.resend.domain, "glpclinicscout.com");
assert.equal(freshReadback.resend.status, "verified");
assert.equal(freshReadback.dns.dkim.present, true);
assert.equal(freshReadback.dns.dmarc.present, true);
assert.equal(freshReadback.d1.database_id, "bcb91d2d-c3f1-4c55-93e3-070587e86d60");
assert.equal(freshReadback.d1.eligible_subscribers, 0);
assert.deepEqual(freshReadback.effects, { email_sends: 0, worker_invocations: 0, provider_mutations: 0, d1_writes: 0, spend_usd: 0 });

const priceIndexInput = await sourceInput();
const expectedObservedOn = priceIndexManifest.latest_observed_on;
const issue = composePriceWatchIssue({ config, priceIndexInput, eligiblePrograms: [], now: `${expectedObservedOn}T23:59:59Z` });
assert.equal(issue.campaignId, `price-watch-${expectedObservedOn}`);
assert.equal(issue.source.observed_on, expectedObservedOn);
assert.equal(issue.promotion_share_percent, 0);
if (!predecessorFeedExists) {
  assert.equal(issue.source.movers_status, "NO_PRIOR_OBSERVED_WEEK");
  assert.equal(issue.template.subject, sample.sample.subject);
  assert.equal(issue.template.preheader, sample.sample.preheader);
  assert.equal(issue.zero_click_value, sample.sample.body_preview);
  assert.match(issue.zero_click_value, /does not backfill or invent earlier prices/);
}
const message = buildMessage({
  config,
  subscriber: {
    subscriber_id: "validator",
    email: "validator@example.test",
    vertical: "glp-clinic-scout",
    funnel_stage: "content-upgrade",
    consent_status: "opted-in",
    consent_version: "glp-content-upgrade-v2-20260801",
    consent_source: "/glp-1-price-index/:price-watch",
    status: "active",
    unsubscribe_token: "0123456789abcdef0123456789abcdef",
  },
  template: issue.template,
  campaignId: issue.campaignId,
});
assert.equal(message.body.from, EXACT_FROM);
assert.equal(message.body.reply_to, "izaiah@glpclinicscout.com");
assert.equal(message.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
assert.match(message.body.html, /Tilton Group LLC.+2108 N St.+Ste N.+Sacramento, CA 95816/);
assert.equal(isWeeklyPriceWatchSubscriber({
  subscriber_id: "validator",
  email: "validator@example.test",
  vertical: "glp-clinic-scout",
  funnel_stage: "content-upgrade",
  consent_status: "opted-in",
  consent_version: "glp-content-upgrade-v2-20260801",
  consent_source: "/glp-1-price-index/:price-watch",
  status: "active",
  unsubscribe_token: "0123456789abcdef0123456789abcdef",
}), true);
assert.equal(resendMachinePolicy.sendingDomain, "glpclinicscout.com");
assert.equal(sample.approval_gate.startsWith("Operator approval is recorded"), true);
assert.equal(sample.status, "LOCAL_RENDERED_OPERATOR_APPROVED_PENDING_DEPLOY");
assert.equal(sample.send_count, 0);
assert.equal(sample.runtime_enabled, true);
assert.equal(sample.send_authorized, true);

const secretPattern = /(?:re_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,})/;
for (const relative of ["data/resend-email-machine.json", "src/resend-email-machine.mjs", "src/price-watch-email.mjs", "scripts/render-price-watch-decision-sample.mjs", "tests/price-watch-email.test.mjs"]) {
  assert.doesNotMatch(await readFile(path.join(ROOT, relative), "utf8"), secretPattern, relative);
}
const [predecessorPublic, candidatePublic] = await Promise.all([
  tree(path.join(predecessorRoot, "public")),
  tree(path.join(ROOT, "public")),
]);
const predecessorNames = new Set(Object.keys(predecessorPublic.rows));
const candidateNames = new Set(Object.keys(candidatePublic.rows));
const addedPublic = [...candidateNames].filter((name) => !predecessorNames.has(name)).sort();
const removedPublic = [...predecessorNames].filter((name) => !candidateNames.has(name)).sort();
const modifiedPublic = [...candidateNames].filter((name) => predecessorNames.has(name) && candidatePublic.rows[name] !== predecessorPublic.rows[name]).sort();
if (currentRootEqualsRoot) {
  assert.deepEqual(addedPublic, []);
  assert.deepEqual(removedPublic, []);
  assert.deepEqual(modifiedPublic, []);
} else if (!predecessorFeedExists) {
  assert.deepEqual(addedPublic, ["data/price-watch-issue.json"]);
  assert.deepEqual(removedPublic, []);
  assert.deepEqual(modifiedPublic, ["_headers"]);
} else {
  assert.deepEqual(addedPublic, ["data/therapeutic-taxonomy.json"]);
  assert.deepEqual(removedPublic, []);
}
const publishedEnvelope = await load(path.join(ROOT, "public/data/price-watch-issue.json"));
assert.deepEqual(Object.keys(publishedEnvelope).sort(), ["issue", "issue_sha256", "schema"]);
assert.equal(publishedEnvelope.schema, "glp-clinic-scout-published-price-watch-envelope-v1");
assert.equal(publishedEnvelope.issue_sha256, sha256(JSON.stringify(publishedEnvelope.issue)));
assert.deepEqual(validatePublishedPriceWatchIssue(publishedEnvelope.issue, { expectedObservedOn }), issue);
assert.match(await readFile(path.join(ROOT, "public/_headers"), "utf8"), /\/data\/price-watch-issue\.json\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet\n  Content-Type: application\/json; charset=utf-8/);
const publicTree = { files: candidatePublic.files, sha256: candidatePublic.sha256 };

process.stdout.write(`${JSON.stringify({
  status: "PASS_BUILD4_LIVE_SCHEDULED_ZERO_ELIGIBLE",
  current_root_mode: currentRootEqualsRoot ? "postdeploy_remint_bound" : "predeploy_predecessor",
  exact_from: config.domain.from_identity,
  chosen_alias: config.domain.sender_alias,
  operator_authority_sha256: config.operator_approval.receipt_sha256,
  provider_domain_status: config.domain.resend_domain_status,
  google_identity_status: freshReadback.mailbox.gmail_profile_match ? "PASS" : "FAIL",
  monitored_mailbox: freshReadback.mailbox.canonical_address,
  eligible_subscribers: freshReadback.d1.eligible_subscribers,
  price_records: issue.source.record_count,
  movement_status: issue.source.movers_status,
  promotion_share_percent: issue.promotion_share_percent,
  public_tree: publicTree,
  sends: 0,
  smtp_sends: 0,
  provider_mutations: 0,
  outreach: 0,
  spend_usd: 0,
})}\n`);
