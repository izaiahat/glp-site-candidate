// Approved-provider link attribution — the marker half of the invariant.
//
// Operator directive 2026-08-19: "wire ANY link to ANY approved provider on our
// site with a valid affiliate link so that we make sure anytime anyone clicks a
// link for a provider on our site, regardless of where it is, we get paid if
// they sign up."
//
// The site has exactly one honest exception to that rule: an EVIDENCE CITATION.
// A numbered source, a first-party price source, or a dagger footnote exists so
// a reader can verify the claim we published. Redirecting that click through a
// tracking link corrupts the evidence trail — the reader would no longer be
// landing on the page we captured, and the page's own honesty claim
// ("The source links on this page go directly to provider websites, not
// affiliate redirectors") would become false.
//
// So "bare" must never be an oversight. Every deliberately-bare provider link
// carries `data-citation="<reason>"`, and
// `scripts/validate-approved-provider-link-monetization.mjs` FAILS the build on
// any approved-provider link that is neither monetized nor marked.

export const CITATION_REASONS = Object.freeze({
  REVIEW_SOURCE_LEDGER: "review_source_ledger",
  INLINE_FACT_SOURCE: "inline_fact_source",
  COMPARISON_SOURCE_LEDGER: "comparison_source_ledger",
  GUIDE_SOURCE_LEDGER: "guide_source_ledger",
  READY6_SOURCE_LEDGER: "ready6_source_ledger",
  FIRST_PARTY_PRICE_EVIDENCE: "first_party_price_evidence",
  DIRECTORY_SOURCE_QUERY: "directory_source_query",
});

const REASON_VALUES = Object.freeze(new Set(Object.values(CITATION_REASONS)));

// The GLP-1 Price Index shipped its own explicit marker before this module
// existed: every evidence cell renders `<a data-first-party-source …>`, and the
// page states in prose that "the source links on this page go directly to
// provider websites, not affiliate redirectors." That is already a recorded
// decision, and the artifact is byte-frozen against the weekly observation
// machine (`GLP_PRICE_INDEX_REFRESH`), so the build gate accepts the existing
// attribute as an equivalent marker rather than unfreezing a working artifact
// to restate the same fact with different spelling.
export const EQUIVALENT_CITATION_MARKERS = Object.freeze({
  "data-first-party-source": CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE,
});

export function isCitationReason(reason) {
  return REASON_VALUES.has(reason);
}

// Partner-portal hosts are OUR authenticated account surfaces. They are a real
// evidence source (offer terms live there), but they must never ship as a
// public href: a reader hits a login wall instead of the promised destination
// (SITE-BUILD-SOP gate 20), and the URL carries our publisher account id.
export const NON_PUBLIC_SOURCE_HOSTS = Object.freeze(new Set([
  "app.katalys.com",
  "ui.awin.com",
  "darwin.awin.com",
  "members.cj.com",
  "members.cj.com.",
  "signup.cj.com",
  "publisher.katalys.com",
  "account.impact.com",
  "app.impact.com",
  "nu-image-medical.trackdesk.com",
]));

export const NON_PUBLIC_SOURCE_LABEL = Object.freeze({
  "app.katalys.com": "Katalys partner-portal offer terms",
  "publisher.katalys.com": "Katalys partner-portal offer terms",
  "ui.awin.com": "Awin partner-portal program terms",
  "darwin.awin.com": "Awin partner-portal program terms",
  "members.cj.com": "CJ Affiliate partner-portal program terms",
  "signup.cj.com": "CJ Affiliate partner-portal program terms",
  "account.impact.com": "Impact partner-portal program terms",
  "app.impact.com": "Impact partner-portal program terms",
  "nu-image-medical.trackdesk.com": "Nu Image Medical partner-portal terms",
});

export function sourceHost(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isNonPublicSourceUrl(url) {
  return NON_PUBLIC_SOURCE_HOSTS.has(sourceHost(url));
}

export function nonPublicSourceLabel(url) {
  return NON_PUBLIC_SOURCE_LABEL[sourceHost(url)] || "Partner-portal program terms";
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// The marker itself. Emitted on the anchor, never on a wrapper, so the build
// gate can read it off the same element it reads href from.
export function citationAttr(reason) {
  if (!isCitationReason(reason)) throw new Error(`citation_reason_unknown:${reason}`);
  return ` data-citation="${reason}"`;
}

/**
 * Render one evidence-citation source.
 *
 * A public source renders as a bare anchor carrying `data-citation`.
 * A partner-portal source renders DE-LINKED: the source stays named and dated
 * in the ledger (the evidence trail is preserved), but no href ships.
 */
export function citationRel(url) {
  const host = sourceHost(url);
  return /(?:^|\.)gov(?:\.uk)?$/.test(host) ? "noopener" : "nofollow noopener";
}

// Covers hand-authored citations in the finalizer, never ordinary CTAs or script specimens.
export function normalizeCitationRels(html) {
  return html.split(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>)/gi).map((part) => {
    if (/^<(?:script|style)\b/i.test(part)) return part;
    return part.replace(/<a\b[^>]*>/gi, (anchor) => {
      if (!/\b(?:data-citation|data-first-party-source)(?:\s|=|>)/i.test(anchor)) return anchor;
      const url = anchor.match(/\bhref="([^"]+)"/i)?.[1];
      if (!url || !/^https?:\/\//i.test(url)) return anchor;
      const rel = `rel="${citationRel(url.replaceAll('&amp;', '&'))}"`;
      return /\brel="[^"]*"/i.test(anchor) ? anchor.replace(/\brel="[^"]*"/i, rel) : anchor.replace(/>$/, ` ${rel}>`);
    });
  }).join('');
}

export function renderCitationAnchor({ url, label, reason, extraAttrs = "" }) {
  const marker = citationAttr(reason);
  if (isNonPublicSourceUrl(url)) {
    return `<span class="source-nolink"${marker} data-source-access="partner_portal_not_public">${escapeAttr(label)} <small>(partner portal — not publicly viewable)</small></span>`;
  }
  return `<a href="${escapeAttr(url)}"${extraAttrs} rel="${citationRel(url)}"${marker}>${escapeAttr(label)}</a>`;
}
