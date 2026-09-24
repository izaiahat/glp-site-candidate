import { canonicalContactStatements } from "./canonical-contact.mjs";

const STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]);
const PRIORITIES = new Set(["price", "insurance", "coaching", "convenience", "medication-form"]);
const ALLOWED_KEYS = new Set(["first_name", "email", "phone", "state", "priority", "source_page", "provider_interest", "privacy_consent", "marketing_consent", "contact_consent", "consent_version"]);
const SAFE_SOURCE = /^\/[a-z0-9/_-]{1,120}$/;
const SAFE_PROVIDER = /^[a-z0-9-]{0,80}$/;
const SAFE_IDEMPOTENCY = /^[A-Za-z0-9_-]{16,80}$/;
const MARKETING_CONSENT_COPY_SHA256 = "49e001435752d46298fe4969663d79d479bb7d15aa8cfb295ea0d2d006a93579";
const PROVIDER_CONTACT_COPY_SHA256 = "025c9a0c1e942826fd0fc8c71c260137b4db8d64f1121d41d8cab21041f5cc21";

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

export function validateLead(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload_invalid");
  if (Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key))) throw new Error("payload_key_not_allowed");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("email_invalid");
  const firstName = String(payload.first_name || "").trim();
  if (!/^[\p{L} .'-]{1,60}$/u.test(firstName)) throw new Error("first_name_invalid");
  const phone = String(payload.phone || "").replaceAll(/[^+\d]/g, "");
  if (!/^\+[1-9]\d{9,14}$/.test(phone)) throw new Error("phone_invalid");
  const state = String(payload.state || "").toUpperCase();
  if (!STATES.has(state)) throw new Error("state_invalid");
  const priority = String(payload.priority || "");
  if (!PRIORITIES.has(priority)) throw new Error("priority_invalid");
  const sourcePage = String(payload.source_page || "");
  if (!SAFE_SOURCE.test(sourcePage)) throw new Error("source_page_invalid");
  const providerInterest = String(payload.provider_interest || "");
  if (!SAFE_PROVIDER.test(providerInterest)) throw new Error("provider_interest_invalid");
  if (payload.privacy_consent !== true || payload.contact_consent !== true) throw new Error("required_consent_missing");
  if (payload.marketing_consent !== true && payload.marketing_consent !== false) throw new Error("marketing_consent_invalid");
  if (payload.consent_version !== "glp-lead-v2-20260723") throw new Error("consent_version_invalid");
  return { firstName, email, phone, state, priority, sourcePage, providerInterest, privacyConsent: true, marketingConsent: payload.marketing_consent, contactConsent: true };
}

async function rateLimit(env, request) {
  const key = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.LEAD_RATE_LIMITER?.limit) {
    const result = await env.LEAD_RATE_LIMITER.limit({ key: `quiz-lead:${key}` });
    return Boolean(result?.success);
  }
  if (env.LEAD_CAPTURE_MODE === "local_test") return true;
  if (!env.GLP_DB?.prepare) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`quiz-lead|${key}`));
  const keyHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const windowStart = Math.floor(Date.now() / 60000);
  try {
    const row = await env.GLP_DB.prepare("INSERT INTO request_rate_limits (scope, key_hash, window_start, request_count, updated_at) VALUES ('quiz-lead', ?, ?, 1, ?) ON CONFLICT(scope, key_hash, window_start) DO UPDATE SET request_count=request_count+1, updated_at=excluded.updated_at RETURNING request_count").bind(keyHash, windowStart, new Date().toISOString()).first();
    return Number(row?.request_count || 0) <= 5;
  } catch { return false; }
}

export async function handleLeadRequest(request, env) {
  if (request.method !== "POST") return json(405, { status: "METHOD_NOT_ALLOWED" });
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) return json(415, { status: "CONTENT_TYPE_REQUIRED" });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8192) return json(413, { status: "PAYLOAD_TOO_LARGE" });
  const idempotency = request.headers.get("idempotency-key") || "";
  if (!SAFE_IDEMPOTENCY.test(idempotency)) return json(400, { status: "IDEMPOTENCY_REQUIRED" });
  const mode = env.LEAD_CAPTURE_MODE;
  const productionGate = mode === "production_operator_approved" && /^[a-f0-9]{64}$/.test(env.LEAD_CAPTURE_RECEIPT_SHA256 || "") && env.LEAD_CAPTURE_GATE === `operator-approved:${env.LEAD_CAPTURE_RECEIPT_SHA256}`;
  if (mode !== "local_test" && !productionGate) return json(503, { status: "LEAD_CAPTURE_HELD" });
  if (!(await rateLimit(env, request))) return json(429, { status: "RATE_LIMITED" });
  let payload;
  try { payload = await request.json(); } catch { return json(400, { status: "JSON_INVALID" }); }
  let lead;
  try { lead = validateLead(payload); } catch (error) { return json(400, { status: error.message }); }
  if (!env.GLP_DB?.prepare || !env.GLP_DB?.batch) return json(503, { status: "STORAGE_UNAVAILABLE" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${lead.email}|${idempotency}`));
  const leadId = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const unsubscribeToken = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const createdAt = new Date().toISOString();
  const consentText = "By submitting, I agree to be contacted by matched providers by phone, text, or email.";
  try {
    const statements = [
      env.GLP_DB.prepare("INSERT OR IGNORE INTO leads (id, session_id, name, email, phone, state, zip, source, consent_status, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'held_national_capture', ?)").bind(leadId, leadId, lead.firstName, lead.email, lead.phone, lead.state, lead.sourcePage, createdAt),
      env.GLP_DB.prepare("INSERT OR IGNORE INTO lead_capture_metadata_v2 (lead_id, priority, provider_interest, source_page, consent_version, privacy_consent, marketing_consent, contact_consent, capture_idempotency_hash, email_send_authorized, provider_share_authorized, hold_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'glp-lead-v2-20260723', 1, ?, 1, ?, 0, 0, 'held_no_route_no_send', ?, ?)").bind(leadId, lead.priority, lead.providerInterest, lead.sourcePage, lead.marketingConsent ? 1 : 0, leadId, createdAt, createdAt),
      env.GLP_DB.prepare("INSERT OR IGNORE INTO consent_ledger (id, lead_id, consent_type, consent_text, created_at) VALUES (?, ?, 'held_national_provider_request', ?, ?)").bind(`held-consent-${leadId}`, leadId, consentText, createdAt),
    ];
    statements.push(...canonicalContactStatements(env.GLP_DB, {
      subscriberId: leadId,
      email: lead.email,
      firstName: lead.firstName,
      funnelStage: "quiz-lead",
      sourceSurface: "quiz-provider-fit",
      sourceContext: { state: lead.state, priority: lead.priority, provider_interest: lead.providerInterest || null },
      marketingConsent: lead.marketingConsent,
      purpose: lead.marketingConsent ? "marketing" : "verification-only",
      consentVersion: "glp-lead-v2-20260723",
      consentSource: lead.sourcePage,
      consentCopySha256: lead.marketingConsent ? MARKETING_CONSENT_COPY_SHA256 : PROVIDER_CONTACT_COPY_SHA256,
      idempotencyKey: `${lead.marketingConsent ? "marketing" : "verification"}:${leadId}:quiz-provider-fit:glp-lead-v2-20260723`,
      capturedAt: createdAt,
      unsubscribeToken: lead.marketingConsent ? unsubscribeToken : null,
    }));
    const results = await env.GLP_DB.batch(statements);
    if (!Array.isArray(results) || results.length !== statements.length || results.some((item) => item?.success === false)) throw new Error("batch_failed");
  } catch { return json(503, { status: "STORAGE_FAILED" }); }
  return json(202, { status: "CAPTURED_SENDS_HELD", lead_id: leadId, subscriber_created: lead.marketingConsent });
}

export const leadCapturePolicy = Object.freeze({
  storedFields: ["first_name", "email", "phone", "state", "priority", "source_page", "provider_interest", "privacy_consent", "marketing_consent", "contact_consent", "consent_version", "created_at"],
  forbiddenFields: ["bmi", "weight", "current_medications", "diagnosis", "medical_history", "quiz_answers"],
  emailSends: false,
  providerSharing: false,
  storageBinding: "GLP_DB",
  atomicBatchRequired: true,
  launchGate: "operator",
});
