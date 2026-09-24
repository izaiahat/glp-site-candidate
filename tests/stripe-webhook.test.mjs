import test from "node:test";
import assert from "node:assert/strict";
import { ingestStripeWebhook, stripeSignatureHex, stripeWebhookHealth, verifyStripeSignature } from "../src/stripe-webhook.mjs";

const SECRET = "whsec_glpclinicscout_fixture_secret_do_not_use_in_production";
const NOW = 1754500000; // fixed clock so fixture signatures are deterministic
const PAYLOAD = JSON.stringify({
  id: "evt_test_fixture_0001",
  object: "event",
  type: "checkout.session.completed",
  created: NOW,
  livemode: false,
  data: { object: { id: "cs_test_fixture", amount_total: 150000, currency: "usd" } }
});

async function signedRequest(payload, { secret = SECRET, timestamp = NOW, header = null } = {}) {
  const signature = await stripeSignatureHex(secret, timestamp, payload);
  return new Request("https://glpclinicscout.com/api/stripe/webhook", {
    method: "POST",
    headers: header === null ? { "stripe-signature": `t=${timestamp},v1=${signature}` } : header,
    body: payload
  });
}

const ENV = { GLP_STRIPE_WEBHOOK_SECRET: SECRET };

test("valid signature -> 200 and acknowledges the event", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD), ENV, NOW);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.received, true);
  assert.equal(body.event_id, "evt_test_fixture_0001");
  assert.equal(body.event_type, "checkout.session.completed");
  assert.equal(body.money_event, true);
});

test("tampered payload -> 400", async () => {
  const signature = await stripeSignatureHex(SECRET, NOW, PAYLOAD);
  const tampered = PAYLOAD.replace("150000", "999999");
  const request = new Request("https://glpclinicscout.com/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${NOW},v1=${signature}` },
    body: tampered
  });
  const response = await ingestStripeWebhook(request, ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "signature_mismatch");
});

test("signature minted with the wrong secret -> 400", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD, { secret: "whsec_wrong_secret" }), ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "signature_mismatch");
});

test("stale timestamp beyond the 5-minute tolerance -> 400", async () => {
  const stale = NOW - 301;
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD, { timestamp: stale }), ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "timestamp_outside_tolerance");
});

test("future timestamp beyond the tolerance -> 400", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD, { timestamp: NOW + 301 }), ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "timestamp_outside_tolerance");
});

test("timestamp at the tolerance edge -> 200", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD, { timestamp: NOW - 300 }), ENV, NOW);
  assert.equal(response.status, 200);
});

test("unsigned request -> 400", async () => {
  const request = new Request("https://glpclinicscout.com/api/stripe/webhook", { method: "POST", body: PAYLOAD });
  const response = await ingestStripeWebhook(request, ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "signature_header_invalid");
});

test("malformed signature header -> 400", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD, { header: { "stripe-signature": "garbage" } }), ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "signature_header_invalid");
});

test("non-hex v1 value -> 400 without throwing", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD, { header: { "stripe-signature": `t=${NOW},v1=zzzz` } }), ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "signature_mismatch");
});

test("rotation: multiple v1 values accepted when one matches", async () => {
  const signature = await stripeSignatureHex(SECRET, NOW, PAYLOAD);
  const request = new Request("https://glpclinicscout.com/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${NOW},v1=${"0".repeat(64)},v1=${signature}` },
    body: PAYLOAD
  });
  assert.equal((await ingestStripeWebhook(request, ENV, NOW)).status, 200);
});

test("valid signature over non-JSON body -> 400", async () => {
  const response = await ingestStripeWebhook(await signedRequest("not-json"), ENV, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_json");
});

test("missing secret binding -> 400, never 500", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD), {}, NOW);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "webhook_secret_unavailable");
});

test("legacy STRIPE_WEBHOOK_SECRET binding is honoured", async () => {
  const response = await ingestStripeWebhook(await signedRequest(PAYLOAD), { STRIPE_WEBHOOK_SECRET: SECRET }, NOW);
  assert.equal(response.status, 200);
});

test("health check reports binding state without leaking the secret", async () => {
  const ok = await stripeWebhookHealth(ENV).json();
  assert.equal(ok.status, "ok");
  assert.equal(ok.checks.webhook_secret_binding, true);
  assert.equal(JSON.stringify(ok).includes(SECRET), false);
  const degraded = await stripeWebhookHealth({}).json();
  assert.equal(degraded.status, "degraded");
});

test("verifyStripeSignature matches the documented Stripe scheme", async () => {
  const timestamp = NOW;
  const expected = await stripeSignatureHex(SECRET, timestamp, PAYLOAD);
  assert.match(expected, /^[0-9a-f]{64}$/);
  const result = await verifyStripeSignature(PAYLOAD, `t=${timestamp},v1=${expected}`, SECRET, NOW);
  assert.deepEqual(result, { ok: true, reason: "verified" });
});
