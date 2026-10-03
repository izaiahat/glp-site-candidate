// GLP-327: nonproduction proposal only. No provider, price, creative, destination or
// paid position is approved. This is deliberately outside the organic result grid.
// The panel is composed only from shared site components (assets/site-p3.css):
// p3-rail-card, p3-chip, provider-logo wordmark, cs-btn, p3-rail-note. Its compact
// layout lives in the shared source (assets/css-src/11-phase3.css, data-sponsor-*
// hooks); it carries no <style> block, inline style or colour value of its own.
export const SPONSOR_CANDIDATE_ROUTE = "/providers/";
export const SPONSOR_CANDIDATE_SLOT = "after provider filters, before organic results";
export const EXAMPLE_SPONSOR = Object.freeze({ provider: "Example Provider", slug: "example-provider" });

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The only switch that admits the sponsor preview composition on /providers/. */
export function sponsorPreviewActive(route) {
  return route === SPONSOR_CANDIDATE_ROUTE && process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW === "1";
}

export function sponsorCta({ preview = true, destination = null } = {}) {
  return preview
    ? '<button class="cs-btn cs-palette-action" type="button" disabled aria-disabled="true">View provider information</button>'
    : `<a class="cs-btn cs-palette-action" href="${esc(destination)}" rel="sponsored nofollow noopener" data-sponsored-link>View provider information</a>`;
}

export function sponsorSmallPrint({ provider = EXAMPLE_SPONSOR.provider, preview = true, affiliate = false } = {}) {
  return preview
    ? "Example placement. No provider is being promoted."
    : `Paid for by ${esc(provider)}.${affiliate ? " We may also earn a commission if you use this link." : ""}`;
}

export function renderSponsoredPanel({ provider = EXAMPLE_SPONSOR.provider, preview = true, destination = null, affiliate = false, id = "sponsored-placement-title" } = {}) {
  return `<aside class="p3-rail-card p3-rail-card--cta" data-sponsor-placement-candidate data-sponsored-placement aria-labelledby="${esc(id)}">`
    + `<div class="p3-rail-identity p3-provider-identity" data-sponsor-panel-identity><span class="provider-logo provider-logo--wordmark" role="img" aria-label="${esc(provider)}"><span class="provider-wordmark" aria-hidden="true">${esc(provider)}</span></span><p><span class="p3-chip p3-chip--status">Sponsored</span><strong id="${esc(id)}">${esc(provider)}</strong></p></div>`
    + `<p data-sponsor-panel-body>${preview ? "A space for a provider's program summary." : "See program details. Check current prices and eligibility with the provider."}</p>`
    + `<div class="p3-hero-actions p3-wrap-actions" data-wrap-actions>${sponsorCta({ preview, destination })}</div>`
    + `<p class="p3-rail-note">${sponsorSmallPrint({ provider, preview, affiliate })}</p></aside>`;
}

export function renderSponsorPlacementCandidate(route, { preview = false } = {}) {
  if (route !== SPONSOR_CANDIDATE_ROUTE || !preview) return "";
  return renderSponsoredPanel();
}
