import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleContentUpgradeRequest } from "../src/content-upgrade.mjs";
import { composePriceWatchIssue } from "../src/price-watch-email.mjs";
import { normalizePriceIndexSourceHashes } from "../src/price-index.mjs";
import { frozenPriceLedger } from "../src/price-index-nonprice-binding.mjs";
import { buildMessage, emailRuntimeGate, isWeeklyPriceWatchSubscriber, resendMachinePolicy, runWeeklyPriceWatch, sendWithResend } from "../src/resend-email-machine.mjs";
import { CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES, COST_CALCULATOR_CAPTURE } from "../src/site-capture-consent-sources.mjs";

const DATA = new URL("../data/", import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const VALIDATOR = fileURLToPath(new URL("../scripts/validate-price-watch-email.mjs", import.meta.url));
const trackerFixture = JSON.parse(await readFile(new URL("price-tracker.json", DATA)));
const LATEST_OBSERVED_ON = trackerFixture.price_index.observations.at(-1).observed_on;
const NOW = `${LATEST_OBSERVED_ON}T23:59:59Z`;
const CAMPAIGN_ID = `price-watch-${LATEST_OBSERVED_ON}`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, DATA), "utf8"));
}

async function priceIndexInput() {
  const names = ["price-tracker.json", "original-data-study.json", "program-registry.json", "program-content-ledger.json"];
  const bytes = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, DATA))])));
  const priceLedger = frozenPriceLedger(bytes["program-content-ledger.json"],
    await readFile(new URL("price-index-frozen-content-ledger.json", DATA)),
    await readJson("price-index-nonprice-binding.json"));
  return {
    tracker: JSON.parse(bytes["price-tracker.json"]),
    study: JSON.parse(bytes["original-data-study.json"]),
    programRegistry: JSON.parse(bytes["program-registry.json"]),
    contentLedger: priceLedger.ledger,
    sourceHashes: {
      original_data_study_sha256: sha256(bytes["original-data-study.json"]),
      program_content_ledger_sha256: sha256(priceLedger.bytes),
      program_registry_sha256: sha256(bytes["program-registry.json"]),
    },
  };
}

async function publicHtmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await publicHtmlFiles(location));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(location);
  }
  return files;
}

function hiddenInputValue(form, name) {
  return form.match(new RegExp(`<input\\b(?=[^>]*\\bname=["']${name}["'])(?=[^>]*\\bvalue=["']([^"']*)["'])[^>]*>`, "i"))?.[1] ?? null;
}

async function emittedTermsCaptureSources() {
  const sources = new Set();
  for (const file of await publicHtmlFiles(path.join(ROOT, "public"))) {
    const page = await readFile(file, "utf8");
    for (const match of page.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
      const form = match[0];
      if (!form.includes("/api/content-upgrade") && !form.includes("content-upgrade")) continue;
      const source = hiddenInputValue(form, "source_page");
      const lead = hiddenInputValue(form, "lead_magnet_key");
      if (source && lead?.endsWith("-terms-checklist")) {
        sources.add(`${source}:${lead}`);
      } else if (source === "" && lead === "") {
        const precedingPage = page.slice(0, match.index);
        const slugs = [...precedingPage.matchAll(/data-page-slug=["']([^"']+)["']/gi)];
        const slug = slugs.at(-1)?.[1];
        if (slug) sources.add(`${slug}:${slug}-terms-checklist`);
      }
    }
  }
  return [...sources].sort();
}

async function emittedNonTermsCaptures() {
  const captures = [];
  for (const file of await publicHtmlFiles(path.join(ROOT, "public"))) {
    const page = await readFile(file, "utf8");
    for (const match of page.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
      const form = match[0];
      if (!form.includes("/api/content-upgrade") && !form.includes("content-upgrade")) continue;
      const source = hiddenInputValue(form, "source_page");
      const lead = hiddenInputValue(form, "lead_magnet_key");
      if (source && lead && !lead.endsWith("-terms-checklist")) captures.push({
        file: path.relative(path.join(ROOT, "public"), file), source, lead,
        consentVersion: hiddenInputValue(form, "consent_version"),
        hasMatchIds: /<input\b[^>]*name=["']match_program_ids["']/.test(form),
      });
    }
  }
  return captures.sort((a, b) => a.file.localeCompare(b.file));
}

function termsCaptureSourceForRoute(route) {
  const slug = String(route || "/").split("/").filter(Boolean).join("-") || "home";
  return `${slug}:${slug}-terms-checklist`;
}

async function stagedPhase3CaptureSources() {
  const [graph, pharmacyInput] = await Promise.all([
    readJson("phase3-page-graph.json"),
    readJson("phase3-pharmacy-render-input.json"),
  ]);
  assert.equal(graph.status, "STAGED_NOT_DEPLOYED");
  const routes = [
    "/insights/page/5/", // Complete current carrier corpus adds the fifth Insights page.
    ...(graph.comparison_pages || []).map((entry) => entry.route),
    ...(graph.organic_compounded_pages || []).map((entry) => entry.route),
    ...(graph.provider_work_order_additions || []).map((entry) => `/providers/${entry.program_id}/`),
    ...(pharmacyInput.entries || [])
      .filter((entry) => (entry.provider_relationships || []).some((relationship) => relationship?.status === "verified" && relationship.program_id && relationship.source_url))
      .map((entry) => `${entry.route}compare-providers/`),
  ];
  return [...new Set(routes.map(termsCaptureSourceForRoute))].sort();
}

function subscriber(overrides = {}) {
  return {
    subscriber_id: "site-capture-1",
    email: "reader@example.test",
    first_name: "Reader",
    vertical: "glp-clinic-scout",
    funnel_stage: "content-upgrade",
    consent_status: "opted-in",
    consent_version: "glp-content-upgrade-v2-20260801",
    consent_source: "providers:providers-terms-checklist",
    unsubscribe_token: "0123456789abcdef0123456789abcdef",
    status: "active",
    created_at: "2026-08-08T00:00:00Z",
    ...overrides,
  };
}

function armedConfig(config) {
  const open = structuredClone(config);
  open.runtime_enabled = true;
  open.send_authorized = true;
  open.domain.warmup_status = "PASS";
  return open;
}

function armedEnv(db, receipt = "fed001deeb0ba25a6ee8361249c72c5a68b2e4f2dfdef45f8e420ed8dacd2d1f") {
  return {
    EMAIL_DB: db,
    EMAIL_RUNTIME_MODE: "production_operator_approved",
    EMAIL_OPERATOR_RECEIPT_SHA256: receipt,
    EMAIL_SEND_GATE: `operator-approved:${receipt}`,
    EMAIL_WARMUP_STATUS: "PASS",
    RESEND_API_KEY: "synthetic-test-key",
  };
}

test("weekly price watch is derived from the validated Price Index and refuses invented movement", async () => {
  const config = await readJson("resend-email-machine.json");
  const input = await priceIndexInput();
  input.tracker.price_index.observations = input.tracker.price_index.observations.slice(0, 1);
  input.tracker.price_index.observations.at(-1).source_files = normalizePriceIndexSourceHashes(input.programRegistry, input.sourceHashes);
  const firstObservedOn = input.tracker.price_index.observations[0].observed_on;
  const issue = composePriceWatchIssue({ config, priceIndexInput: input, now: `${firstObservedOn}T23:59:59Z` });
  assert.equal(issue.schema, "glp-clinic-scout-weekly-price-watch-v1");
  assert.equal(issue.campaignId, "price-watch-2026-08-08");
  assert.equal(issue.status, "READY_GATE_REQUIRED_NO_PROMOTION");
  assert.equal(issue.promotion_share_percent, 0);
  assert.equal(issue.source.record_count, 35);
  assert.equal(issue.source.observation_count, 1);
  assert.equal(issue.source.data_as_of, "2026-08-06");
  assert.equal(issue.source.movers_status, "NO_PRIOR_OBSERVED_WEEK");
  assert.match(issue.template.subject, /\$112 semaglutide median, \$182\.50 tirzepatide/);
  assert.match(issue.template.preheader, /35 dated price observations/);
  assert.match(issue.zero_click_value, /\$74 to \$179 range/);
  assert.match(issue.zero_click_value, /\$125 to \$279 range/);
  assert.match(issue.zero_click_value, /no prior observed week exists yet/i);
  assert.doesNotMatch(issue.zero_click_value, /(?:rose|fell|increased|decreased) this week/i);
});

test("price watch derivation fails closed when tracker evidence is changed", async () => {
  const config = await readJson("resend-email-machine.json");
  const input = await priceIndexInput();
  input.tracker.price_index.records[0].amount_usd = 1;
  assert.throws(() => composePriceWatchIssue({ config, priceIndexInput: input, now: NOW }), /price_index_/);
});

test("rendered price watch has zero-click value, chosen sender, postal address, and one-click unsubscribe", async () => {
  const config = await readJson("resend-email-machine.json");
  const issue = composePriceWatchIssue({ config, priceIndexInput: await priceIndexInput(), now: NOW });
  const message = buildMessage({ config, subscriber: subscriber(), template: issue.template, featuredProgram: issue.featuredProgram, campaignId: issue.campaignId });
  assert.equal(message.body.from, "GLP Clinic Scout <izaiah@glpclinicscout.com>");
  assert.equal(message.body.reply_to, "izaiah@glpclinicscout.com");
  assert.match(message.body.html, /no click is required/);
  assert.match(message.body.html, /\$112 semaglutide median/);
  assert.match(message.body.html, /2108 N St, Ste N/);
  assert.match(message.body.html, /Sacramento, CA 95816/);
  assert.equal(message.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(message.body.headers["List-Unsubscribe"], /unsubscribe\?token=0123456789abcdef0123456789abcdef/);
  assert.match(message.body.text, /Unsubscribe: https:\/\/glpclinicscout\.com\/unsubscribe/);
  assert.equal(message.idempotencyKey, `${CAMPAIGN_ID}/site-capture-1/${issue.template.week_number}`);
  assert.throws(() => buildMessage({
    config,
    subscriber: subscriber({ consent_source: "admin-upload:admin-upload-terms-checklist" }),
    template: issue.template,
    featuredProgram: issue.featuredProgram,
    campaignId: issue.campaignId,
  }), /subscriber_not_sendable/);
});

test("site-capture eligibility requires exact consent provenance, active state, and unsubscribe token", () => {
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber()), true);
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({ consent_source: "/glp-1-price-index/:price-watch" })), true);
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({
    funnel_stage: "quiz-lead",
    consent_version: "glp-lead-v2-20260723",
    consent_source: "/quiz/provider-fit/",
  })), true);
  const costCalculatorCapture = JSON.stringify({
    source_page: COST_CALCULATOR_CAPTURE.sourcePage,
    lead_magnet_key: COST_CALCULATOR_CAPTURE.leadMagnetKey,
    cost_breakdown: {
      version: "cost-breakdown-v1",
      providerId: "provider-one",
      providerName: "Provider One",
      firstMonthUsd: 100,
      recurringMonthUsd: 80,
      months: 3,
      totalUsd: 260,
      priceContext: "Published self-pay planning values",
      checkedAsOf: "2026-08-09",
    },
  });
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({ consent_source: costCalculatorCapture })), true);
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({ consent_source: JSON.stringify({ ...JSON.parse(costCalculatorCapture), imported: true }) })), false);
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({ consent_source: JSON.stringify({ ...JSON.parse(costCalculatorCapture), cost_breakdown: {} }) })), false);
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({ consent_source: JSON.stringify({ ...JSON.parse(costCalculatorCapture), cost_breakdown: { imported: true } }) })), false);
  for (const mutation of [
    { vertical: "imported-list" },
    { funnel_stage: "affiliate-import" },
    { consent_status: "withdrawn" },
    { consent_version: "unknown" },
    { consent_source: "" },
    { consent_source: "imported-csv" },
    { consent_source: "forced-enrollment" },
    { consent_source: "manual-offsite" },
    { consent_source: "manual/offsite" },
    { consent_source: "x" },
    { consent_source: "imported-csv:imported-csv-terms-checklist" },
    { consent_source: "admin-upload:admin-upload-terms-checklist" },
    { consent_source: "forced-enrollment:forced-enrollment-terms-checklist" },
    { consent_source: " online-glp-1-program-costs:online-glp-1-program-costs-terms-checklist" },
    { consent_source: "online-glp-1-program-costs:other-terms-checklist" },
    { funnel_stage: "quiz-lead", consent_version: "glp-lead-v2-20260723", consent_source: "/offsite/form/" },
    { funnel_stage: "quiz-lead", consent_version: "glp-content-upgrade-v2-20260801", consent_source: "/quiz/provider-fit/" },
    { unsubscribe_token: "short" },
    { status: "suppressed" },
  ]) assert.equal(isWeeklyPriceWatchSubscriber(subscriber(mutation)), false, JSON.stringify(mutation));
});

test("content-upgrade provenance inventory includes the exact authoritative staged Phase 3 additions", async () => {
  const emitted = await emittedTermsCaptureSources();
  const approved = [...CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES].sort();
  const staged = await stagedPhase3CaptureSources();
  assert.deepEqual(emitted, [...new Set([...approved, ...staged])].sort());
  assert.equal(approved.length, 304);
  assert.equal(staged.length, 9);
  const captures = await emittedNonTermsCaptures();
  assert.deepEqual(captures.map(({file, source, lead}) => [file, source, lead]), [
    ["matches/customized/index.html", "matches-customized", "matches-customized-match-checklist"],
    ["quiz/provider-fit/index.html", "quiz-provider-fit", "quiz-provider-fit-match-checklist"],
    ["tools/glp-1-cost-calculator/index.html", "tools-glp-1-cost-calculator", "tools-glp-1-cost-calculator-cost-breakdown"],
  ]);
  const matches = captures.find(capture => capture.source === "matches-customized");
  assert.equal(matches.hasMatchIds, true);
  assert.equal(matches.consentVersion, "glp-content-upgrade-v2-20260801");
  const writes = [];
  const captureDb = { prepare(sql) { return { bind(...args) { return { async run() {
    writes.push({sql, args}); return { success: true, meta: { changes: 1 } };
  } }; } }; } };
  let transports = 0;
  const noTransport = async () => { transports++; throw new Error("unexpected_transport"); };
  const matchesResponse = await handleContentUpgradeRequest(new Request("https://example.test/api/content-upgrade", {
    method: "POST", headers: {"content-type":"application/json"},
    body: JSON.stringify({ source_page: matches.source, lead_magnet_key: matches.lead,
      consent_version: matches.consentVersion, email: "reader@example.test", email_consent: true,
      company: "", match_program_ids: "healthrx,try-ageless,wellorithm" }),
  }), { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: captureDb }, noTransport);
  // The form exists, but the current capture validator does not admit its source.
  // Preserve that separate hold; never open capture to exercise sender denial.
  assert.equal(matchesResponse.status, 400);
  assert.equal((await matchesResponse.json()).status, "match_checklist_source_invalid");
  assert.equal(writes.length, 0);
  const quizCapture = captures.find(capture => capture.source === "quiz-provider-fit");
  const response = await handleContentUpgradeRequest(new Request("https://example.test/api/content-upgrade", {
    method: "POST", headers: {"content-type":"application/json"},
    body: JSON.stringify({ source_page: quizCapture.source, lead_magnet_key: quizCapture.lead,
      consent_version: quizCapture.consentVersion, email: "reader@example.test", email_consent: true,
      company: "", match_program_ids: "healthrx,try-ageless,wellorithm" }),
  }), { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: captureDb }, noTransport);
  assert.equal(response.status, 202, await response.clone().text());
  assert.equal((await response.json()).status, "CAPTURED_SENDS_HELD");
  const producerSerialized = writes.find(entry => /INTO subscribers/.test(entry.sql))?.args.find(value =>
    typeof value === "string" && value.includes('"match_program_ids"'));
  assert.ok(producerSerialized, "observe actual producer serialization, not a guessed terms key");
  assert.deepEqual(JSON.parse(producerSerialized), {source_page: quizCapture.source, lead_magnet_key: quizCapture.lead,
    match_program_ids: ["healthrx", "try-ageless", "wellorithm"]});
  // Hostile persisted-row fixture: producer JSON shape with the real matches
  // form's identifiers. This is not a successful matches capture/enrollment.
  const serialized = JSON.stringify({...JSON.parse(producerSerialized), source_page: matches.source, lead_magnet_key: matches.lead});
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({consent_source: serialized})), false);
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber({consent_source: `${matches.source}:${matches.lead}`})), false);
  const config = armedConfig(await readJson("resend-email-machine.json"));
  const issue = composePriceWatchIssue({config, priceIndexInput: await priceIndexInput(), now: NOW});
  let selections = 0, claims = 0;
  const sendDb = {prepare() { return {bind() {return {
    async all() { selections++; return {results:[subscriber({consent_source: serialized})]}; },
    async run() { claims++; throw new Error("matches_reached_claim"); },
  }; }}; }};
  const delivery = await runWeeklyPriceWatch(armedEnv(sendDb), config, issue, new Date(NOW), noTransport);
  assert.deepEqual(delivery, {status:"PASS",sent:0,retries:0,failed:0,skipped:1});
  assert.equal(selections, 1); assert.equal(claims, 0); assert.equal(transports, 0);

  assert.deepEqual(staged.filter((consentSource) => approved.includes(consentSource)), []);
  for (const consentSource of approved) {
    assert.equal(isWeeklyPriceWatchSubscriber(subscriber({ consent_source: consentSource })), true, consentSource);
  }
  for (const consentSource of staged) {
    assert.equal(isWeeklyPriceWatchSubscriber(subscriber({ consent_source: consentSource })), false, consentSource);
  }
});

test("held runtime performs zero DB and zero transport calls", async () => {
  const config = await readJson("resend-email-machine.json");
  const issue = composePriceWatchIssue({ config, priceIndexInput: await priceIndexInput(), now: NOW });
  let dbCalls = 0;
  let transportCalls = 0;
  const db = { prepare() { dbCalls += 1; throw new Error("held_runtime_touched_db"); } };
  const result = await runWeeklyPriceWatch({ EMAIL_DB: db }, config, issue, new Date(NOW), async () => { transportCalls += 1; throw new Error("held_runtime_touched_transport"); });
  assert.deepEqual(result, { status: "HELD", sent: 0, reason: "email_runtime_gate" });
  assert.equal(dbCalls, 0);
  assert.equal(transportCalls, 0);
});

test("hostile nonempty provenance is rejected before claim, retry, or transport even if storage returns it", async () => {
  const config = armedConfig(await readJson("resend-email-machine.json"));
  const issue = composePriceWatchIssue({ config, priceIndexInput: await priceIndexInput(), now: NOW });
  for (const consentSource of ["imported-csv", "forced-enrollment", "manual-offsite", "manual/offsite", "x", "imported-csv:imported-csv-terms-checklist", "admin-upload:admin-upload-terms-checklist"]) {
    const calls = [];
    const db = {
      prepare(sql) {
        calls.push(sql);
        return { bind() { return {
          async all() { return { results: [subscriber({ consent_source: consentSource })] }; },
          async run() { throw new Error(`hostile_provenance_reached_claim:${consentSource}`); },
        }; } };
      },
    };
    let transportCalls = 0;
    const result = await runWeeklyPriceWatch(armedEnv(db), config, issue, new Date(NOW), async () => {
      transportCalls += 1;
      throw new Error(`hostile_provenance_reached_transport:${consentSource}`);
    });
    assert.deepEqual(result, { status: "PASS", sent: 0, retries: 0, failed: 0, skipped: 1 }, consentSource);
    assert.equal(transportCalls, 0, consentSource);
    assert.equal(calls.length, 1, consentSource);
    assert.match(calls[0], /s\.consent_source='\/glp-1-price-index\/:price-watch'/);
    assert.match(calls[0], /s\.consent_source='\/quiz\/provider-fit\/'/);
    assert.match(calls[0], /s\.consent_source IN \(/);
    assert.match(calls[0], /json_valid\(s\.consent_source\)=1/);
    assert.doesNotMatch(calls[0], /LENGTH\(s\.consent_source\)>0/);
  }
});

test("selection, initial claim, and retry all carry the same positive provenance contract", async () => {
  const config = armedConfig(await readJson("resend-email-machine.json"));
  const issue = composePriceWatchIssue({ config, priceIndexInput: await priceIndexInput(), now: NOW });
  const calls = [];
  const db = {
    prepare(sql) {
      return { bind(...args) { return {
        async all() { calls.push({ sql, args, kind: "all" }); return { results: [subscriber()] }; },
        async run() { calls.push({ sql, args, kind: "run" }); return { success: true, meta: { changes: 0 } }; },
      }; } };
    },
  };
  let transportCalls = 0;
  const result = await runWeeklyPriceWatch(armedEnv(db), config, issue, new Date(NOW), async () => {
    transportCalls += 1;
    throw new Error("unclaimed_delivery_reached_transport");
  });
  assert.deepEqual(result, { status: "PASS", sent: 0, retries: 0, failed: 0, skipped: 1 });
  assert.equal(transportCalls, 0);
  const selection = calls.find((call) => /^SELECT \*/.test(call.sql));
  const initialClaim = calls.find((call) => /^INSERT OR IGNORE INTO email_deliveries/.test(call.sql));
  const retryClaim = calls.find((call) => /^UPDATE email_deliveries SET status='sending'/.test(call.sql));
  assert.ok(selection);
  assert.ok(initialClaim);
  assert.ok(retryClaim);
  for (const call of [selection, initialClaim, retryClaim]) {
    assert.match(call.sql, /s\.funnel_stage='content-upgrade'/);
    assert.match(call.sql, /s\.consent_source='\/glp-1-price-index\/:price-watch'/);
    assert.match(call.sql, /s\.funnel_stage='quiz-lead'/);
    assert.match(call.sql, /s\.consent_source='\/quiz\/provider-fit\/'/);
    assert.match(call.sql, /s\.consent_source IN \(/);
    assert.match(call.sql, /json_valid\(s\.consent_source\)=1/);
    assert.match(call.sql, /LENGTH\(s\.unsubscribe_token\)=32/);
    assert.match(call.sql, /s\.unsubscribe_token NOT GLOB/);
    assert.doesNotMatch(call.sql, /LENGTH\(s\.consent_source\)>0/);
  }
});

test("weekly claim is idempotent, suppression-aware, and uses only a synthetic transport", async () => {
  const config = armedConfig(await readJson("resend-email-machine.json"));
  const issue = composePriceWatchIssue({ config, priceIndexInput: await priceIndexInput(), now: NOW });
  const expectedIdempotencyKey = `${CAMPAIGN_ID}/site-capture-1/${issue.template.week_number}`;
  const calls = [];
  const db = {
    prepare(sql) {
      return { bind(...args) { return {
        async all() { calls.push({ sql, args, kind: "all" }); return { results: [subscriber()] }; },
        async run() {
          calls.push({ sql, args, kind: "run" });
          return { success: true, meta: { changes: /INSERT OR IGNORE INTO email_deliveries/.test(sql) ? 1 : 1 } };
        },
      }; } };
    },
  };
  let transportCalls = 0;
  const result = await runWeeklyPriceWatch(armedEnv(db), config, issue, new Date(NOW), async (url, init) => {
    transportCalls += 1;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["User-Agent"], "clinic-scout-email-machine/1.0");
    assert.equal(init.headers["Idempotency-Key"], expectedIdempotencyKey);
    return new Response(JSON.stringify({ id: "synthetic_email_1" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(result, { status: "PASS", sent: 1, retries: 0, failed: 0, skipped: 0 });
  assert.equal(transportCalls, 1);
  const claim = calls.find((call) => /INSERT OR IGNORE INTO email_deliveries/.test(call.sql));
  assert.ok(claim);
  assert.match(claim.sql, /message_type.*weekly-price-watch/);
  assert.match(claim.sql, /NOT EXISTS \(SELECT 1 FROM suppression_log/);
  assert.ok(claim.args.includes(expectedIdempotencyKey));
  assert.ok(claim.args.includes("reader@example.test"));
  assert.ok(claim.args.includes("glp-content-upgrade-v2-20260801"));
  assert.ok(claim.args.includes("providers:providers-terms-checklist"));
  assert.ok(claim.args.includes("0123456789abcdef0123456789abcdef"));
});

test("a lost claim or new suppression skips transport", async () => {
  const config = armedConfig(await readJson("resend-email-machine.json"));
  const issue = composePriceWatchIssue({ config, priceIndexInput: await priceIndexInput(), now: NOW });
  const db = {
    prepare(sql) {
      return { bind() { return {
        async all() { return { results: [subscriber()] }; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      }; } };
    },
  };
  let transportCalls = 0;
  const result = await runWeeklyPriceWatch(armedEnv(db), config, issue, new Date(NOW), async () => { transportCalls += 1; throw new Error("transport_must_not_run"); });
  assert.deepEqual(result, { status: "PASS", sent: 0, retries: 0, failed: 0, skipped: 1 });
  assert.equal(transportCalls, 0);
});

test("runtime gate binds the selected monitored sender, warmup, and exact operator receipt", async () => {
  const config = armedConfig(await readJson("resend-email-machine.json"));
  const env = armedEnv({});
  assert.equal(emailRuntimeGate(config, env), true);
  assert.equal(emailRuntimeGate({ ...config, domain: { ...config.domain, alias_routing_verified: false } }, env), false);
  assert.equal(emailRuntimeGate({ ...config, domain: { ...config.domain, sender_alias: "ops@glpclinicscout.com" } }, env), false);
  assert.equal(emailRuntimeGate({ ...config, domain: { ...config.domain, reply_to: "ops@glpclinicscout.com" } }, env), false);
  assert.equal(emailRuntimeGate(config, { ...env, EMAIL_WARMUP_STATUS: "HELD" }), false);
  assert.equal(emailRuntimeGate(config, armedEnv({}, "e".repeat(64))), false);
  assert.equal(emailRuntimeGate({ ...config, domain: { ...config.domain, from_name: "Clinic Scout" } }, env), false);
  assert.equal(emailRuntimeGate({ ...config, domain: { ...config.domain, from_identity: "Clinic Scout <izaiah@glpclinicscout.com>" } }, env), false);
  assert.equal(emailRuntimeGate({ ...config, domain: { ...config.domain, warmup_status: "NOT_STARTED" } }, env), false);
  assert.equal(emailRuntimeGate({ ...config, domain: { ...config.domain, resend_domain_verified: false } }, env), false);
});

test("Resend transport proof uses a custom User-Agent without a provider call", async () => {
  let seen;
  const result = await sendWithResend({ endpoint: "https://example.test/no-provider", idempotencyKey: "synthetic", body: {} }, { RESEND_API_KEY: "synthetic" }, async (_url, init) => {
    seen = init.headers;
    return new Response(JSON.stringify({ id: "synthetic" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(result.status, "sent");
  assert.equal(seen["User-Agent"], "clinic-scout-email-machine/1.0");
});

test("committed newsletter config is mirrored, exact, opt-in-only, and never imports or force-enrolls", async () => {
  const [config, mirror, source] = await Promise.all([
    readJson("resend-email-machine.json"),
    JSON.parse(await readFile(new URL("../artifacts/ops/resend-email-machine.json", import.meta.url), "utf8")),
    readFile(new URL("../src/resend-email-machine.mjs", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(mirror, config);
  assert.equal(config.status, "LIVE_SCHEDULED_ZERO_ELIGIBLE");
  assert.equal(config.domain.from_name, "GLP Clinic Scout");
  assert.equal(config.domain.from_identity, "GLP Clinic Scout <izaiah@glpclinicscout.com>");
  assert.equal(config.domain.reply_to, "izaiah@glpclinicscout.com");
  assert.equal(config.domain.warmup_status, "PASS");
  assert.equal(config.activation_evidence.status, "PASS_LIVE_SCHEDULED_ZERO_ELIGIBLE");
  assert.equal(config.newsletter.active_subscriber_required, true);
  assert.deepEqual(config.newsletter.site_capture_funnel_stages, ["content-upgrade", "quiz-lead"]);
  assert.equal(resendMachinePolicy.customUserAgent, "clinic-scout-email-machine/1.0");
  assert.doesNotMatch(JSON.stringify(config), /(?:force[_ -]?enroll|imported[_ -]?(?:list|subscriber))/i);
  assert.doesNotMatch(source, /(?:force[_ -]?enroll|imported[_ -]?(?:list|subscriber))/i);
});

test("validator permits a post-remint current root only with exact activation evidence bound to that root", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "glp-price-watch-validator-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const config = await readJson("resend-email-machine.json");
  const postRemintBound = structuredClone(config);
  postRemintBound.activation_evidence.current_release_root = ROOT;
  const currentBasePath = path.join(temp, "current-content-base.json");
  const configPath = path.join(temp, "resend-email-machine.json");
  const mirrorPath = path.join(temp, "resend-email-machine-mirror.json");
  await writeFile(currentBasePath, JSON.stringify({ release_root: ROOT }));
  await writeFile(configPath, JSON.stringify(postRemintBound));
  await writeFile(mirrorPath, JSON.stringify(postRemintBound));
  const env = { ...process.env, GLP_CURRENT_CONTENT_BASE: currentBasePath, GLP_EMAIL_CONFIG_PATH: configPath, GLP_EMAIL_MIRROR_PATH: mirrorPath };
  const bound = spawnSync(process.execPath, [VALIDATOR], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(bound.status, 0, bound.stderr);
  const unbound = structuredClone(postRemintBound);
  unbound.activation_evidence.current_release_root = "/tmp/not-the-current-release";
  await writeFile(configPath, JSON.stringify(unbound));
  await writeFile(mirrorPath, JSON.stringify(unbound));
  const rejected = spawnSync(process.execPath, [VALIDATOR], { cwd: ROOT, env, encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /current_release_root|not-the-current-release/);
});
