const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_KEYS = Object.freeze(["schema", "updated_at", "source_contract", "offers"]);
const CONTRACT_KEYS = Object.freeze(["write_owner", "consumers", "max_age_days", "status_values"]);
const OFFER_KEYS = Object.freeze(["program_id", "network", "network_offer_id", "status", "code", "benefit_copy", "source_url", "verified_at", "expires_at"]);

const exactKeys = (value, expected, label) => {
  const actual = Object.keys(value || {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label}_keys_invalid`);
};
const parseDate = (value) => DATE_RE.test(String(value || "")) ? new Date(`${value}T00:00:00Z`) : null;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function validateCouponFeed(feed) {
  exactKeys(feed, TOP_KEYS, "coupon_feed");
  if (feed.schema !== "glp-coupon-offers-v1" || Number.isNaN(Date.parse(feed.updated_at))) throw new Error("coupon_feed_identity_invalid");
  exactKeys(feed.source_contract, CONTRACT_KEYS, "coupon_source_contract");
  if (feed.source_contract.write_owner !== "affiliate-machines"
    || JSON.stringify(feed.source_contract.consumers) !== JSON.stringify(["site-build"])
    || !Number.isInteger(feed.source_contract.max_age_days) || feed.source_contract.max_age_days < 1
    || JSON.stringify(feed.source_contract.status_values) !== JSON.stringify(["VERIFIED", "HELD"])) throw new Error("coupon_source_contract_invalid");
  if (!Array.isArray(feed.offers)) throw new Error("coupon_offers_invalid");
  const identities = new Set();
  for (const offer of feed.offers) {
    exactKeys(offer, OFFER_KEYS, "coupon_offer");
    if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(String(offer.program_id || ""))) throw new Error("coupon_program_id_invalid");
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(String(offer.network || ""))) throw new Error("coupon_network_invalid");
    if (!String(offer.network_offer_id || "").trim()) throw new Error("coupon_network_offer_id_invalid");
    if (!["VERIFIED", "HELD"].includes(offer.status)) throw new Error("coupon_status_invalid");
    const identity = `${offer.network}:${offer.network_offer_id}`;
    if (identities.has(identity)) throw new Error("coupon_offer_duplicate");
    identities.add(identity);
    if (offer.status === "VERIFIED") {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(String(offer.code || ""))) throw new Error("coupon_code_invalid");
      if (typeof offer.benefit_copy !== "string" || offer.benefit_copy.trim().length < 4 || offer.benefit_copy.length > 140) throw new Error("coupon_benefit_copy_invalid");
      if (!/^https:\/\//.test(String(offer.source_url || ""))) throw new Error("coupon_source_url_invalid");
      if (!parseDate(offer.verified_at)) throw new Error("coupon_verified_at_invalid");
      if (offer.expires_at !== null && !parseDate(offer.expires_at)) throw new Error("coupon_expires_at_invalid");
    } else if (offer.code !== null || offer.benefit_copy !== null || offer.source_url !== null) {
      throw new Error("held_coupon_public_fields_present");
    }
  }
  return true;
}

export function activeCouponMap(feed, now = new Date().toISOString()) {
  validateCouponFeed(feed);
  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new Error("coupon_now_invalid");
  const day = 24 * 60 * 60 * 1000;
  const active = {};
  for (const offer of feed.offers) {
    if (offer.status !== "VERIFIED") continue;
    const verified = parseDate(offer.verified_at);
    const expires = parseDate(offer.expires_at);
    if (nowDate < verified || nowDate.getTime() - verified.getTime() > feed.source_contract.max_age_days * day) continue;
    if (expires && nowDate >= new Date(expires.getTime() + day)) continue;
    if (active[offer.program_id]) throw new Error(`coupon_program_collision:${offer.program_id}`);
    active[offer.program_id] = Object.freeze({ ...offer });
  }
  return Object.freeze(active);
}

export function renderCouponChip(coupon) {
  if (!coupon) return "";
  return `<button type="button" class="cs-coupon-chip" data-coupon-copy data-coupon-code="${esc(coupon.code)}" aria-label="Copy coupon ${esc(coupon.code)}">Use code ${esc(coupon.code)} for ${esc(coupon.benefit_copy)}</button>`;
}
