// Display-only S11 projection. No I/O, pricing arithmetic or authority decisions.
import { CITATION_REASONS, renderCitationAnchor } from './citation-attribution.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isTypedPrice = row => !!row && Object.hasOwn(row, 'price_kind');
// Display projection only: evidence values and captured quotations remain untouched.
export const readerPriceText = value => String(value ?? '').replace(/\bUNKNOWN\b/g, 'not stated').replace(/intro_then_ongoing/g, 'introductory and renewal pricing').replace(/v2 kinds/g, 'reported offer formats');
export function sanitizeCapturedWording(quote) {
  const plain = String(quote ?? '')
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`#>|]/g, '')
    .replace(/\\([\[\]()!])/g, '$1');
  const promo = /offer ends|save big|limited[ -]time|\b(?:sale|coupon|promo|discount|exclusive)\b|act now|hurry|shop now|buy now|sign up|get started|start your|transform your|unlock|risk.free|\d+%\s*off|save\s+(?:\$|\d)/i;
  const sentences = plain.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => /\$\s*\d/.test(s) && !promo.test(s) && s.length <= 280);
  let excerpt = '';
  for (const sentence of sentences) {
    if ((excerpt ? excerpt+' '+sentence : sentence).length > 280) break;
    excerpt += (excerpt ? ' ' : '')+sentence;
  }
  return excerpt || 'See the dated price source for the captured price wording.';
}
export function typedPriceText(row, { labelOnly = false } = {}) {
  if (!isTypedPrice(row) || row.calculator_eligibility !== 'display_only') throw new Error('typed_price_display_contract_invalid');
  const value = key => {
    const fact = row.facts?.[key];
    if (!fact || !Object.hasOwn(fact,'value')) throw new Error('typed_price_fact_missing:'+key);
    const v = fact.value;
    if (key.endsWith('_usd')) {
      if (v === 'UNKNOWN') {
        if (row.price_kind === 'membership_plus_medication' || (row.price_kind === 'monthly_equivalent_of_billing_period' && key === 'amount_usd')) return 'not stated';
        throw new Error('typed_price_required_amount_unknown:'+key);
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('typed_price_amount_invalid:'+key);
      return '$'+v.toLocaleString('en-US',{maximumFractionDigits:2});
    }
    if (typeof v !== 'string' || !v.trim()) throw new Error('typed_price_period_invalid:'+key);
    return readerPriceText(v);
  };
  let label;
  switch (row.price_kind) {
    case 'floor_from': label = `From ${value('amount_usd')} ${value('period') === 'not stated' ? '— Billing period not stated' : /^(?:month|monthly|per month|\/month|\/mo)$/i.test(value('period')) ? '/mo' : value('period')}. Advertised starting price; selected-plan charge not established.`; break;
    case 'prepaid_bundle': label = `${value('amount_usd')} for ${value('supply_period')}. Prepaid bundle.`; break;
    case 'monthly_equivalent_of_billing_period': label = `${value('equivalent_usd')} ${value('equivalent_period')} equivalent. Billed ${value('billing_period')}; ${value('amount_usd') === 'not stated' ? 'Full billed amount not stated' : value('amount_usd')+' billed'}.`; break;
    case 'membership_plus_medication': {
      const component = name => value(name+'_usd') === 'not stated' && value(name+'_period') === 'not stated' ? 'not stated' : `${value(name+'_usd')} ${value(name+'_period') === 'not stated' ? '(period not stated)' : value(name+'_period')}`;
      label = `Membership: ${component('membership')} + medication: ${component('medication')}.`; break;
    }
    case 'intro_then_ongoing': label = `${value('intro_usd')} for ${value('intro_period')}, then ${value('ongoing_usd')} ${value('ongoing_period')}.`; break;
    case 'monthly_cash': label = `${value('amount_usd')} ${value('period')}. ${value('cash_schedule')}`; break;
    default: throw new Error('typed_price_kind_unknown:'+row.price_kind);
  }
  if (!Array.isArray(row.qualifiers) || !Array.isArray(row.unknown_components)) throw new Error('typed_price_limitations_missing');
  if (labelOnly) return readerPriceText(label);
  return [label,...row.qualifiers,...row.unknown_components,'Informational only; enter your complete quote manually.'].map(readerPriceText).join(' ');
}
// One dated price witness -> one <li>. Exported so EVERY price surface that holds the same three
// evidence facts (an https source, its capture date, the captured wording) renders the SAME typed
// provenance from this one renderer, instead of a second copy of the markup drifting per module.
// Display projection only: no amount, date, source or quotation is synthesised here.
export function renderPriceWitnesses(witnesses, { showDate = false } = {}) {
  const unique = [...new Map((witnesses||[]).map(w=>[JSON.stringify(w),w])).values()];
  return unique.map(w=>{
    const url = new URL(w.source_url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('typed_price_source_invalid');
    const date = String(w.captured_at_utc).slice(0,10);
    const humanDate = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
    // Component-owned sizing survives both the shared shell and standalone ads CSS.
    // Inline-block gives source links a real hit box; neither target borrows overlap space.
    return `<li${showDate ? '' : ` data-source-checked="${esc(date)}"`}>${showDate ? `<time datetime="${esc(date)}">${esc(humanDate)}</time> ` : ''}${renderCitationAnchor({url:w.source_url,label:'Price source',reason:CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE,extraAttrs:' style="display:inline-block;min-height:24px"',rel:url.hostname.endsWith('.gov') ? 'noopener' : 'nofollow noopener'})}<details><summary style="box-sizing:border-box;min-height:44px;padding-block:10px">Captured wording</summary><blockquote>${esc(sanitizeCapturedWording(w.quote))}</blockquote></details></li>`;
  }).join('');
}
// `headingLevel` lets a caller seat this block at the depth its own page actually
// uses. The default stays 4 - every surface that nests a typed price under its own
// h3 keeps the markup it already ships - but a surface that places the block
// directly under a section h2 must say so, or the page emits an h2 -> h4 skip
// (WCAG 1.3.1 / the registered accessibility producer's heading-order check).
export function renderTypedPrice(row, { showDate = false, headingLevel = 4 } = {}) {
  if (!Number.isInteger(headingLevel) || headingLevel < 2 || headingLevel > 6) throw new Error('typed_price_heading_level_invalid');
  const h = `h${headingLevel}`;
  const text = typedPriceText(row, {labelOnly:true});
  const limitations = [...row.qualifiers,...row.unknown_components,'Informational only; enter your complete quote manually.'].map(readerPriceText).join(' ');
  const witnesses = [...(row.evidence||[]),...(row.identity_evidence||[]),...Object.values(row.facts||{}).flatMap(f=>f.evidence||[])];
  const sources = renderPriceWitnesses(witnesses, {showDate});
  const plan = String(row.plan_label || '').replace(/^Reported S32 offer:\s*/i, '').trim();
  const heading = !plan || plan === row.label ? row.label : `${row.label} — ${plan}`;
  return `<section class="typed-price" data-typed-price-kind="${esc(readerPriceText(row.price_kind))}" data-price-row-id="${esc(row.row_id)}"><${h}>${esc(heading)}</${h}><p>Reported information</p><p class="typed-price-line" style="font-weight:750"><strong>${esc(text)}</strong></p><p class="muted" data-price-limitations>${esc(limitations)}</p><ul aria-label="Dated price evidence">${sources}</ul></section>`;
}
