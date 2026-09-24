const TOLERANCE_SECONDS = 300;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function timingSafeEqualHex(left, right) {
  const a = hexToBytes(left);
  const b = hexToBytes(right);
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function parseSignatureHeader(header) {
  const timestamps = [];
  const signatures = [];
  for (const part of String(header || "").split(",")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamps.push(value);
    else if (key === "v1") signatures.push(value);
  }
  return { timestamp: timestamps[0] || "", signatures };
}

export async function stripeSignatureHex(secret, timestamp, rawBody) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Verifies a Stripe-Signature header (v1 HMAC-SHA256 over `${t}.${payload}`) inside the 5-minute tolerance window. */
export async function verifyStripeSignature(rawBody, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return { ok: false, reason: "webhook_secret_unavailable" };
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!/^\d{9,11}$/.test(timestamp) || signatures.length === 0) return { ok: false, reason: "signature_header_invalid" };
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_outside_tolerance" };
  const expected = await stripeSignatureHex(secret, timestamp, rawBody);
  if (!signatures.some((candidate) => timingSafeEqualHex(expected, candidate))) return { ok: false, reason: "signature_mismatch" };
  return { ok: true, reason: "verified" };
}

const MONEY_EVENTS = new Set(["checkout.session.completed", "invoice.paid", "payout.paid"]);

/**
 * Minimal, safe receiver: verify, acknowledge, do nothing else. The hermes Stripe
 * poller owns notification and reconciliation, so this endpoint holds no state and
 * has no side effects — its only job is to keep the Stripe endpoint healthy.
 */
export async function ingestStripeWebhook(request, env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = env?.GLP_STRIPE_WEBHOOK_SECRET || env?.STRIPE_WEBHOOK_SECRET || "";
  const rawBody = await request.text();
  const verification = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret, nowSeconds);
  if (!verification.ok) return jsonResponse({ status: "error", error: verification.reason }, 400);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ status: "error", error: "invalid_json" }, 400);
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) return jsonResponse({ status: "error", error: "invalid_event" }, 400);

  return jsonResponse({
    status: "ok",
    received: true,
    event_id: typeof event.id === "string" ? event.id : null,
    event_type: typeof event.type === "string" ? event.type : null,
    money_event: typeof event.type === "string" && MONEY_EVENTS.has(event.type),
    handled_by: "hermes_stripe_poller"
  });
}

export function stripeWebhookHealth(env) {
  return jsonResponse({
    status: env?.GLP_STRIPE_WEBHOOK_SECRET || env?.STRIPE_WEBHOOK_SECRET ? "ok" : "degraded",
    service: "glp-clinic-scout-stripe-webhook",
    checks: { webhook_secret_binding: Boolean(env?.GLP_STRIPE_WEBHOOK_SECRET || env?.STRIPE_WEBHOOK_SECRET) },
    note: "GET is a read-only health check. POST requires a valid Stripe-Signature."
  });
}
