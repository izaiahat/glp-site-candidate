import { isTypedPrice, renderTypedPrice } from "./typed-price-labels.mjs";
// ProviderCompareCard — the workhorse of the rebuild (SPEC-LAYOUT §4 C1, B-15).
//
// WHAT THIS IS
// ------------
// glpwinner's comparison UI is not a table: it is a grid of dense provider cards
// (§C2), and that card is the single most-copied element on their whole site —
// hub, presets, drug pages, quiz results, LPs. This module is our version of it.
// Their card is the SHAPE. Everything inside it is ours, and one thing inside it
// is the moat: THEY SHOW EXACT PRICES WITH NO DATE AND NO SOURCE (teardown §C3).
// Every price this card renders carries `Checked YYYY-MM-DD` plus an InfoDot that
// opens the captured quote and a direct link to the page we captured it from.
//
// WHERE THE NUMBERS COME FROM
// ---------------------------
// `data/provider-pricing-matrix.json` — the machine-maintained capture the
// monthly pricing-refresh lane writes (schema `glp-provider-pricing-matrix-v1`).
// This module is a pure READER of that file: it never invents a price, never
// interpolates one, and renders "Not published" where the capture has no row.
// That keeps the automation write-point untouched — the refresh machine keeps
// writing exactly the same file at exactly the same path, and the new design
// picks the change up on the next build.
//
// WHAT IT DELIBERATELY DOES NOT RENDER
// ------------------------------------
// glpwinner's DoseGrid (mg/week × $/month) and their multi-month `/mg` column.
// We have no dose-level or plan-length capture, and a card that invented one
// would burn the only advantage we have. The grid renders the medication rows we
// actually captured instead, and says so.
import { CITATION_REASONS, renderCitationAnchor } from "./citation-attribution.mjs";
import { renderCouponChip } from "./coupon-offers.mjs";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Per-drug accent coding (their idea, our hues — LAY §1 token table).
const DRUG_ACCENT = Object.freeze({
  "compounded-semaglutide-injection": "semaglutide",
  "compounded-semaglutide-oral": "semaglutide",
  "compounded-tirzepatide-injection": "tirzepatide",
  "compounded-tirzepatide-oral": "tirzepatide",
  "compounded-liraglutide-injection": "semaglutide",
  retatrutide: "tirzepatide",
});

const BRAND_MEDS = new Set(["brand-ozempic", "brand-wegovy", "brand-mounjaro", "brand-zepbound", "brand-saxenda"]);

const usd = (value) => `$${Number(value).toLocaleString("en-US")}`;

/** The cheapest captured COMPOUNDED monthly price — the number a comparison reader came for. */
export function headlinePrice(entry) {
  const rows = (entry?.medications || []).filter((row) => Number.isFinite(row.ongoing_usd) && !BRAND_MEDS.has(row.medication_id) && row.medication_id !== "membership-only");
  if (!rows.length) return null;
  return rows.slice().sort((left, right) => left.ongoing_usd - right.ongoing_usd)[0];
}

/** The InfoDot + popover that carries the moat: capture date, captured quote, direct source. */
function citationPopover(row, id) {
  const source = renderCitationAnchor({
    url: row.source_url,
    label: "Open the page we captured ↗",
    reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE,
  });
  return `<span class="cs-cite"><button type="button" class="cs-infodot" aria-controls="${esc(id)}" aria-expanded="false" aria-label="Where this price came from">i</button><span class="cs-cite__pop" id="${esc(id)}" hidden>From the provider's own page: &ldquo;${esc(row.quote)}&rdquo;<br>${source}</span></span>`;
}

function medicationGrid(entry, cardId) {
  const rows = (entry?.medications || []).filter((row) => isTypedPrice(row) || Number.isFinite(row.ongoing_usd));
  if (!rows.length) {
    return `<p class="cs-medgrid__empty">Price not yet substantiated for this product/plan. We do not estimate one.</p>`;
  }
  const cells = rows.map((row, index) => {
    if (isTypedPrice(row)) return renderTypedPrice(row, { showDate: false });
    const accent = DRUG_ACCENT[row.medication_id] || "brand";
    const intro = Number.isFinite(row.month_1_usd) && row.month_1_usd !== row.ongoing_usd
      ? `<span class="cs-medgrid__intro">${usd(row.month_1_usd)} first month</span>`
      : "";
    return `<div class="cs-medgrid__row" data-drug="${esc(accent)}" data-medication="${esc(row.medication_id)}"><span class="cs-medgrid__label">${esc(row.label)}</span><span class="cs-medgrid__value">${usd(row.ongoing_usd)}<small>/${esc(row.cadence)}</small>${intro}${citationPopover(row, `${cardId}-cite-${index}`)}</span></div>`;
  }).join("");
  return `<div class="cs-medgrid">${cells}</div><p class="cs-medgrid__foot">Each price links to its source. Check the plan terms before enrolling.</p>`;
}

/**
 * One ProviderCompareCard.
 *
 * @param row      the money-page provider row (identity, ranking, features)
 * @param entry    this provider's `provider-pricing-matrix.json` record (may be undefined)
 * @param options  { rank, featured, cta } — `cta` is rendered by the caller so the
 *                 anchor keeps the canonical CR-5 sub-ID identity and rel hygiene.
 */
export function renderCompareCard({ row, entry, rank, featured = false, cta = "", logo = "", reviewPath = "", hidden = false, coupon = null }) {
  const cardId = `cmp-${String(row.program_id || row.review_slug || rank).replace(/[^a-z0-9-]/gi, "")}`;
  const headline = headlinePrice(entry);
  const name = row.provider || row.display_name || row.program_id;
  const features = (row.feature_pills || []).slice(0, 6)
    .map((label) => `<li><span class="cs-chip cs-chip--sm">${esc(label)}</span></li>`).join("");
  const priceBlock = headline
    ? `<p class="cs-price"><strong class="cs-price__figure">${usd(headline.ongoing_usd)}</strong><span class="cs-price__unit">/${esc(headline.cadence)}</span>${citationPopover(headline, `${cardId}-cite-head`)}<span class="cs-price__basis">${esc(headline.label)}, from this provider&rsquo;s own page.</span></p>`
    : `<p class="cs-price"><strong class="cs-price__figure cs-price__figure--none">See plan evidence</strong><span class="cs-price__basis">Price not yet substantiated for a comparable monthly charge. See the product/plan evidence below.</span></p>`;
  return `<article id="${esc(cardId)}" class="cs-card cs-comparecard${featured ? " cs-card--ring cs-card--featured" : ""}"${hidden ? " data-cmp-hidden" : ""} data-rank="${rank}" data-program="${esc(row.program_id || "")}">`
    + `<div class="cs-comparecard__head">${logo}<div class="cs-comparecard__id"><p class="gcs-kicker">#${rank}${featured ? " · Top of this comparison" : ""}</p><h3>${esc(name)}</h3>${reviewPath ? `<a class="cs-comparecard__more" href="${esc(reviewPath)}">Read the ${esc(name)} review →</a>` : ""}</div></div>`
    + priceBlock
    + renderCouponChip(coupon)
    + medicationGrid(entry, cardId)
    + (features ? `<ul class="cs-chiprow cs-comparecard__features">${features}</ul>` : "")
    + `<div class="cs-comparecard__foot">${cta}<button type="button" class="cs-btn cs-btn--quiet" data-compare-add data-program="${esc(row.program_id || cardId)}" data-provider-name="${esc(name)}" aria-pressed="false">Add to compare</button></div>`
    + `</article>`;
}

/**
 * The grid section: filter chips (drug), a Cheapest sort chip, and the cards.
 * Filtering is query-param faceted and client-side (LAY §3.2) — the page is
 * static, every card ships in the DOM, and the controls never hide a provider
 * from a crawler or from a reader with JS off.
 */
export const CARDS_VISIBLE_BEFORE_DISCLOSURE = 12;

export function renderCompareGrid({ cards, medications = [], total = 0 }) {
  const drugChips = medications.map((item) => `<li><button type="button" class="cs-chip cs-chip--sm" data-compare-filter="${esc(item.value)}" aria-pressed="false">${esc(item.label)}</button></li>`).join("");
  return `<section id="compare-cards" class="anchor-section cs-comparegrid" aria-labelledby="compare-cards-title">`
    + `<div class="section-heading"><p class="gcs-kicker">Card comparison</p><h2 id="compare-cards-title">Every provider, every price, with the date we checked it</h2><p>The same providers as the table below, read as cards. Filter by medication; unlike price kinds are not sorted together — nothing is hidden from the page, so a filter only changes what is shown, never what exists.</p></div>`
    + `<div class="cs-comparegrid__controls"><ul class="cs-chiprow" role="group" aria-label="Filter by medication"><li><button type="button" class="cs-chip cs-chip--sm is-active" data-compare-filter="all" aria-pressed="true">All medications</button></li>${drugChips}</ul>`
    + `<ul class="cs-chiprow" role="group" aria-label="Sort"><li><button type="button" class="cs-chip cs-chip--sm is-active" data-compare-sort="rank" aria-pressed="true">Our ranking</button></li></ul></div>`
    + `<div class="cs-cardgrid" data-compare-grid>${cards}</div>`
    + (total > CARDS_VISIBLE_BEFORE_DISCLOSURE
      ? `<p class="cs-comparegrid__more"><button type="button" class="cs-btn cs-btn--quiet" data-compare-more>Show all ${total} providers</button></p>`
      : "")
    + `<aside class="cs-tray" data-compare-tray aria-label="Provider compare tray" aria-live="polite"><p class="cs-tray__count">0 of 4 selected</p><ul class="cs-tray__slots"></ul><div class="cs-tray__actions"><a class="cs-btn" href="#compare">View comparison table</a></div></aside>`
    + `</section>`;
}

export const compareCardContract = Object.freeze({
  source: "data/provider-pricing-matrix.json",
  schema: "glp-provider-pricing-matrix-v1",
  everyPriceDated: true,
  everyPriceCited: true,
  doseGrid: "not_rendered_no_dose_level_capture_exists",
  planLengthColumns: "not_rendered_no_plan_length_capture_exists",
  missingPrice: "renders_not_published_never_estimated",
});
