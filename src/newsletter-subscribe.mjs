import { resendContactsEnabled, syncResendContact } from "./resend-contacts.mjs";
import { canonicalContactStatements, runCanonicalContactStatements } from "./canonical-contact.mjs";
import { ONBOARDING_CONSENT_VERSION, ONBOARDING_CONSENT_SOURCE, ONBOARDING_CONSENT_TEXT, ONBOARDING_SURFACE } from './onboarding-consent.mjs';

export const NEWSLETTER_CONSENT_VERSION = "glp-newsletter-v1-20260822";
export const NEWSLETTER_CONSENT_SOURCE = "/subscribe-bottom-sheet/";
export const NEWSLETTER_FUNNEL_STAGE = "newsletter";
export const NEWSLETTER_CONSENT_COPY_SHA256 = "81aafa286061bc57e4ecedf19fedde4d7dda1752e6805982bf692a0a1f48e308";
export const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

const DEFAULT_FROM_ADDRESS = "hello@glpclinicscout.com";
const DEFAULT_FROM_NAME = "GLP Clinic Scout";
const DEFAULT_SITE_ORIGIN = "https://glpclinicscout.com";
const POSTAL_ADDRESS = "Tilton Group LLC · 2108 N St, Ste N · Sacramento, CA 95816";

const ALLOWED_KEYS = new Set(["company", "consent_source", "consent_version", "email", "email_consent", "first_name", "provider_context", "source_surface"]);
const ALLOWED_SOURCE_SURFACES = new Set(["sitewide-price-watch", "quiz-provider-fit", "matches-customized"]);
const ALLOWED_CONTEXT_KEYS = new Set(["state", "medication_family", "medication_intents"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function priceAlertConfirmationHtml({ firstName, origin, unsubscribeUrl }) {
  const greeting = firstName ? `Hi ${esc(firstName)},` : "You're in.";
  return `<!doctype html><html lang="en"><head><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head><body style="margin:0;background:#07100d;color:#f2f8f4;font:16px/1.6 system-ui,sans-serif"><div style="max-width:620px;margin:0 auto;padding:34px 22px"><p style="margin:0 0 18px;color:#3fd9a4;font-weight:800;letter-spacing:.08em;text-transform:uppercase">GLP Clinic Scout</p><h1 style="margin:0 0 16px;font-size:30px;line-height:1.1">${greeting}</h1><p>We saved your price-watch request. We’ll email you when a source-dated update is ready.</p><p>No invented movement, no provider-paid ranking, and no medical advice. You can review the latest published evidence anytime.</p><p><a href="${esc(origin)}/glp-1-price-index/" style="color:#6fd8ff;font-weight:800">Open the GLP-1 price index</a></p><hr style="border:0;border-top:1px solid rgba(233,247,241,.18);margin:28px 0"><p style="color:#a7bfb5;font-size:13px">You requested GLP-1 price updates from Clinic Scout. <a href="${esc(unsubscribeUrl)}" style="color:#6fd8ff">Unsubscribe</a>.</p><p style="color:#a7bfb5;font-size:13px">${POSTAL_ADDRESS}</p></div></body></html>`;
}

async function logConfirmationDelivery(env, { subscriberId, status, resendEmailId = null }) {
  const db = env.EMAIL_DB || env.GLP_DB;
  if (!db?.prepare) return;
  const now = new Date().toISOString();
  const deliveryId = hex(crypto.getRandomValues(new Uint8Array(16)));
  try {
    await db.prepare("INSERT OR IGNORE INTO email_deliveries (delivery_id, idempotency_key, subscriber_id, vertical, funnel_stage, message_type, sequence_step, campaign_id, resend_email_id, status, created_at, sent_at, failed_at) VALUES (?, ?, ?, 'glp-clinic-scout', 'newsletter', 'price-alert-confirmation', NULL, 'price-alert-confirmation', ?, ?, ?, ?, ?)")
      .bind(deliveryId, `newsletter-confirmation/${subscriberId}/${NEWSLETTER_CONSENT_VERSION}`, subscriberId, resendEmailId, status, now, status === "sent" ? now : null, status === "failed" ? now : null).run();
  } catch { /* logging is best-effort and never changes the durable capture result */ }
}

export async function deliverPriceAlertConfirmation({ env, capture, subscriberId, unsubscribeToken }, fetchImpl = globalThis.fetch) {
  if (!resendContactsEnabled(env)) return { status: "held", endpoint: RESEND_EMAILS_ENDPOINT, http_status: null, email_id: null, reason: "provider_gate_disabled" };
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    await logConfirmationDelivery(env, { subscriberId, status: "failed" });
    return { status: "failed", endpoint: RESEND_EMAILS_ENDPOINT, http_status: null, email_id: null, reason: "missing_api_key" };
  }
  const origin = String(env.SITE_ORIGIN || DEFAULT_SITE_ORIGIN).replace(/\/$/, "");
  const unsubscribeUrl = `${origin}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const idempotencyKey = `newsletter-confirmation/${subscriberId}/${NEWSLETTER_CONSENT_VERSION}`.slice(0, 256);
  let receipt = { status: "failed", endpoint: RESEND_EMAILS_ENDPOINT, http_status: null, email_id: null, reason: "transport_error" };
  try {
    const response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey, "User-Agent": "clinic-scout-price-alert-confirmation/1.0" },
      body: JSON.stringify({
        from: `${env.RESEND_FROM_NAME || DEFAULT_FROM_NAME} <${env.RESEND_FROM_ADDRESS || DEFAULT_FROM_ADDRESS}>`,
        to: [capture.email],
        ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {}),
        subject: "You're on the GLP-1 price watch",
        html: priceAlertConfirmationHtml({ firstName: capture.firstName, origin, unsubscribeUrl }),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Entity-Ref-ID": idempotencyKey },
      }),
    });
    const body = await response.json().catch(() => ({}));
    const emailId = typeof body?.id === "string" && body.id ? body.id : null;
    receipt = {
      status: response.ok && emailId ? "sent" : "failed",
      endpoint: RESEND_EMAILS_ENDPOINT,
      http_status: response.status,
      email_id: emailId,
      reason: response.ok && emailId ? null : response.ok ? "provider_receipt_invalid" : "provider_rejected",
    };
  } catch { /* the explicit transport_error receipt remains */ }
  await logConfirmationDelivery(env, { subscriberId, status: receipt.status === "sent" ? "sent" : "failed", resendEmailId: receipt.email_id });
  return receipt;
}

export function validateNewsletterSubscription(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload_invalid");
  for (const key of Object.keys(payload)) if (!ALLOWED_KEYS.has(key)) throw new Error("payload_key_not_allowed");
  if (String(payload.company || "") !== "") throw new Error("bot_rejected");
  const email = String(payload.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error("email_invalid");
  if (payload.email_consent !== true && payload.email_consent !== "true") throw new Error("required_consent_missing");
  const onboarding = payload.consent_version === ONBOARDING_CONSENT_VERSION;
  if (!onboarding && payload.consent_version !== NEWSLETTER_CONSENT_VERSION) throw new Error("consent_version_invalid");
  if (payload.consent_source !== NEWSLETTER_CONSENT_SOURCE) throw new Error("consent_source_invalid");
  const firstName = String(payload.first_name || "").trim().replace(/\s+/g, " ");
  if (firstName.length > 60 || /[\u0000-\u001f\u007f]/.test(firstName)) throw new Error("first_name_invalid");
  const sourceSurface = String(payload.source_surface || "sitewide-price-watch").trim();
  if (!ALLOWED_SOURCE_SURFACES.has(sourceSurface)) throw new Error("source_surface_invalid");
  const providerContext = payload.provider_context ?? null;
  if (onboarding && (sourceSurface !== ONBOARDING_SURFACE || providerContext !== null || firstName !== '')) throw new Error('onboarding_purpose_invalid');
  if (providerContext !== null) {
    if (!providerContext || typeof providerContext !== "object" || Array.isArray(providerContext)) throw new Error("provider_context_invalid");
    if (Object.keys(providerContext).some((key) => !ALLOWED_CONTEXT_KEYS.has(key))) throw new Error("provider_context_invalid");
    if (JSON.stringify(providerContext).length > 500) throw new Error("provider_context_invalid");
  }
  return { email, firstName, sourceSurface, providerContext, consentVersion: onboarding ? ONBOARDING_CONSENT_VERSION : NEWSLETTER_CONSENT_VERSION, consentSource: NEWSLETTER_CONSENT_SOURCE };
}

function captureGate(env) {
  // `enabled` is the explicit Pages capture-only mode authorized by Design
  // Pass 4. It writes durable consent to D1 but cannot start email sends;
  // RESEND_ENABLED and the independent worker send gate still own effects.
  if (["local_test", "enabled"].includes(env.NEWSLETTER_CAPTURE_MODE)) return true;
  const receipt = String(env.NEWSLETTER_CAPTURE_RECEIPT_SHA256 || "");
  return env.NEWSLETTER_CAPTURE_MODE === "production_operator_approved"
    && /^[a-f0-9]{64}$/.test(receipt)
    && env.NEWSLETTER_CAPTURE_GATE === `operator-approved:${receipt}`;
}

async function rateLimit(env, db, request) {
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.LEAD_RATE_LIMITER?.limit) {
    const result = await env.LEAD_RATE_LIMITER.limit({ key: `newsletter-subscribe:${address}` });
    return Boolean(result?.success);
  }
  if (env.NEWSLETTER_CAPTURE_MODE === "local_test") return true;
  const keyHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`newsletter-subscribe|${address}`)));
  const windowStart = Math.floor(Date.now() / 60000);
  try {
    const row = await db.prepare("INSERT INTO request_rate_limits (scope,key_hash,window_start,request_count,updated_at) VALUES ('newsletter-subscribe',?,?,1,?) ON CONFLICT(scope,key_hash,window_start) DO UPDATE SET request_count=request_count+1,updated_at=excluded.updated_at RETURNING request_count")
      .bind(keyHash, windowStart, new Date().toISOString()).first();
    return Number(row?.request_count || 0) <= 5;
  } catch {
    return false;
  }
}

export async function handleNewsletterSubscribeRequest(request, env, fetchImpl = globalThis.fetch) {
  if (request.method !== "POST") return json(405, { status: "METHOD_NOT_ALLOWED" });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json(415, { status: "CONTENT_TYPE_REQUIRED" });
  if (Number(request.headers.get("content-length") || 0) > 2048) return json(413, { status: "PAYLOAD_TOO_LARGE" });
  if (!captureGate(env)) return json(503, { status: "NEWSLETTER_CAPTURE_HELD" });
  const db = env.EMAIL_DB || env.GLP_DB;
  if (!db?.prepare) return json(503, { status: "STORAGE_UNAVAILABLE" });
  if (!(await rateLimit(env, db, request))) return json(429, { status: "RATE_LIMITED" });

  let payload;
  try { payload = await request.json(); } catch { return json(400, { status: "JSON_INVALID" }); }
  let capture;
  try { capture = validateNewsletterSubscription(payload); } catch (error) { return json(400, { status: error.message }); }

  const now = new Date().toISOString();
  const subscriberId = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`newsletter|glp-clinic-scout|${capture.email}`)));
  const unsubscribeToken = hex(crypto.getRandomValues(new Uint8Array(16)));
  if (capture.consentVersion === ONBOARDING_CONSENT_VERSION) {
    // New purpose is create-only: historic, withdrawn and suppressed identities
    // are never silently converted/reactivated; duplicate opt-ins do not restart.
    if (typeof db.batch !== 'function') return json(503, {status:'ATOMIC_STORAGE_REQUIRED'});
    try {
      const suppressed = await db.prepare("SELECT 1 AS found FROM suppression_log WHERE email=? AND vertical='glp-clinic-scout' LIMIT 1").bind(capture.email).first();
      const prior = await db.prepare("SELECT status,consent_status,consent_version FROM subscribers WHERE email=? AND vertical='glp-clinic-scout'").bind(capture.email).first();
      if (suppressed || prior && (prior.status !== 'active' || prior.consent_status !== 'opted-in' || prior.consent_version !== ONBOARDING_CONSENT_VERSION)) return json(409, {status:'EXISTING_PURPOSE_OR_SUPPRESSION_HELD'});
      if (prior) return json(200, {status:'ALREADY_ENROLLED',sends_started:false});
      const consentHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ONBOARDING_CONSENT_TEXT)));
      const insert = db.prepare("INSERT INTO subscribers(subscriber_id,email,first_name,vertical,funnel_stage,consent_status,consent_version,consent_source,consent_at,unsubscribe_token,status,next_drip_step,next_send_at,created_at,updated_at) SELECT ?,?,?,'glp-clinic-scout','newsletter','opted-in',?,?,?,?,'active',1,?,?,? WHERE NOT EXISTS (SELECT 1 FROM suppression_log WHERE email=? AND vertical='glp-clinic-scout') ON CONFLICT(email,vertical) DO NOTHING")
        .bind(subscriberId,capture.email,capture.firstName||'there',ONBOARDING_CONSENT_VERSION,ONBOARDING_CONSENT_SOURCE,now,unsubscribeToken,now,now,now,capture.email);
      const ledger = canonicalContactStatements(db, {subscriberId,email:capture.email,firstName:capture.firstName,funnelStage:'newsletter',sourceSurface:ONBOARDING_SURFACE,sourceContext:null,marketingConsent:true,consentVersion:ONBOARDING_CONSENT_VERSION,consentSource:ONBOARDING_CONSENT_SOURCE,consentCopySha256:consentHash,idempotencyKey:`marketing:${subscriberId}:${ONBOARDING_SURFACE}:${ONBOARDING_CONSENT_VERSION}`,capturedAt:now,unsubscribeToken,captureOnly:true});
      const results = await db.batch([insert,...ledger]);
      if (results.some(r=>r?.success===false)) throw new Error('batch_failed');
      const row = await db.prepare("SELECT status,consent_status,consent_version FROM subscribers WHERE email=? AND vertical='glp-clinic-scout'").bind(capture.email).first();
      if (!row || row.status!=='active' || row.consent_status!=='opted-in' || row.consent_version!==ONBOARDING_CONSENT_VERSION) return json(409,{status:'ENROLLMENT_HELD'});
      return json(Number(results[0]?.meta?.changes||0)===1?201:200,{status:'ONBOARDING_ENROLLED',sends_started:false});
    } catch { return json(503,{status:'STORAGE_FAILED'}); }
  }
  try {
    const statements = canonicalContactStatements(db, {
      subscriberId,
      email: capture.email,
      firstName: capture.firstName,
      funnelStage: "newsletter",
      sourceSurface: capture.sourceSurface,
      sourceContext: capture.providerContext,
      marketingConsent: true,
      consentVersion: capture.consentVersion,
      consentSource: capture.consentSource,
      consentCopySha256: NEWSLETTER_CONSENT_COPY_SHA256,
      idempotencyKey: `marketing:${subscriberId}:${capture.sourceSurface}:${capture.consentVersion}`,
      capturedAt: now,
      unsubscribeToken,
    });
    const results = await runCanonicalContactStatements(db, statements);
    if (results.some((result) => result?.success === false)) throw new Error("insert_failed");
    // A ledger insert does not make a guarded subscriber no-op sendable.
    if (Number(results[0]?.meta?.changes || 0) !== 1) return json(409, {status:'EXISTING_PURPOSE_OR_SUPPRESSION_HELD',sends_started:false});
  } catch {
    return json(503, { status: "STORAGE_FAILED" });
  }

  // D1 remains the durable consent/provenance source. The requested confirmation
  // email is attempted first; the secondary Contacts sync can never make a saved
  // subscription look like a failed save.
  if (!resendContactsEnabled(env)) {
    return json(201, { status: "SUBSCRIBED_SENDS_HELD", subscriber_id: subscriberId, sends_started: false, confirmation_email: null, resend_contact: null });
  }

  const confirmationEmail = await deliverPriceAlertConfirmation({ env, capture, subscriberId, unsubscribeToken }, fetchImpl);
  const resendContact = await syncResendContact({ env, email: capture.email, firstName: capture.firstName || "there" }, fetchImpl);
  const warnings = [];
  if (confirmationEmail.status !== "sent") warnings.push({ code: "CONFIRMATION_EMAIL_FAILED" });
  if (resendContact.status !== "synced") warnings.push({ code: "CONTACT_SYNC_FAILED", retryable: Boolean(resendContact.retryable) });
  const status = confirmationEmail.status === "sent"
    ? resendContact.status === "synced" ? "SUBSCRIBED" : "SUBSCRIBED_CONTACT_SYNC_FAILED"
    : resendContact.status === "synced" ? "SUBSCRIBED_CONFIRMATION_FAILED" : "SUBSCRIBED_PROVIDER_FAILED";
  const body = {
    status,
    subscriber_id: subscriberId,
    sends_started: false,
    confirmation_sent: confirmationEmail.status === "sent",
    confirmation_email: confirmationEmail,
    resend_contact: resendContact,
    warnings,
  };
  return json(warnings.length ? 202 : 201, body);
}
