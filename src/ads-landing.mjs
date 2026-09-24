import { selectedFamilyStyles } from "./selected-family-styles.mjs";
import { collectEvidenceDates, deriveMoneyPageFreshness } from './freshness.mjs';
// LP-A — the paid brand-review landing page (SPEC-ADS §3.1, B-17).
//
// WHAT THIS IS
// ------------
// The destination for the `Brand-Reviews_P0` campaign: somebody typed
// "orderly meds reviews" and clicked an ad. Message match beats a generic ranked
// list for that query class, so this page answers the brand question first and
// offers the ladder second.
//
// WHY IT IS A STANDALONE DOCUMENT
// -------------------------------
// The speed gate is non-negotiable: ≤15 requests, ≤300 KB transfer, LCP < 1.0s
// on mid-tier mobile. The sitewide chrome alone (site.css + site.js + two
// variable fonts + consent + analytics) spends most of that budget on things a
// paid landing page does not use. So this template ships its own inline critical
// CSS, a system font stack, and exactly the two same-origin scripts that make
// the click measurable — and `scripts/validate-lp-speed.mjs` fails the build if
// that ever stops being true.
//
// WHAT IT DELIBERATELY DOES NOT HAVE (SPEC-ADS §3.3)
// --------------------------------------------------
// No email capture, no quiz interstitial, no exit intent, no chat widget, no
// countdown or stock counter, no `AggregateRating`/star markup, no third-party
// script beyond GA4/PostHog. And no ranking that tracks payout: the rail below
// is ordered by the same published rubric the organic site uses.
import { CITATION_REASONS, renderCitationAnchor } from "./citation-attribution.mjs";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const usd = (value) => `$${Number(value).toLocaleString("en-US")}`;

import { isTypedPrice, renderTypedPrice } from "./typed-price-labels.mjs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `[month]`/`[year]` resolve at BUILD time; nothing about the headline is user-supplied. */
export function resolveHeadlineTokens(text, isoDate) {
  const [year, month] = String(isoDate).split("-");
  return String(text)
    .replaceAll("[month]", MONTHS[Number(month) - 1] || "")
    .replaceAll("[year]", year || "");
}

/**
 * The `h=` mechanism (SPEC-ADS §3.4) — Forbes' `kh1` clone, done safely.
 * Free text from the query string is never written into the DOM. `h=` indexes a
 * build-time allowlist baked into the page; an unknown key falls back to the
 * default H1. That is the whole surface area.
 */
export function headlineScript(map) {
  const allow = JSON.stringify(map);
  return `<script>(()=>{const M=${allow};const k=new URLSearchParams(location.search).get('h');if(!k||!Object.prototype.hasOwnProperty.call(M,k))return;const h=document.getElementById('lp-h1');if(h)h.textContent=M[k];})();</script>`;
}

const CRITICAL_CSS = `/* pass5-paid-landing-dark */:root{color-scheme:dark;--ink:#f2f8f4;--muted:#a7bfb5;--paper:#07100d;--card:#101d18;--line:rgba(233,247,241,.13);--green:#3fd9a4;--gold:#f0b23f;--blue:#6fd8ff;--focus:#7fe3ff;--on-accent:#04120e;--grad:linear-gradient(104deg,#17a87e 0%,#3fd9a4 38%,#6fc6ee 72%,#a99bf2 100%)}
*{box-sizing:border-box}html{background:var(--paper)}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-underline-offset:.16em}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
body:has(.sticky){--sticky-clearance:96px}
/* Standalone LPs do not load the shared shell palette. Keep consent readable
   on its own opaque surface, including the first visible entrance frame. */
section#gcs-consent{--text-primary:var(--ink);--text-secondary:var(--muted);--color-surface-float:var(--card);--color-line-strong:var(--line);--color-interactive:var(--blue);--action-primary:var(--green);--text-on-accent:var(--on-accent);background:var(--card);color:var(--ink);animation:none}
.lp-strip{height:4px;background:var(--grad)}
.wrap{width:min(980px,calc(100% - 32px));margin-inline:auto}
header.lp{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 18px;padding:14px 0}
.brand{font-weight:900;letter-spacing:.01em}
.stamp{font-size:.82rem;font-weight:700;color:var(--muted)}
details.disc{font-size:.82rem;color:var(--muted);max-width:70ch}
details.disc summary{cursor:pointer;font-weight:800;min-height:44px;display:flex;align-items:center}
h1{font-size:clamp(1.7rem,4vw,2.5rem);line-height:1.15;margin:.2em 0 .3em;text-wrap:balance}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:clamp(18px,3vw,26px);margin:18px 0}
.card--verdict{border-color:transparent;box-shadow:0 0 0 1px rgba(70,214,162,.55),0 0 24px -6px rgba(70,214,162,.45)}
.score{display:flex;align-items:baseline;gap:10px;font-weight:900}
.score b{font-size:2rem;line-height:1}
.score span{font-weight:700;color:var(--muted)}
.price{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin:12px 0}
.price b{font-size:clamp(1.7rem,4vw,2.2rem);line-height:1;color:var(--green)}
.price s{color:var(--muted)}
.chip{display:inline-flex;align-items:center;padding:3px 9px;border:1px solid currentColor;border-radius:999px;font-size:.72rem;font-weight:800;color:var(--muted)}
ul.ticks{margin:14px 0;padding:0;list-style:none;display:grid;gap:8px}
ul.ticks li{padding-left:26px;position:relative}
ul.ticks li::before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:900}
.cta{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:12px 24px;border-radius:999px;background-image:var(--grad);background-size:180% 100%;color:var(--on-accent)!important;font-weight:900;text-decoration:none;width:100%;text-align:center;transition:background-position .25s ease,transform .12s ease,box-shadow .25s ease}
.cta:hover{background-position:100% 0;transform:translateY(-1px);box-shadow:0 16px 40px -15px rgba(111,198,238,.66)}
.cta:active{transform:scale(.98)}
.cta--row,.rail .cta{min-width:260px;min-height:44px;width:max-content;padding:10px 16px;font-size:.9rem;white-space:nowrap}
.table-disclosure{margin:14px 0 10px;font-size:.86rem;color:var(--muted)}
.caveat{border-left:4px solid var(--gold);background:rgba(240,178,63,.14);padding:12px 16px;border-radius:8px;font-size:.92rem}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table.rail{width:100%;border-collapse:collapse;font-size:.92rem}
table.rail th,table.rail td{padding:10px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
table.rail th{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.rail-wrap{overflow-x:auto}
ol.src{padding-left:20px;font-size:.86rem;color:var(--muted)}
footer.lp{margin:32px 0 120px;font-size:.82rem;color:var(--muted)}
footer.lp p{max-width:80ch}
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;align-items:center;gap:12px;padding:10px 16px;background:#15251f;border-top:1px solid var(--line);box-shadow:0 -8px 24px rgba(0,0,0,.42)}
.sticky .cta{width:auto;flex:1;min-height:48px}
.sticky b{white-space:nowrap}
@media(max-width:640px){.sticky{padding:8px 12px}.sticky b{display:none}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

/**
 * @param provider   { slug, name, score, reviewPath }
 * @param price      matrix medication row (dated + cited) or null
 * @param advertised optional advertised figure to strike through, when it differs
 * @param bullets    4 benefit lines, price first (SPEC-ADS §3.1.3)
 * @param caveat     the honest caveat that must sit INSIDE the fold
 * @param rail       [{ name, score, differentiator, price, checked, cta }]
 * @param sources    [{ url, publisher, verified_as_of }]
 * @param cta        fully-instrumented primary affiliate anchor markup
 * @param stickyCta  the same anchor with the sticky element code
 */
export function renderAdsLandingPage({
  provider, price, typedPrices = [], advertised = null, bullets, caveat, rail = [], sources = [],
  cta, stickyCta, headlines, defaultHeadline, checkedThrough, disclosure, fdaFootnotes = [], stickyEnabled = true, analyticsAssetUrl = "/assets/analytics.js",
}) {
  if (!provider?.slug || !provider?.name) throw new Error("lp_provider_identity_invalid");
  if (!Array.isArray(bullets) || bullets.length !== 4) throw new Error("lp_bullets_contract_invalid");
  if (!cta) throw new Error("lp_primary_cta_missing");
  const priceRows = [price, ...typedPrices, ...rail.flatMap(item => item.typedPrices || [])].filter(Boolean);
  const witnesses = priceRows.flatMap(row => [...(row.evidence || []), ...(row.identity_evidence || []), ...Object.values(row.facts || {}).flatMap(fact => fact.evidence || [])]);
  const dates = collectEvidenceDates({ priceChecks: priceRows.map(row => row.captured_on), railChecks: rail.map(item => item.checked), checkedThrough, captures: witnesses.map(w => String(w.captured_at_utc).slice(0, 10)) });
  const freshness = deriveMoneyPageFreshness({ path: `/lp/r/${provider.slug}/`, sources: [...sources, ...[...dates].map(verified_as_of => ({ verified_as_of }))] });
  const url = `https://glpclinicscout.com/lp/r/${provider.slug}/`;
  const typedBlock = [...new Map([...typedPrices, ...(isTypedPrice(price) ? [price] : [])].filter(isTypedPrice).map(row => [row.row_id, row])).values()].map(row => renderTypedPrice(row, { showDate: false })).join("");
  const priceBlock = isTypedPrice(price) ? typedBlock : price
    ? `<p class="price"><b>${usd(price.ongoing_usd)}</b><span>/${esc(price.cadence)}</span>${advertised && advertised !== price.ongoing_usd ? `<s>${usd(advertised)}</s>` : ""}</p><p style="margin:0;font-size:.86rem;color:var(--muted)">${esc(price.label)}, captured verbatim from ${esc(provider.name)}&rsquo;s own page: &ldquo;${esc(price.quote)}&rdquo; &middot; ${renderCitationAnchor({ url: price.source_url, label: "open the source", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE })}</p>`
    : `<p class="price"><b style="font-size:1.2rem;color:var(--muted)">Price not yet substantiated for this product/plan</b></p>`;
  const railRows = rail
    .filter((item) => Number.isFinite(item.price) || (item.typedPrices || []).some(isTypedPrice))
    .map((item) => `<tr><td><strong>${esc(item.name)}</strong><br><span style="color:var(--muted)">${esc(item.differentiator)}</span></td><td>${item.score === null ? "Pending" : `${esc(item.score.toFixed(1))}/10`}</td><td>${Number.isFinite(item.price) ? `${usd(item.price)}` : ""}${(item.typedPrices || []).filter(isTypedPrice).map(row => renderTypedPrice(row, { showDate: false })).join("")}</td><td>${item.cta}</td></tr>`)
    .join("");
  const sourceList = sources.map((source) => `<li>${renderCitationAnchor({ url: source.url, label: source.publisher, reason: CITATION_REASONS.REVIEW_SOURCE_LEDGER })} &middot; checked ${esc(source.verified_as_of)}</li>`).join("");
  const footnotes = fdaFootnotes.map((line) => `<p>${esc(line)}</p>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex,follow,max-image-preview:large">`
    + `<title>${esc(defaultHeadline)} | Clinic Scout</title>`
    + `<meta name="description" content="${esc(`An independent, dated review of ${provider.name}: what it publishes, what it costs, and how it compares.`)}">`
    + `<link rel="canonical" href="${esc(url)}">`
    + `<style>${CRITICAL_CSS}</style>${provider.slug === "orderlymeds" ? selectedFamilyStyles("/lp/r/orderlymeds/") : ""}</head>`
    + `<body data-page-slug="lp-r-${esc(provider.slug)}" data-lp-variant="a">`
    + `<div class="lp-strip" aria-hidden="true"></div>`
    + `<div class="wrap"><header class="lp"><span class="brand">Clinic Scout</span><span class="stamp">Prices checked <span data-prices-checked-date>${esc(freshness.source_checked_from)} – ${esc(freshness.source_checked_through)}</span></span></header>`
    + `<details class="disc affiliate-note"><summary>Advertising disclosure</summary><p>${esc(disclosure)}</p></details>`
    + `<main>`
    + `${provider.slug === "orderlymeds" ? '<div class="d3-orderly-hero">' : ""}<h1 id="lp-h1">${esc(defaultHeadline)}</h1>`
    + `<section class="card card--verdict">`
    + `<p class="score"><b>${esc(provider.score === null ? "—" : provider.score.toFixed(1))}</b><span>/10 &middot; our published rubric</span></p>`
    + priceBlock + (!isTypedPrice(price) ? typedBlock : "")
    + `<ul class="ticks">${bullets.map((line) => `<li>${esc(price?.captured_on ? line.replace(`, checked ${price.captured_on}.`, '.') : line)}</li>`).join("")}</ul>`
    + `<p class="table-disclosure">The buttons on this page are sponsored links: if you sign up through one, we may earn a commission at no extra cost to you. The alternatives below use the published evidence rubric. They are not clinical recommendations.</p>`
    + cta
    + `<p style="margin:10px 0 0;font-size:.8rem;color:var(--muted)">Clinic Scout is reader-supported. We may earn a commission if you sign up through this link, at no extra cost to you. Check the ordering method stated for each comparison; payment is not evidence of quality, safety or medical suitability.</p>`
    + `<p class="caveat">${esc(caveat)}</p>`
    + `</section>${provider.slug === "orderlymeds" ? "</div>" : ""}`
    + `<section class="card"><h2>How ${esc(provider.name)} compares</h2><p class="table-disclosure" style="margin-top:0">Ordered by the same published rubric the rest of the site uses. Never by what a program pays.</p>${provider.slug === "orderlymeds" ? '<p id="d3-rail-hint">Swipe or use arrow keys in the focused comparison table to see every column.</p>' : ""}<div class="rail-wrap"${provider.slug === "orderlymeds" ? ' tabindex="0" role="region" aria-label="Provider comparison" aria-describedby="d3-rail-hint"' : ""}><table class="rail"><thead><tr><th>Program</th><th>Score</th><th>Published price</th><th></th></tr></thead><tbody>${railRows}</tbody></table></div><p style="font-size:.84rem;color:var(--muted)">Compounded semaglutide and compounded tirzepatide are not FDA-approved and have not been evaluated by the FDA for safety or effectiveness.</p></section>`
    + `<section class="card"><h2>What we checked</h2><ol class="src">${sourceList}</ol><p style="font-size:.86rem"><a href="/how-we-rate/">How we rate — the weights are published</a> &middot; <a href="${esc(provider.reviewPath)}">Read the full ${esc(provider.name)} review</a></p></section>`
    + `</main>`
    + `<footer class="lp">${footnotes}<p>This page is consumer research, not medical advice. It does not diagnose, prescribe, or determine eligibility. Talk to a licensed clinician.</p><p>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</p><p><a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a> · <a href="/how-we-make-money/">How we make money</a></p></footer>`
    + `</div>`
    + (stickyEnabled ? `<div class="sticky" data-lp-sticky><b>${esc(provider.score === null ? provider.name : `${provider.name} ${provider.score.toFixed(1)}/10`)}</b>${stickyCta}</div>` : "")
    + headlineScript(headlines)
    + `<script src="/assets/consent.js" defer></script><script src="${analyticsAssetUrl}" defer></script>`
    + `</body></html>`;
}

export const adsLandingContract = Object.freeze({
  route: "/lp/r/{provider}/",
  robots: "noindex,follow",
  inSitemap: false,
  adsBotAllowed: true,
  emailCapture: false,
  quiz: false,
  countdown: false,
  aggregateRating: false,
  thirdPartyScripts: ["ga4", "posthog"],
  speedBudget: { requests: 15, transferKb: 300, lcpSeconds: 1.0 },
  headlineMechanism: "build_time_allowlist_h_param",
  rankOrder: "published_rubric_never_payout",
});
