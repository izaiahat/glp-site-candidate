export const RESEND_CONTACTS_ENDPOINT = "https://api.resend.com/contacts";

const heldReceipt = (segmentId) => ({
  status: "held",
  endpoint: RESEND_CONTACTS_ENDPOINT,
  http_status: null,
  contact_id: null,
  object: null,
  segment_id: segmentId,
  reason: "provider_gate_disabled",
});

const failedReceipt = ({ segmentId, httpStatus = null, reason, providerError = null }) => ({
  status: "failed",
  endpoint: RESEND_CONTACTS_ENDPOINT,
  http_status: httpStatus,
  contact_id: null,
  object: null,
  segment_id: segmentId,
  reason,
  provider_error: providerError,
});

export function resendContactsEnabled(env) {
  return env?.RESEND_ENABLED === "true";
}

/**
 * Synchronize one explicitly submitted address into Resend's global Contacts DB.
 * The caller owns the durable consent/provenance write and injects fetch in tests.
 */
export async function syncResendContact({ env, email, firstName = "there", lastName = "", unsubscribed = false }, fetchImpl = globalThis.fetch) {
  const segmentId = String(env?.RESEND_SEGMENT_ID || "").trim() || null;
  if (!resendContactsEnabled(env)) return heldReceipt(segmentId);

  const apiKey = String(env?.RESEND_API_KEY || "").trim();
  if (!apiKey) return failedReceipt({ segmentId, reason: "missing_api_key" });
  if (typeof fetchImpl !== "function") return failedReceipt({ segmentId, reason: "transport_unavailable" });

  const body = {
    email: String(email || "").trim().toLowerCase(),
    first_name: String(firstName || "").trim(),
    unsubscribed: Boolean(unsubscribed),
    ...(String(lastName || "").trim() ? { last_name: String(lastName).trim() } : {}),
    ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
  };

  let response;
  try {
    response = await fetchImpl(RESEND_CONTACTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "clinic-scout-resend-contacts/1.0",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return failedReceipt({
      segmentId,
      reason: "transport_error",
      providerError: String(error?.message || error || "transport_error"),
    });
  }

  let providerBody = {};
  try { providerBody = await response.json(); } catch { providerBody = {}; }
  const providerError = typeof providerBody?.message === "string"
    ? providerBody.message
    : typeof providerBody?.name === "string" ? providerBody.name : null;
  if (!response.ok) {
    return failedReceipt({
      segmentId,
      httpStatus: response.status,
      reason: "provider_rejected",
      providerError,
    });
  }

  const contactId = typeof providerBody?.id === "string" && providerBody.id ? providerBody.id : null;
  const object = typeof providerBody?.object === "string" && providerBody.object ? providerBody.object : null;
  if (!contactId) {
    return failedReceipt({
      segmentId,
      httpStatus: response.status,
      reason: "provider_receipt_invalid",
      providerError,
    });
  }

  return {
    status: "synced",
    endpoint: RESEND_CONTACTS_ENDPOINT,
    http_status: response.status,
    contact_id: contactId,
    object,
    segment_id: segmentId,
    reason: null,
    provider_error: null,
  };
}
