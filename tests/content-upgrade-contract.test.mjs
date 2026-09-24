import test from "node:test";
import assert from "node:assert/strict";
import { validateContentUpgrade, handleContentUpgradeRequest, deliverContentUpgrade, resolveContentUpgradeTemplate } from "../src/content-upgrade.mjs";
import { RESEND_CONTACTS_ENDPOINT } from "../src/resend-contacts.mjs";
import { COST_AFFILIATE_EMAIL_MANIFEST } from "../src/cost-affiliate-email-manifest.generated.mjs";

// --- Minimal D1 mock matching the worker's prepare(sql).bind(...).run() contract ---
function mockD1() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return { bind(...args) { return { async run() { calls.push({ sql, args }); return { success: true, meta: { changes: 1 } }; } }; } };
    }
  };
}

// The EXACT payload the rendered inline + modal forms POST:
//   Object.fromEntries(new FormData(form).entries()) with the single explicit consent checked.
//   The checkbox control serialises its `value="true"` string; the honeypot text input is
//   always present as an empty string; hidden inputs are populated client-side to the page
//   slug and `${slug}-terms-checklist`.
function renderedFormPayload(slug = "online-glp-1-program-costs", email = "reader@example.test") {
  return {
    source_page: slug,
    lead_magnet_key: `${slug}-terms-checklist`,
    consent_version: "glp-content-upgrade-v2-20260801",
    email,
    email_consent: "true",
    company: ""
  };
}

function renderedCostBreakdownPayload() {
  return {
    source_page: "tools-glp-1-cost-calculator",
    lead_magnet_key: "tools-glp-1-cost-calculator-cost-breakdown",
    consent_version: "glp-content-upgrade-v2-20260801",
    email: "reader@example.test",
    email_consent: "true",
    company: "",
    cost_breakdown_version: "cost-breakdown-v1",
    cost_provider_id: "healthrx",
    cost_provider_name: "HealthRX",
    cost_first_month_usd: "249.00",
    cost_recurring_month_usd: "299.00",
    cost_months: "3",
    cost_total_usd: "847.00",
    cost_price_context: "Published starting-price context",
    cost_checked_as_of: "2026-08-01"
  };
}

function renderedMatchChecklistPayload() {
  return {
    source_page: "quiz-provider-fit",
    lead_magnet_key: "quiz-provider-fit-match-checklist",
    consent_version: "glp-content-upgrade-v2-20260801",
    email: "reader@example.test",
    email_consent: "true",
    company: "",
    match_program_ids: "healthrx,try-ageless,wellorithm"
  };
}

const jsonPost = (payload) => new Request("https://glpclinicscout.com/api/content-upgrade", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(payload)
});

test("validator accepts the exact rendered form payload (string 'true' consents, empty honeypot)", () => {
  const result = validateContentUpgrade(renderedFormPayload());
  assert.equal(result.email, "reader@example.test");
  assert.equal(result.sourcePage, "online-glp-1-program-costs");
  assert.equal(result.leadMagnetKey, "online-glp-1-program-costs-terms-checklist");
  assert.equal(result.consentVersion, "glp-content-upgrade-v2-20260801");
});

test("validator accepts boolean-true consent too (dual string/boolean contract)", () => {
  const payload = { ...renderedFormPayload(), email_consent: true };
  assert.equal(validateContentUpgrade(payload).email, "reader@example.test");
});

test("validator accepts cached legacy two-checkbox pages only with the legacy version", () => {
  const payload = { ...renderedFormPayload(), consent_version: "glp-content-upgrade-v1-20260724", privacy_consent: true, marketing_consent: true };
  delete payload.email_consent;
  assert.equal(validateContentUpgrade(payload).consentVersion, "glp-content-upgrade-v1-20260724");
});

test("validator accepts every distinct rendered money-page slug shape", () => {
  for (const slug of ["best-online-glp-1-providers", "trimi-vs-shed", "online-glp-1-program-costs", "glp-1-shipping-review-times"]) {
    assert.equal(validateContentUpgrade(renderedFormPayload(slug)).sourcePage, slug);
  }
});

test("validator stays strict against tampered / bot payloads", () => {
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload(), extra: "x" }), /payload_key_not_allowed/);
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload(), company: "acme" }), /bot_rejected/);
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload(), consent_version: "old" }), /consent_version_invalid/);
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload(), lead_magnet_key: "mismatch-terms-checklist" }), /lead_magnet_key_invalid/);
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload("Bad_Slug") }), /source_page_invalid/);
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload(), email: "not-an-email" }), /email_invalid/);
});

test("validator binds calculator breakdown fields and rejects incomplete or mismatched totals", () => {
  const result = validateContentUpgrade(renderedCostBreakdownPayload());
  assert.equal(result.costBreakdown.providerId, "healthrx");
  assert.equal(result.costBreakdown.totalUsd, 847);
  assert.equal(result.costBreakdown.checkedAsOf, "2026-08-01");
  assert.throws(() => validateContentUpgrade({ ...renderedCostBreakdownPayload(), cost_total_usd: "866.99" }), /cost_total_mismatch/);
  const incomplete = renderedCostBreakdownPayload();
  delete incomplete.cost_checked_as_of;
  assert.throws(() => validateContentUpgrade(incomplete), /cost_breakdown_incomplete/);
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload(), cost_months: "3" }), /cost_breakdown_not_allowed/);
});

test("validator binds exactly three governed quiz matches and rejects tampering", () => {
  const result = validateContentUpgrade(renderedMatchChecklistPayload());
  assert.deepEqual(result.matchPrograms.map((match) => match.programId), ["healthrx", "try-ageless", "wellorithm"]);
  assert.throws(() => validateContentUpgrade({ ...renderedMatchChecklistPayload(), match_program_ids: "healthrx,try-ageless" }), /match_program_ids_invalid/);
  assert.throws(() => validateContentUpgrade({ ...renderedMatchChecklistPayload(), match_program_ids: "healthrx,try-ageless,healthrx" }), /match_program_ids_invalid/);
  assert.throws(() => validateContentUpgrade({ ...renderedMatchChecklistPayload(), match_program_ids: "healthrx,try-ageless,not-governed" }), /match_program_not_governed/);
  assert.throws(() => validateContentUpgrade({ ...renderedFormPayload(), match_program_ids: "healthrx,try-ageless,wellorithm" }), /match_program_ids_not_allowed/);
});

test("validator rejects an omitted (unchecked) consent — FormData drops unchecked boxes", () => {
  const missingConsent = renderedFormPayload();
  delete missingConsent.email_consent;
  assert.throws(() => validateContentUpgrade(missingConsent), /required_consent_missing/);
});

test("endpoint holds capture (503) until an operator/local mode is set", async () => {
  const response = await handleContentUpgradeRequest(jsonPost(renderedFormPayload()), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "CONTENT_UPGRADE_CAPTURE_HELD");
});

test("endpoint accepts the rendered payload in local mode and holds sends by default", async () => {
  const db = mockD1();
  const response = await handleContentUpgradeRequest(jsonPost(renderedFormPayload()), { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: db });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "CAPTURED_SENDS_HELD");
  assert.equal(body.lead_magnet_key, "online-glp-1-program-costs-terms-checklist");
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /INTO subscribers/);
  assert.match(db.calls[1].sql, /contact_capture_events/);
});

test("endpoint durably stores the validated cost breakdown while sends remain held", async () => {
  const db = mockD1();
  const response = await handleContentUpgradeRequest(jsonPost(renderedCostBreakdownPayload()), { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: db });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, "CAPTURED_SENDS_HELD");
  const stored = db.calls[0].args.find((value) => typeof value === "string" && value.includes('"cost_breakdown"'));
  assert.ok(stored, "cost breakdown persisted in consent_source");
  const parsed = JSON.parse(stored);
  assert.equal(parsed.cost_breakdown.totalUsd, 847);
  assert.equal(parsed.cost_breakdown.providerName, "HealthRX");
});

test("endpoint accepts the exact rendered payload under the REAL operator-approved production gate (the live capture path, D1 rate-limit fallback)", async () => {
  // Unlike the local_test cases above, this exercises the actual production path that runs on
  // the live site: the operator-approved capture gate AND the D1 rate_limit fallback (no
  // LEAD_RATE_LIMITER binding). Needs a mock that also answers .first() for the rate-limit read.
  const calls = [];
  const db = {
    prepare(sql) {
      return { bind(...args) { return {
        async run() { calls.push({ sql, args }); return { success: true, meta: { changes: 1 } }; },
        async first() { calls.push({ sql, args }); return /request_rate_limits/.test(sql) ? { request_count: 1 } : null; }
      }; } };
    }
  };
  const receipt = "a".repeat(64);
  const env = {
    CONTENT_UPGRADE_CAPTURE_MODE: "production_operator_approved",
    CONTENT_UPGRADE_CAPTURE_RECEIPT_SHA256: receipt,
    CONTENT_UPGRADE_CAPTURE_GATE: `operator-approved:${receipt}`,
    GLP_DB: db
  };
  const request = new Request("https://glpclinicscout.com/api/content-upgrade", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify(renderedFormPayload("best-online-glp-1-providers"))
  });
  const response = await handleContentUpgradeRequest(request, env);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "CAPTURED_SENDS_HELD");
  assert.equal(body.lead_magnet_key, "best-online-glp-1-providers-terms-checklist");
  assert.ok(calls.some((c) => /request_rate_limits/.test(c.sql)), "D1 rate-limit fallback exercised");
  assert.ok(calls.some((c) => /INTO subscribers/.test(c.sql)), "subscriber inserted");
});

test("resolveContentUpgradeTemplate keys off lead_magnet_key suffix", () => {
  assert.equal(resolveContentUpgradeTemplate("anything-terms-checklist").templateKey, "terms-checklist");
  assert.equal(resolveContentUpgradeTemplate("tools-glp-1-cost-calculator-cost-breakdown").templateKey, "cost-breakdown");
  assert.equal(resolveContentUpgradeTemplate("quiz-provider-fit-match-checklist").templateKey, "match-checklist");
  assert.equal(resolveContentUpgradeTemplate("unknown-magnet"), null);
});

test("match-checklist email reproduces the exact three governed matches through first-party go links", async () => {
  const db = mockD1();
  const capture = validateContentUpgrade(renderedMatchChecklistPayload());
  let body;
  const fetchImpl = async (url, init) => {
    if (String(url).includes("/emails")) {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "email_match_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ object: "contact", id: "contact_match_1" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const result = await deliverContentUpgrade({ env: { RESEND_ENABLED: "true", RESEND_API_KEY: "re_synthetic", GLP_DB: db }, capture, subscriberId: "s-match", unsubscribeToken: "tok-match" }, fetchImpl);
  assert.equal(result.status, "sent");
  assert.equal(body.subject, "Your three matched GLP-1 providers");
  for (const [index, programId] of ["healthrx", "try-ageless", "wellorithm"].entries()) {
    assert.match(body.html, new RegExp(`Match ${index + 1}`));
    assert.ok(body.html.includes(`/go/${programId}?s=email-glp.match&amp;v=a`));
  }
  assert.ok(body.html.indexOf("Affiliate disclosure:") < body.html.indexOf("/go/healthrx"));
  assert.match(body.html, /name="color-scheme" content="light dark"/);
  assert.match(body.html, /Visit GLP Clinic Scout/);
  assert.match(body.html, /Unsubscribe/);
  assert.match(body.html, /2108 N St, Ste N/);
});

test("deliverContentUpgrade renders the submitted calculator scenario in the cost-breakdown email", async () => {
  const db = mockD1();
  const capture = validateContentUpgrade(renderedCostBreakdownPayload());
  let body;
  const fetchImpl = async (url, init) => {
    if (String(url).includes("/emails")) {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "email_cost_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ object: "contact", id: "contact_cost_1" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const result = await deliverContentUpgrade({ env: { RESEND_ENABLED: "true", RESEND_API_KEY: "re_synthetic", GLP_DB: db }, capture, subscriberId: "s-cost", unsubscribeToken: "tok-cost" }, fetchImpl);
  assert.equal(result.status, "sent");
  assert.equal(body.subject, "Your GLP-1 cost breakdown");
  assert.match(body.html, /HealthRX/);
  assert.match(body.html, /\$847\.00/);
  assert.match(body.html, /2026-08-01/);
  assert.match(body.html, /Published starting-price context/);
  const governed = COST_AFFILIATE_EMAIL_MANIFEST.programs.find((row) => row.program_id === "healthrx");
  assert.ok(governed, "HealthRX governed calculator affiliate row missing");
  assert.match(body.html, new RegExp(`Start with ${governed.merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(body.html.includes(governed.affiliate_href.replaceAll("&", "&amp;")), "email CTA uses the exact governed href with HTML-safe query separators");
  assert.match(body.html, /Affiliate disclosure: Clinic Scout may earn a commission/);
});

// --- Resend send path (env-gated, direct fetch injection) ---
function makeCapture(slug = "online-glp-1-program-costs") {
  return { email: "reader@example.test", sourcePage: slug, leadMagnetKey: `${slug}-terms-checklist`, consentVersion: "glp-content-upgrade-v1-20260724" };
}

test("deliverContentUpgrade is a no-op unless RESEND_ENABLED === 'true'", async () => {
  let called = false;
  const result = await deliverContentUpgrade({ env: { RESEND_ENABLED: "false" }, capture: makeCapture(), subscriberId: "s1", unsubscribeToken: "tok" }, async () => { called = true; return new Response("{}"); });
  assert.equal(result.status, "sends_held");
  assert.equal(called, false);
});

test("deliverContentUpgrade sends first, syncs the same address through shared Contacts, and returns exact receipts", async () => {
  const db = mockD1();
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    if (String(url).includes("/emails")) return new Response(JSON.stringify({ id: "email_123" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "contact_1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = { RESEND_ENABLED: "true", RESEND_API_KEY: "re_synthetic", RESEND_SEGMENT_ID: "seg_glp", RESEND_AUDIENCE_ID: "legacy_must_be_ignored", GLP_DB: db };
  const result = await deliverContentUpgrade({ env, capture: makeCapture(), subscriberId: "s1", unsubscribeToken: "tok9" }, fetchImpl);

  assert.equal(result.status, "sent");
  assert.equal(result.resend_email_id, "email_123");
  assert.equal(result.contact_id, "contact_1");
  assert.deepEqual(result.resend_email, {
    status: "sent",
    endpoint: "https://api.resend.com/emails",
    http_status: 200,
    email_id: "email_123",
    reason: null,
  });
  assert.equal(result.resend_contact.endpoint, RESEND_CONTACTS_ENDPOINT);
  assert.equal(result.resend_contact.http_status, 200);
  assert.equal(result.resend_contact.contact_id, "contact_1");
  assert.equal(result.resend_contact.segment_id, "seg_glp");

  const emailCall = fetchCalls.find((c) => String(c.url).includes("/emails"));
  const emailBody = JSON.parse(emailCall.init.body);
  assert.match(emailBody.from, /hello@glpclinicscout\.com/);
  assert.deepEqual(emailBody.to, ["reader@example.test"]);
  assert.ok(emailBody.subject.length > 0);
  assert.match(emailCall.init.headers.Authorization, /^Bearer re_synthetic$/);
  assert.match(emailBody.html, /Unsubscribe/);
  assert.match(emailBody.html, /Tilton Group LLC/);
  assert.match(emailBody.html, /2108 N St, Ste N/);
  assert.match(emailBody.html, /Sacramento, CA 95816/);
  assert.equal(emailBody.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(emailBody.headers["List-Unsubscribe"], /unsubscribe\?token=tok9/);

  assert.equal(fetchCalls[0].url, "https://api.resend.com/emails");
  assert.equal(fetchCalls[1].url, RESEND_CONTACTS_ENDPOINT);
  assert.equal(fetchCalls.some((c) => String(c.url).includes("/audiences/")), false);
  const contactBody = JSON.parse(fetchCalls[1].init.body);
  assert.deepEqual(contactBody, {
    email: "reader@example.test",
    first_name: "there",
    unsubscribed: false,
    segments: [{ id: "seg_glp" }],
  });
  assert.deepEqual(emailBody.to, [contactBody.email], "transactional and Contacts paths use the same address");

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INTO email_deliveries/);
  assert.ok(db.calls[0].args.includes("sent"));
});

test("deliverContentUpgrade degrades gracefully when the Resend send fails", async () => {
  const db = mockD1();
  const fetchImpl = async (url) => {
    if (String(url).includes("/emails")) throw new Error("network_down");
    return new Response("{}", { status: 200 });
  };
  const env = { RESEND_ENABLED: "true", RESEND_API_KEY: "re_synthetic", GLP_DB: db };
  const result = await deliverContentUpgrade({ env, capture: makeCapture(), subscriberId: "s1", unsubscribeToken: "tok" }, fetchImpl);
  assert.equal(result.status, "send_failed");
  assert.equal(db.calls.length, 1);
  assert.ok(db.calls[0].args.includes("failed"));
});

test("deliverContentUpgrade logs a failure when the API key is missing", async () => {
  const db = mockD1();
  const result = await deliverContentUpgrade({ env: { RESEND_ENABLED: "true", GLP_DB: db }, capture: makeCapture(), subscriberId: "s1", unsubscribeToken: "tok" }, async () => new Response("{}"));
  assert.equal(result.status, "send_misconfigured");
  assert.equal(db.calls.length, 1);
});

test("handler returns CAPTURED with exact receipts only after the checklist send and Contact sync succeed", async () => {
  const db = mockD1();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === "https://api.resend.com/emails") {
      assert.equal(db.calls.length, 2, "D1 subscriber projection and provenance event precede provider work");
      return new Response(JSON.stringify({ id: "email_handler_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ object: "contact", id: "contact_handler_1" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const env = { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: db, RESEND_ENABLED: "true", RESEND_API_KEY: "re_synthetic" };
  const response = await handleContentUpgradeRequest(jsonPost(renderedFormPayload()), env, fetchImpl);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "CAPTURED");
  assert.equal(body.send, "sent");
  assert.equal(body.provider_receipts.email.email_id, "email_handler_1");
  assert.equal(body.provider_receipts.email.http_status, 200);
  assert.equal(body.provider_receipts.contact.contact_id, "contact_handler_1");
  assert.equal(body.provider_receipts.contact.http_status, 201);
  assert.deepEqual(calls, ["https://api.resend.com/emails", RESEND_CONTACTS_ENDPOINT]);
  assert.equal(db.calls.length, 3);
});

test("handler is an explicit non-success when checklist delivery fails, so UI cannot claim Checklist sent", async () => {
  const db = mockD1();
  const env = { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: db, RESEND_ENABLED: "true", RESEND_API_KEY: "re_synthetic" };
  const response = await handleContentUpgradeRequest(jsonPost(renderedFormPayload()), env, async (url) => {
    if (url === "https://api.resend.com/emails") throw new Error("resend_unavailable");
    return new Response(JSON.stringify({ object: "contact", id: "contact_after_send_failure" }), { status: 201, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.ok, false);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.status, "CAPTURED_PROVIDER_FAILED");
  assert.equal(body.send, "send_failed");
  assert.equal(body.provider_receipts.email.status, "failed");
  assert.equal(body.provider_receipts.contact.status, "synced");
  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0].sql, /INTO subscribers/);
  assert.match(db.calls[1].sql, /contact_capture_events/);
  assert.match(db.calls[2].sql, /INTO email_deliveries/);
});

test("handler treats Contact sync failure as a nonfatal warning after Resend accepted the checklist email", async () => {
  const db = mockD1();
  const env = { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: db, RESEND_ENABLED: "true", RESEND_API_KEY: "re_synthetic" };
  const response = await handleContentUpgradeRequest(jsonPost(renderedFormPayload()), env, async (url) => {
    if (url === "https://api.resend.com/emails") {
      return new Response(JSON.stringify({ id: "email_accepted_contact_failed" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ name: "validation_error", message: "segment unavailable" }), { status: 422, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "CAPTURED");
  assert.equal(body.send, "sent");
  assert.deepEqual(body.warnings, [{ code: "CONTACT_SYNC_FAILED", retryable: false }]);
  assert.equal(body.provider_receipts.email.status, "sent");
  assert.equal(body.provider_receipts.contact.status, "failed");
  assert.equal(body.provider_receipts.contact.http_status, 422);
  assert.equal(body.provider_receipts.contact.provider_error, "segment unavailable");
});
