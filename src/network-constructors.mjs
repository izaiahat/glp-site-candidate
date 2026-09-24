const SUBID = /^(?:c1-[a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ConstructorError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function verified(program) {
  if (!program?.constructor_verified || !program?.advertiser_permission_verified || !program?.tracking) throw new ConstructorError("constructor_gate_held");
}

function url(raw, hosts, code) {
  let value;
  try { value = new URL(raw); } catch { throw new ConstructorError(code); }
  if (value.protocol !== "https:" || value.username || value.password || !(hosts || []).includes(value.hostname.toLowerCase())) throw new ConstructorError(code);
  return value;
}

function destination(program) {
  if (!program.tracking.destination_url) return null;
  if (!program.tracking.deep_link_permitted) throw new ConstructorError("deep_link_not_permitted");
  return url(program.tracking.destination_url, program.tracking.allowed_destination_hosts, "destination_not_allowlisted");
}

// AFFILIATI_S1_S2_CONTRACT_V1: surfaceCode is the caller's CR-5
// surface/element code. It is optional so every non-Affiliati rail is
// untouched; only the Affiliati branch requires it.
export function constructNetworkUrl(program, subid, surfaceCode = "") {
  verified(program);
  if (!SUBID.test(subid)) throw new ConstructorError("subid_invalid");
  // The GobyMeds exception preserves the exact account-issued URL. Its
  // referral dashboard is not a documented click-level reconciliation API.
  if (program.network === "direct") {
    if (program.program_id !== "gobymeds" || program.tracking.issued_link_passthrough_verified !== true
        || program.tracking.base_url !== "https://my.gobymeds.com/s/vuMPMv"
        || program.tracking.destination_url) throw new ConstructorError("direct_passthrough_not_authorized");
    return url(program.tracking.base_url, ["my.gobymeds.com"], "direct_base_invalid");
  }
  if (["everflow", "xentraffic"].includes(program.network)) {
    if (program.tracking.generated_link_readback_verified !== true || program.tracking.everflow_redirect_link_verified !== true) throw new ConstructorError("everflow_redirect_readback_missing");
    const out = url(program.tracking.base_url, program.tracking.allowed_tracking_hosts, "everflow_base_invalid");
    if (!/^\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/$/.test(out.pathname) || out.hash) throw new ConstructorError("everflow_issued_path_invalid");
    if (!/^\d+$/.test(String(program.network_offer_id || ""))) throw new ConstructorError("everflow_offer_identity_missing");
    if (out.searchParams.has("sub1") && (out.searchParams.getAll("sub1").length !== 1 || out.searchParams.get("sub1") !== subid)) throw new ConstructorError("everflow_subid_conflict");
    out.searchParams.set("sub1", subid);
    return out;
  }
  if (program.network === "awin") {
    const base = url(program.tracking.base_url, ["www.awin1.com"], "awin_base_invalid");
    const out = new URL("https://www.awin1.com/cread.php");
    const mid = base.searchParams.get(base.pathname === "/awclick.php" ? "mid" : "awinmid");
    const aff = base.searchParams.get(base.pathname === "/awclick.php" ? "id" : "awinaffid");
    if (!/^\d+$/.test(mid || "") || !/^\d+$/.test(aff || "")) throw new ConstructorError("awin_ids_missing");
    out.searchParams.set("awinmid", mid); out.searchParams.set("awinaffid", aff); out.searchParams.set("clickref", subid);
    const deep = destination(program); if (deep) out.searchParams.set("ued", deep.toString());
    return out;
  }
  if (program.network === "cj") {
    const out = url(program.tracking.base_url, program.tracking.allowed_tracking_hosts, "cj_base_invalid");
    if (!/^\/click-\d{1,10}-\d{1,15}(?:-\d+)?$/.test(out.pathname)) throw new ConstructorError("cj_path_invalid");
    out.searchParams.delete("SID"); out.searchParams.set("sid", subid);
    const deep = destination(program); if (deep) out.searchParams.set("url", deep.toString());
    if (out.toString().length >= 2000) throw new ConstructorError("cj_url_too_long");
    return out;
  }
  if (program.network === "katalys") {
    if (!program.tracking.generated_link_readback_verified) throw new ConstructorError("katalys_readback_missing");
    const out = url(program.tracking.base_url, program.tracking.allowed_tracking_hosts, "katalys_base_invalid");
    if (!out.searchParams.get("offer_id") || !out.searchParams.get("aff_id") || out.searchParams.has("aff_click_id")) throw new ConstructorError("katalys_generated_link_invalid");
    out.searchParams.set("sub1", subid); out.searchParams.set("source", "gcs");
    const deep = destination(program);
    if (deep) { if (out.searchParams.has("url_id")) throw new ConstructorError("katalys_destination_conflict"); out.searchParams.set("url", deep.toString()); }
    return out;
  }
  if (program.network === "affiliati") {
    // AFFILIATI_S1_S2_CONTRACT_V1
    if (!UUID_V7.test(subid)) throw new ConstructorError("affiliati_uuidv7_required");
    if (!program.tracking.generated_link_readback_verified) throw new ConstructorError("affiliati_readback_missing");
    // s1 is the PLACEMENT subid, not the click id. Refuse rather than send
    // a placeholder: an unlabelled placement is a reporting hole we would
    // not be able to see afterwards.
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(surfaceCode || ""))) throw new ConstructorError("affiliati_surface_code_invalid");
    const out = url(program.tracking.base_url, program.tracking.allowed_tracking_hosts, "affiliati_base_invalid");
    // Which link family Affiliati issued us. An explicit
    // tracking.affiliati_link_form always wins - that is the one-line switch
    // for the network's answer. With nothing declared the form is read off
    // the link itself rather than guessed: a base url carrying offer_id/oid IS
    // an offer link, and everything else is treated as the creative family,
    // which is what all three of our creatives are. Inferring beats a fixed
    // default here because a wrong default silently refuses a whole family.
    const declaredForm = String(program.tracking.affiliati_link_form || "");
    const carriesOfferId = /^\d+$/.test(out.searchParams.get("offer_id") || out.searchParams.get("oid") || "");
    const linkForm = declaredForm || (carriesOfferId ? "offer" : "creative");
    if (linkForm === "offer") {
      const offerId = out.searchParams.get("offer_id") || out.searchParams.get("oid");
      if (!/^\d+$/.test(offerId || "") || String(program.network_offer_id || "") !== offerId) throw new ConstructorError("affiliati_offer_identity_invalid");
    } else if (linkForm === "creative") {
      // A creative link carries no offer id; its identity is the creative in
      // `c`, which the program authority already binds to the offer. Still
      // require a well-formed offer id on the PROGRAM so the click row we
      // write can be joined by the postback receiver.
      if (!/^\d+$/.test(out.searchParams.get("a") || "") || !/^\d+$/.test(out.searchParams.get("c") || "")) throw new ConstructorError("affiliati_creative_identity_invalid");
      if (!/^\d+$/.test(String(program.network_offer_id || ""))) throw new ConstructorError("affiliati_offer_identity_invalid");
    } else {
      throw new ConstructorError("affiliati_link_form_unknown");
    }
    out.searchParams.delete("s1");
    out.searchParams.delete("s2");
    out.searchParams.set("s1", surfaceCode);
    out.searchParams.set("s2", subid);
    return out;
  }
  if (program.network === "partnerize") {
    if (!program.tracking.generated_link_readback_verified) throw new ConstructorError("partnerize_readback_missing");
    const out = url(program.tracking.base_url, program.tracking.allowed_tracking_hosts, "partnerize_base_invalid");
    if (!/^\/click\/camref:[A-Za-z0-9]+/.test(out.pathname) || /\/clickref:/i.test(out.pathname)) throw new ConstructorError("partnerize_generated_link_invalid");
    let path = out.pathname.replace(/\/pubref:[^/]+/g, "").replace(/\/destination:.*$/g, "").replace(/\/$/, "");
    path += `/pubref:${subid}`;
    const deep = destination(program);
    if (deep) { if (!program.tracking.destination_encoding_verified) throw new ConstructorError("partnerize_encoding_unverified"); path += `/destination:${encodeURIComponent(deep.toString())}`; }
    out.pathname = path; return out;
  }
  throw new ConstructorError("network_unsupported");
}

export const subidPattern = SUBID.source;
