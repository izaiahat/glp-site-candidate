// Canonical outbound-click identity grammar (BUILD-SPEC-PACK CR-5 / B-01).
//
// CR-5 resolves the [CRO] vs [ADS] naming collision in favour of the names the
// site already renders: the event is `affiliate_click` and the first-party click
// id is `cs_click_id`. [CRO]'s property schema is absorbed wholesale; only the
// names changed.
//
//   sub1 = <rank><element>   e.g. "1L" - rank position + element code
//   sub2 = page_slug
//   sub3 = cs_click_id       (UUIDv7, localStorage, per provider - runtime)
//   sub4 = gclid             (runtime, paid traffic only)
//
// sub1/sub2 are known at build time and ride the anchor as data attributes.
// sub3/sub4 are per-visitor and are appended by the runtime at click time, which
// is the only place they can exist - so the URL that actually reaches the network
// carries all four.
//
// ELEMENT CODES — the merged [CRO] slot list and [ADS] code list:
//   L list/table row · B provider card button · C card hero / verdict
//   T top-3 podium · F sticky bar · R review-page inline · K calculator result
//   Q quiz result card — an explicit extension: neither source spec enumerated
//     the quiz surface, and giving it its own code is the only way to learn
//     whether the quiz improves click quality (CI §2A's open question).

export const ELEMENT_CODES = Object.freeze({
  L: "comparison table row",
  B: "provider card button",
  C: "card hero / verdict",
  T: "top-3 podium",
  F: "sticky bar",
  R: "review page inline",
  K: "calculator result",
  Q: "quiz result card",
  // 2026-08-27: in-prose affiliate link inside guide body copy (blog-system
  // mdLinks) — previously shipped bare rel="sponsored" and was invisible to
  // the click runtime.
  P: "guide prose inline",
});

// Rendered `data-link-position` values -> element code. Fail-closed: an unmapped
// position throws rather than shipping an unattributable click.
const POSITION_TO_ELEMENT = Object.freeze({
  prose: "P",
  pricing: "L",
  pros: "B",
  intro: "C",
  conclusion: "F",
  review: "R",
  "review-verdict": "R",
  "review-atf": "R",
  "review-closing": "R",
  calculator: "K",
  quiz: "Q",
  "quiz-result": "Q",
  podium: "T",
  // B-17: the paid landing family. Its three surfaces map onto the SAME merged
  // code grammar as the organic site so one taxonomy explains every click:
  // the fold verdict CTA is a card hero, the ladder rows are list rows, and the
  // bar is the bar. Paid vs organic is told apart by page_type/page_slug, not by
  // inventing a parallel alphabet.
  "lp-hero": "C",
  "lp-rail": "L",
  "lp-sticky": "F",
  "provider-card": "B",
  "provider-card-unverified": "B",
});

export function elementCodeFor(position) {
  const code = POSITION_TO_ELEMENT[String(position)];
  if (!code) throw new Error(`affiliate_element_code_unmapped:${position}`);
  return code;
}

export function sub1For(position, rankPosition) {
  const rank = Number.isFinite(rankPosition) && rankPosition > 0 ? Math.trunc(rankPosition) : 0;
  return `${rank}${elementCodeFor(position)}`;
}

// Per-network parameter names for the same four values. A network absent from
// this map takes the generic `sub1..sub4`, which every tested network accepts as
// pass-through query params.
export const NETWORK_SUBID_PARAMS = Object.freeze({
  Katalys: ["sub1", "sub2", "sub3", "sub4"],
  RevOffers: ["sub1", "sub2", "sub3", "sub4"],
  // Affiliati uses s1 as the primary owned click id and duplicates it into s2 for compatibility.
  Affiliati: ["s1", "s2"],
  Awin: ["clickref", "clickref2", "clickref3", "clickref4"],
  CJ: ["sid", "sid2", "sid3", "sid4"],
  Impact: ["subId1", "subId2", "subId3", "subId4"],
  ShareASale: ["afftrack", "u1", "u2", "u3"],
});

export function subidParamsFor(network) {
  return NETWORK_SUBID_PARAMS[network] || NETWORK_SUBID_PARAMS.Katalys;
}

// Katalys' owned click key is independent from sub1..sub4 placement reporting.
export const NETWORK_CLICK_ID_PARAMS = Object.freeze({ Katalys: "aff_click_id" });

export function clickIdParamFor(network) {
  return NETWORK_CLICK_ID_PARAMS[network] || null;
}

// The tracking hostname is ground truth for which subid parameter names the
// destination network reads; sheet labels are free text and drift ("CJ
// Affiliate", "Direct affiliate"). Only hosts we hold approvals on are listed —
// an unknown host resolves to null, never a guess.
const NETWORK_BY_TRACKING_HOST = Object.freeze({
  "epsilonmkt.com": "Affiliati",
  "maanantaispc.com": "Affiliati",
  "www.awin1.com": "Awin",
  "track.revoffers.com": "Katalys",
  "www.tkqlhce.com": "CJ",
  "www.anrdoezrs.net": "CJ",
  "www.dpbolvw.net": "CJ",
  "www.jdoqocy.com": "CJ",
  "www.kqzyfj.com": "CJ",
  "www.shareasale.com": "ShareASale",
});

export function networkForHref(href) {
  try {
    return NETWORK_BY_TRACKING_HOST[new URL(String(href)).hostname] || null;
  } catch {
    return null;
  }
}

const NETWORK_LABEL_PATTERNS = [
  [/^xentraffic$/i, "XenTraffic"],
  [/affiliati/i, "Affiliati"],
  [/awin/i, "Awin"],
  [/katalys|revoffers/i, "Katalys"],
  [/^cj\b|cj affiliate|commission junction/i, "CJ"],
  [/impact/i, "Impact"],
  [/shareasale/i, "ShareASale"],
];

/** Canonical NETWORK_SUBID_PARAMS key for a free-text label and/or the link itself. */
export function normalizeNetwork(label, href) {
  const byHost = networkForHref(href);
  if (byHost) return byHost;
  const text = String(label || "");
  for (const [pattern, canonical] of NETWORK_LABEL_PATTERNS) {
    if (pattern.test(text)) return canonical;
  }
  return "direct";
}

/** Rail identity is not the subid codec. Preserve issuer rails with no codec
 * without changing normalizeNetwork/subidParamsFor's parameter fallback. */
export function affiliateNetworkIdentity(label, href) {
  const identities = new Map([['trackdesk', 'Trackdesk'], ['partnerize', 'Partnerize'], ['clickdealer', 'ClickDealer']]);
  return identities.get(String(label || "").trim().toLowerCase()) || normalizeNetwork(label, href);
}

/** Classifies the rendered destination; does not grant outbound authority. */
export function affiliateLinkMode(href) {
  if (typeof href !== "string" || !href.trim()) throw new Error("affiliate_rendered_href_missing");
  const url = new URL(href, "https://glpclinicscout.com/");
  return url.origin === "https://glpclinicscout.com" && url.pathname.startsWith("/go/") ? "server-redirect" : "transparent-direct";
}

/** The build-time attribute block every live affiliate anchor carries. */
export function subidAttributes({ network, position, rankPosition, pageSlug, pageType, providerSlug, href, renderedHref }) {
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  return [
    // No rendered affiliate href (held / unavailable provider: the card links to its review page) => not an affiliate
    // CTA, so no link-mode attribute. Only a present href is classified (build 3 refused on a null href, 2026-09-18).
    ...(renderedHref == null || !String(renderedHref).trim() ? [] : [`data-link-mode="${affiliateLinkMode(renderedHref)}"`]),
    `data-network="${esc(affiliateNetworkIdentity(network, href))}"`,
    `data-provider-slug="${esc(providerSlug)}"`,
    `data-element-code="${esc(elementCodeFor(position))}"`,
    `data-rank-position="${Number.isFinite(rankPosition) ? Math.trunc(rankPosition) : 0}"`,
    `data-page-type="${esc(pageType)}"`,
    `data-sub1="${esc(sub1For(position, rankPosition))}"`,
    `data-sub2="${esc(pageSlug)}"`,
  ].join(" ");
}
