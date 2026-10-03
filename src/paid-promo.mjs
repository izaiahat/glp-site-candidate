// GLP-327 paid inventory. Separate from editorial ranking; no activation by default.
// Every surface here is a site page: it is rendered through the Phase 3
// pageDocument(), wrapped by the build's shared shell (header, footer, fonts,
// site-p3.css) and composed only of existing site components. It never emits a
// <style> block, inline style or colour value of its own.
import { pageDocument, breadcrumbs } from "./phase3-page-graph.mjs";
import { renderSponsoredPanel, EXAMPLE_SPONSOR } from "./sponsor-placement-candidate.mjs";

export const SPONSOR_RATE_CARD_ROUTE = "/sponsors/rates/";
export const sponsorPromoRoute = (slug) => `/sponsors/${slug}/`;
// Paid inventory stays out of search and the sitemap until a sponsor is booked.
export const SPONSOR_ROBOTS = "noindex,nofollow,noarchive,nosnippet";
const DISCLAIMER = "GLP Clinic Scout is an independent comparison publisher, not a clinic, pharmacy or medical provider. This page is not medical advice.";
const NO_PAID_RANK = "Sponsored placements never change our independent rankings. No paid top rank, editorial score, favorable review or paid SEO backlink.";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (items) => `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const planCard = ({ id, name, price, terms, items, accent }) => `<article class="p3-plan-card p3-plan-card--${accent}" id="${id}" aria-labelledby="${id}-title"><header class="p3-plan-title"><span class="p3-plan-pill" id="${id}-title">${esc(name)}</span></header><p class="cs-price cs-price--xl">${esc(price)}</p><p>${esc(terms)}</p>${list(items)}</article>`;

export function renderRateCard() {
  const route = SPONSOR_RATE_CARD_ROUTE;
  const plans = [
    planCard({ id: "plan-pilot", accent: "semaglutide", name: "Initial 30-day pilot", price: "$200", terms: "$100 setup + $100 placement and reporting", items: [
      "One responsive Sponsored panel on <strong>/providers/</strong>, after filters and before independent results",
      "One paid introduction page at <strong>/sponsors/{provider}/</strong>",
      "Approved provider identity, factual creative and one approved CTA",
      "One copy correction round, plus required safety corrections",
      "720 consecutive hours from verified activation",
    ] }),
    planCard({ id: "plan-renewal", accent: "tirzepatide", name: "Same-scope renewal", price: "$100", terms: "Another 30 days, by affirmative order only.", items: [
      "Same panel and sponsored page.",
      "No automatic renewal or recurring charge.",
      "Delivery and available aggregate measurement report within five business days of term close.",
    ] }),
  ].join("");
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { label: "Sponsorship rates" }])}`
    + `<section class="p3-index-hero"><p class="gcs-kicker">US-provider sponsorship</p><h1 class="p3-wrap-title" data-wrap-text>Visibility without buying a ranking.</h1><p class="lede">Introduce your program in clearly labeled paid inventory on an independent GLP-1 provider comparison site.</p></section>`
    + `<section class="p3-provider-section p3-plans" aria-labelledby="sponsor-plans"><div class="p3-plan-head"><div><p class="gcs-kicker">Sponsorship rates</p><h2 id="sponsor-plans">Plans</h2></div></div><p class="p3-plan-note">No traffic, leads, sales or SEO guarantee. Subject to available inventory and final review.</p><div class="p3-plan-grid">${plans}</div></section>`
    + `<aside class="p3-source-disclosure affiliate-note table-disclosure" data-sponsor-independence><strong>${esc(NO_PAID_RANK.split(". ")[0])}.</strong> ${esc(NO_PAID_RANK.split(". ").slice(1).join(". "))}</aside>`
    + `<section class="p3-detail-grid"><article><h2>Audience and reporting, honestly</h2><p>Our site offers provider comparisons, cost tools and independent reviews. No verified audience size or sponsor impression estimate is included in this proposal. Unknown is not zero. Site visits are not ad impressions. Only reliably measured, privacy-safe aggregate exposure and outbound clicks would be reported, with collection coverage and limitations. No patient information or health-derived audience is shared.</p></article><article><h2>Booking and payment</h2><p>US providers only. Final availability, provider eligibility, creative/link permission, legal terms and approval are required before booking. Payment is confirmed after a reviewed order and readiness checks, before activation. PayPal remittance: ops@glpclinicscout.com. Prices before any applicable tax; final tax-inclusive quote must be agreed. Full refund if no conforming placement launches; refund or mutually agreed equivalent extension for undelivered time.</p></article></section>`
    + `<aside class="p3-source-disclosure affiliate-note table-disclosure" data-sponsor-disclaimer><p>${esc(DISCLAIMER)}</p></aside>`;
  return pageDocument({ route, title: "Sponsorship rates · Clinic Scout", description: "Clearly labeled paid inventory for US providers. Sponsored placements never change independent rankings.", body, robots: SPONSOR_ROBOTS });
}

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
  const panel = renderSponsoredPanel({ provider, preview, destination: order.destination, affiliate: order.affiliate === true, id: "sponsored-rail-title" });
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: `Sponsored: ${provider}` }])}<a class="p3-card-link" href="/providers/">← Back to provider comparison</a>`
    + `<section class="p3-index-hero"><p class="gcs-kicker">Paid provider introduction</p><p><span class="p3-chip p3-chip--status">Sponsored</span></p><div class="p3-provider-identity p3-wrap-cluster" data-wrap-identity><span class="provider-logo provider-logo--wordmark" role="img" aria-label="${esc(provider)}"><span class="provider-wordmark" aria-hidden="true">${esc(provider)}</span></span><h1 class="p3-wrap-title" data-wrap-text>${esc(provider)}</h1></div><p class="lede">This is advertising, not an independent review or a recommendation. Compare costs, terms and eligibility before choosing a provider.</p></section>`
    + `<div class="p3-detail-layout" data-detail-layout><div class="p3-detail-main"><section class="p3-detail-grid"><article><h2>What to check</h2>${list(["Current total cost and renewal terms", "Program details and available services", "State and individual eligibility", "Cancellation, support and provider terms"])}<p>Information is reported by the provider. We make no treatment, medication, clinician, licensure or outcome claim here.</p></article><article><h2>Your comparison stays independent</h2><p>This paid page and any clearly labeled directory panel sit outside our organic provider rankings.</p><p>Sponsored placements never change our independent rankings.</p><a class="cs-btn cs-btn--quiet" href="/providers/">Compare providers independently</a></article></section>`
    + `<aside class="p3-source-disclosure affiliate-note table-disclosure" data-sponsor-disclaimer><p>${esc(DISCLAIMER)} Sponsored placements never change our independent rankings.</p></aside></div><div class="p3-detail-rail">${panel}</div></div>`;
  return pageDocument({ route, title: `${provider} · Sponsored introduction · Clinic Scout`, description: `A clearly labeled paid introduction to ${provider}. Advertising, not an independent review.`, body, robots: SPONSOR_ROBOTS });
}
