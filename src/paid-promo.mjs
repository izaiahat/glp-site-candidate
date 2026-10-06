// GLP-327 sponsor inventory. No activation by default; shared site renderer/styles.
import { pageDocument } from "./phase3-page-graph.mjs";
import { SPONSOR_PRICING, usd, paymentVerified } from "./sponsor-pricing.mjs";
import { renderSponsoredPanel, sponsorCta, sponsorSmallPrint, EXAMPLE_SPONSOR } from "./sponsor-placement-candidate.mjs";

export const SPONSOR_RATE_CARD_ROUTE = "/sponsors/rates/";
export const sponsorPromoRoute = (slug) => `/sponsors/${slug}/`;
export const SPONSOR_ROBOTS = "noindex,nofollow,noarchive,nosnippet";
export const SPONSOR_BOOKING_EMAIL = "partners@glpclinicscout.com";
const DISCLAIMER = "GLP Clinic Scout is an independent comparison publisher, not a clinic, pharmacy or medical provider. This page is not medical advice.";
const NO_PAID_RANK = "Independent rankings do not change. Sponsorship does not buy a score, favorable review or SEO backlink.";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (items, attrs = "") => `<ul${attrs}>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const disclaimer = () => `<aside class="p3-source-disclosure affiliate-note table-disclosure" data-sponsor-disclaimer><p>${esc(DISCLAIMER)}</p></aside>`;

export function renderRateCard() {
  const route = SPONSOR_RATE_CARD_ROUTE;
  // Remittance address stays in the order email; this page uses the partner alias.
  const offer = `<section class="p3-rail-card p3-rail-card--cta" data-sponsor-offer aria-labelledby="sponsor-offer-title">`
    + `<h1 id="sponsor-offer-title">Sponsor placements</h1>`
    + `<p data-sponsor-price><span class="cs-price cs-price--xl">${usd(SPONSOR_PRICING.initial)}</span><span> / 30 days</span></p><p data-sponsor-price-terms>${usd(SPONSOR_PRICING.setup)} setup + ${usd(SPONSOR_PRICING.placement)} placement and reporting</p>`
    + list(["One Sponsored directory panel.", "One sponsored provider intro page."], " data-sponsor-deliverables")
    + `<p data-sponsor-renewal><strong>Same-scope renewal: ${usd(SPONSOR_PRICING.renewal)} / 30 days.</strong> No automatic renewal or recurring charge.</p>`
    + `<div class="p3-hero-actions p3-wrap-actions" data-wrap-actions><a class="cs-btn cs-palette-action" href="mailto:${SPONSOR_BOOKING_EMAIL}" data-sponsor-booking-cta>Discuss a placement</a></div>`
    + `<p class="p3-rail-note" data-sponsor-independence>${esc(NO_PAID_RANK)}</p></section>`;
  const example = `<figure data-sponsor-example><figcaption class="gcs-kicker">Example directory placement</figcaption>${renderSponsoredPanel({ id: "sponsor-example-title" })}</figure>`;
  const details = `<section data-sponsor-details aria-labelledby="sponsor-details-title"><h2 id="sponsor-details-title">What's included</h2><p>For US providers. The 30-day pilot includes one responsive panel on <strong>/providers/</strong>, between the filters and independent results, and one introduction page at /sponsors/{provider}/.</p>`
    + `<div class="p3-detail-grid"><article><h3>Setup and term</h3>${list(["Approved provider identity, factual creative and one approved CTA", "One copy correction round, plus required safety corrections", "720 consecutive hours from verified activation"])}</article>`
    + `<article><h3>Renewal and reporting</h3>${list(["Same panel and sponsored page.", `Same-scope renewal: ${usd(SPONSOR_PRICING.renewal)}. Another 30 days, by affirmative order only.`, "Delivery report within five business days of term close; separately labeled aggregate diagnostics only when supported."])}<p>No traffic, leads, sales or SEO guarantee. Subject to available inventory and final review.</p></article>`
    + `<article><h3>Booking and payment</h3>${list(["US providers only.", "Final availability, provider eligibility, creative/link permission, legal terms and approval are required before booking.", "Payment is confirmed after a reviewed order and readiness checks, before activation.", `PayPal payment details are supplied after a confirmed order. Contact: <a href="mailto:${SPONSOR_BOOKING_EMAIL}">${SPONSOR_BOOKING_EMAIL}</a>.`, "Prices before any applicable tax; final tax-inclusive quote must be agreed.", "Full refund if no conforming placement launches; refund or mutually agreed equivalent extension for undelivered time."])}</article></div>`
    + `<details class="cs-details" data-sponsor-audience><summary>Audience and reporting</summary><p>We do not have a verified audience size or sponsor impression estimate for this proposal. Site visits are not ad impressions. Delivery reports cover the agreed publication dates, URL, duration and captures. Separately labeled aggregate diagnostics are included only when a reliable, permitted measurement source supports them and collection limits are noted. No patient information or health-derived audience is shared.</p></details></section>`;
  const body = `<div data-sponsor-layout="rate-card"><div data-sponsor-lead-grid>${offer}${example}</div>${details}${disclaimer()}</div>`;
  return pageDocument({ route, title: "Sponsor placements · Clinic Scout", description: `A directory panel and provider introduction page for US providers. ${usd(SPONSOR_PRICING.initial)} for 30 days; optional same-scope renewal at ${usd(SPONSOR_PRICING.renewal)}.`, body, robots: SPONSOR_ROBOTS });
}

const PROMO_FACT_SLOTS = Object.freeze([
  ["Program summary", "Awaiting the provider's program summary."],
  ["Published price", "Awaiting a reported price, source and checked date."],
  ["Eligibility and states", "Awaiting eligibility and state availability."],
  ["Current offer", "Awaiting an approved offer and its terms, if available."],
]);

export function renderPromo(order = {}, { preview = true } = {}) {
  const provider = order.provider || EXAMPLE_SPONSOR.provider;
  const slug = order.slug || EXAMPLE_SPONSOR.slug;
  if (!preview) {
    if (!order.operator_approval || !order.partner_creative_approval || !paymentVerified(order) || !order.eligibility_approved || !order.inventory_reserved || !order.starts_at || !order.ends_at) throw Error("Sponsor activation gates missing; authenticated payment required");
    if (/fella/i.test(provider) || order.held !== false || order.us_provider !== true) throw Error("Excluded, held or unverified jurisdiction");
    const url = new URL(order.destination); if (url.protocol !== "https:" || url.username || url.password) throw Error("Invalid approved destination");
    const start = Date.parse(order.starts_at), end = Date.parse(order.ends_at); if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 720 * 3600000 || Date.now() < start || Date.now() >= end) throw Error("Outside paid term");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw Error("Invalid provider slug");
  const route = sponsorPromoRoute(slug);
  const lead = `<section class="p3-rail-card p3-rail-card--cta" data-sponsor-lead aria-labelledby="sponsor-provider-title">`
    + `<p data-sponsor-lead-label><span class="p3-chip p3-chip--status">Sponsored</span></p>`
    + `<h1 class="p3-wrap-title" id="sponsor-provider-title" data-wrap-text>${esc(provider)}</h1>`
    + `<p class="lede">${preview ? "Example page. Provider details will appear here after review." : "See program details. Check current prices and eligibility with the provider."}</p>`
    + `<div class="p3-hero-actions p3-wrap-actions" data-wrap-actions>${sponsorCta({ preview, destination: order.destination })}</div>`
    + `<p class="p3-rail-note" data-sponsor-ad-disclosure>${preview ? "Template only. No provider is being promoted." : sponsorSmallPrint({ provider, preview, affiliate: order.affiliate === true })}</p></section>`;
  const facts = preview
    ? `<section class="cs-card" data-sponsor-facts aria-labelledby="sponsor-facts-title"><h2 id="sponsor-facts-title">Program at a glance</h2><dl>${PROMO_FACT_SLOTS.map(([label, slot]) => `<div data-sponsor-fact-slot><dt>${esc(label)}</dt><dd>${esc(slot)}</dd></div>`).join("")}</dl></section>`
    : "";
  const body = `<div data-sponsor-layout="promo">${facts ? `<div data-sponsor-lead-grid>${lead}${facts}</div>` : lead}`
    + `<section class="p3-detail-grid" data-sponsor-promo-checks><article><h2>Before you choose</h2>${list(["Total cost and renewal terms", "Services included", "Eligibility in your state", "Cancellation and support"])}<p>Confirm these details with the provider.</p></article>`
    + `<article><h2>Compare your options</h2><p>${esc(NO_PAID_RANK)}</p><div class="p3-hero-actions p3-wrap-actions" data-wrap-actions><a class="cs-btn cs-btn--quiet" href="/providers/">Compare providers independently</a></div></article></section>`
    + `${disclaimer()}</div>`;
  return pageDocument({ route, title: `${provider} · Sponsored introduction · Clinic Scout`, description: preview ? "Example provider introduction template. No provider is being promoted." : `Sponsored program information from ${provider}.`, body, robots: SPONSOR_ROBOTS });
}
