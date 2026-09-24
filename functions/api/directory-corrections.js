const ALLOWED = new Set(["npi", "submitter_role", "email", "correction_type", "source_url", "statement", "truthful_attestation"]);
const TYPES = new Set(["identity", "location", "taxonomy", "service-verification", "remove"]);

function validate(payload) {
  if (!payload || Object.keys(payload).some((key) => !ALLOWED.has(key))) throw new Error("correction_field_not_allowlisted");
  if (!/^\d{10}$/.test(payload.npi || "")) throw new Error("correction_npi_invalid");
  if (!["authorized-representative", "consumer"].includes(payload.submitter_role)) throw new Error("correction_role_invalid");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email || "")) throw new Error("correction_email_invalid");
  if (!TYPES.has(payload.correction_type)) throw new Error("correction_type_invalid");
  const source = new URL(payload.source_url || "");
  if (source.protocol !== "https:") throw new Error("correction_source_invalid");
  if (String(payload.statement || "").length < 20 || String(payload.statement).length > 1000) throw new Error("correction_statement_invalid");
  if (payload.truthful_attestation !== true) throw new Error("correction_attestation_required");
  if (/patient|diagnos|medication history|date of birth/i.test(payload.statement)) throw new Error("correction_health_data_rejected");
  return { npi: payload.npi, submitter_role: payload.submitter_role, email: payload.email.trim().toLowerCase(), correction_type: payload.correction_type, source_url: source.toString(), statement: payload.statement.trim(), truthful_attestation: true };
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ status: "INVALID" }, { status: 415 });
  if (env.DIRECTORY_CORRECTIONS_MODE !== "local_test" || !env.DIRECTORY_CORRECTIONS?.prepare) return Response.json({ status: "CORRECTION_INTAKE_HELD" }, { status: 503 });
  let value;
  try { value = validate(await request.json()); } catch (error) { return Response.json({ status: "INVALID", reason: error.message }, { status: 422 }); }
  await env.DIRECTORY_CORRECTIONS.prepare("INSERT INTO directory_corrections (npi, submitter_role, email, correction_type, source_url, statement, truthful_attestation, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'held_manual_review', ?)").bind(value.npi, value.submitter_role, value.email, value.correction_type, value.source_url, value.statement, new Date().toISOString()).run();
  return Response.json({ status: "CAPTURED_HELD_MANUAL_REVIEW", published: false }, { status: 202 });
}

export async function onRequest() { return Response.json({ status: "METHOD_NOT_ALLOWED" }, { status: 405 }); }
