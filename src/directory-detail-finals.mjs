import { isTypedPrice, typedPriceText, renderTypedPrice, renderPriceWitnesses } from "./typed-price-labels.mjs";
// Fable FD-004: shared source-bound amounts for desktop rows and mobile definition lists.
// No numeric coercion, invented cadence, inferred first-month price or copied exhibit prices.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number.isFinite(value) && value >= 0 ? new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:2}).format(value) : null;
export function priceModel(row = {}) {
  if (isTypedPrice(row)) return { typed: true, label: String(row.label || row.medication_id), text: typedPriceText(row) };
  const bound = Boolean(row.source_url && /^https:\/\//.test(row.source_url) && /^\d{4}-\d{2}-\d{2}$/.test(row.captured_on || ''));
  return {
    label: String(row.label || row.medication_id || 'Medication not stated'),
    first: bound ? money(row.month_1_usd) : null,
    ongoing: bound ? money(row.ongoing_usd) : null,
    firstUnknown: String(row.month_1_unavailable_reason || (row.month_1_basis === 'same_as_ongoing' ? 'No separate first-month rate reported.' : 'First-month amount not reported in this price row.')),
    cadence: String(row.cadence || 'Cadence not stated'),
    qualifier: String(row.notes || row.quote || ''),
    source: bound ? row.source_url : null,
    captured: bound ? row.captured_on : null,
  };
}
export function finalsCss() {
  return `<style data-preserve>
.d3-price-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;min-width:0}.d3-price-box{padding:24px;border:1px solid #718d86;border-radius:20px;background:#123e36;color:#fff;min-width:0;overflow-wrap:anywhere}.d3-price-box h3{color:#fff;margin:0 0 16px}.d3-price-box .d3-amount{font-size:clamp(24px,3vw,38px);line-height:1.2}.d3-price-box p,.d3-price-box small{color:#fff}.d3-price-box a{color:#fff;text-decoration:underline}.d3-price-box small{display:block;margin-top:12px}.d3-detail-hero{display:grid;gap:28px;align-items:center}.d3-directory-table{width:100%;border-collapse:collapse;background:#f6f3e9;color:#173a32}.d3-directory-table th,.d3-directory-table td{padding:12px 16px;text-align:left;vertical-align:top;border-bottom:1px solid #75877d}.d3-directory-table a,.d3-directory-table strong{color:#173a32}.d3-directory-table caption{text-align:left;padding:16px}.d3-mobile-cards{display:none}.d3-ledger{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0}.d3-ledger>div{min-width:0}.d3-ledger dt{font-weight:700}.d3-ledger dd{margin:6px 0 0;overflow-wrap:anywhere}.d3-ledger-med,.d3-ledger-source{grid-column:1/-1}.d3-directory-card{padding:24px;border:1px solid #718d86;border-radius:20px;background:#123e36;color:#fff;min-width:0}.d3-directory-card a,.d3-directory-card h3{color:#fff}.d3-directory-card a{text-decoration:underline}.d3-directory-card small{display:block;color:inherit}.d3-directory-card p,.d3-directory-card dd,.d3-directory-card dt{color:#fff}
.d3-price-box strong{color:#fff}
.p3-page .d3-directory-table :is(caption,th,th p){color:#173a32}.d3-directory-table caption{background:#f6f3e9}
.d3-hero-prices{min-width:0}.p3-plans .p3-plan-grid{grid-template-columns:minmax(0,1fr)}
.d3-price-pair{grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr))}
@media(min-width:1024px){.p3-page.p3-detail-page .d3-profile-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:40px}.d3-profile-hero>:not(.d3-hero-prices){grid-column:1}.d3-profile-hero .d3-hero-prices{grid-column:2;grid-row:1;align-self:start}}
.d3-directory-table .p3-provenance,.d3-directory-card .p3-provenance{color:inherit}.d3-directory-prices{margin-block:40px}.d3-directory-hero .p3-hero-actions{padding:24px;border:1px solid #718d86;border-radius:20px;background:#123e36}.d3-directory-hero .p3-source-disclosure{margin:0;color:#fff;background:transparent}.d3-directory-hero .p3-source-disclosure strong{color:#fff}
@media(min-width:1024px){.d3-directory-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:40px}.d3-directory-hero>:not(.p3-hero-actions){grid-column:1}.d3-directory-hero .p3-hero-actions{grid-column:2;grid-row:1/span 4;align-self:center;display:grid}}
@media(min-width:1024px){.d3-detail-hero{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
@media(max-width:768px){.d3-price-pair{grid-template-columns:1fr}.d3-directory-table{display:none}.d3-mobile-cards{display:grid;gap:20px}}
.d3-amount{font-family:var(--font-display,"Manrope",sans-serif);font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap;font-size:1.25rem}.d3-price-box .d3-absence{font-size:1rem;line-height:1.5;font-weight:400;color:#d9e8e0}.d3-plan-terms{font-size:1rem;line-height:1.45;margin:6px 0;color:#51645c}.d3-price-box .d3-plan-terms,.d3-directory-card .d3-plan-terms{color:#d9e8e0}.d3-directory-table th:nth-child(2){width:22%}.d3-directory-table p{margin-block:6px}.d3-directory-table .typed-price{font-size:1rem}.d3-directory-table .typed-price :is(h3,h4){font-size:1rem;color:inherit}.d3-directory-table .typed-price p{color:inherit}.d3-directory-card .d3-amount{color:#fff}
</style>`;
}
function provenance(model, sourceLink) {
  return model.source ? `<span class="p3-provenance" data-source-checked="${escape(model.captured)}">Reported information</span> · ${sourceLink(model.source)}` : 'Price source and capture date not bound.';
}
// A typed offer retains its complete S11 label/evidence; never project it into
// first-month/thereafter cash slots. Div avoids nested sections in pass2's hero seam.
// The heading level travels with the seat, because the same block is mounted at two
// different depths. In a card or a detail price box it sits under that container's
// own h3/h1 and stays an h4. In the desktop price-ledger table it sits directly under
// the section h2 "Reported plan prices and billing terms", where an h4 is a real
// h2 -> h4 heading-order skip - the serious finding the registered accessibility
// producer reports on the listing family (GLP-38 WO-15). There it is that section's
// h3: the same heading with the same words, nothing removed and nothing invented.
function typedBlock(row, headingLevel = 4) {
  return renderTypedPrice(row, { headingLevel }).replace('<section ', '<div ').replace(/<\/section>$/, '</div>');
}
export function renderProgramCardCount(count) {
  if (!Number.isSafeInteger(count) || count < 0) throw Error('directory_program_card_count_invalid');
  return `<p class="d3-program-card-count" data-program-card-count="${count}">${count} program cards. Filters and sorting need JavaScript.</p>`;
}
// A bound LEGACY cash row (no `price_kind`) carries exactly the evidence a typed row does:
// an https source_url, a YYYY-MM-DD captured_on and the captured wording. It therefore renders
// the SAME typed provenance as every other priced row - a dated `Price source` citation anchor
// plus the `Captured wording` disclosure - instead of the retired untyped
// `<summary>Price source</summary>` string. Nothing is invented: an UNBOUND row still emits no
// evidence at all (priceModel() already withholds its amounts and `provenance()` states that the
// price source and capture date are not bound), and a row whose captured wording cannot be quoted
// gets sanitizeCapturedWording()'s own honest empty state, never a fabricated quotation.
function capturedPriceEvidence(row, model) {
  if (!model.source || !model.captured) return '';
  return `<ul aria-label="Dated price evidence">${renderPriceWitnesses([{source_url: model.source, captured_at_utc: model.captured, quote: row.quote}])}</ul>`;
}
export function renderPricePair(row, sourceLink) {
  if (isTypedPrice(row)) return `<div class="d3-price-box d3-typed-offer">${typedBlock(row)}</div>`;
  const m = priceModel(row);
  const amount = (value, explanation) => value ? `<strong class="d3-amount">${escape(value)}</strong>` : `<p class="d3-absence">Not separately reported</p><p class="d3-plan-terms">${escape(explanation)}</p>`;
  const disclosure = capturedPriceEvidence(row, m);
  return `<div class="d3-price-pair" role="group" aria-label="Reported plan prices"><article class="d3-price-box"><h3>First month</h3>${amount(m.first,m.firstUnknown)}<small>${provenance(m,sourceLink)}</small>${disclosure}</article><article class="d3-price-box"><h3>Thereafter</h3>${amount(m.ongoing,'Ongoing amount not reported')}${m.ongoing ? `<span> / ${escape(m.cadence)}</span>` : ''}<p class="d3-plan-terms">${escape(m.qualifier)}</p><small>${provenance(m,sourceLink)}</small>${disclosure}</article></div>`;
}
export function renderDirectoryFinal(rows, sourceLink) {
  // Caller owns provider eligibility and canonical review identity. One input row = one medication/plan.
  const model = rows.map(row => ({...row, priceRow:row.price, price:priceModel(row.price)}));
  const identity = r => `<strong>${escape(r.provider)}</strong><p>${escape(r.price.label)}</p><a href="${escape(r.review)}" data-card-review>Read the review</a>`;
  for (const r of model) if (!r.review?.startsWith('/reviews/') || r.review.startsWith('//')) throw Error('directory_review_identity_missing');
  const first = m => m.first ? `<strong class="d3-amount">${escape(m.first)}</strong>` : `<span>Not separately reported</span><p class="d3-plan-terms">${escape(m.firstUnknown)}</p>`;
  const ongoing = (m, notes = true) => `${m.ongoing ? `<strong class="d3-amount">${escape(m.ongoing)}</strong>` : 'Ongoing amount not reported'}${m.ongoing ? ` / ${escape(m.cadence)}` : ''}${notes ? `<p class="d3-plan-terms">${escape(m.qualifier)}</p>` : ''}`;
  const desktop = model.map(r => r.price.typed ? `<tr data-directory-row="${escape(r.id)}"><th scope="row">${identity(r)}</th><td colspan="2">${typedBlock(r.priceRow, 3)}</td><td>See dated evidence beside the typed offer.</td></tr>` : `<tr data-directory-row="${escape(r.id)}"><th scope="row">${identity(r)}</th><td>${first(r.price)}</td><td>${ongoing(r.price)}</td><td>${provenance(r.price,sourceLink)}</td></tr>`).join('');
  const mobile = model.map(r => r.price.typed ? `<article class="d3-directory-card" data-directory-row="${escape(r.id)}" data-directory-price-card><h3>${escape(r.provider)}</h3>${typedBlock(r.priceRow)}<a href="${escape(r.review)}" data-card-review>Read the review</a></article>` : `<article class="d3-directory-card" data-directory-row="${escape(r.id)}" data-directory-price-card><h3>${escape(r.provider)}</h3><dl class="d3-ledger"><div class="d3-ledger-med"><dt>Medication</dt><dd>${escape(r.price.label)}</dd></div><div><dt>First month</dt><dd>${first(r.price)}</dd></div><div><dt>Thereafter</dt><dd>${ongoing(r.price,false)}</dd></div><div class="d3-ledger-source"><dt>Plan terms</dt><dd>${escape(r.price.qualifier)}</dd></div><div class="d3-ledger-source"><dt>Source and capture</dt><dd>${provenance(r.price,sourceLink)}</dd></div></dl><a href="${escape(r.review)}" data-card-review>Read the review</a></article>`).join('');
  return `<table class="d3-directory-table"><caption>Introductory and ongoing amounts stay separate. Other offer types retain their stated billing basis; they are not comparable monthly cash charges. Unknown cells remain unknown.</caption><thead><tr><th scope="col">Provider and medication</th><th scope="col">First month</th><th scope="col">Thereafter</th><th scope="col">Source and capture</th></tr></thead><tbody>${desktop}</tbody></table><div class="d3-mobile-cards">${mobile}</div>`;
}
