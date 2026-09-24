import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { composePriceWatchIssue } from "../src/price-watch-email.mjs";
import { frozenPriceLedger } from "../src/price-index-nonprice-binding.mjs";
import { buildMessage } from "../src/resend-email-machine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.resolve(process.argv[2] || "/home/ubuntu/business/reports/glp-clinic-scout/growth/build-4/activation-20260808-r3/price-watch-approved-sample.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function load(name) {
  const bytes = await readFile(path.join(ROOT, "data", name));
  return { bytes, value: JSON.parse(bytes) };
}

const [config, tracker, study, registry, ledger] = await Promise.all([
  load("resend-email-machine.json"),
  load("price-tracker.json"),
  load("original-data-study.json"),
  load("program-registry.json"),
  load("program-content-ledger.json"),
]);
const priceLedger = frozenPriceLedger(ledger.bytes,
  (await load("price-index-frozen-content-ledger.json")).bytes,
  (await load("price-index-nonprice-binding.json")).value);
const input = {
  tracker: tracker.value,
  study: study.value,
  programRegistry: registry.value,
  contentLedger: priceLedger.ledger,
  sourceHashes: {
    original_data_study_sha256: sha256(study.bytes),
    program_content_ledger_sha256: sha256(priceLedger.bytes),
    program_registry_sha256: sha256(registry.bytes),
  },
};
const issue = composePriceWatchIssue({ config: config.value, priceIndexInput: input, eligiblePrograms: [], now: "2026-08-08T23:59:59Z" });
const message = buildMessage({
  config: config.value,
  subscriber: {
    subscriber_id: "local-decision-preview",
    email: "preview@example.test",
    first_name: "Reader",
    vertical: "glp-clinic-scout",
    funnel_stage: "content-upgrade",
    consent_status: "opted-in",
    status: "active",
    unsubscribe_token: "0123456789abcdef0123456789abcdef",
  },
  template: issue.template,
  featuredProgram: issue.featuredProgram,
  campaignId: issue.campaignId,
});
const card = {
  schema: "glp-clinic-scout-build4-approved-sample-v2",
  status: "LOCAL_RENDERED_OPERATOR_APPROVED_PENDING_DEPLOY",
  chosen_alias: config.value.alias_decision.chosen,
  alias_decision: config.value.alias_decision.decision,
  alias_reason: config.value.alias_decision.reason,
  alternatives_considered: config.value.alias_decision.alternatives_considered,
  evidence_paths: {
    source_tracker: path.join(ROOT, "data/price-tracker.json"),
    source_validator: path.join(ROOT, "src/price-index.mjs"),
    email_machine: path.join(ROOT, "src/resend-email-machine.mjs"),
    provider_and_alias_readback: config.value.domain.provider_evidence_path,
    dns_readback: config.value.domain.dns_evidence_path,
    postal_address_source: path.join(ROOT, config.value.postal_address.evidence_path),
  },
  provider: {
    domain: config.value.domain.sending_domain,
    status: config.value.domain.resend_domain_status,
    sending_capability: config.value.domain.resend_sending_capability,
    region: config.value.domain.resend_domain_region,
  },
  sample: {
    from: message.body.from,
    subject: issue.template.subject,
    preheader: issue.template.preheader,
    body_preview: issue.zero_click_value,
    zero_click_value_present: true,
    promotion_share_percent: issue.promotion_share_percent,
    rendered_html_sha256: sha256(message.body.html),
  },
  postal_address: {
    value: config.value.postal_address.value,
    evidence_path: path.join(ROOT, config.value.postal_address.evidence_path),
  },
  consent_and_unsubscribe: {
    audience: "Active, opted-in GLP Clinic Scout site captures only; consent version and source are required; suppression is checked again at the idempotent delivery claim.",
    unsubscribe: "Visible tokenized link plus RFC 8058 List-Unsubscribe and List-Unsubscribe-Post; unsubscribe immediately withdraws consent and writes suppression.",
  },
  approval_gate: "Operator approval is recorded in the exact receipt bound by config.operator_approval.receipt_sha256. Runtime still requires the matching production environment receipt and send gate.",
  runtime_enabled: config.value.runtime_enabled,
  send_authorized: config.value.send_authorized,
  send_count: 0,
  external_effects: {
    provider_email_sends: 0,
    gmail_sends: 0,
    smtp_sends: 0,
    outreach: 0,
    spend_usd: 0,
    provider_mutations: 0,
  },
  credentials_included: false,
};
await mkdir(path.dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(card, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT, 0o600);
process.stdout.write(`${JSON.stringify({ status: card.status, output: OUTPUT, send_count: 0, credentials_included: false })}\n`);
