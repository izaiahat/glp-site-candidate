// GLP-327 paid inventory. Separate from editorial ranking; no activation by default.
// Every surface here is a site page: it is rendered through the Phase 3
// pageDocument(), wrapped by the build's shared shell (header, footer, fonts,
// site-p3.css) and composed of existing site components. Its composition rules
// live in the shared source (assets/css-src/11-phase3.css, data-sponsor-layout
// hooks); it never emits a <style> block, inline style or colour value.
import { pageDocument, breadcrumbs } from "./phase3-page-graph.mjs";
import { renderSponsoredPanel, sponsorCta, sponsorSmallPrint, EXAMPLE_SPONSOR } from "./sponsor-placement-candidate.mjs";

export const SPONSOR_RATE_CARD_ROUTE = "/sponsors/rates/";
export const sponsorPromoRoute = (slug) => `/sponsors/${slug}/`;
// Paid inventory stays out of search and the sitemap until a sponsor is booked.
export const SPONSOR_ROBOTS = "noindex,nofollow,noarchive,nosnippet";
export const SPONSOR_BOOKING_EMAIL = "partners@glpclinicscout.com";
const DISCLAIMER = "GLP Clinic Scout is an independent comparison publisher, not a clinic, pharmacy or medical provider. This page is not medical advice.";
const NO_PAID_RANK = "Sponsored placements never change our independent rankings. No paid top rank, editorial score, favorable review or paid SEO backlink.";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (items, attrs = "") => `<ul${attrs}>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const disclaimer = () => `<aside class="p3-source-disclosure affiliate-note table-disclosure" data-sponsor-disclaimer><p>${esc(DISCLAIMER)}</p></aside>`;

export function renderRateCard() {
  const route = SPONSOR_RATE_CARD_ROUTE;
  // The PayPal remittance address travels only in the operator's order email;
  // public pages publish the partner alias (data/email-alias-map.json).
  // Everything a buyer needs to decide sits in the first viewport: price and
  // split, both deliverables, renewal terms, the booking CTA and the
  // no-paid-ranking disclosure. Secondary terms follow, all preserved.
  const offer = `<section class="p3-rail-card p3-rail-card--cta" data-sponsor-offer aria-labelledby="sponsor-offer-title">`
    + `<p class="gcs-kicker" id="sponsor-offer-title">Initial 30-day pilot</p>`
    + `<p data-sponsor-price><span class="cs-price cs-price--xl">$200</span><span data-sponsor-price-terms>$100 setup + $100 placement and reporting</span></p>`
    + list([
      "<strong>Directory placement:</strong> One responsive Sponsored panel on /providers/, after filters and before independent results",
      "<strong>Sponsor page:</strong> One paid introduction page at /sponsors/{provider}/",
    ], " data-sponsor-deliverables")
    + `<p data-sponsor-renewal><strong>Same-scope renewal: $100.</strong> Another 30 days, by affirmative order only. No automatic renewal or recurring charge.</p>`
    + `<div class="p3-hero-actions p3-wrap-actions" data-wrap-actions><a class="cs-btn cs-palette-action" href="mailto:${SPONSOR_BOOKING_EMAIL}" data-sponsor-booking-cta>Discuss a placement</a></div>`
    + `<p class="p3-rail-note" data-sponsor-independence><strong>Visibility without buying a ranking.</strong> ${esc(NO_PAID_RANK)}</p>`
    + `</section>`;
  const example = `<figure data-sponsor-example><figcaption class="gcs-kicker">Example: the Sponsored panel on /providers/</figcaption>${renderSponsoredPanel({ id: "sponsor-example-title" })}</figure>`;
  const details = `<section data-sponsor-details aria-labelledby="sponsor-details-title"><h2 id="sponsor-details-title">Pilot and renewal details</h2>`
    + `<div class="p3-detail-grid"><article><h3>Also in the pilot</h3>${list(["Approved provider identity, factual creative and one approved CTA", "One copy correction round, plus required safety corrections", "720 consecutive hours from verified activation"])}</article>`
    + `<article><h3>Renewal and reporting</h3>${list(["Same panel and sponsored page.", "Delivery and available aggregate measurement report within five business days of term close."])}<p>No traffic, leads, sales or SEO guarantee. Subject to available inventory and final review.</p></article>`
    + `<article><h3>Booking, payment and refunds</h3>${list(["US providers only.", "Final availability, provider eligibility, creative/link permission, legal terms and approval are required before booking.", "Payment is confirmed after a reviewed order and readiness checks, before activation.", `PayPal payment details are supplied after a confirmed order. Contact: <a href="mailto:${SPONSOR_BOOKING_EMAIL}">${SPONSOR_BOOKING_EMAIL}</a>.`, "Prices before any applicable tax; final tax-inclusive quote must be agreed.", "Full refund if no conforming placement launches; refund or mutually agreed equivalent extension for undelivered time."])}</article></div>`
    + `<details class="cs-details" data-sponsor-audience><summary>Audience and reporting, honestly</summary><p>Our site offers provider comparisons, cost tools and independent reviews. No verified audience size or sponsor impression estimate is included in this proposal. Unknown is not zero. Site visits are not ad impressions. Only reliably measured, privacy-safe aggregate exposure and outbound clicks would be reported, with collection coverage and limitations. No patient information or health-derived audience is shared.</p></details>`
    + `</section>`;
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { label: "Sponsor placements" }])}`
    + `<div data-sponsor-layout="rate-card"><header data-sponsor-title><p class="gcs-kicker">US-provider sponsorship</p><h1>Sponsor placements</h1><p class="lede">Introduce your program in clearly labeled paid inventory on an independent GLP-1 provider comparison site.</p></header>`
    + `<div data-sponsor-lead-grid>${offer}${example}</div>${details}${disclaimer()}</div>`;
  return pageDocument({ route, title: "Sponsor placements · Clinic Scout", description: "Clearly labeled paid inventory for US providers. Sponsored placements never change independent rankings.", body, robots: SPONSOR_ROBOTS });
}

// Slots a reviewed provider brief fills before activation. The preview shows
// where each fact goes and states that it is empty; it never supplies one.
const PROMO_FACT_SLOTS = Object.freeze([
  ["Program summary", "Reserved for the provider's approved program summary."],
  ["Published price", "Reserved for a provider-reported price, shown with its source and checked date."],
  ["Eligibility and states", "Reserved for provider-reported eligibility and state availability."],
  ["Current offer", "Reserved for an approved offer and its terms, if the provider has one."],
]);

export function renderPromo(order = {}, { preview = true } = {}) {
  const provider = order.provider || EXAMPLE_SPONSOR.provider;
  const slug = order.slug || EXAMPLE_SPONSOR.slug;
  if (!preview) {
    if (!order.operator_approval || !order.partner_creative_approval || !order.payment_confirmed || !order.eligibility_approved || !order.inventory_reserved || !order.starts_at || !order.ends_at) throw Error("Sponsor activation gates missing");
    if (/fella/i.test(provider) || order.held !== false || order.us_provider !== true) throw Error("Excluded, held or unverified jurisdiction");
    const url = new URL(order.destination); if (url.protocol !== "https:" || url.username || url.password) throw Error("Invalid approved destination");
    const start = Date.parse(order.starts_at), end = Date.parse(order.ends_at); if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 720 * 3600000 || Date.now() < start || Date.now() >= end) throw Error("Outside paid term");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw Error("Invalid provider slug");
  const route = sponsorPromoRoute(slug);
  // One identity, one intro, one primary action and the ad disclosure, in that
  // order, before anything else on the page.
  const lead = `<section class="p3-rail-card p3-rail-card--cta" data-sponsor-lead aria-labelledby="sponsor-provider-title">`
    + `<p data-sponsor-lead-label><span class="p3-chip p3-chip--status">Sponsored</span><span class="gcs-kicker">Paid provider introduction</span></p>`
    + `<div class="p3-provider-identity p3-wrap-cluster" data-wrap-identity><span class="provider-logo provider-logo--wordmark" role="img" aria-label="${esc(provider)}"><span class="provider-wordmark" aria-hidden="true">${esc(provider)}</span></span><h1 class="p3-wrap-title" id="sponsor-provider-title" data-wrap-text>${esc(provider)}</h1></div>`
    + `<p class="lede">A paid introduction to ${esc(provider)}. Explore provider-reported program information and check current terms and eligibility directly with the provider.</p>`
    + `<div class="p3-hero-actions p3-wrap-actions" data-wrap-actions>${sponsorCta({ preview, destination: order.destination })}</div>`
    + `<p class="p3-rail-note" data-sponsor-ad-disclosure>This is advertising, not an independent review or a recommendation. Sponsored placements never change our independent rankings. ${sponsorSmallPrint({ provider, preview, affiliate: order.affiliate === true })}</p>`
    + `</section>`;
  const facts = preview
    ? `<section class="cs-card" data-sponsor-facts aria-labelledby="sponsor-facts-title"><h2 id="sponsor-facts-title">Program at a glance</h2><dl>${PROMO_FACT_SLOTS.map(([label, slot]) => `<div data-sponsor-fact-slot><dt>${esc(label)}</dt><dd>${esc(slot)}</dd></div>`).join("")}</dl><p class="p3-rail-note">Template preview. These slots stay empty until approved, dated provider materials are reviewed; nothing here is a provider fact.</p></section>`
    : "";
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: `Sponsored: ${provider}` }])}`
    + `<div data-sponsor-layout="promo">${facts ? `<div data-sponsor-lead-grid>${lead}${facts}</div>` : lead}`
    + `<section class="p3-detail-grid" data-sponsor-promo-checks><article><h2>What to check</h2>${list(["Current total cost and renewal terms", "Program details and available services", "State and individual eligibility", "Cancellation, support and provider terms"])}<p>Information is reported by the provider. We make no treatment, medication, clinician, licensure or outcome claim here.</p></article>`
    + `<article><h2>Your comparison stays independent</h2><p>This paid page and any clearly labeled directory panel sit outside our organic provider rankings.</p><div class="p3-hero-actions p3-wrap-actions" data-wrap-actions><a class="cs-btn cs-btn--quiet" href="/providers/">Compare providers independently</a></div></article></section>`
    + `${disclaimer()}</div>`;
  return pageDocument({ route, title: `${provider} · Sponsored introduction · Clinic Scout`, description: `A clearly labeled paid introduction to ${provider}. Advertising, not an independent review.`, body, robots: SPONSOR_ROBOTS });
}
