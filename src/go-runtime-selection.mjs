import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { projectGoOnlyPriceBasis, GO_PRICE_BASIS_SELECTION_SHA256 } from './go-price-basis.mjs';
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
  return { selection_sha256: hash(bytes), programs };
}

export function loadGoPromotionAuthority(root = DEFAULT_ROOT) {
  if (root instanceof URL) root = fileURLToPath(root);
  let legacy = { programs: {} };
  try { legacy = JSON.parse(readFileSync(path.join(root, "data/go-runtime-promotion-authority.json"))); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const current = loadGoSelection(root);
  return { ...legacy, ...(current ? { selection_sha256: current.selection_sha256 } : {}),
    programs: { ...legacy.programs, ...current?.programs } };
}

export function applyGoSelectionToLinkMap(links, registry, surface, profileId, current) {
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
