import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { projectGoOnlyPriceBasis, GO_PRICE_BASIS_SELECTION_SHA256 } from './go-price-basis.mjs';
import { relationshipDenials } from './affiliate-relationship-sync.mjs';
import { redirectorTermsAllowed } from "./go-redirector-authority.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// The selection receipt is a scoped commercial adoption, not bridge acceptance.
// Its hash also binds each risk-ledger row and the deployment's runtime gate.
export function loadGoSelection(root = DEFAULT_ROOT) {
  if (root instanceof URL) root = fileURLToPath(root);
  let bytes;
  try { bytes = readFileSync(path.join(root, "data/go-selection-receipt.json")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const selection = JSON.parse(bytes);
  const terms = JSON.parse(readFileSync(path.join(root, "data/go-terms-review-ledger.json")));
  if (selection.schema !== "glp-go-selection-v1" || selection.status !== "ADOPTED_CANDIDATE_NOT_RELEASE_ACCEPTANCE"
      || !Array.isArray(selection.programs) || selection.count !== selection.programs.length
      || new Set(selection.programs.map(p => p.program_id)).size !== selection.count
      || terms.schema !== "glp-go-terms-review-ledger-v1" || terms.selection_sha256 !== hash(bytes))
    throw new Error("go_selection_contract_invalid");
  const programs = {};
  for (const row of selection.programs) {
    if (row.disposition === "HOLD") { programs[row.program_id] = { ...row, status: "WITHHELD" }; continue; }
    const risk = terms.programs?.[row.program_id];
    const promotion = { ...row, status: "VERIFIED", operator_selection_receipt_sha256: hash(bytes),
      redirector_tos_verified: false, redirector_risk_acceptance: risk,
      tracking_link_sha256: hash(row.issued_link || "") };
    if (row.disposition !== "ADOPT" || !row.network || !row.render_id
        || row.route !== `/go/${row.render_id}`
        || !["promotion_authorized", "constructor_verified", "advertiser_permission_verified", "encoding_verified", "privacy_qa_passed"].every(key => row[key] === true)
        || !redirectorTermsAllowed({ ...promotion, tracking: { base_url: row.issued_link } }))
      throw new Error(`go_selection_row_invalid:${row.program_id}`);
    programs[row.program_id] = promotion;
  }
  return { selection_sha256: hash(bytes), selected_at: selection.at_utc, programs };
}

// Current exact-offer HOLD rows take precedence over historical blanket
// approvals. An issued link or old decision hash is not creative approval.
// Preserve the historical evidence; reconciliation belongs to its source owner.
export function loadGoPromotionAuthority(root = DEFAULT_ROOT) {
  if (root instanceof URL) root = fileURLToPath(root);
  let legacy = { programs: {} };
  try { legacy = JSON.parse(readFileSync(path.join(root, "data/go-runtime-promotion-authority.json"))); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const current = loadGoSelection(root);
  const programs = { ...legacy.programs, ...current?.programs };
  // Direct review-only successors are bound to retained approved publisher API
  // readbacks. A URL in the authority map alone never grants permission.
  for (const [id, row] of Object.entries(programs)) {
    if (row.direct_only !== true || row.status === 'WITHHELD') continue;
    const receipt = JSON.parse(readFileSync(path.join(root, 'data/review-tracking-receipts.json'))).programs?.[id];
    const api = receipt?.tracking_api_receipt;
    const campaign = receipt?.campaign;
    const href = api?.response?.['tracking-link'];
    const url = new URL(href);
    if (row.network !== 'MaxBounty' || campaign?.details?.affiliate_campaign_status !== 'Approved'
        || api?.status !== 200 || api?.publisher_id !== '803003' || api?.tracking_clicks !== 0
        || api?.response?.success !== true || href !== row.issued_link
        || hash(href) !== row.tracking_link_sha256 || url.protocol !== 'https:'
        || url.searchParams.get('o') !== String(campaign.campaign_id)
        || url.searchParams.get('a') !== api.publisher_id)
      throw new Error(`review_tracking_receipt_unbound:${id}`);
  }
  // The genuine 2026-10-01 operator decision retains the XenTraffic hold.
  // Apply it after historical selection/approval merging, without rewriting
  // either receipt or the frozen price basis. This is a denial, not a grant.
  // Policy belongs to this source tree even when callers supply fixture roots.
  const holdPath = 'data/OPERATOR-DECISION-20261001-all-pipelines-live.md';
  const holdSha256 = '147069fc66b2f66639321828e723dc2859d37a4b2c205f2239369724ab1b74ad';
  if (hash(readFileSync(path.join(DEFAULT_ROOT, holdPath))) !== holdSha256)
    throw new Error('go_current_hold_authority_invalid');
  for (const [id, row] of Object.entries(programs)) {
    if (![legacy.programs?.[id]?.network, current?.programs[id]?.network]
        .some(network => String(network || '').toLowerCase() === 'xentraffic')) continue;
    programs[id] = { ...row, status: 'WITHHELD', promotion_authorized: false,
      current_hold_decision: { path: holdPath, sha256: holdSha256 },
      reason: 'operator_current_xentraffic_hold' };
  }
  let registry;
  try { registry = JSON.parse(readFileSync(path.join(root, 'data/program-registry.json'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const denial of relationshipDenials(registry)) {
    const row = programs[denial.program_id] || {};
    programs[denial.program_id] = { ...row, status:'WITHHELD', promotion_authorized:false,
      reason:'sole_writer_relationship_' + denial.lifecycle,
      relationship_snapshot:denial };
  }
  return { ...legacy, ...(current ? { selection_sha256: current.selection_sha256 } : {}), programs };
}

export function applyGoSelectionToLinkMap(links, registry, surface, profileId, current, promotionAuthority = null) {
  if (!current) return links;
  for (const row of Object.values(current.programs)) {
    const program = registry.programs.find(p => p.program_id === row.program_id);
    const renderId = program?.review_slug || program?.program_id;
    if (!program || renderId !== row.render_id) throw new Error(`go_selection_registry_identity:${row.program_id}`);
    const profile = program.profiles?.[profileId];
    if (row.disposition === "HOLD") {
      links[renderId] = { program_id: renderId, merchant: program.display_name, review_path: program.review_path, affiliate_href: null, live: false };
      continue;
    }
    if (program.commercial_state !== "live" || profile?.vertical_fit !== true || profile.wired !== true || profile.surfaces?.[surface] !== true) continue;
    links[renderId] = { program_id: renderId, merchant: program.display_name, review_path: program.review_path,
      affiliate_href: row.issued_link, network: row.network, network_offer_id: row.network_offer_id, live: true,
      operator_selection_receipt_sha256: current.selection_sha256 };
  }
  return links;
}

// Preserve the frozen pricing basis while adopting ONLY the four receipted
// go-profile supersessions. The caller still verifies the original basis hash.
export function restoreGoOnlyPriceBasis(basis, root = DEFAULT_ROOT) {
  const current = loadGoSelection(root);
  if (!current) return basis;
  if (GO_PRICE_BASIS_SELECTION_SHA256 !== current.selection_sha256)
    throw new Error('go_price_basis_receipt_invalid');
  for (const id of ['awin-128761','katalys-1286','katalys-1304','katalys-647'])
    if (current.programs[id]?.status !== 'VERIFIED') throw new Error(`go_price_basis_authority_invalid:${id}`);
  return projectGoOnlyPriceBasis(basis);
}