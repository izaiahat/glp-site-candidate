import test from "node:test";
import assert from "node:assert/strict";
import {
  NEWSLETTER_CONSENT_SOURCE,
  NEWSLETTER_CONSENT_VERSION,
  RESEND_EMAILS_ENDPOINT,
  deliverPriceAlertConfirmation,
  handleNewsletterSubscribeRequest,
  priceAlertConfirmationHtml,
  validateNewsletterSubscription,
} from "../src/newsletter-subscribe.mjs";
import { RESEND_CONTACTS_ENDPOINT, syncResendContact } from "../src/resend-contacts.mjs";
import { isWeeklyPriceWatchSubscriber } from "../src/resend-email-machine.mjs";

const payload = (changes = {}) => ({
  email: "Reader@Example.test",
  email_consent: "true",
  consent_version: NEWSLETTER_CONSENT_VERSION,
  consent_source: NEWSLETTER_CONSENT_SOURCE,
  company: "",
  ...changes,
});

const request = (body = payload()) => new Request("https://glpclinicscout.com/api/newsletter-subscribe", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function mockD1() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { calls.push({ kind: "run", sql, args }); return { success: true, meta: { changes: 1 } }; },
            async first() { calls.push({ kind: "first", sql, args }); return { request_count: 1 }; },
          };
        },
      };
    },
  };
}

test("W5 newsletter validator accepts only explicit sitewide consent", () => {
  assert.deepEqual(validateNewsletterSubscription(payload()), {
    email: "reader@example.test",
    firstName: "",
    sourceSurface: "sitewide-price-watch",
    providerContext: null,
    consentVersion: NEWSLETTER_CONSENT_VERSION,
    consentSource: NEWSLETTER_CONSENT_SOURCE,
  });
  assert.throws(() => validateNewsletterSubscription(payload({ email_consent: false })), /required_consent_missing/);
  assert.throws(() => validateNewsletterSubscription(payload({ consent_source: "/import/" })), /consent_source_invalid/);
  assert.throws(() => validateNewsletterSubscription(payload({ extra: "x" })), /payload_key_not_allowed/);
  assert.throws(() => validateNewsletterSubscription(payload({ company: "bot" })), /bot_rejected/);
});

test("W5 newsletter endpoint holds unless capture is explicitly gated", async () => {
  const response = await handleNewsletterSubscribeRequest(request(), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "NEWSLETTER_CAPTURE_HELD");
});

test("W5 newsletter endpoint durably captures into D1 and makes no provider call while the gate is held", async () => {
  const db = mockD1();
  let transportCalls = 0;
  const response = await handleNewsletterSubscribeRequest(request(), {
    NEWSLETTER_CAPTURE_MODE: "local_test",
    EMAIL_DB: db,
    RESEND_ENABLED: "false",
  }, async () => { transportCalls += 1; });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, "SUBSCRIBED_SENDS_HELD");
  assert.equal(body.sends_started, false);
  assert.equal(body.confirmation_email, null);
  assert.equal(body.resend_contact, null);
  assert.equal(transportCalls, 0);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /INSERT INTO subscribers/);
  assert.match(db.calls[0].sql, /'opted-in'/);
  assert.match(db.calls[0].sql, /next_drip_step=0,next_send_at=NULL/);
  assert.match(db.calls[1].sql, /contact_capture_events/);
  assert.ok(db.calls[1].args.includes("sitewide-price-watch"));
  assert.ok(db.calls[1].args.includes("marketing"));
  assert.ok(db.calls[0].args.includes(NEWSLETTER_CONSENT_VERSION));
  assert.ok(db.calls[0].args.includes(NEWSLETTER_CONSENT_SOURCE));
});

test("shared Resend Contacts adapter uses POST /contacts with optional segment and an injected fetch", async () => {
  const calls = [];
  const receipt = await syncResendContact({
    env: {
      RESEND_ENABLED: "true",
      RESEND_API_KEY: "re_synthetic",
      RESEND_SEGMENT_ID: "seg_glp",
      RESEND_AUDIENCE_ID: "legacy_must_be_ignored",
    },
    email: "Reader@Example.test",
  }, async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ object: "contact", id: "contact_newsletter_1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, RESEND_CONTACTS_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_synthetic");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: "reader@example.test",
    first_name: "there",
    unsubscribed: false,
    segments: [{ id: "seg_glp" }],
  });
  assert.deepEqual(receipt, {
    status: "synced",
    endpoint: RESEND_CONTACTS_ENDPOINT,
    http_status: 201,
    contact_id: "contact_newsletter_1",
    object: "contact",
    segment_id: "seg_glp",
    reason: null,
    provider_error: null,
  });
});

test("price-alert confirmation is accessible in dark and light clients with unsubscribe and address", () => {
  const html = priceAlertConfirmationHtml({ firstName: "Reader", origin: "https://glpclinicscout.com", unsubscribeUrl: "https://glpclinicscout.com/unsubscribe?token=abc" });
  assert.match(html, /color-scheme" content="light dark"/);
  assert.match(html, /Hi Reader,/);
  assert.match(html, /source-dated update/);
  assert.match(html, /https:\/\/glpclinicscout\.com\/glp-1-price-index\//);
  assert.match(html, /https:\/\/glpclinicscout\.com\/unsubscribe\?token=abc/);
  assert.match(html, /Tilton Group LLC · 2108 N St, Ste N · Sacramento, CA 95816/);
});

test("W5 newsletter sends confirmation first, syncs contact second, and returns exact receipts after D1", async () => {
  const db = mockD1();
  const calls = [];
  const response = await handleNewsletterSubscribeRequest(request(), {
    NEWSLETTER_CAPTURE_MODE: "local_test",
    EMAIL_DB: db,
    RESEND_ENABLED: "true",
    RESEND_API_KEY: "re_synthetic",
    RESEND_SEGMENT_ID: "seg_price_alerts",
  }, async (url, init) => {
    calls.push({ url, init });
    assert.ok(db.calls.length >= 2, "durable subscriber projection and append-only event must precede provider work");
    if (url === RESEND_EMAILS_ENDPOINT) {
      return new Response(JSON.stringify({ id: "email_newsletter_confirmation_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(url, RESEND_CONTACTS_ENDPOINT);
    return new Response(JSON.stringify({ object: "contact", id: "contact_newsletter_2" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, "SUBSCRIBED");
  assert.equal(body.confirmation_sent, true);
  assert.equal(body.confirmation_email.email_id, "email_newsletter_confirmation_1");
  assert.equal(body.sends_started, false);
  assert.equal(body.resend_contact.contact_id, "contact_newsletter_2");
  assert.equal(body.resend_contact.http_status, 201);
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(calls.map((call) => call.url), [RESEND_EMAILS_ENDPOINT, RESEND_CONTACTS_ENDPOINT]);
  const emailRequest = JSON.parse(calls[0].init.body);
  assert.equal(emailRequest.subject, "You're on the GLP-1 price watch");
  assert.match(emailRequest.headers["List-Unsubscribe"], /\/unsubscribe\?token=/);
  assert.equal(emailRequest.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(db.calls.some((call) => /email_deliveries/.test(call.sql)), "confirmation receipt must be persisted best-effort");
});

test("W5 contact-sync failure is a nonfatal warning after confirmation acceptance", async () => {
  const db = mockD1();
  const response = await handleNewsletterSubscribeRequest(request(), {
    NEWSLETTER_CAPTURE_MODE: "local_test",
    EMAIL_DB: db,
    RESEND_ENABLED: "true",
    RESEND_API_KEY: "re_synthetic",
  }, async (url) => url === RESEND_EMAILS_ENDPOINT
    ? new Response(JSON.stringify({ id: "email_newsletter_confirmation_2" }), { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "retry later" }), { status: 429, headers: { "content-type": "application/json" } }));

  assert.ok(db.calls.length >= 3);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "SUBSCRIBED_CONTACT_SYNC_FAILED");
  assert.equal(body.confirmation_sent, true);
  assert.equal(body.resend_contact.status, "failed");
  assert.equal(body.resend_contact.http_status, 429);
  assert.equal(body.resend_contact.reason, "provider_rejected");
  assert.equal(body.resend_contact.provider_error, "retry later");
  assert.deepEqual(body.warnings, [{ code: "CONTACT_SYNC_FAILED", retryable: false }]);
});

test("W5 confirmation failure remains an honest partial success after durable capture", async () => {
  const db = mockD1();
  const response = await handleNewsletterSubscribeRequest(request(), {
    NEWSLETTER_CAPTURE_MODE: "local_test",
    EMAIL_DB: db,
    RESEND_ENABLED: "true",
    RESEND_API_KEY: "re_synthetic",
  }, async (url) => url === RESEND_EMAILS_ENDPOINT
    ? new Response(JSON.stringify({ message: "retry later" }), { status: 429, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ object: "contact", id: "contact_newsletter_3" }), { status: 201, headers: { "content-type": "application/json" } }));

  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "SUBSCRIBED_CONFIRMATION_FAILED");
  assert.equal(body.confirmation_sent, false);
  assert.equal(body.confirmation_email.http_status, 429);
  assert.equal(body.resend_contact.status, "synced");
  assert.deepEqual(body.warnings, [{ code: "CONFIRMATION_EMAIL_FAILED" }]);
});

test("confirmation delivery reports missing configuration without making a provider request", async () => {
  const db = mockD1();
  let calls = 0;
  const receipt = await deliverPriceAlertConfirmation({
    env: { RESEND_ENABLED: "true", EMAIL_DB: db },
    capture: { email: "reader@example.test", firstName: "Reader" },
    subscriberId: "subscriber-1",
    unsubscribeToken: "token-1",
  }, async () => { calls += 1; });
  assert.equal(calls, 0);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.reason, "missing_api_key");
  assert.ok(db.calls.some((call) => /email_deliveries/.test(call.sql)));
});

test("W5 newsletter endpoint accepts the Pages GLP_DB binding fallback", async () => {
  const db = mockD1();
  const response = await handleNewsletterSubscribeRequest(request(), { NEWSLETTER_CAPTURE_MODE: "enabled", GLP_DB: db });
  assert.equal(response.status, 201);
  assert.equal(db.calls.length, 3);
});

test("W5 newsletter endpoint enforces method, content type, and body shape", async () => {
  const env = { NEWSLETTER_CAPTURE_MODE: "local_test", GLP_DB: mockD1() };
  const get = await handleNewsletterSubscribeRequest(new Request("https://glpclinicscout.com/api/newsletter-subscribe"), env);
  assert.equal(get.status, 405);
  const text = await handleNewsletterSubscribeRequest(new Request("https://glpclinicscout.com/api/newsletter-subscribe", { method: "POST", body: "x" }), env);
  assert.equal(text.status, 415);
  const invalid = await handleNewsletterSubscribeRequest(request(payload({ email: "nope" })), env);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).status, "email_invalid");
});

test("W5 explicit bottom-sheet opt-in is eligible for the gated Resend newsletter", () => {
  const subscriber = {
    vertical: "glp-clinic-scout",
    funnel_stage: "newsletter",
    consent_status: "opted-in",
    consent_version: NEWSLETTER_CONSENT_VERSION,
    consent_source: NEWSLETTER_CONSENT_SOURCE,
    status: "active",
    unsubscribe_token: "a".repeat(32),
  };
  assert.equal(isWeeklyPriceWatchSubscriber(subscriber), true);
  assert.equal(isWeeklyPriceWatchSubscriber({ ...subscriber, consent_source: "/admin-import/" }), false);
});
