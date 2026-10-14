const VERTICAL = "glp-clinic-scout";
const SAFE_SURFACE = /^[a-z0-9][a-z0-9._:/-]{1,119}$/;
const PURPOSES = new Set(["marketing", "verification-only", "withdrawal", "suppression", "resource-delivery"]);

function normalizedName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) return "there";
  if (name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("first_name_invalid");
  return name;
}

function normalizedContext(value) {
  if (value == null || value === "") return null;
  const context = typeof value === "string" ? value : JSON.stringify(value);
  if (context.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(context)) {
    throw new Error("source_context_invalid");
  }
  return context;
}

export function canonicalContactStatements(db, {
  subscriberId,
  email,
  firstName,
  funnelStage,
  sourceSurface,
  sourceContext = null,
  reviewId = null,
  marketingConsent,
  purpose = marketingConsent ? "marketing" : "verification-only",
  consentVersion,
  consentSource,
  consentCopySha256,
  idempotencyKey,
  capturedAt,
  unsubscribeToken = null,
  captureOnly = false,
}) {
  const name = normalizedName(firstName);
  const surface = String(sourceSurface || "").trim();
  if (!SAFE_SURFACE.test(surface)) throw new Error("source_surface_invalid");
  const context = normalizedContext(sourceContext);
  const normalizedPurpose = String(purpose || "").trim();
  if (!PURPOSES.has(normalizedPurpose)) throw new Error("purpose_invalid");
  if (!/^[a-z0-9][a-z0-9._:/-]{3,255}$/.test(String(idempotencyKey || ""))) throw new Error("idempotency_key_invalid");
  if (!/^[a-f0-9]{64}$/.test(String(consentCopySha256 || ""))) throw new Error("consent_copy_sha256_invalid");
  if (reviewId != null && !/^review_[a-f0-9-]{16,80}$/.test(String(reviewId))) throw new Error("review_id_invalid");
  if (Boolean(marketingConsent) !== (normalizedPurpose === "marketing")) throw new Error("purpose_consent_mismatch");
  const consentStatus = marketingConsent ? "opted-in" : normalizedPurpose === "resource-delivery" ? "resource-only" : "verification-only";
  const statements = [];

  if (marketingConsent) {
    if (!subscriberId || !/^[a-f0-9]{64}$/.test(subscriberId)) throw new Error("subscriber_id_invalid");
    if (!/^[a-f0-9]{32}$/.test(unsubscribeToken || "")) throw new Error("unsubscribe_token_invalid");
    if (!captureOnly) statements.push(db.prepare("INSERT INTO subscribers (subscriber_id,email,first_name,vertical,funnel_stage,consent_status,consent_version,consent_source,consent_at,unsubscribe_token,status,next_drip_step,next_send_at,created_at,updated_at) VALUES (?,?,?,?,?,'opted-in',?,?,?,?,'active',0,NULL,?,?) ON CONFLICT(email,vertical) DO UPDATE SET first_name=CASE WHEN excluded.first_name <> 'there' THEN excluded.first_name ELSE subscribers.first_name END,funnel_stage=excluded.funnel_stage,consent_status='opted-in',consent_version=excluded.consent_version,consent_source=excluded.consent_source,consent_at=excluded.consent_at,unsubscribe_token=CASE WHEN LENGTH(subscribers.unsubscribe_token)=32 THEN subscribers.unsubscribe_token ELSE excluded.unsubscribe_token END,status='active',next_drip_step=0,next_send_at=NULL,updated_at=excluded.updated_at WHERE subscribers.consent_version <> 'glp47-comparison-guides-v1-20261013' AND subscribers.status='active' AND NOT EXISTS (SELECT 1 FROM suppression_log z WHERE z.email=subscribers.email AND z.vertical=subscribers.vertical)")
      .bind(subscriberId, email, name, VERTICAL, funnelStage, consentVersion, consentSource, capturedAt, unsubscribeToken, capturedAt, capturedAt));
  }

  statements.push(db.prepare("INSERT OR IGNORE INTO contact_capture_events (capture_id,idempotency_key,email,first_name,vertical,funnel_stage,source_surface,source_context,review_id,purpose,marketing_consent,consent_status,consent_version,consent_source,consent_copy_sha256,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(`contact_${crypto.randomUUID()}`, idempotencyKey, email, name, VERTICAL, funnelStage, surface, context, reviewId, normalizedPurpose, marketingConsent ? 1 : 0, consentStatus, consentVersion, consentSource, consentCopySha256, capturedAt));
  return statements;
}

export async function runCanonicalContactStatements(db, statements) {
  if (typeof db.batch === "function") return db.batch(statements);
  const results = [];
  for (const statement of statements) results.push(await statement.run());
  return results;
}
