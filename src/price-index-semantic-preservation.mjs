import { policyMarkup, releaseExportPolicy, stageCandidateExportPolicy } from "./candidate-export-policy.mjs";

import { normalizePriceIndexUrls } from "./price-index-url-normalization.mjs";
const P1_CAPTURE_SURFACE = /<aside\b(?=[^>]*\bdata-p1-capture-surface\b)[^>]*>[\s\S]*?<\/aside>/gi;
const P1_CAPTURE_BEHAVIOR = /<script\b(?=[^>]*\bdata-p1-content-upgrade\b)[^>]*>[\s\S]*?<\/script>/gi;
const P1_CAPTURE_RESILIENCE = /<script\b(?=[^>]*\bdata-p1-capture-resilience\b)[^>]*>[\s\S]*?<\/script>/gi;
const TOP_STRIP = /<div\b[^>]*\bclass="[^"]*\bcs-topstrip\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
const SHARED_NAV = /<nav\b[^>]*\bclass="[^"]*\bgcs-nav\b[^"]*"[^>]*>[\s\S]*?<\/nav>/gi;
const SHARED_PREFOOTER = /<div\b[^>]*\bclass="[^"]*\bcs-prefooter\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
const SHARED_FOOTER = /<footer\b[^>]*\bclass="[^"]*\bgcs-footer\b[^"]*"[^>]*>[\s\S]*?<\/footer>/gi;
// 2026-08-27 launch step 4: the GTM container loader is shared shell chrome added
// site-wide at launch; the preserved predecessor predates it. One-sided chrome
// vanishes under normalization — never a price-semantics delta.
const GTM_LOADER = /<script>\(function\(w,d,s,l,i\)\{[\s\S]*?GTM-[A-Z0-9]+'\);<\/script>/g;
// 2026-08-27 GTM cutover: the inline synthetic-suppression guard precedes the
// GTM loader on every shell page; like the loader it is one-sided shell chrome
// the preserved predecessor predates — it vanishes under normalization.
const SYNTHETIC_GUARD = /<script>if\(navigator\.webdriver===true\|\|[\s\S]*?GCS_ANALYTICS_SUPPRESSED=true\}<\/script>/g;
const SOURCE_DATE_LABEL = /\b(?:Checked|Current as of) (?=\d{4}-\d{2}-\d{2}\b)/g;

/**
 * Normalize only transport hashes and the explicitly mutable PASS 2 opt-in
 * surface before comparing preserved Build 4 price-index semantics.
 *
 * The price table, provider rows, evidence dates, copy, links, and all content
 * outside the marked opt-in and shared-shell surfaces remain byte-strict.
 */
export function normalizePriceIndexBuild4Semantics(html) {
  // The exact known shell's local export hold is a declared runtime migration,
  // not a price fact. Export safety is tested separately, not inferred here.
  return normalizePriceIndexUrls(stageCandidateExportPolicy(String(html), {stage:"candidate"}))
    .replaceAll(policyMarkup(releaseExportPolicy("candidate")), "")
    .replaceAll(policyMarkup(releaseExportPolicy("production-seal")), "")
    .replaceAll('<script data-candidate-export-policy>window.GCS_EXPORT_POLICY=Object.freeze({"schema":"glp-candidate-export-policy-v1","third_party_exports":false,"reason":"local-candidate-export-hold"});</script>', "")
    .replace(/,gtm_container_id:'GTM-[A-Z0-9]+'/g, "")
    .replace(TOP_STRIP, "")
    .replace(SHARED_NAV, '<nav class="gcs-nav">PASS2_SHARED_NAV</nav>')
    // 2026-08-27: the redesign adds the shared prefooter to every page; the
    // preserved predecessor predates it. Shared chrome present on only one side
    // must vanish (like TOP_STRIP), not tokenize, or the gate flags chrome as a
    // price-semantics delta.
    .replace(SHARED_PREFOOTER, "")
    .replace(SYNTHETIC_GUARD, "")
    .replace(GTM_LOADER, "")
    .replace(SHARED_FOOTER, '<footer class="gcs-footer">PASS2_SHARED_FOOTER</footer>')
    .replace(SOURCE_DATE_LABEL, "SOURCE_DATE ")
    .replace(P1_CAPTURE_SURFACE, '<aside data-p1-capture-surface="normalized">PASS2_OPT_IN_SURFACE</aside>')
    .replace(P1_CAPTURE_BEHAVIOR, '<script data-p1-content-upgrade="normalized">PASS2_OPT_IN_BEHAVIOR</script>')
    .replace(P1_CAPTURE_RESILIENCE, "");
}
