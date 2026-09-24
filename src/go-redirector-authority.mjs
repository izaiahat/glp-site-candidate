// Shared producer/worker terms contract. Risk acceptance is not express consent.
const SHA256 = /^[a-f0-9]{64}$/;
export function validGoReceiptDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value || "")) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value && stamp <= Date.now();
}
export function validGoReceiptSource(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
export function redirectorTermsAllowed(program) {
  if (program.redirector_tos_verified === true) {
    return validGoReceiptSource(program.redirector_tos_source_url) && validGoReceiptDate(program.redirector_tos_verified_as_of);
  }
  const risk = program.redirector_risk_acceptance;
  return Boolean(
    program.redirector_tos_verified === false
    && risk?.schema === "go-redirector-risk-acceptance-v1"
    && risk.risk_accepted === true
    && risk.scope === "first-party-redirect-and-documented-subids"
    && risk.express_network_permission_proven === false
    && risk.program_id === program.program_id
    && risk.network === program.network
    && risk.tracking_base_url === program.tracking?.base_url
    && SHA256.test(risk.operator_decision_sha256 || "")
    && SHA256.test(risk.operator_selection_receipt_sha256 || "")
    && risk.operator_selection_receipt_sha256 === program.operator_selection_receipt_sha256
    && validGoReceiptDate(risk.accepted_as_of)
    && (validGoReceiptSource(risk.terms_source_url)
      || (typeof risk.terms_source_artifact === "string" && risk.terms_source_artifact.length > 0
        && SHA256.test(risk.terms_source_artifact_sha256 || "")))
    && typeof risk.limitation === "string" && risk.limitation.trim().length > 0
  );
}
