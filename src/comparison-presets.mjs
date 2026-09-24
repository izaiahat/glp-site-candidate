import { isTypedPrice, renderTypedPrice } from './typed-price-labels.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const unknown = '<span data-not-established>Not established</span>';


// Classify only the accepted row's billing/supply fields. A /mo equivalent or
// advertised floor is NOT evidence of a one-month commitment. Do not turn weeks
// into months, or multiply a monthly figure into a bundle total.
export function comparisonTerm(row) {
  if (!isTypedPrice(row)) return Number.isFinite(row.ongoing_usd) && row.cadence === 'month' ? 1 : null;
  if (row.price_kind === 'monthly_cash') return 1;
  if (!['prepaid_bundle', 'monthly_equivalent_of_billing_period'].includes(row.price_kind)) return null;
  const terms = ['plan_period_label', 'supply_period', 'billing_period'].map(key => row.facts?.[key]?.value);
  return terms.some(value => typeof value === 'string' && /^(?:every\s+)?3[ -]months?(?:\s+of medication)?$/i.test(value.trim())) ? 3 : null;
}

export function comparisonCardBody(page, entry, sourcePrice) {
  const rows = entry.medications || [];
  const offerTerms = entry.offers?.flatMap(offer => offer.duration_months) || [];
  const terms = [...new Set([...rows.map(comparisonTerm), ...offerTerms].filter(term => term === 1 || term === 3))];
  const table = (caption, headers, cells) => `<div class="comparison-table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table data-comparison-table="${esc(page.slug)}"><caption>${esc(caption)}</caption><thead><tr>${headers.map(header => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody><tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr></tbody></table></div>`;
  const evidence = row => isTypedPrice(row) ? renderTypedPrice(row) : sourcePrice(row);
  if (page.slug === 'both') {
    const lanes = page.duration_months.map(term => {
      const matching = rows.filter(row => comparisonTerm(row) === term);
      return `<div data-comparison-lane="${term}">${matching.length ? matching.map(evidence).join('') : unknown}${!matching.length && terms.includes(term) ? '<p>The treatment source names this term, but does not establish a comparable price.</p>' : ''}</div>`;
    });
    return table('Reported plan prices — dose match not established', ['1-month billing', '3-month plan or billing'], lanes)
      + `<p>Price for the selected weekly dose: ${unknown}. Billing periods do not establish the quantity of medication supplied. A missing lane is an evidence gap, not a claim that this provider has no such plan.</p>`;
  }
  // The registered pricing inputs currently contain no accepted preset schedule,
  // sequence, total-mg or unit-cost fields. Generic program quotes must not be
  // promoted to Starter/Step Up facts. An explicitly named Starter bundle can
  // supply its reported term, but not an unstated dosing schedule or full cost.
  const named = rows.filter(row => isTypedPrice(row) && row.price_kind === 'prepaid_bundle' && (page.slug === 'starter' ? /\bstarter\b/i : /\bstep[ -]up\b/i).test(row.plan_label || ''));
  const schedule = page.slug === 'starter'
    ? table('Month-by-month Starter schedule', ['Month', 'Weekly dose', 'Normalised unit cost'], [unknown, unknown, unknown])
    : table('Step Up dose-sequence alternatives', ['Dose sequence', 'Supply term', 'Upfront total', 'Unit-cost context'], [unknown, unknown, unknown, unknown]);
  const supply = named.flatMap(row => row.facts?.supply_period?.value && row.facts.supply_period.value !== 'UNKNOWN' ? [esc(row.facts.supply_period.value)] : []);
  const totals = `<dl class="p3-card-ledger comparison-totals">${['Preset eligibility', 'Program total', 'Total medication', 'Supply term'].map(label => `<div><dt>${label}</dt><dd>${label === 'Supply term' && supply.length ? supply.join('; ') + ' (reported bundle)' : unknown}</dd></div>`).join('')}</dl>`;
  const context = rows.length ? `<details data-preset-source-context${named.length ? ' open' : ''}><summary>${named.length ? 'Source-reported preset bundle terms' : 'Other reported program terms — not established as this preset'}</summary><p>These source quotes do not establish a Starter schedule, Step Up sequence or complete selected-plan initial and renewal total.</p>${rows.map(evidence).join('')}</details>` : '';
  return `${schedule}${totals}${context}`;
}

export function comparisonControls(page, states, tirzepatideDoses, semaglutideDoses) {
  const links = [['/both/', 'Both'], ['/lp/best-providers/compounded-tirzepatide/?duration=1', '1 month'], ['/3-month/', '3 months']];
  const link = (route, label) => `<a class="cs-btn cs-btn--quiet" data-comparison-route href="${esc(route)}"${route === page.route ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  const presetLabel = page.slug === 'starter' ? 'More plans — Starter' : page.slug === 'step-up' ? 'More plans — Step Up' : 'More plans';
  const doseOptions = `<option value="all">All doses</option>${[[tirzepatideDoses, 'TIRZEPATIDE'], [semaglutideDoses, 'SEMAGLUTIDE']].flatMap(([doses, drug]) => doses.map(dose => `<option value="${esc(dose)}" data-dose-drug="${drug}"${drug === 'SEMAGLUTIDE' ? ' hidden disabled' : ''}${drug === 'TIRZEPATIDE' && dose === '2.5' ? ' selected' : ''}>${esc(dose)} mg/week</option>`)).join('')}`;
  return `<nav class="comparison-plan-nav" aria-label="Plan">${links.map(([route, label]) => link(route, label)).join('')}<details${page.slug !== 'both' ? ' open' : ''}><summary>${presetLabel}</summary>${link('/starter/', 'Starter')}${link('/step-up/', 'Step Up')}${link('/6-month/', '6+ months')}</details></nav>
    <form method="get" action="${esc(page.route)}" class="p3-filterbar comparison-filters" data-comparison-filters data-comparison-preset="${esc(page.slug)}">
      <label>Medication<select name="drug"><option value="TIRZEPATIDE" selected>Tirzepatide</option><option value="SEMAGLUTIDE">Semaglutide</option></select></label>
      <label>Form<select name="form"><option value="COMPOUNDED">Compounded injection</option></select></label>
      <label>State<select name="region"><option value="">All states (availability unverified)</option>${states.map(([code, name]) => `<option value="${code}"${code === 'OR' ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      ${page.slug === 'starter' ? '' : `<label>${page.slug === 'step-up' ? 'Starting dose' : 'Weekly dose'}<select name="dose">${doseOptions}</select></label>`}
      <label>Sort<select name="sort"><option value="cheapest">Cheapest</option><option value="name">Provider name</option></select></label>
      <button class="cs-btn cs-btn--quiet" type="submit">Apply filters</button>
    </form><p data-comparison-selection aria-live="polite">These controls express comparison preferences, not a recommended dose. Preset eligibility and dose-specific quotes must be confirmed with the provider.</p><noscript><p>Without JavaScript, all source records for both medications remain below; filter preferences are not applied.</p></noscript>`;
}

function activateComparison() {
  const form = document.querySelector('[data-comparison-filters]');
  if (!form) return;
  const main = form.closest('main');
  const preset = form.dataset.comparisonPreset;
  const cards = [...main.querySelectorAll('[data-comparison-card]')];
  const grid = main.querySelector('[data-phase3-provider-grid]');
  const title = main.querySelector('h1');
  const result = main.querySelector('[data-filter-result]');
  const selection = main.querySelector('[data-comparison-selection]');
  const allowed = (select, value) => [...select.options].some(option => !option.disabled && option.value === value);
  function doseOptions() {
    if (!form.elements.dose) return;
    for (const option of form.elements.dose.options) {
      option.hidden = option.disabled = Boolean(option.dataset.doseDrug && option.dataset.doseDrug !== form.elements.drug.value);
    }
    if (!allowed(form.elements.dose, form.elements.dose.value)) form.elements.dose.value = form.elements.drug.value === 'SEMAGLUTIDE' ? '0.25' : '2.5';
  }
  function restore() {
    form.reset();
    const query = new URL(location.href).searchParams;
    for (const key of ['drug', 'form', 'region', 'sort']) {
      const value = query.get(key) ?? (key === 'region' ? query.get('state') : null);
      if (value !== null && allowed(form.elements[key], value)) form.elements[key].value = value;
    }
    doseOptions();
    if (form.elements.dose && allowed(form.elements.dose, query.get('dose'))) form.elements.dose.value = query.get('dose');
    apply(false);
  }
  function apply(persist) {
    doseOptions();
    const drug = form.elements.drug.value;
    const region = form.elements.region.value;
    const dose = form.elements.dose?.value;
    const molecule = drug === 'SEMAGLUTIDE' ? 'Semaglutide' : 'Tirzepatide';
    title.textContent = preset === 'both' ? `Compare 1-Month vs 3-Month ${molecule} Plans` : `Compare ${molecule} ${preset === 'starter' ? 'Starter' : 'Step Up'} Plans`;
    document.title = `${title.textContent} · Clinic Scout`;
    let visible = 0;
    let unverified = 0;
    for (const card of cards) {
      const mode = card.dataset.stateMode;
      const includes = (card.dataset.stateIncludes || '').split(' ');
      const excludes = (card.dataset.stateExcludes || '').split(' ');
      const stateOk = !region || mode === 'unknown' || mode === 'all' || (mode === 'included' && includes.includes(region)) || (mode === 'excluded' && !excludes.includes(region));
      card.hidden = card.dataset.drugs !== drug || !stateOk;
      const status = !region ? 'not-selected' : mode === 'unknown' ? 'unverified' : stateOk ? 'verified' : 'excluded';
      card.dataset.selectedStateStatus = status;
      card.querySelector('[data-comparison-state]').textContent = status === 'unverified' || status === 'not-selected' ? 'State availability: not established for this selection.' : `State coverage is reported in the cited provider source; confirm current availability in ${region}.`;
      if (!card.hidden) { visible++; if (status === 'unverified') unverified++; }
    }
    // Display-only typed offers never enter numerical sorting. Nor do generic
    // monthly quotes become dose-matched prices when a dose is selected.
    const price = card => preset === 'both' && dose === 'all' && card.dataset.monthlyPrice !== '' ? Number(card.dataset.monthlyPrice) : Infinity;
    const ordered = cards.slice().sort((a, b) => (form.elements.sort.value === 'cheapest' ? price(a) - price(b) : 0) || a.dataset.providerName.localeCompare(b.dataset.providerName));
    for (const card of ordered) grid.append(card);
    result.textContent = `${visible} provider records${region ? ` for ${region}; ${unverified} need direct state verification` : ''}. Preset eligibility and dose matching are not established.`;
    selection.textContent = `${dose && dose !== 'all' ? `Requested ${preset === 'step-up' ? 'starting ' : ''}dose: ${dose} mg/week. ` : ''}No schedule, dose sequence or price for that dose is inferred. Cheapest sorts only comparable monthly cash quotes with All doses selected; other records stay unranked, in name order.`;
    main.querySelector('[data-filter-empty]').hidden = visible !== 0;
    const query = new URLSearchParams(new FormData(form));
    if (preset === 'both') query.set('plan', 'both');
    for (const link of main.querySelectorAll('[data-comparison-route]')) {
      const url = new URL(link.getAttribute('href'), location.origin);
      for (const key of ['drug', 'form', 'region', 'sort']) url.searchParams.set(key, query.get(key));
      if (dose && url.pathname !== '/starter/') url.searchParams.set('dose', dose); else url.searchParams.delete('dose');
      if (url.pathname.startsWith('/lp/best-providers/compounded-')) url.pathname = `/lp/best-providers/compounded-${molecule.toLowerCase()}/`;
      link.href = url.pathname + url.search;
    }
    if (persist) history.replaceState(null, '', location.pathname + '?' + query);
    form.dataset.comparisonReady = 'true';
  }
  form.addEventListener('change', () => apply(true));
  form.addEventListener('submit', event => { event.preventDefault(); apply(true); });
  main.querySelector('[data-filter-reset]')?.addEventListener('click', () => { form.reset(); apply(true); });
  window.addEventListener('popstate', restore);
  restore();
}

export function comparisonRuntime() {
  return `<script data-comparison-runtime>(${activateComparison.toString()})();</script>`;
}

export function comparisonStyles() {
  // Page-local styles leave existing route stylesheets and bytes unchanged.
  return `<style data-preserve data-comparison-styles>
    .comparison-plan-nav{display:flex;flex-wrap:wrap;align-items:start;gap:12px;margin-block:20px}
    .comparison-plan-nav [aria-current=page]{background:#173f31;color:#fff}
    .comparison-plan-nav summary{padding:12px;cursor:pointer;font-weight:700}
    .comparison-filters{display:flex!important;flex-wrap:wrap;align-items:end;gap:16px;position:static!important}
    .comparison-filters label{display:grid;gap:6px;flex:1 1 150px;min-width:0}
    .comparison-filters select{width:100%;max-width:100%;min-height:44px;background:#fff;color:#173f31;border:1px solid #657e70;border-radius:8px;padding:8px}
    [data-comparison-card]{min-width:0}[data-comparison-card][hidden]{display:none!important}
    .comparison-table-scroll{width:100%;overflow-x:auto;border:1px solid #d4ddd7;border-radius:10px;margin-block:16px}
    .comparison-table-scroll:focus-visible{outline:3px solid #176743;outline-offset:3px}
    .comparison-table-scroll table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.9rem}
    .comparison-table-scroll caption{padding:12px;text-align:left;font-weight:700}
    .comparison-table-scroll th,.comparison-table-scroll td{padding:12px;text-align:left;vertical-align:top;overflow-wrap:anywhere;border-top:1px solid #d4ddd7}
    .listing .comparison-table-scroll th{width:auto!important;background:#eff5f0;color:#173f31;letter-spacing:normal;text-transform:none}.comparison-table-scroll h4{font-size:1rem}
    .comparison-table-scroll ul{padding-left:18px}.comparison-totals dd{margin:0}
    [data-not-established]{color:inherit}[data-comparison-card] details{overflow-wrap:anywhere}
    .listing:has([data-comparison-filters]) [data-phase3-provider-grid]{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    .listing [data-comparison-card] table tbody tr{background:#10271e!important;color:#edf6f1!important}
    .listing [data-comparison-card] table tbody td::before{color:#b7c9bf!important}
    @media(max-width:900px){.listing:has([data-comparison-filters]){padding-top:100px!important}.listing:has([data-comparison-filters]) [data-phase3-provider-grid]{grid-template-columns:minmax(0,1fr)!important}}
    @media(max-width:600px){.comparison-filters label{flex-basis:calc(50% - 16px)}.comparison-table-scroll th,.comparison-table-scroll td{padding:8px}.comparison-table-scroll table[data-comparison-table=step-up]{min-width:460px}}
  </style>`;
}
