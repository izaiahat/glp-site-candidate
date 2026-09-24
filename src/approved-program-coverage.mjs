import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CANDIDATE_ID = "glp-approved53-ready6-brand-slug-successor-20260802-r3";
const CONTENT_FIT_HOLD_STATE = "content_fit_hold_non_glp_destination";
const CONTENT_FIT_BRIEF_STATE = "existing_page_editorial_retained_link_dark_content_fit_hold";
// 2026-08-18 content-fit LIFT. AFF-TRT-001 held TRT Nation link-dark because the
// only creative we had resolved to the testosterone vertical. Its own unblock
// condition was a verified GLP deep link, and one now exists and was clicked.
//
// The lift is a THIRD partition, not a promotion into the wired majority, because
// its evidence is different in kind: the frozen 2026-08-02 evidence snapshot still
// records the testosterone URL and is never rewritten, so a lifted program's URL
// cannot be checked against it. It is checked against a dated link-click QA
// receipt instead - and that receipt is the ONLY thing in this module that may
// turn click_qa_performed true.
const CONTENT_FIT_LIFTED_STATE = "content_fit_lifted_provider_issued";
const CONTENT_FIT_LIFT_BRIEF_STATE = "existing_page_editorial_content_fit_lifted_for_link_activation";
const CONTENT_FIT_LIFT_RULING = "BRIDGE-20260818-AFF-TRT-001-CONTENT-FIT-LIFT";
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const READY6_REGISTRY_IDS = new Set(["awin-128761", "katalys-1286", "katalys-647", "katalys-1304", "katalys-1516", "katalys-1518"]);
const READY6_REVIEW_PATHS = new Map([
  ["awin-128761", "/reviews/coivas/"],
  ["katalys-1286", "/reviews/sprout-health/"],
  ["katalys-647", "/reviews/mangorx/"],
  ["katalys-1304", "/reviews/direct-meds/"],
  ["katalys-1516", "/reviews/shed/"],
  ["katalys-1518", "/reviews/breezemeds/"],
]);
const NETWORK_SLUG = Object.freeze({
  Awin: "awin",
  "CJ Affiliate": "cj-affiliate",
  Katalys: "katalys",
  Partnerize: "partnerize",
});

function fail(code, detail = "") {
  throw new Error(detail ? `${code}:${detail}` : code);
}

// A registered DOWNWARD disposition only; never a generic held-state waiver.
// Pins match the installed completeness sensor. The frozen approved set and
// accepted brief remain historical evidence, not current promotion authority.
const NETWORK_PAUSED_STATE = "link_retired_network_program_paused";
const TELOS_HOLD = Object.freeze({
  path: "data/telos-research-hold-receipt.json",
  sha256: "f18426e9dea271a1c8ae5b234324ddbb57c3c524e61c1494dd8c281174c9c585",
  ackSha256: "3eabb6f43dbd2610f313eb1b1220e5aa5d59ae36426b5dd6e31e13db4d710b8e",
  rowSha256: "323acb673fb7628c50229fce9adddfa0a4ae0d30c66944e84d85103a6f0566e8",
  briefSha256: "6307dcc9cdf8f5ddbf64949bf9ff30b402a4576725b37731eec2537c03f6651b",
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const holdBindingMatches = (ref) => ref?.path === TELOS_HOLD.path && ref?.sha256 === TELOS_HOLD.sha256;

function validateReceiptedNetworkHold(program, brief, proof) {
  const require = (ok, code) => { if (!ok) fail(`approved_60_receipted_hold_${code}`, program.program_key); };
  require(program.program_key === "Katalys:1612" && program.registry_id === "katalys-1612"
    && program.network === "Katalys" && program.provider_program_id === "1612"
    && program.existing_release_alias === "telos-rx" && program.canonical_sheet_row === 93
    && program.routing_class === "held_network_program_paused", "identity_invalid");
  require(holdBindingMatches(program.research_hold_receipt), "binding_invalid");
  require(proof && typeof proof.receiptBytes === "string"
    && digest(proof.receiptBytes) === TELOS_HOLD.sha256, "receipt_hash_invalid");
  const receipt = JSON.parse(proof.receiptBytes);
  require(receipt.schema === "glp-receipted-research-hold-v1" && receipt.program_id === "telos-rx"
    && receipt.network === program.network && receipt.network_program_id === program.provider_program_id
    && receipt.sheet_row === 93 && receipt.sheet_seo_slug === "telos-rx-review"
    && receipt.disposition === "HOLD" && receipt.link_disposition === NETWORK_PAUSED_STATE
    && receipt.promotion_authorized === false && receipt.live_link_allowed === false
    && receipt.research_intake_authorized === false, "receipt_contract_invalid");
  for (const [field, bytes, hash] of [["operator_ack", proof.ackBytes, TELOS_HOLD.ackSha256],
    ["row_readback", proof.rowBytes, TELOS_HOLD.rowSha256]]) {
    require(receipt[field]?.sha256 === hash && typeof bytes === "string" && digest(bytes) === hash, `${field}_hash_invalid`);
  }
  const rows = JSON.parse(proof.rowBytes).rows.filter((row) => row.event?.sheet_row === receipt.sheet_row);
  const event = rows[0]?.event;
  require(rows.length === 1 && rows[0].approval_claim === false
    && event.network === receipt.network && event.seo_slug === receipt.sheet_seo_slug
    && event.row_fingerprint === receipt.row_readback.row_fingerprint
    && event.status === "paused_network_program_paused" && event.link_qa_status === NETWORK_PAUSED_STATE
    && event.wired_live === false && event.wire_in_ready === false, "row_invalid");
  require(program.tracking?.state === NETWORK_PAUSED_STATE && program.tracking.candidate_registry_wired === false
    && program.tracking.click_qa_performed === false && program.tracking.public_go_surface === false, "activation_present");
  // Preserve and authenticate the original accepted brief; it is not a new CTA
  // authorization. Its original tracking contract is checked separately below.
  require(typeof proof.briefBytes === "string" && digest(proof.briefBytes) === TELOS_HOLD.briefSha256
    && JSON.stringify(brief) === JSON.stringify(JSON.parse(proof.briefBytes)), "historical_brief_invalid");
  const registryRows = proof.siteRegistry?.programs || [];
  for (const [id, role] of [["telos-rx", "canonical"], ["telos-rx-review", "alias"]]) {
    const matches = registryRows.filter((row) => row.program_id === id);
    require(matches.length === 1, "registry_identity_invalid");
    const row = matches[0];
    const profile = row.profiles?.["glp-clinic-scout"];
    const identity = profile?.canonical_identity;
    // S9-7: the identity-only alias renders no review page, so it must declare no
    // review path at all (tighter than the previous blanket requirement); the
    // canonical editorial row still declares and renders its own.
    require(identity?.role === role && identity.canonical_program_id === "telos-rx"
      && identity.identity_key === "telosrx" && row.display_name === program.display_name
      && (role === "alias" ? !("review_path" in row) : row.review_path === `/reviews/${id}/`)
      && row.go?.route === `/go/${id}`, "alias_invalid");
    require(holdBindingMatches(row.research_hold_receipt), "registry_binding_invalid");
    require(row.commercial_state === "held" && profile?.wired === false && row.go?.entry_state === "held"
      && ["compare", "quiz", "calculator", "go"].every((key) => profile.surfaces?.[key] === false)
      && (role !== "alias" || Object.values(profile.surfaces).every((value) => value === false)), "registry_activation_present");
  }
}

function exactRegistryId(program) {
  return `${NETWORK_SLUG[program.network]}-${String(program.provider_program_id).toLowerCase()}`;
}

// The ONLY thing that may turn click_qa_performed true. A bare boolean is a claim;
// this demands the dated receipt behind it, the bridge ruling that authorised it,
// a 200 on the intended destination, and an attribution stamp - because a click
// that resolves but does not attribute is a click that never pays.
function validLinkClickQa(tracking) {
  const qa = tracking?.link_click_qa;
  return Boolean(
    qa
    && qa.authority === CONTENT_FIT_LIFT_RULING
    && typeof qa.receipt === "string" && qa.receipt.endsWith(".json")
    && SHA256.test(qa.receipt_sha256 || "")
    && ISO_DATE_TIME.test(qa.performed_at_utc || "")
    && qa.observed_final_status === 200
    && typeof qa.observed_final_url === "string" && qa.observed_final_url.startsWith("https://")
    && qa.attribution_stamp_present === true
    && typeof qa.cjevent === "string" && qa.cjevent.length > 0
    && qa.observed_final_url.includes(`cjevent=${qa.cjevent}`),
  );
}

function validateTracking(program, registry) {
  const tracking = program.tracking;
  if (!tracking || tracking.public_go_surface !== false) {
    fail("approved_60_tracking_safety_invalid", program.program_key);
  }
  // click_qa_performed defaults closed for all 53. It may be true only with a
  // receipt that checks out; a naked `true` still fails here.
  if (tracking.click_qa_performed !== false && !(tracking.click_qa_performed === true && validLinkClickQa(tracking))) {
    fail("approved_60_tracking_safety_invalid", program.program_key);
  }
  if (tracking.state === CONTENT_FIT_LIFTED_STATE) {
    if (
      tracking.candidate_registry_wired !== true
      || tracking.click_qa_performed !== true
      || !SHA256.test(tracking.superseded_evidence_snapshot_url_sha256 || "")
      || typeof tracking.superseded_content_fit_blocker !== "string"
      || !/testosterone/i.test(tracking.superseded_content_fit_blocker)
      || typeof tracking.source_ref !== "string"
      || !tracking.source_ref.startsWith(tracking.link_click_qa.receipt)
    ) fail("approved_60_content_fit_lift_state_invalid", program.program_key);
    let liftedUrl;
    try {
      liftedUrl = new URL(tracking.provider_issued_url);
    } catch {
      fail("approved_60_tracking_url_invalid", program.program_key);
    }
    const allowedLifted = registry.allowed_provider_tracking_hosts?.[program.network] || [];
    if (
      liftedUrl.protocol !== "https:"
      || !allowedLifted.includes(liftedUrl.hostname)
      || liftedUrl.hostname !== tracking.tracking_host
    ) fail("approved_60_tracking_url_not_provider_issued", program.program_key);
    return CONTENT_FIT_LIFTED_STATE;
  }
  if (tracking.provider_issued_url === null) {
    const contentFitHeld = (
      tracking.state === CONTENT_FIT_HOLD_STATE
      && tracking.candidate_registry_wired === false
      && tracking.tracking_host === null
      && typeof tracking.source_ref === "string"
      && tracking.source_ref.startsWith("data/approved-program-evidence-snapshot.json#/")
      && SHA256.test(tracking.evidence_only_provider_issued_url_sha256 || "")
      && typeof tracking.content_fit_blocker === "string"
      && /testosterone replacement/i.test(tracking.content_fit_blocker)
    );
    if (contentFitHeld) return CONTENT_FIT_HOLD_STATE;
    if (
      tracking.state !== "unwired_missing_provider_issued_url"
      || tracking.candidate_registry_wired !== false
      || tracking.tracking_host !== null
      || typeof tracking.source_ref !== "string"
      || !tracking.source_ref
    ) fail("approved_60_unwired_state_invalid", program.program_key);
    return false;
  }
  if (
    tracking.state !== "candidate_registry_wired_provider_issued"
    || tracking.candidate_registry_wired !== true
    || typeof tracking.source_ref !== "string"
    || !tracking.source_ref
  ) fail("approved_60_wired_state_invalid", program.program_key);
  let parsed;
  try {
    parsed = new URL(tracking.provider_issued_url);
  } catch {
    fail("approved_60_tracking_url_invalid", program.program_key);
  }
  const allowed = registry.allowed_provider_tracking_hosts?.[program.network] || [];
  if (parsed.protocol !== "https:" || !allowed.includes(parsed.hostname) || parsed.hostname !== tracking.tracking_host) {
    fail("approved_60_tracking_url_not_provider_issued", program.program_key);
  }
  return true;
}

function validateBrief(program, brief, candidateId, readyContractSha256) {
  if (!brief || brief.schema !== "approved-program-review-brief-scaffold-v1") {
    fail("approved_60_review_brief_missing", program.registry_id);
  }
  if (
    brief.registry_id !== program.registry_id
    || brief.candidate_id !== candidateId
    || brief.program_key !== program.program_key
    || brief.exact_identity?.network !== program.network
    || String(brief.exact_identity?.provider_program_id) !== String(program.provider_program_id)
    || brief.exact_identity?.display_name !== program.display_name
    || brief.proposed_review_path !== (READY6_REVIEW_PATHS.get(program.registry_id) || `/reviews/${program.registry_id}/`)
  ) fail("approved_60_review_brief_identity_mismatch", program.registry_id);
  const contentFitHeld = (
    program.tracking?.state === CONTENT_FIT_HOLD_STATE
    && brief.editorial?.state === CONTENT_FIT_BRIEF_STATE
    && Array.isArray(brief.editorial?.approved_claims)
    && brief.editorial.approved_claims.length > 0
    && brief.cta?.enabled === false
    && brief.cta?.evidence_only_provider_issued_url_present === true
    && brief.cta?.public_go_surface === false
    && brief.cta?.public_affiliate_surface === false
    && brief.coverage_gate?.bridge_review_state === "CONTENT_FIT_REPAIR_CONTRACT_20260808"
    && brief.coverage_gate?.editorial_approval_state === "ACCEPTED_EXISTING_SOURCE_CITED_PAGE_LINK_DARK"
    && brief.coverage_gate?.publication_state === "READY_EDITORIAL_LINK_DARK"
    && brief.coverage_gate?.deployment_authority === false
    && brief.activated_existing_review_path === `/reviews/${program.existing_release_alias}/`
  );
  const pending = (
    brief.editorial?.state === "scaffold_pending_evidence_review"
    && Array.isArray(brief.editorial?.approved_claims)
    && brief.editorial.approved_claims.length === 0
    && brief.cta?.enabled === false
    && brief.cta?.public_go_surface === false
    && brief.coverage_gate?.bridge_review_state === "PENDING"
    && brief.coverage_gate?.editorial_approval_state === "PENDING"
    && brief.coverage_gate?.publication_state === "BLOCKED"
    && brief.coverage_gate?.deployment_authority === false
  );
  const accepted = (
    brief.editorial?.state === "existing_page_editorial_accepted_for_link_activation"
    && Array.isArray(brief.editorial?.approved_claims)
    && brief.editorial.approved_claims.length > 0
    && brief.cta?.enabled === true
    && brief.cta?.public_go_surface === true
    && brief.cta?.public_affiliate_surface === true
    && brief.coverage_gate?.bridge_review_state === "ACCEPTED_20260802_STANDING_BUILD_ORDER"
    && brief.coverage_gate?.editorial_approval_state === "ACCEPTED_EXISTING_SOURCE_CITED_PAGE_CONTENT_UNCHANGED"
    && brief.coverage_gate?.publication_state === "READY_INCREMENTAL_EXISTING_PAGE_ACTIVATION"
    && brief.coverage_gate?.deployment_authority === true
    && brief.activated_existing_review_path === `/reviews/${program.existing_release_alias}/`
  );
  const contentFitLifted = (
    program.tracking?.state === CONTENT_FIT_LIFTED_STATE
    && brief.editorial?.state === CONTENT_FIT_LIFT_BRIEF_STATE
    && Array.isArray(brief.editorial?.approved_claims)
    && brief.editorial.approved_claims.length > 0
    && brief.cta?.enabled === true
    && brief.cta?.provider_issued_url_present === true
    && brief.cta?.evidence_only_provider_issued_url_present === false
    && brief.cta?.public_go_surface === true
    && brief.cta?.public_affiliate_surface === true
    && brief.cta?.link_click_qa_performed === true
    && brief.cta?.link_click_qa_receipt === program.tracking.link_click_qa?.receipt
    && brief.coverage_gate?.bridge_review_state === CONTENT_FIT_LIFT_RULING
    && brief.coverage_gate?.editorial_approval_state === "ACCEPTED_EXISTING_SOURCE_CITED_PAGE_CONTENT_UNCHANGED"
    && brief.coverage_gate?.publication_state === "READY_INCREMENTAL_EXISTING_PAGE_ACTIVATION"
    && brief.coverage_gate?.deployment_authority === true
    && brief.activated_existing_review_path === `/reviews/${program.existing_release_alias}/`
  );
  const readyForProductionReview = (
    READY6_REGISTRY_IDS.has(program.registry_id)
    && brief.editorial?.state === "ready6_production_review_indexable_source_cited_candidate"
    && Array.isArray(brief.editorial?.approved_claims)
    && brief.editorial.approved_claims.length === 0
    && Array.isArray(brief.editorial?.evidence_bound_claims)
    && brief.editorial.evidence_bound_claims.length >= 3
    && brief.editorial.source_contract_sha256 === readyContractSha256
    && brief.cta?.enabled === true
    && brief.cta?.candidate_local_transparent_direct === true
    && brief.cta?.public_go_surface === false
    && brief.cta?.public_affiliate_surface === false
    && brief.coverage_gate?.bridge_review_state === "PENDING"
    && brief.coverage_gate?.editorial_approval_state === "READY_EDITORIAL_PRODUCTION_REVIEW"
    && brief.coverage_gate?.publication_state === "INDEXABLE_CANDIDATE_PENDING_BRIDGE_NO_DEPLOYMENT"
    && brief.coverage_gate?.deployment_authority === false
    && brief.coverage_gate?.indexable === true
    && brief.coverage_gate?.sitemap_included === true
  );
  if (
    (!pending && !accepted && !readyForProductionReview && !contentFitHeld && !contentFitLifted)
    // link_click_qa_performed stays false for 52 of 53. The lifted partition is
    // the single exception, and only because a real receipted click exists.
    || brief.cta?.link_click_qa_performed !== contentFitLifted
    || brief.coverage_gate?.scaffold_complete !== true
  ) fail("approved_60_review_brief_gate_invalid", program.registry_id);
  const wired = program.tracking.candidate_registry_wired;
  let trackingMatches;
  if (contentFitHeld) {
    trackingMatches = brief.cta.provider_issued_url_present === false
      && brief.cta.tracking_registry_state === CONTENT_FIT_HOLD_STATE
      && brief.coverage_gate.tracking_gate_state === "HOLD_CONTENT_FIT_NON_GLP_DESTINATION";
  } else if (contentFitLifted) {
    trackingMatches = brief.cta.tracking_registry_state === CONTENT_FIT_LIFTED_STATE
      && brief.coverage_gate.tracking_gate_state === "PASS_PROVIDER_ISSUED_QA_VERIFIED";
  } else {
    trackingMatches = brief.cta.provider_issued_url_present === wired
      && brief.cta.tracking_registry_state === program.tracking.state
      && brief.coverage_gate.tracking_gate_state === ((accepted || readyForProductionReview) ? "PASS_PROVIDER_ISSUED_NONCLICK_VERIFIED" : "READY_FOR_NONCLICK_REVIEW");
  }
  if (!trackingMatches) fail("approved_60_review_brief_tracking_mismatch", program.registry_id);
  if (contentFitLifted) return "content_fit_lifted";
  return contentFitHeld ? "content_fit_held" : accepted ? "accepted_existing4" : readyForProductionReview ? "ready6_production_review" : "scaffold_pending";
}

export function validateApprovedProgramCoverage({ registry, briefs, evidenceSnapshot, sourceHashResults, readyContractSha256, networkHoldProof }) {
  if (
    registry?.schema !== "approved-program-successor-registry-v1"
    || registry.candidate_id !== CANDIDATE_ID
    || registry.expected_program_count !== 53
    || !Array.isArray(registry.programs)
    || registry.programs.length !== 53
  ) fail("approved_60_registry_shape_invalid");
  const policy = registry.publication_policy || {};
  if (
    policy.auto_generate_public_pages !== false
    || policy.auto_publish !== false
    || policy.auto_deploy !== false
    || policy.provider_issued_tracking_urls_only !== true
    || policy.all_review_briefs_require_bridge_acceptance !== true
    || policy.missing_tracking_url_disposition !== "none_in_exact_provider_approved_set"
  ) fail("approved_60_publication_policy_invalid");
  const sourceEntries = Object.values(registry.source_manifest || {});
  if (sourceEntries.length !== 6 || sourceEntries.some((source) => !source.path || !SHA256.test(source.sha256 || "") || !source.role)) {
    fail("approved_60_source_manifest_invalid");
  }
  if (
    evidenceSnapshot?.schema !== "approved-program-evidence-snapshot-v1"
    || evidenceSnapshot.candidate_id !== registry.candidate_id
    || evidenceSnapshot.reconciled_counts?.approved_programs_total !== 53
    || !Array.isArray(evidenceSnapshot.program_keys)
    || evidenceSnapshot.program_keys.length !== 53
    || new Set(evidenceSnapshot.program_keys).size !== 53
    || Object.keys(evidenceSnapshot.tracking_by_program || {}).length !== 53
    || Object.values(evidenceSnapshot.effects || {}).some((value) => value !== 0)
    || JSON.stringify(evidenceSnapshot.source_manifest) !== JSON.stringify(registry.source_manifest)
  ) fail("approved_60_evidence_snapshot_invalid");
  const registryKeys = registry.programs.map((program) => program.program_key);
  if (JSON.stringify(registryKeys) !== JSON.stringify(evidenceSnapshot.program_keys)) {
    fail("approved_60_exact_set_mismatch");
  }
  for (const [sourceId, source] of Object.entries(registry.source_manifest)) {
    if (sourceHashResults?.[sourceId] !== source.sha256) {
      fail("approved_60_source_hash_mismatch", sourceId);
    }
  }

  const ids = new Set();
  const keys = new Set();
  const counts = Object.fromEntries(Object.keys(registry.expected_provider_counts || {}).map((network) => [network, 0]));
  let wired = 0;
  let networkPaused = 0;
  let contentFitHeld = 0;
  let contentFitLifted = 0;
  let accepted = 0;
  let readyForProductionReview = 0;
  for (const program of registry.programs) {
    if (!NETWORK_SLUG[program.network]) fail("approved_60_network_invalid", program.network || "missing");
    if (
      !ID.test(program.registry_id || "")
      || program.registry_id !== exactRegistryId(program)
      || program.program_key !== `${program.network}:${program.provider_program_id}`
      || ids.has(program.registry_id)
      || keys.has(program.program_key)
      || !program.display_name
      || !Array.isArray(program.source_refs)
      || program.source_refs.length === 0
    ) fail("approved_60_exact_identity_invalid", program.program_key || "missing");
    ids.add(program.registry_id);
    keys.add(program.program_key);
    counts[program.network] = (counts[program.network] || 0) + 1;
    const capturedTracking = evidenceSnapshot.tracking_by_program[program.program_key];
    const networkHeld = Boolean(program.research_hold_receipt || program.tracking?.state === NETWORK_PAUSED_STATE
      || (networkHoldProof && program.program_key === "Katalys:1612"));
    let evidenceProgram = program;
    if (networkHeld) {
      validateReceiptedNetworkHold(program, briefs.get(program.registry_id), networkHoldProof);
      // The issued URL/source remain byte-identical. Only the disposition is
      // superseded. Validate the preserved historical state with the original
      // host, safety, brief and frozen-evidence checks; never mutate inputs.
      if (capturedTracking?.state !== "candidate_registry_wired_provider_issued"
        || typeof capturedTracking.provider_issued_url !== "string"
        || digest(capturedTracking.provider_issued_url) !== "28b51e94b148f2d958a6fe9f972a030d2c6dfc230c501b0504034ae619029511"
        || capturedTracking.source_ref !== "core#/programs/program_key=Katalys:1612/canonical_sheet/full_affiliate_link") {
        fail("approved_60_receipted_hold_evidence_invalid", program.program_key);
      }
      evidenceProgram = { ...program, tracking: { ...program.tracking,
        state: capturedTracking.state, candidate_registry_wired: true } };
      networkPaused += 1;
    }
    const trackingState = validateTracking(evidenceProgram, registry);
    if (trackingState === CONTENT_FIT_HOLD_STATE) {
      const capturedUrlHash = typeof capturedTracking?.provider_issued_url === "string"
        ? createHash("sha256").update(capturedTracking.provider_issued_url).digest("hex")
        : null;
      if (capturedUrlHash !== program.tracking.evidence_only_provider_issued_url_sha256) {
        fail("approved_60_content_fit_hold_evidence_mismatch", program.program_key);
      }
      contentFitHeld += 1;
    } else if (trackingState === CONTENT_FIT_LIFTED_STATE) {
      // The frozen snapshot is NOT rewritten to match the new link. It still
      // records the testosterone URL that was captured on 2026-08-02, and the
      // lifted row has to name that exact hash as the thing it superseded. That
      // is what stops a lift from quietly erasing the incident it resolved.
      const capturedUrlHash = typeof capturedTracking?.provider_issued_url === "string"
        ? createHash("sha256").update(capturedTracking.provider_issued_url).digest("hex")
        : null;
      if (capturedUrlHash !== program.tracking.superseded_evidence_snapshot_url_sha256) {
        fail("approved_60_content_fit_lift_evidence_mismatch", program.program_key);
      }
      if (capturedTracking?.provider_issued_url === program.tracking.provider_issued_url) {
        fail("approved_60_content_fit_lift_supersedes_nothing", program.program_key);
      }
      contentFitLifted += 1;
    } else {
      if (
        !capturedTracking
        || capturedTracking.provider_issued_url !== program.tracking?.provider_issued_url
        || capturedTracking.state !== evidenceProgram.tracking?.state
        || capturedTracking.source_ref !== program.tracking?.source_ref
      ) fail("approved_60_tracking_evidence_mismatch", program.program_key);
      if (trackingState === true && !networkHeld) wired += 1;
    }
    const briefState = validateBrief(evidenceProgram, briefs.get(program.registry_id), registry.candidate_id, readyContractSha256);
    if (briefState === "accepted_existing4") accepted += 1;
    if (briefState === "content_fit_held") {
      if (trackingState !== CONTENT_FIT_HOLD_STATE) fail("approved_60_content_fit_hold_authority_mismatch", program.program_key);
    }
    if (briefState === "content_fit_lifted") {
      if (trackingState !== CONTENT_FIT_LIFTED_STATE) fail("approved_60_content_fit_lift_authority_mismatch", program.program_key);
    } else if (trackingState === CONTENT_FIT_LIFTED_STATE) {
      // A lifted tracking row without a lifted brief would publish a live link
      // whose editorial acceptance nobody recorded. Fail both directions.
      fail("approved_60_content_fit_lift_authority_mismatch", program.program_key);
    }
    if (briefState === "ready6_production_review") readyForProductionReview += 1;
  }
  if (briefs.size !== 53) fail("approved_60_review_brief_bijection_invalid", String(briefs.size));
  for (const id of briefs.keys()) if (!ids.has(id)) fail("approved_60_unregistered_review_brief", id);
  for (const [network, expected] of Object.entries(registry.expected_provider_counts)) {
    if (counts[network] !== expected) fail("approved_60_provider_count_invalid", `${network}:${counts[network]}:${expected}`);
  }
  const unwired = 53 - wired - contentFitHeld - contentFitLifted - networkPaused;
  // 2026-08-18: was `wired !== 52 || contentFitHeld !== 1`. The 52 is deliberately
  // unchanged - TRT Nation did not join the frozen-snapshot-wired majority, it moved
  // from held(1) to lifted(1), so the delta is explicit rather than absorbed.
  if (wired !== 52 - networkPaused || networkPaused > 1 || contentFitHeld !== 0 || contentFitLifted !== 1 || unwired !== 0) {
    fail("approved_60_tracking_count_invalid", `${wired}:${contentFitHeld}:${contentFitLifted}:${unwired}`);
  }
  if (accepted !== 3 || readyForProductionReview !== 6) fail("approved_60_activation_partition_invalid", `${accepted}:${contentFitHeld}:${contentFitLifted}:${readyForProductionReview}`);
  const scaffoldPending = 53 - accepted - contentFitHeld - contentFitLifted - readyForProductionReview;
  // A lifted program carries its own recorded bridge acceptance, so it is no
  // longer pending bridge review or editorial approval.
  const bridgePending = 53 - accepted - contentFitLifted;
  const editorialApprovalPending = 53 - accepted - contentFitHeld - contentFitLifted;
  return {
    status: "PASS_SCAFFOLD",
    candidate_id: registry.candidate_id,
    approved_programs: 53,
    exact_program_keys: keys.size,
    provider_counts: counts,
    candidate_registry_wired: wired,
    receipted_network_program_paused: networkPaused,
    approved_denominator_semantics: "Frozen provider-approved evidence set; not current live approval or promotion authority",
    existing4_partition_semantics: "Historical accepted editorial cohort; receipted network holds supersede commercial activation",
    content_fit_held_non_glp_destination: contentFitHeld,
    content_fit_lifted_provider_issued: contentFitLifted,
    unwired_missing_provider_issued_url: unwired,
    review_briefs: briefs.size,
    bridge_review_pending: bridgePending,
    editorial_approval_pending: editorialApprovalPending,
    ready6_production_review_indexable: readyForProductionReview,
    scaffold_pending_evidence_review: scaffoldPending,
    existing4_active_unchanged: accepted,
    existing4_editorial_link_dark_content_fit_hold: contentFitHeld,
    existing4_content_fit_lifted_qa_verified: contentFitLifted,
    public_go_surfaces_added: accepted + contentFitLifted - networkPaused,
    candidate_local_transparent_direct_ctas: readyForProductionReview,
    coverage_gate: {
      status: bridgePending === 0 ? "PASS" : "BLOCKED",
      reasons: bridgePending === 0 ? [] : [
        ...(networkPaused ? [`${networkPaused} receipted network-paused program remains link-dark; no research intake or promotion authorized`] : []),
        contentFitHeld
          ? `${contentFitHeld} existing source-cited page is editorially retained but commercial-link held for content fit`
          : `${contentFitLifted} existing source-cited page had its content-fit hold lifted against a receipted link-click QA`,
        `${readyForProductionReview} source-cited indexable candidates are ready for production review and ${scaffoldPending} briefs still require evidence review`,
        "full approved-program successor remains non-deployed while partial accepted routes are independently releasable",
      ],
    },
    external_effects: {
      provider_calls: 0,
      provider_writes: 0,
      sheet_calls: 0,
      sheet_writes: 0,
      tracking_clicks: 0,
      deployments: 0,
      ads_mutations: 0,
      spend_usd: 0,
    },
  };
}

export function assertApprovedProgramsPublishable(result) {
  if (result?.coverage_gate?.status !== "PASS") {
    fail("approved_60_publication_gate_blocked", `${result?.unwired_missing_provider_issued_url ?? "unknown"}:${result?.bridge_review_pending ?? "unknown"}`);
  }
  return result;
}

export async function loadApprovedProgramCoverage(root) {
  const resolved = root instanceof URL ? fileURLToPath(root) : path.resolve(root);
  const registry = JSON.parse(await readFile(path.join(resolved, "data", "approved-program-registry.json"), "utf8"));
  const evidenceSnapshot = JSON.parse(await readFile(path.join(resolved, "data", "approved-program-evidence-snapshot.json"), "utf8"));
  const readyContractSha256 = createHash("sha256").update(await readFile(path.join(resolved, "data", "ready6-editorial-contract.json"))).digest("hex");
  const briefDir = path.join(resolved, "data", "review-briefs");
  const files = (await readdir(briefDir)).filter((name) => name.endsWith(".json")).sort();
  const briefs = new Map();
  for (const name of files) {
    const brief = JSON.parse(await readFile(path.join(briefDir, name), "utf8"));
    briefs.set(name.slice(0, -5), brief);
  }
  const sourceHashResults = {};
  for (const [sourceId, source] of Object.entries(registry.source_manifest || {})) {
    sourceHashResults[sourceId] = createHash("sha256").update(await readFile(source.path)).digest("hex");
  }
  // Optional on historical candidates. A present immutable receipt or current
  // held row is never inferred from absence of activation booleans.
  let networkHoldProof;
  let receiptBytes;
  try { receiptBytes = await readFile(path.join(resolved, TELOS_HOLD.path), "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (receiptBytes !== undefined) {
    if (digest(receiptBytes) !== TELOS_HOLD.sha256) fail("approved_60_receipted_hold_receipt_hash_invalid", "Katalys:1612");
    const receipt = JSON.parse(receiptBytes);
    networkHoldProof = {
      receiptBytes,
      ackBytes: await readFile(receipt.operator_ack.path, "utf8"),
      rowBytes: await readFile(receipt.row_readback.path, "utf8"),
      briefBytes: await readFile(path.join(briefDir, "katalys-1612.json"), "utf8"),
      siteRegistry: JSON.parse(await readFile(path.join(resolved, "data/program-registry.json"), "utf8")),
    };
  }
  return { registry, briefs, evidenceSnapshot, sourceHashResults, readyContractSha256, networkHoldProof };
}
