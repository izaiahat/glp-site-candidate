// GLP-327: nonproduction proposal only. No provider, price, creative, destination or
// paid position is approved. This is deliberately outside the organic result grid.
// The panel is composed only from shared site components (assets/site-p3.css):
// p3-rail-card, p3-chip, provider-logo wordmark, cs-btn, p3-rail-note. It carries
// no <style> block, colour value or new class of its own.
export const SPONSOR_CANDIDATE_ROUTE = "/providers/";
export const SPONSOR_CANDIDATE_SLOT = "after provider filters, before organic results";
export const EXAMPLE_SPONSOR = Object.freeze({ provider: "Example Provider", slug: "example-provider" });

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderSponsoredPanel({ provider = EXAMPLE_SPONSOR.provider, preview = true, destination = null, affiliate = false, id = "sponsored-placement-title" } = {}) {
  const cta = preview
    ? '<button class="cs-btn cs-palette-action" type="button" disabled aria-disabled="true">View provider information</button>'
    : `<a class="cs-btn cs-palette-action" href="${esc(destination)}" rel="sponsored nofollow noopener" data-sponsored-link>View provider information</a>`;
  const smallPrint = `${preview ? "Example creative, not a provider endorsement." : `Paid for by ${esc(provider)}.`} ${affiliate ? "We may also earn a commission if you use this link." : "Any applicable affiliate commission will be disclosed next to the final link."} Payment buys advertising space, not a recommendation or rank.`;
  return `<aside class="p3-rail-card p3-rail-card--cta" data-sponsor-placement-candidate data-sponsored-placement aria-labelledby="${esc(id)}"><p><span class="p3-chip p3-chip--status">Sponsored</span></p><div class="p3-rail-identity p3-provider-identity"><span class="provider-logo provider-logo--wordmark" role="img" aria-label="${esc(provider)}"><span class="provider-wordmark" aria-hidden="true">${esc(provider)}</span></span><p><strong id="${esc(id)}">${esc(provider)}</strong></p></div><p>A paid introduction to ${esc(provider)}. Explore provider-reported program information and check current terms and eligibility directly with the provider.</p><div class="p3-hero-actions p3-wrap-actions" data-wrap-actions>${cta}</div><p class="p3-rail-note">${smallPrint}</p></aside>`;
}

export function renderSponsorPlacementCandidate(route, { preview = false } = {}) {
  if (route !== SPONSOR_CANDIDATE_ROUTE || !preview) return "";
  return renderSponsoredPanel();
}
