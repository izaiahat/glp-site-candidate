const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PROMO_MAX_AGE_DAYS = 45;

function dayMs() { return 24 * 60 * 60 * 1000; }
function parseDate(value) { return DATE_RE.test(String(value ?? "")) ? new Date(`${value}T00:00:00Z`) : null; }

export function validatePromoRecord(promo) {
  if (!promo || typeof promo !== "object") throw new Error("promo_record_missing");
  if (!["NOT_VERIFIED", "VERIFIED"].includes(promo.status)) throw new Error("promo_status_invalid");
  if (promo.status === "VERIFIED" && !DATE_RE.test(String(promo.verified_as_of ?? ""))) throw new Error("promo_verified_date_invalid");
  if (promo.expires_at !== null && promo.expires_at !== undefined && !DATE_RE.test(String(promo.expires_at))) throw new Error("promo_expiry_invalid");
  if (promo.status === "NOT_VERIFIED") {
    if (promo.code !== null && promo.code !== undefined) throw new Error("unverified_promo_code_present");
    if (promo.source_url !== null && promo.source_url !== undefined) throw new Error("unverified_promo_source_present");
  }
  if (promo.status === "VERIFIED") {
    if (!String(promo.code || "").trim() || !/^https:\/\//.test(String(promo.source_url || ""))) throw new Error("verified_promo_evidence_incomplete");
  }
  return true;
}

export function resolvePromo(promo, now = new Date().toISOString()) {
  validatePromoRecord(promo);
  const nowDate = new Date(now);
  const verified = parseDate(promo.verified_as_of);
  const expiry = parseDate(promo.expires_at);
  if (promo.status !== "VERIFIED") return { status: "NOT_VERIFIED", code: null, source_url: null, verified_as_of: promo.verified_as_of, expires_at: promo.expires_at ?? null };
  if (!verified || Number.isNaN(nowDate.getTime()) || nowDate < verified) return { status: "HELD", code: null, source_url: null, reason: "verification_date_not_current" };
  if (expiry && nowDate >= new Date(expiry.getTime() + dayMs())) return { status: "HELD", code: null, source_url: null, reason: "promo_expired" };
  if (nowDate.getTime() - verified.getTime() > PROMO_MAX_AGE_DAYS * dayMs()) return { status: "HELD", code: null, source_url: null, reason: "promo_evidence_stale" };
  return { status: "ACTIVE", code: String(promo.code), source_url: String(promo.source_url), verified_as_of: promo.verified_as_of, expires_at: promo.expires_at ?? null };
}

export function renderPromoEvidence(promo, now = new Date().toISOString()) {
  const resolved = resolvePromo(promo, now);
  if (resolved.status === "ACTIVE") return `<aside class="promo-evidence" data-promo-state="active"><strong>Verified offer code:</strong> ${resolved.code} · <a href="${resolved.source_url}" rel="sponsored noopener">Source and terms</a> · verified ${resolved.verified_as_of}${resolved.expires_at ? ` · expires ${resolved.expires_at}` : ""}</aside>`;
  if (resolved.status === "HELD") return `<aside class="promo-evidence" data-promo-state="held"><strong>No current promo code shown.</strong> The recorded code is held because its source or date is not current.</aside>`;
  return `<aside class="promo-evidence" data-promo-state="not-verified"><strong>No verified current promo code.</strong> This page does not display an unverified or stale discount.</aside>`;
}
