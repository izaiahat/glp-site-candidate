import { readFileSync } from 'node:fs';
import { deriveMoneyPageFreshness } from './freshness.mjs';
import { isTypedPrice, typedPriceText } from './typed-price-labels.mjs';
import { CITATION_REASONS, renderCitationAnchor } from './citation-attribution.mjs';
import { loadAffiliateLinkMap } from './affiliate-link-map.mjs';
import { loadGoPromotionAuthority } from './go-runtime-selection.mjs';
import { resolveCardOutbound } from './card-outbound.mjs';
import { renderCouponChip } from './coupon-offers.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const content = read('../data/compounded-category-content.json');
const affiliateMap = loadAffiliateLinkMap('compare');
const promotionAuthority = loadGoPromotionAuthority();
const evidencePath = '../data/compounded-category-evidence/';
const keywords = read(`${evidencePath}KEYWORDS.json`);
const medications = ['semaglutide', 'tirzepatide'];
const stateNames = Object.entries({AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'});
const stateEvidence = new Map(read('../data/program-content-ledger.json').programs.map(program => [program.program_id, program.research_states_served]));
function categoryStateExclusions(program) {
  const statement = stateEvidence.get(program.review_slug || program.program_id);
  if (!statement?.verified_as_of || !/^https:\/\//.test(statement.source_url || '')) return [];
  // A platform-wide service claim is not same-product state eligibility. Use
  // explicit negative coverage only; every remaining state stays unverified.
  const clauses = String(statement.value || '').match(/(?:except|excluding|restricts?|excludes[^.;]*?service in)\s+[^.;]+/gi) || [];
  const exclusions = clauses.map(clause => clause.split(/\bwith\b|\band limits\b/i)[0]).join(' ');
  return stateNames.filter(([, name]) => new RegExp(`\\b${name}\\b`, 'i').test(exclusions)
    || new RegExp(`limits ${name} to branded[^.]*rather than compounded`, 'i').test(statement.value)).map(([code]) => code);
}
const evidence = Object.fromEntries(medications.map(medication => {
  const packet = read(`${evidencePath}${medication}/PACKET.json`);
  const rawSources = read(`${evidencePath}${medication}/SOURCES.json`);
  // S14 intentionally has different packet and source-register schemas.
  const sources = medication === 'semaglutide' ? rawSources.sources : rawSources;
  if (!Array.isArray(packet.providers) || !Array.isArray(sources)) throw new Error('compounded_category_evidence_schema');
  return [medication, {packet, sources:new Map(sources.map(s=>[s.id,s])), providers:new Map(packet.providers.map(p=>[p.program_id,p]))}];
}));
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const humanDate = value => {
  const day = String(value).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error('category_source_date_invalid');
  return new Date(day+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
};
const readerText = value => String(value)
  .replace(/^Reported information:\s*/i,'')
  .replaceAll('Complete selected-plan initial and renewal cost bundle is not established by this typed price alone.', 'Total initial and renewal charges, including any separate fees, are not stated here; request a complete quote.')
  .replaceAll('Medication-plan charge only; complete first debit UNKNOWN.', 'Medication-plan charge only; total first payment not stated.')
  .replaceAll('Do not interpret the monthly equivalent as cash debit', 'The monthly equivalent is not the amount charged at checkout')
  .replaceAll('Reported information; clinical eligibility required; no approval/quality equivalence asserted.', 'A clinician must determine eligibility; this listing is not an assurance of approval or quality.')
  .replaceAll('Standard total; expired promotional alternatives excluded', 'Standard total; expired promotions are not included')
  .replaceAll('Terms specify a charge every 30 days; advertised /month is not normalized to a calendar month.', 'Terms specify billing every 30 days, rather than by calendar month.')
  .replaceAll('campaign-3', 'offer').replaceAll('campaign Monthly option', 'monthly option')
  .replaceAll('UNKNOWN','not stated');
// Editorial summaries are bound to the full source-derived note, not a provider
// name or price ID: a changed qualification must never reuse a stale summary.
export function categoryReaderNote(limitations) {
  const sourceNote = limitations.join(' ');
  const note = content.price_note_rewrites?.find(item => item.source_note === sourceNote)?.reader_note || sourceNote;
  if (note.split(/(?<=[.!?])\s+/).length > 2) throw new Error('category_price_note_editorial_review_required');
  return note;
}
const periodText = value => ['/mo','/month','every month'].includes(value) ? 'per month' : value === 'UNKNOWN' ? 'period not stated' : String(value);

// G08b compact projection: validate with the S11 owner, never reinterpret a
// floor/equivalent/bundle as monthly cash or derive an unreported total.
export function renderCategoryPrice(row) {
  typedPriceText(row);
  const fact = key => row.facts?.[key]?.value;
  const money = value => value === 'UNKNOWN' ? 'not stated' : '$'+value.toLocaleString('en-US',{maximumFractionDigits:2});
  let line;
  const extra = ['Total initial and renewal charges, including any separate fees, are not stated here; request a complete quote.'];
  switch (row.price_kind) {
    case 'monthly_cash': {
      const billing = fact('terms_charge_interval') || fact('billing_period') || (fact('period') === 'every month' ? 'monthly' : null);
      line = `${money(fact('amount_usd'))} ${periodText(fact('period'))}${billing ? ' · billed '+(billing === 'month to month' ? 'monthly' : billing) : ''}`;
      break;
    }
    case 'floor_from':
      line = `From ${money(fact('amount_usd'))} ${periodText(fact('period'))} · advertised starting price`;

      if (fact('billing_period') === 'UNKNOWN') extra.push('Billing schedule not stated.');
      break;
    case 'prepaid_bundle':
      line = `${money(fact('amount_usd'))} for ${fact('supply_period')} · prepaid bundle`;
      break;
    case 'monthly_equivalent_of_billing_period':
      line = `${money(fact('equivalent_usd'))} ${periodText(fact('equivalent_period'))} equivalent · billed ${readerText(fact('billing_period')).toLowerCase()}`;
      extra.push(fact('amount_usd') === 'UNKNOWN' ? 'Full billed amount not stated.' : `${money(fact('amount_usd'))} billed per payment.`);
      break;
    case 'membership_plus_medication':
      line = `Membership ${money(fact('membership_usd'))}${fact('membership_usd') === 'UNKNOWN' ? '' : ' '+periodText(fact('membership_period'))} + medication ${money(fact('medication_usd'))} ${periodText(fact('medication_period'))}`;
      break;
    case 'intro_then_ongoing':
      line = `${money(fact('intro_usd'))} for ${fact('intro_period')}, then ${money(fact('ongoing_usd'))} ${periodText(fact('ongoing_period'))}`;
      break;
    default: throw new Error('category_price_kind_invalid');
  }
  const witnesses = [...(row.evidence||[]),...(row.identity_evidence||[]),...Object.values(row.facts||{}).flatMap(f=>f.evidence||[])];
  if (!witnesses.length) throw new Error('category_price_evidence_missing');
  const sources = [...new Map(witnesses.map(w=>[w.source_url+'|'+String(w.captured_at_utc).slice(0,10),w])).values()];
  const reported = sources.map(w=>String(w.captured_at_utc).slice(0,10)).sort()[0];
  const limitations = [...new Set([...extra,...row.qualifiers,...row.unknown_components].filter(s=>!['from','From','Starting at','Starting from','As low as','as low as','starting as low as','Monthly','Quarterly'].includes(s)).map(readerText))];
  const links = sources.map(w=>{
    const u = new URL(w.source_url);
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error('typed_price_source_invalid');
    return `<li>${renderCitationAnchor({url:w.source_url,label:`Provider terms, checked ${humanDate(w.captured_at_utc)}`,reason:CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE})}</li>`;
  }).join('');
  return `<section class="typed-price" data-typed-price-kind="${esc(row.price_kind)}" data-price-row-id="${esc(row.row_id)}"><h4>${esc(row.label)}</h4><p class="g08-plan">${esc(readerText(row.plan_label))}</p><p class="g08-price-line" data-g08-price-line>${esc(line)}</p><p class="g08-price-limitations">${esc(categoryReaderNote(limitations))}</p><p>reported <time datetime="${esc(reported)}">${esc(humanDate(reported))}</time></p><ul aria-label="Dated price evidence">${links}</ul></section>`;
}
export function getCompoundedCategoryMetadata(medication) {
  if (!medications.includes(medication)) throw new Error('compounded_category_medication_invalid');
  const seo = keywords.seo[medication];
  return {title:seo.title, description:seo.meta_description, h1:seo.h1};
}
function citations(sourceIds, sourceMap) {
  return [...new Set(sourceIds || [])].flatMap(id=>{
    const source = sourceMap.get(id);
    if (!source?.source_url) return [];
    const url = new URL(source.source_url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('compounded_category_source_invalid');
    const date = source.capture_date || source.captured_at_utc;
    if (!date) throw new Error('compounded_category_source_date_missing');
    const fda = url.hostname === 'fda.gov' || url.hostname.endsWith('.fda.gov');
    const label = !fda ? 'Provider terms' : url.pathname.includes('compounding-and-fda-questions-and-answers') ? 'FDA compounding questions and answers' : url.pathname.includes('fdas-concerns-unapproved-glp-1-drugs-used-weight-loss') ? 'FDA concerns about unapproved GLP-1 drugs' : 'FDA guidance';
    return [`<span class="g08-source">${renderCitationAnchor({url:source.source_url,label:`${label}, checked ${humanDate(date)}`,reason:CITATION_REASONS.COMPARISON_SOURCE_LEDGER})}</span>`];
  }).join('');
}
function packetRows(packet, medication) {
  return medication === 'semaglutide' ? [...(packet?.price_rows||[]), ...(packet?.unknown_price_rows||[])] : packet?.pricing_rows||[];
}
function providerEvidence(packet, medication, sourceMap) {
  const chips = packet?.evidence_chips || [];
  return chips.length ? chips.map(chip=>`<div class="g08-evidence-chip"><p class="g08-label">Reported information · ${esc(chip.field.replaceAll('_',' '))}</p><p>${esc(readerText(chip.text))}</p>${citations(chip.source_ids,sourceMap)}</div>`).join('') : `<p>${esc(content.unknown_evidence)}</p>`;
}
function renderPrices(program, packet, medication, pricingMatrix) {
  const renderId = program.review_slug || program.program_id;
  const entries = Object.values(pricingMatrix.providers || {}).filter(entry=>entry.program_id===renderId);
  const exactProduct = new RegExp(`^compounded-${medication}-(?:injection|oral)$`);
  const rows = entries.flatMap(entry=>entry.medications || []).filter(row=>isTypedPrice(row) && exactProduct.test(row.medication_id));
  // Do not deduplicate by medication_id: different plans can share a medication.
  // The upstream accepted typed-price matrix remains the price authority, not S14's snapshot.
  const rendered = rows.map(row=> {
    if (!row.row_id) throw new Error('compounded_category_price_row_id_missing');
    return renderCategoryPrice(row);
  }).join('');
  // A refreshed source can replace a row ID without changing the plan identity.
  // Match the exact product, kind and plan; never collapse distinct plans by medication alone.
  const missing = packetRows(packet,medication).filter(row=>exactProduct.test(row.medication_id) && !rows.some(live=>
    live.row_id===row.row_id || (live.medication_id===row.medication_id && live.price_kind===(row.kind || row.price_kind) && live.plan_label===row.plan_label)));
  const gaps = missing.map(row=>`<div class="g08-price-gap" data-g08-unpriced-row-id="${esc(row.row_id)}"><p><strong>${esc(row.label || row.medication_id.replaceAll('-',' '))}</strong> · Price not published in the pages checked</p><p>${esc(content.unknown_price)}</p></div>`).join('');
  return (rendered || `<p class="g08-price-gap">${esc(content.unknown_price)}</p>`) + gaps;
}
function categoryFilterData(program, medication, pricingMatrix) {
  const rows = Object.values(pricingMatrix.providers).filter(entry => entry.program_id === (program.review_slug || program.program_id)).flatMap(entry => entry.medications || []).filter(row => isTypedPrice(row) && new RegExp(`^compounded-${medication}-(?:injection|oral)$`).test(row.medication_id));
  const durations = new Set(), doses = new Set(), cash = new Set();
  for (const row of rows) {
    const term = [row.facts?.supply_period?.value, row.facts?.billing_period?.value].filter(value => value && value !== 'UNKNOWN').join(' ').toLowerCase();
    for (const match of term.matchAll(/\b(\d+)\s*[- ]?months?\b/g)) durations.add(match[1]);
    if (/\bmonthly\b|month to month/.test(term) || (row.price_kind === 'monthly_cash' && ['every month','/month','/mo'].includes(row.facts?.period?.value))) durations.add('1');
    if (/\byearly\b|\bannual\b/.test(term)) durations.add('12');
    if (/\bquarterly\b/.test(term)) durations.add('3');
    if (/\bstarter\b/i.test(row.plan_label)) durations.add('starter');
    if (/\bstep[- ]up\b/i.test(row.plan_label)) durations.add('step-up');
    if (row.dose_pricing?.status === 'SOURCE_REPORTED_PER_DOSE') for (const tier of row.dose_pricing.tiers || []) doses.add(String(tier.dose_mg));
    const amount = row.facts?.amount_usd?.value;
    if (row.price_kind === 'monthly_cash' && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) cash.add(amount);
  }
  // Only an unambiguous monthly-cash amount can enter the existing sort runtime.
  // Floors, bundles, equivalents and unknowns remain display-only, never zero.
  return `data-phase3-provider data-program="${esc(program.review_slug || program.program_id)}" data-drugs="${medication.toUpperCase()}" data-forms="COMPOUNDED" data-state-mode="unknown" data-state-excludes="${categoryStateExclusions(program).join(' ')}" data-duration="${esc([...durations].join(' ') || 'unknown')}" data-dose-values="${esc([...doses].join(' ') || 'unknown')}" data-price-map="${rows.length === 1 && cash.size === 1 ? esc(medication.toUpperCase()+':'+[...cash][0]) : ''}"`;
}
function categoryFilters(medication) {
  const group = (label, key, choices) => `<fieldset data-filter-group="${key}"><legend>${label}</legend><div class="p3-filter-chips">${choices.map(([value, text, disabled], index) => `<button type="button" data-filter="${key}" data-value="${value}" aria-pressed="${index === 0}"${disabled ? ' disabled aria-disabled="true"' : ''}>${text}</button>`).join('')}</div></fieldset>`;
  const doses = medication === 'tirzepatide' ? ['2.5','5','7.5','10','12.5','15'] : ['0.25','0.5','1','1.7','2.4'];
  return `<div class="p3-filterbar" data-provider-filters>
    <label class="g08-state-control">State <select data-state-native aria-label="State"><option value="">Any state</option>${stateNames.map(([code,name]) => `<option value="${code}">${name}</option>`).join('')}</select></label>
    ${group('Type','type',[['compounded','Compounded'],['brand','Brand name'],['microdose','Micro dose',true]])}
    ${group('Plan','plan',[['both','Both'],['1','1 month'],['3','3 month']])}
    <details><summary>More plans</summary>${group('Longer or introductory plans','duration',[['all','Any plan'],['6','6+ months'],['starter','Starter'],['step-up','Step-up']])}</details>
    ${group('Dose','dose',[['all','All doses'],...doses.map(dose=>[dose,`${dose} mg/week`])])}
    ${group('Sort','sort',[['cheapest','Cheapest'],['best','Best (quiz matches)',true]])}
    <p>Filters use published plan and dose details. Unstated plan or dose details do not count as a match. State removes explicit reported exclusions; remaining programs require direct confirmation of product availability in your state. Only unambiguous monthly cash prices enter Cheapest; other prices remain unranked. Best prioritizes your saved quiz matches, then monthly cash prices.</p>
  </div>`;
}
const css = `<style data-preserve data-g08-category-style>
[data-g08-mobile]{display:none}
[data-g08-medication] .p3-filter-chips{display:flex;flex-wrap:wrap;gap:8px}
[data-g08-medication] .p3-filterbar fieldset{min-width:0}
[data-g08-medication] .p3-filterbar button{min-height:44px;max-width:100%;white-space:normal}
[data-g08-medication] article[hidden]{display:none!important}
@media(max-width:899px){[data-g08-desktop]{display:none}[data-g08-mobile]{display:block}}
body:has([data-g08-medication]) .gcs-links a.cs-palette-action[href="/quiz/provider-fit/"]{background:transparent!important;background-image:none!important;box-shadow:none!important;border-color:transparent!important;color:var(--color-paper-50,#f2f8f4)!important}
[data-g08-medication]{color:var(--color-paper-50,#f2f8f4);max-width:var(--container-wide,1180px);margin-inline:auto;padding:0 clamp(16px,3vw,32px) 48px;font-size:1rem;line-height:1.65}
[data-g08-medication] *{box-sizing:border-box}
[data-g08-medication] .g08-hero{padding-block:16px 32px;max-width:920px}
[data-g08-medication] .g08-caveat{margin:0 0 20px;padding:14px 18px;border-left:3px solid var(--color-gold-400,#f0b23f);background:var(--color-surface-raised,#101d18);font-size:1rem;line-height:1.5;border-radius:0 12px 12px 0}
[data-g08-medication] h1{font-size:clamp(1.9rem,4vw,3.3rem);line-height:1.12;letter-spacing:-.035em;max-width:24ch;margin:12px 0 20px}
[data-g08-medication] h2{font-size:clamp(1.4rem,2.3vw,2rem);line-height:1.25;letter-spacing:-.02em;margin:0 0 16px}
[data-g08-medication] h3,[data-g08-medication] h4{font-size:1.06rem;line-height:1.4;margin:0 0 12px}
[data-g08-medication] p{margin:0 0 12px}
[data-g08-medication] a{color:var(--color-evidence,#3fd9a4);text-underline-offset:4px;overflow-wrap:anywhere}
[data-g08-medication] a:focus-visible{outline:3px solid var(--focus,#7fe3ff);outline-offset:4px;border-radius:3px}
[data-g08-medication] .g08-kicker,[data-g08-medication] .g08-label{color:var(--color-evidence,#3fd9a4);font-size:.8rem;font-weight:650;letter-spacing:.04em}
[data-g08-medication] .g08-actions{display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:18px}
[data-g08-medication] .g08-actions a{display:inline-flex;align-items:center;min-height:44px;padding:8px 0}
[data-g08-medication] .g08-actions .cs-palette-action{padding:12px 20px;color:var(--on-accent,#04120e);text-decoration:none;font-weight:700}
[data-g08-medication] .g08-links-note{font-size:.85rem;line-height:1.5;color:var(--color-text-secondary,#b8cfc4);margin:0 0 28px;max-width:78ch}
[data-g08-medication] #g08-directory{scroll-margin-top:100px}
[data-g08-medication] .g08-price-line{font-weight:650}
[data-g08-medication] .g08-plan,[data-g08-medication] .g08-price-limitations{font-size:.85rem;line-height:1.5;color:var(--color-text-secondary,#b8cfc4)}
[data-g08-medication] .g08-editorial{display:grid;gap:24px;margin-block:20px 40px}
[data-g08-medication] .g08-editorial>section{padding:24px;border:1px solid var(--color-border,#294137);border-radius:18px;background:var(--color-surface-raised,#101d18);min-width:0}
[data-g08-medication] .g08-source{display:block;font-size:.78rem;line-height:1.5;color:var(--color-text-secondary,#b8cfc4);overflow-wrap:anywhere;margin-top:8px}
[data-g08-medication] .g08-directory-head{max-width:none;width:100%;margin:0 0 24px}
[data-g08-medication] table{width:100%;border-collapse:collapse;table-layout:fixed}
[data-g08-medication] caption{text-align:left;padding-bottom:16px;font-size:1.05rem;font-weight:650}
[data-g08-medication] th,[data-g08-medication] td{padding:24px 18px;text-align:left;vertical-align:top;border-bottom:1px solid var(--color-border,#294137);overflow-wrap:anywhere}
[data-g08-medication] thead th{font-size:.85rem;background:var(--color-surface-raised,#101d18);border-top:1px solid var(--color-border,#294137)}
[data-g08-medication] thead th:first-child{width:20%}
[data-g08-medication] thead th:nth-child(2){width:45%}
[data-g08-medication] thead th:nth-child(3){width:35%}
[data-g08-category-table] td[data-label="Reported prices & plan terms"],.g08-card-price,.g08-price-line,.g08-price-limitations{hyphens:none}
[data-g08-medication] .g08-evidence-chip,[data-g08-medication] .typed-price,[data-g08-medication] .g08-price-gap{padding:0 0 18px;margin:0 0 18px;border-bottom:1px solid var(--color-border,#294137)}
[data-g08-medication] .typed-price:last-child,[data-g08-medication] .g08-evidence-chip:last-child{margin-bottom:0;border-bottom:0}
[data-g08-medication] .typed-price ul{padding-left:18px;font-size:.8rem;overflow-wrap:anywhere}
[data-g08-medication] a[data-citation],[data-g08-medication] .typed-price ul[aria-label="Dated price evidence"] a{display:inline-block;min-height:24px;line-height:24px}
[data-g08-medication] a[data-g08-primary]{display:inline-flex;align-items:center;min-height:44px;padding:10px 16px;margin-top:16px;text-decoration:none;color:var(--on-accent,#04120e);font-weight:700}
[data-g08-medication] .g08-unknown{font-size:.9rem;color:var(--color-text-secondary,#b8cfc4)}
[data-g08-medication] .g08-directory-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
[data-g08-medication] .g08-directory-cards>article{border:1px solid var(--color-border,#294137);background:var(--color-surface-raised,#101d18);border-radius:18px;padding:22px;min-width:0}
[data-g08-medication] [data-g08-category-cards]{display:none}
[data-g08-medication] .g08-question{padding-top:14px;margin-top:14px;border-top:1px solid var(--color-border,#294137)}
[data-g08-medication] .g08-next{margin-top:40px;max-width:820px;scroll-margin-top:120px}
[data-g08-medication] .g08-next li{margin-bottom:16px}
@media(min-width:1000px){[data-g08-medication] .g08-editorial{grid-template-columns:1fr 1fr}}
@media(max-width:899px){[data-g08-medication] [data-g08-category-table]{display:none}[data-g08-medication] [data-g08-category-cards]{display:grid;grid-template-columns:1fr;gap:20px}[data-g08-medication] .g08-card-evidence{margin-top:24px}[data-g08-medication] .g08-card-price{margin-top:24px}[data-g08-medication] .g08-editorial>section{padding:20px}}
@media print{[data-g08-medication] [data-g08-category-table]{display:grid}[data-g08-medication] [data-g08-category-cards]{display:none}}
</style>`;

/** Parent owns canonical identity, page shell, disclosure, breadcrumbs and SEO directives. */
export function renderCompoundedCategoryBody({medication,programs,pricingMatrix,registry,coupons = {},linksNotice = ''}) {
  const metadata = getCompoundedCategoryMetadata(medication);
  if (!Array.isArray(programs) || !pricingMatrix?.providers || !registry?.therapeutic_taxonomy?.programs) throw new Error('compounded_category_inputs_invalid');
  const copy = content.medications[medication];
  const bundle = evidence[medication];
  const eligible = programs.filter(program=>{
    const profile=program.profiles?.['glp-clinic-scout'];
    const taxonomy=registry.therapeutic_taxonomy.programs[program.review_slug||program.program_id];
    return program.commercial_state==='live' && profile?.vertical_fit===true && profile?.wired===true && profile?.surfaces?.review===true
      && !/fella/i.test(`${program.program_id} ${program.review_slug||''} ${program.display_name}`)
      && taxonomy?.commercial_link_state?.compare==='live'
      && taxonomy.molecule_tags?.includes(medication) && taxonomy.treatment_type_tags?.includes('compounded');
  }).sort((a,b)=>a.display_name.localeCompare(b.display_name,'en')||a.program_id.localeCompare(b.program_id,'en'));
  if (new Set(eligible.map(p=>p.program_id)).size !== eligible.length) throw new Error('compounded_category_duplicate_program');
  const priceRows = eligible.flatMap(program => Object.values(pricingMatrix.providers).filter(entry => entry.program_id === (program.review_slug || program.program_id)).flatMap(entry => entry.medications || [])).filter(row => isTypedPrice(row) && new RegExp(`^compounded-${medication}-(?:injection|oral)$`).test(row.medication_id));
  const priceWitnesses = priceRows.flatMap(row => [...(row.evidence || []), ...(row.identity_evidence || []), ...Object.values(row.facts || {}).flatMap(fact => fact.evidence || [])]);
  const sources = [...bundle.sources.values()].map(source => ({ verified_as_of: String(source.capture_date || source.captured_at_utc).slice(0, 10) }));
  sources.push(...priceWitnesses.map(witness => ({ verified_as_of: String(witness.captured_at_utc).slice(0, 10) })), ...eligible.map(program => ({ verified_as_of: registry.therapeutic_taxonomy.programs[program.review_slug || program.program_id].verified_as_of })));
  const freshness = deriveMoneyPageFreshness({ path: `/${medication}/`, sources });
  const views = eligible.map((program,index)=>{
    if (!/^\/reviews\/[a-z0-9-]+\/$/.test(program.review_path||'')) throw new Error('compounded_category_review_path_invalid:'+program.program_id);
    const packet=bundle.providers.get(program.program_id);
    const taxonomy=registry.therapeutic_taxonomy.programs[program.review_slug||program.program_id];
    const renderId=program.review_slug||program.program_id;
    const outbound=resolveCardOutbound({program,affiliate:affiliateMap[renderId],promotionAuthority,pageSlug:medication,position:'provider-card',rankPosition:index+1});
    const manifestEntry=GO_RUNTIME_MANIFEST.programs[renderId];
    // The category is a consumer of owner-issued authority, never its writer.
    // Legacy/direct/held entries retain an explicit internal-review fallback.
    const tracked=outbound.mode==='go'
      && manifestEntry?.status==='live_operator_approved'
      && manifestEntry.link_mode==='server_redirect'
      && manifestEntry.route===program.go?.route
      && manifestEntry.allowed_page_roles?.includes(medication)
      && manifestEntry.allowed_positions?.includes(outbound.f08Key.split('.')[1])
      && manifestEntry.allowed_variants?.includes('a');
    const primary=tracked?`<a class="cs-btn cs-palette-action" href="${esc(outbound.href)}" rel="sponsored noopener nofollow" data-g08-primary data-provider-card-contract="option-c" data-analytics-event="affiliate_click" data-program="${esc(renderId)}" data-link-position="provider-card" ${outbound.attributes}>Get started</a>`:`<a class="cs-btn cs-palette-action" href="${esc(program.review_path)}" data-g08-primary data-provider-card-contract="option-c" data-g08-outbound-state="held-review-fallback">Read the review</a>`;
    return {id:esc(program.program_id),name:esc(program.display_name),review:esc(program.review_path),primary,coupon:renderCouponChip(coupons[renderId]),filters:categoryFilterData(program,medication,pricingMatrix),
      evidence:providerEvidence(packet,medication,bundle.sources),prices:renderPrices(program,packet,medication,pricingMatrix),
      unknown:`<p class="g08-unknown">${esc(content.unknown_product)}</p><p class="g08-source">Confirm the specific product directly.</p>`,
      question:`<p class="g08-question"><strong>Next question</strong><br>${esc(copy.questions[0])}</p>`};
  });

  const cards=views.map(v=>`<article data-g08-provider-id="${v.id}" ${v.filters}><h3><a href="${v.review}">${v.name}</a></h3><div class="g08-card-price"><h4>Prices &amp; plan terms</h4>${v.prices}</div>${v.coupon}<details class="g08-card-evidence"><summary>Program details</summary>${v.evidence}${v.unknown}</details>${v.question}${v.primary}</article>`).join('');
  const filteredCards = mode => `<div data-g08-${mode}>${categoryFilters(medication)}<section class="p3-provider-section"><p data-filter-result aria-live="polite"></p><div class="g08-directory-cards" data-phase3-provider-grid data-g08-category-${mode === 'desktop' ? 'table' : 'cards'} aria-label="Compounded ${medication} program comparison">${cards}</div><p data-filter-empty hidden>No matching published plan details. Try another filter; missing information is not a zero price. <button type="button" data-filter-reset>Clear filters</button></p></section></div>`;
  const sections=copy.sections.map(s=>`<section><h2>${esc(s.heading)}</h2>${s.paragraphs.map(p=>`<p>${esc(p.text)}</p>${citations(p.source_ids,bundle.sources)}`).join('')}</section>`).join('');
  const opposite=medication==='semaglutide'?'tirzepatide':'semaglutide';
  const notice = linksNotice.replace('class="p3-source-disclosure affiliate-note table-disclosure"','class="g08-links-note p3-source-disclosure affiliate-note table-disclosure"');
  return `${css}<div data-g08-medication="${medication}">
    <section class="g08-hero"><p class="g08-kicker">Reported information · independent comparison</p><h1>${esc(metadata.h1)}</h1><p>Prices checked <span data-prices-checked-date>${esc(freshness.source_checked_from)} – ${esc(freshness.source_checked_through)}</span></p><p>${esc(copy.intro)}</p><nav class="g08-actions" aria-label="Category shortcuts"><a class="cs-btn cs-palette-action" href="/quiz/provider-fit/">Explore the comparison quiz</a><a href="#g08-directory">Compare program terms</a></nav></section>
    ${notice}
    <section id="g08-directory"><p class="g08-caveat">${esc(bundle.packet.fda_caveat.text)} ${citations(bundle.packet.fda_caveat.source_ids,bundle.sources)}</p><header class="g08-directory-head"><h2>Compare compounded ${medication} programs</h2><p data-g08-category-count="${eligible.length}">${eligible.length} program profiles</p><p>${esc(content.scope)}</p></header>${filteredCards('desktop')}${filteredCards('mobile')}</section>
    <details class="g08-editorial"><summary>About compounded ${medication}</summary>${sections}</details>
    <section class="g08-next"><h2>Questions to ask before committing</h2><ol>${copy.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ol><p><a href="#g08-directory">Compare the prices and plan terms above</a></p></section><section class="g08-next"><h2>Sources &amp; comparison method</h2><p>${esc(copy.method)}</p>${citations(bundle.packet.fda_caveat.source_ids,bundle.sources)}<nav class="g08-actions" aria-label="Comparison methods and related pages"><a href="/providers/">All providers</a><a href="/${opposite}/">Compounded ${opposite}</a><a href="/how-we-rate/">How we rate</a><a href="/editorial-guidelines/">Editorial guidelines</a><a href="/how-we-make-money/">How we make money</a></nav></section></div>`;
}
