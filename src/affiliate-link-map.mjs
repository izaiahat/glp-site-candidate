import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadProviderPageContracts } from "./provider-cta-contract.mjs";
import { loadGoSelection, applyGoSelectionToLinkMap } from "./go-runtime-selection.mjs";

const TRACKING_HOST_BY_NETWORK = Object.freeze({
  Awin: "www.awin1.com",
  Katalys: "track.revoffers.com",
});

const cache = new Map();
const SHA256 = /^[a-f0-9]{64}$/;

function authorizedSelectionMap(selection) {
  if (selection?.schema !== "glp-affiliate-sheet-derived-selection-v1" || selection.status !== "APPROVED_FOR_TRANSPARENT_DIRECT_BUILD" || selection.go_route_program_count !== 0 || !SHA256.test(selection.operator_gate_receipt_sha256 || "") || !Array.isArray(selection.programs) || selection.program_count !== selection.programs.length) return null;
  const rows = new Map();
  for (const program of selection.programs) {
    const allowedHost = TRACKING_HOST_BY_NETWORK[program.network];
    if (!program.program_id || rows.has(program.program_id) || program.link_mode !== "transparent_direct" || program.sheet_status !== "approved_active_tracking_ready" || program.tracking_host !== allowedHost || !SHA256.test(program.tracking_link_sha256 || "")) return null;
    rows.set(program.program_id, program);
  }
  return rows;
}

function linkDarkRecord(programId, displayName = programId, reviewPath = `/reviews/${programId}/`) {
  return {
    program_id: programId,
    merchant: displayName,
    review_path: reviewPath,
    affiliate_href: null,
    live: false,
  };
}

// 2026-08-06 surface unification. The Katalys Sheet selection was the ONLY
// authority here, so only its 13 programs could ever carry a live link. Every
// other live provider rendered a review link on the quiz and the calculator - a
// second tier, one layer down from the one on the comparison page.
//
// Two more authorities join it, each proving the SAME thing the Sheet hash
// proves: that the href on the row is byte-for-byte the href in the artifact that
// approved it. A fast-path program is bound to its own contract's tracking_url; a
// READY6 program to its provider-issued url in the approved-program registry.
// Anything that does not match exactly still goes link-dark, and one poisoned
// program still takes only itself down.
const AWIN_ITEM1_SURFACE_MATRIX = Object.freeze({
  "53271": Object.freeze({ alias: "drhouse", existing: ["compare", "cost", "quiz"], expansion: ["calculator"] }),
  // 2026-08-27: "80963" (ShedRX on Awin) removed. ShedRX now lives on the Katalys
  // rail at $410 (best-terms 2026-08-26 deploy) and the Awin sibling is a retired
  // separate-rail row per the cross-marketplace rule — aliasing it onto "shedrx"
  // made one program claim two hrefs and poisoned it to link-dark (#117).
  "115383": Object.freeze({ alias: "biltrx", existing: ["compare", "cost", "quiz"], expansion: ["calculator"] }),
  // 2026-08-13 the operator rejected advertiser 126727. On 2026-08-31 he
  // rescinded that in his own words ("i never denied measured ... i want it
  // wired in fully live on the site"), with the indemnity trigger carried as a
  // recorded risk-acceptance on the row. Measured is therefore LIVE on its
  // three existing surfaces through a DIRECT CTA; surfaces.go stays false, so
  // no /go/measured redirect is minted. The validation below pins that row.
  "126727": Object.freeze({ alias: "measured", existing: ["compare", "cost", "quiz"], expansion: [] }),
  "128203": Object.freeze({ alias: "serena-health", existing: ["compare", "cost", "quiz", "calculator"], expansion: [] }),
  "128761": Object.freeze({ alias: "coivas", existing: ["compare", "cost", "quiz"], expansion: ["calculator"] }),
});

const REJECTED_TERMS_DISPOSITION = "de_link_all_surfaces_operator_rejected_terms";

function awinItem1SurfaceAuthority(wireInApprovals) {
  const reassessment = wireInApprovals?.current_terms_reassessment;
  if (wireInApprovals?.schema !== "glp-affiliate-wire-in-approvals-v1"
      // The 2026-08-31 operator rescission renamed this scope marker. Demanding
      // only the pre-rescission literal blanked the whole authority.
      || !["accepted_live_preserved_rejected_terms_de_linked",
           "accepted_live_preserved_rejected_terms_rescinded_20260831"]
           .includes(String(reassessment?.governance_scope || ""))
      || reassessment?.evidence_sha256 !== "7eb6660110af1b7f64149036217723c1095398b9d2016dfb7da32135dfc6ae73"
      || !Array.isArray(reassessment.programs) || reassessment.programs.length !== 6) return null;
  const rows = new Map(reassessment.programs.map((row) => [String(row.provider_program_id), row]));
  if (rows.size !== 6 || [...Object.keys(AWIN_ITEM1_SURFACE_MATRIX)].some((id) => !rows.has(id))) return null;
  // A row that fails its own pinned expectations is de-authorized BY ITSELF -
  // "one poisoned program still takes only itself down", as the header promises.
  // Nulling the whole authority is what took every Awin program dark on
  // 2026-09-03 when the Measured rescission landed: four healthy programs
  // (serena-health, coivas, drhouse, biltrx) lost their links over one row.
  const poisoned = new Set();
  for (const [id, expected] of Object.entries(AWIN_ITEM1_SURFACE_MATRIX)) {
    const row = rows.get(id);
    const rejected = row.verdict === "operator_rejected_terms";
    // A rejected-terms program may not carry ANY authorized surface, in the
    // pinned matrix or in the data row - a stale surface list poisons that
    // program rather than reviving a rejected link.
    if (rejected && (expected.existing.length || expected.expansion.length
        || row.existing_live_surfaces.length || row.authorized_material_expansion_surfaces.length)) {
      poisoned.add(id);
      continue;
    }
    if (row.existing_release_alias !== expected.alias
        || row.live_link_disposition !== (rejected ? REJECTED_TERMS_DISPOSITION : "preserve_existing_live")
        || row.may_authorize_new_activation !== false
        || row.may_authorize_material_expansion !== (expected.expansion.length > 0)
        || JSON.stringify(row.existing_live_surfaces) !== JSON.stringify(expected.existing)
        || JSON.stringify(row.authorized_material_expansion_surfaces) !== JSON.stringify(expected.expansion)) poisoned.add(id);
  }
  const accepted = new Map([
    ["80963", Object.freeze({ words: "ACCEPT-TERMS 80963", receipt: "febcdea976a2f28813a347552486420f6468f338a74a4551890210e348ebe17b" })],
    ["115383", Object.freeze({ words: "ACCEPT-TERMS 115383", receipt: "6c9e8f2c782a71fefeecc20ad7c7deca873587b70bbf4745126139010c32b281" })],
  ]);
  for (const [id, decision] of accepted) {
    const row = rows.get(id);
    if (row.status !== "operator_accepted_terms" || row.verdict !== "operator_accepted_terms"
        || row.future_change_terms_gate_open !== true || row.operator_words !== decision.words
        || row.provenance !== "discord-message-1537243566156546078"
        || row.reversible_by !== `REJECT-TERMS ${id}`
        || row.decision_receipt_sha256 !== decision.receipt) poisoned.add(id);
  }
  // 126727: the 2026-08-31 rescission supersedes the 2026-08-12 rejection. The
  // recorded risk-acceptance for the indemnity trigger is part of the pin, so a
  // row that goes live WITHOUT it still poisons itself.
  const measured = rows.get("126727");
  if (measured.status !== "operator_accepted_terms" || measured.verdict !== "operator_accepted_terms"
      || measured.future_change_terms_gate_open !== true
      || measured.rescission_note !== "MEASURED_TERMS_RESCISSION_V1"
      || measured.provenance !== "operator-decision-supersession-20260831"
      || measured.reversible_by !== "ACCEPT-TERMS 126727"
      || measured.decision_receipt_sha256 !== "743efb19f484f5cebd74b5894b9321ff3e97ac4a0d15e0b54214b68f68c8e51d"
      || measured.risk_acceptance?.risk_accepted !== true
      || measured.risk_acceptance?.mechanical_trigger !== "advertiser_supplied_copy_indemnity") poisoned.add("126727");
  for (const id of poisoned) rows.delete(id);
  return rows;
}

function awinItem1SurfaceAllowed(authority, advertiserId, surface) {
  const expected = AWIN_ITEM1_SURFACE_MATRIX[String(advertiserId)];
  if (!expected) return true;
  if (!authority) return false;
  const row = authority.get(String(advertiserId));
  // De-authorized (poisoned) programs are absent from the map: link-dark.
  if (!row) return false;
  return row.existing_live_surfaces.includes(surface)
    || row.authorized_material_expansion_surfaces.includes(surface);
}

function contractAuthorityMap(contracts, fastpath, approvedRegistry, slugByRegistryId, surface, wireInApprovals) {
  const rows = new Map();
  const item1Authority = awinItem1SurfaceAuthority(wireInApprovals);
  const activeIds = new Set((fastpath?.providers || [])
    .filter((provider) => provider.affiliate_cta_state === "ACTIVE_PROVIDER_ISSUED_DIRECT"
      && provider.route_state === "LIVE_EDITORIAL_AFFILIATE_ACTIVE")
    .map((provider) => provider.program_id));
  for (const contract of contracts?.providers || []) {
    const network = contract.network_contract || {};
    if (!activeIds.has(contract.program_id) || network.activation_blocker !== null) continue;
    if (contract.row_contract?.promotion_authorized !== true || typeof network.tracking_url !== "string") continue;
    const advertiserId = String(network.immutable_offer_id || network.immutable_advertiser_id || network.advertiser_id || "");
    if (!awinItem1SurfaceAllowed(item1Authority, advertiserId, surface)) continue;
    try {
      rows.set(contract.program_id, {
        network: network.network,
        ...(network.provider_offer_id ? { network_offer_id: network.provider_offer_id } : {}),
        tracking_host: new URL(network.tracking_url).hostname,
        expected_href: network.tracking_url,
      });
    } catch { /* an unparseable approval url authorizes nothing */ }
  }
  for (const program of approvedRegistry?.programs || []) {
    const tracking = program.tracking || {};
    const allowed = approvedRegistry.allowed_provider_tracking_hosts?.[program.network] || [];
    if (tracking.candidate_registry_wired !== true || !allowed.includes(tracking.tracking_host)) continue;
    // The approved-program registry keys by network id and does NOT carry the
    // render route; the site registry is what maps a network id to its slug.
    const slug = slugByRegistryId.get(program.registry_id);
    if (!slug || !tracking.provider_issued_url) continue;
    if (!awinItem1SurfaceAllowed(item1Authority, program.provider_program_id, surface)) continue;
    rows.set(slug, {
      network: program.network,
      tracking_host: tracking.tracking_host,
      expected_href: tracking.provider_issued_url,
    });
  }
  return rows;
}

export function buildAffiliateLinkMap(pages, registry, selection, surface, profileId = "glp-clinic-scout", extraAuthorities = {}) {
  if (!Array.isArray(pages) || !registry || registry.schema !== "site-program-registry-v1" || !registry.site_profiles?.[profileId] || typeof surface !== "string" || !surface) return {};
  const authorized = authorizedSelectionMap(selection);
  if (!authorized) return {};
  const slugByRegistryId = new Map((registry.programs || []).map((program) => [program.program_id, program.review_slug || program.program_id]));
  const contractAuthority = contractAuthorityMap(
    extraAuthorities.providerContracts,
    extraAuthorities.providerFastpath,
    extraAuthorities.approvedRegistry,
    slugByRegistryId,
    surface,
    extraAuthorities.wireInApprovals,
  );
  const item1Authority = awinItem1SurfaceAuthority(extraAuthorities.wireInApprovals);
  const item1IdByAlias = new Map(Object.entries(AWIN_ITEM1_SURFACE_MATRIX)
    .map(([advertiserId, policy]) => [policy.alias, advertiserId]));

  const registryLive = new Map();
  for (const program of registry.programs || []) {
    const profile = program.profiles?.[profileId];
    const live = program.commercial_state === "live" && profile?.vertical_fit === true && profile?.wired === true && profile?.surfaces?.[surface] === true;
    registryLive.set(program.program_id, live);
    // Rows are keyed by render identity; the registry keys network programs by
    // network id. Both spellings resolve to the same program.
    if (program.review_slug) registryLive.set(program.review_slug, live);
  }

  const links = {};
  const liveHrefs = new Map();
  const conflicts = new Set();
  for (const page of pages) {
    for (const row of page.rows || []) {
      const programId = row.program_id;
      if (!programId) continue;
      if (!links[programId]) links[programId] = linkDarkRecord(programId, row.provider || programId, row.review_path || `/reviews/${programId}/`);
      if (conflicts.has(programId)) continue;
      const claimsLive = row.affiliate_link_mode === "transparent_direct" && row.live_link_allowed === true && row.promotion_authorized === true;
      if (!claimsLive || registryLive.get(programId) !== true) continue;
      const sheetAuthority = authorized.get(programId);
      const contract = contractAuthority.get(programId);
      const item1AdvertiserId = item1IdByAlias.get(programId);
      const explicitSurfaceAuthorityBoundary = Object.keys(extraAuthorities).length > 0;
      const item1Allowed = !item1AdvertiserId || !explicitSurfaceAuthorityBoundary
        || awinItem1SurfaceAllowed(item1Authority, item1AdvertiserId, surface);
      const hrefOk = typeof row.affiliate_href === "string" && Boolean(row.affiliate_href);
      const receiptOk = row.operator_selection_receipt_sha256 === selection.operator_gate_receipt_sha256;
      const sheetMatch = Boolean(item1Allowed && sheetAuthority && hrefOk && receiptOk && row.affiliate_network === sheetAuthority.network
        && createHash("sha256").update(row.affiliate_href, "utf8").digest("hex") === sheetAuthority.tracking_link_sha256);
      const contractMatch = Boolean(contract && hrefOk && receiptOk && row.affiliate_network === contract.network
        && row.affiliate_href === contract.expected_href);
      const authority = sheetMatch ? sheetAuthority : contractMatch ? contract : null;
      if (!authority) {
        conflicts.add(programId);
        links[programId] = linkDarkRecord(programId, row.provider || programId, row.review_path || `/reviews/${programId}/`);
        continue;
      }

      try {
        const url = new URL(row.affiliate_href);
        // A network program pins to the network host; a provider-issued direct
        // link pins to the host its own approval artifact named.
        const allowedHost = TRACKING_HOST_BY_NETWORK[row.affiliate_network] || authority.tracking_host;
        if (url.protocol !== "https:" || !allowedHost || url.hostname !== allowedHost || url.hostname !== authority.tracking_host) {
          conflicts.add(programId);
          links[programId] = linkDarkRecord(programId, row.provider || programId, row.review_path || `/reviews/${programId}/`);
          continue;
        }
        const href = url.toString();
        const priorHref = liveHrefs.get(programId);
        if (priorHref && priorHref !== href) {
          conflicts.add(programId);
          links[programId] = linkDarkRecord(programId, row.provider || programId, row.review_path || `/reviews/${programId}/`);
          continue;
        }
        liveHrefs.set(programId, href);
        links[programId] = {
          program_id: programId,
          merchant: row.provider || programId,
          review_path: row.review_path || `/reviews/${programId}/`,
          affiliate_href: href,
          network: row.affiliate_network || null,
          ...(authority.network_offer_id ? { network_offer_id: authority.network_offer_id } : {}),
          live: true,
        };
      } catch {
        // A malformed live-claiming tracking row poisons this program to link-dark.
        conflicts.add(programId);
        links[programId] = linkDarkRecord(programId, row.provider || programId, row.review_path || `/reviews/${programId}/`);
      }
    }
  }
  return applyGoSelectionToLinkMap(links, registry, surface, profileId, extraAuthorities.goSelection);
}

export function loadAffiliateLinkMap(surface, profileId = "glp-clinic-scout") {
  const key = `${profileId}:${surface}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const specs = JSON.parse(readFileSync(new URL("../data/money-page-specs.json", import.meta.url), "utf8"));
    const registry = JSON.parse(readFileSync(new URL("../data/program-registry.json", import.meta.url), "utf8"));
    const selection = JSON.parse(readFileSync(new URL("../data/affiliate-activation-selection.json", import.meta.url), "utf8"));
    const providerContracts = loadProviderPageContracts(new URL("../", import.meta.url));
    const providerFastpath = JSON.parse(readFileSync(new URL("../data/provider-fastpath-contract.json", import.meta.url), "utf8"));
    const approvedRegistry = JSON.parse(readFileSync(new URL("../data/approved-program-registry.json", import.meta.url), "utf8"));
    const wireInApprovals = JSON.parse(readFileSync(new URL("../data/affiliate-wire-in-approvals.json", import.meta.url), "utf8"));
    const goSelection = loadGoSelection();
    const map = buildAffiliateLinkMap(specs.pages, registry, selection, surface, profileId, { providerContracts, providerFastpath, approvedRegistry, wireInApprovals, goSelection });
    cache.set(key, map);
    return map;
  } catch {
    return {};
  }
}

// Build-time dynamic surfaces use this exact authority set as the regular
// resolver. Centralizing the loader prevents a surface from silently falling
// back to the activation-selection-only projection.
export function loadAffiliateAuthorities() {
  return {
    goSelection: loadGoSelection(),
    providerContracts: JSON.parse(readFileSync(new URL("../data/provider-page-contracts.json", import.meta.url), "utf8")),
    providerFastpath: JSON.parse(readFileSync(new URL("../data/provider-fastpath-contract.json", import.meta.url), "utf8")),
    approvedRegistry: JSON.parse(readFileSync(new URL("../data/approved-program-registry.json", import.meta.url), "utf8")),
    wireInApprovals: JSON.parse(readFileSync(new URL("../data/affiliate-wire-in-approvals.json", import.meta.url), "utf8")),
  };
}
