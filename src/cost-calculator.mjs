import { isTypedPrice, typedPriceText, renderTypedPrice } from "./typed-price-labels.mjs";
import { validateProviderDynamicProfiles } from "./provider-dynamic-profiles.mjs";
import { deriveMedicationEntries } from "./medication-options.mjs";
import { CITATION_REASONS, citationAttr } from "./citation-attribution.mjs";
import {isComparableCashRow,PRICE_STATE_DISCLOSURE} from './price-state.mjs';

// DESIGN WAVE 2026-08-06: post-calculate CTA label adapts to the single provider on screen.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function checkedDate(page, row) {
  const source = page.sources?.find((item) => item.url === row.source_url);
  return source?.verified_as_of || page.source_checked_through || page.date_modified;
}

// 2026-08-06 cluster 1: an override may name a program that is a declared ALIAS
// of another merchant. That row is deliberately not a calculator candidate (its
// canonical row is), so the override is redundant rather than broken - it is
// recorded as suppressed instead of either crashing the build or being silently
// swallowed the way a genuine typo must not be.
/**
 * Attach each provider's evidenced per-medication pricing.
 *
 * WHY (2026-08-18 operator defect): the calculator autofilled prices for FIVE of
 * 33 providers. Every other provider opened blank "manual" boxes, because the
 * only price the build had was one adjudicated whole-provider figure, and for
 * most providers no single figure is true - the price depends on which
 * medication you pick. The fix is a per-provider, per-medication matrix
 * (`data/provider-pricing-matrix.json`) where every number carries a verbatim
 * quote, its source URL, the capture date and the sha256 of the captured page.
 *
 * A provider with no evidenced price does NOT get an invented one: it ships the
 * honest unavailable state and the reader enters what they were quoted.
 */
export function attachPricingMatrix(providers, matrix) {
  if (!["glp-provider-pricing-matrix-v1", "glp-provider-pricing-matrix-v2"].includes(matrix?.schema) || !matrix.providers) {
    throw new Error("provider_pricing_matrix_invalid");
  }
  for (const provider of providers) {
    const entry = matrix.providers[provider.program_id];
    const medications = (entry?.medications || []).map((row) => {
      if (isTypedPrice(row)) {
        if (['month_1_usd','ongoing_usd','month_1_basis','cadence'].some(key=>Object.hasOwn(row,key))) throw new Error('pricing_matrix_amount_not_in_quote:typed_legacy_cash_field');
        if (matrix.schema !== 'glp-provider-pricing-matrix-v2') throw new Error('typed_row_in_v1_matrix');
        return {...row, display_only: true, display_text: typedPriceText(row)};
      }
      for (const field of ["medication_id", "label", "source_url", "quote", "captured_on"]) {
        if (!row[field]) throw new Error(`pricing_matrix_row_incomplete:${provider.program_id}:${field}`);
      }
      if (!/^https:\/\//.test(row.source_url)) throw new Error(`pricing_matrix_source_invalid:${provider.program_id}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.captured_on)) throw new Error(`pricing_matrix_capture_date_invalid:${provider.program_id}`);
      if (!["intro", "same_as_ongoing"].includes(row.month_1_basis)) throw new Error(`pricing_matrix_basis_invalid:${provider.program_id}:${row.medication_id}`);
      // The number a reader sees must be inside the quote a reader can check.
      for (const field of ["month_1_usd", "ongoing_usd"]) {
        const amount = row[field];
        if (amount === null || amount === undefined) continue;
        if (!Number.isFinite(amount) || amount < 0) throw new Error(`pricing_matrix_amount_invalid:${provider.program_id}:${row.medication_id}`);
        const quoteTokens = new Set([
          String(amount),
          amount.toLocaleString("en-US", { useGrouping: true, maximumFractionDigits: 2 }),
          Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2),
        ]);
        if (![...quoteTokens].some((token) => row.quote.includes(token))) {
          throw new Error(`pricing_matrix_amount_not_in_quote:${provider.program_id}:${row.medication_id}:${field}`);
        }
      }
      return row;
    });
    // One provider may publish two priced TIERS of one medication (enhance.md
    // ships "GLP-1 Advanced" and "Microdosing Tirzepatide", both compounded
    // tirzepatide injection). They are separate evidenced rows and must be
    // separately selectable, so each carries its own entry_key and a label
    // qualifier derived from its own quote. See src/medication-options.mjs.
    provider.medications = deriveMedicationEntries(provider.program_id, medications);
    provider.matrix_bound = true;
    provider.pricing_unavailable_reason = medications.length
      ? null
      : (entry?.unavailable_reason
        || "The captured first-party pages do not publish a price we can attribute to a specific medication.");
  }
  return providers;
}

export function buildCostCalculatorData(config, pages, providerContracts, fastpath, registry = null, profileId = "glp-clinic-scout", aliasIds = new Set(), pricingMatrix = null) {
  if (config.schema !== "glp-cost-calculator-v1" || !config.path?.startsWith("/tools/") || !Array.isArray(pages)) throw new Error("cost_calculator_config_invalid");
  if (providerContracts?.schema !== "glp-provider-fastpath-contracts-v1" || fastpath?.schema !== "glp-provider-fastpath-integration-v1") throw new Error("cost_calculator_fastpath_contract_missing");
  const candidates = new Map();
  for (const page of pages) {
    for (const row of page.rows || []) {
      const candidate = {
        program_id: row.program_id,
        provider: row.provider,
        first_month_base_usd: Number.isFinite(row.starting_price_sort) ? row.starting_price_sort : null,
        recurring_month_base_usd: Number.isFinite(row.starting_price_sort) ? row.starting_price_sort : null,
        one_time_fee_usd: 0,
        price_context: row.starting_price,
        source_url: row.source_url,
        checked_as_of: checkedDate(page, row),
      };
      const prior = candidates.get(row.program_id);
      if (!prior || candidate.price_context.length > prior.price_context.length) candidates.set(row.program_id, candidate);
    }
  }
  // 2026-08-06 surface unification: this used to assert the money-class count (13).
  // Candidates are now every provider carrying a comparison row, which is the whole
  // live set - so the check that matters is that a candidate is real, not that the
  // total equals a frozen literal.
  const comparisonCandidateCount = candidates.size;
  // Synergy RX published product prices with no cadence or supply period, so its
  // calculator row was fail-closed to safe copy rather than a computed number.
  // 2026-08-17: Katalys paused the program and the registry row was removed, so
  // the provider is no longer a candidate and the contract no longer carries the
  // block. Both must disappear together - a fail-closed override with no provider,
  // or a provider with no override, is a desync worth failing on.
  const synergy = candidates.get("synergy-rx");
  if (Boolean(synergy) !== Boolean(fastpath.synergy_rx)) throw new Error("cost_calculator_synergy_contract_invalid");
  if (synergy) {
    if (fastpath.synergy_rx.decision !== "FAIL_CLOSED_NO_CALCULATOR_ROW" || fastpath.synergy_rx.starting_price_sort !== null) throw new Error("cost_calculator_synergy_contract_invalid");
    Object.assign(synergy, {
      first_month_base_usd: null,
      recurring_month_base_usd: null,
      price_context: fastpath.synergy_rx.safe_display_copy,
      source_url: fastpath.synergy_rx.source_url,
      checked_as_of: fastpath.checked_as_of,
    });
  }
  const fastpathById = new Map((fastpath.providers || []).map((provider) => [provider.program_id, provider]));
  for (const contract of providerContracts.providers) {
    // A fast-path provider now also has a comparison row, so it is already a
    // candidate. Its contract row still supplies the price context, because the
    // contract is the artifact the price was researched into.
    if (contract.row_contract.starting_price_sort !== null) throw new Error(`cost_calculator_fastpath_row_invalid:${contract.program_id}`);
    candidates.set(contract.program_id, {
      program_id: contract.program_id,
      provider: contract.display_name,
      first_month_base_usd: null,
      recurring_month_base_usd: null,
      one_time_fee_usd: 0,
      price_context: contract.row_contract.starting_price,
      source_url: contract.row_contract.source_url,
      // A provider refreshed by a later research pass carries its own date; the
      // global contract date would misdate its published price (2026-08-06).
      checked_as_of: fastpathById.get(contract.program_id)?.checked_as_of || fastpath.checked_as_of,
    });
  }
  // 2026-08-06 coverage repair (G6): a fast-path contract row deliberately keeps
  // starting_price_sort null, so the only way a program with a genuinely comparable
  // published monthly figure (strut-health $149, biltrx $81) can reach the dropdown
  // is an explicit, source-backed first-month override alongside the recurring one.
  const suppressedAliasOverrides = [];
  const applyOverrides = (overrides, field, errorCode) => {
    for (const [programId, amount] of Object.entries(overrides || {})) {
      if (aliasIds.has(programId)) { suppressedAliasOverrides.push(`${field}:${programId}`); continue; }
      const provider = candidates.get(programId);
      if (!provider || !Number.isFinite(amount) || amount < 0) throw new Error(`${errorCode}:${programId}`);
      provider[field] = amount;
    }
  };
  applyOverrides(config.first_month_overrides, "first_month_base_usd", "cost_calculator_first_month_override_invalid");
  applyOverrides(config.recurring_overrides, "recurring_month_base_usd", "cost_calculator_override_invalid");
  applyOverrides(config.one_time_overrides, "one_time_fee_usd", "cost_calculator_one_time_override_invalid");
  let providers = [...candidates.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  let registryCalculatorIds = null;
  if (registry !== null) {
    if (registry.schema !== "site-program-registry-v1" || !registry.site_profiles?.[profileId]) throw new Error(`cost_calculator_program_registry_invalid:${profileId}`);
    const dynamic = validateProviderDynamicProfiles(registry, profileId, {
      asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
    });
    const candidateIds = new Set(candidates.keys());
    const missing = dynamic.canonicalIds.filter((id) => !candidateIds.has(id));
    if (missing.length) throw new Error(`cost_calculator_dynamic_membership_mismatch:missing=${missing.join(",")}`);
    providers = [...dynamic.profiles.values()].map((profile) => ({
      program_id: profile.program_id,
      provider: profile.provider,
      ...profile.calculator,
    })).sort((a, b) => a.provider.localeCompare(b.provider));
    // OPERATOR MODEL 2026-08-13: the dropdown pool is the canonical provider
    // set MINUS programs whose registry row scopes the calculator surface off
    // with a documented surface_restriction_basis exception (trt-nation:
    // editorial_link_dark, not live-eligible, so never a conversion option).
    const calculatorAllowed = new Set();
    for (const program of registry.programs || []) {
      if (program.profiles?.[profileId]?.surfaces?.calculator !== true) continue;
      calculatorAllowed.add(String(program.review_slug || program.program_id));
    }
    registryCalculatorIds = [...dynamic.canonicalIds].filter((id) => calculatorAllowed.has(String(id)));
  }
  if (registry === null && providers.length < comparisonCandidateCount) throw new Error(`cost_calculator_provider_count_invalid:${providers.length}:candidates:${comparisonCandidateCount}`);
  for (const provider of providers) {
    if (!provider.program_id || !provider.provider || !provider.price_context || !/^https:\/\//.test(provider.source_url) || !/^\d{4}-\d{2}-\d{2}$/.test(provider.checked_as_of)) throw new Error(`cost_calculator_provider_invalid:${provider.program_id}`);
  }
  if (pricingMatrix) attachPricingMatrix(providers, pricingMatrix);
  const pricingCoverage = {
    providers: providers.length,
    with_evidenced_pricing: providers.filter((provider) => (provider.medications || []).length).length,
    pricing_unavailable: providers.filter((provider) => !(provider.medications || []).length).length,
    medication_rows: providers.reduce((total, provider) => total + (provider.medications || []).length, 0),
    rows_with_intro_month_1: providers.reduce((total, provider) => total
      + (provider.medications || []).filter((medication) => medication.month_1_basis === "intro").length, 0),
  };
  return { ...config, providers, registry_calculator_ids: registryCalculatorIds, pricing_coverage: pricingCoverage, suppressed_alias_overrides: suppressedAliasOverrides.sort() };
}

// A provider is only offered in the dropdown when it has BOTH a usable first-month
// AND a usable recurring price to autofill (operator: "no provider without info may be
// an option"). Providers that fail this ("price not stated", e.g. synergy-rx) are excluded.
export function costCalculatorDropdownProviders(data) {
  const eligible = [];
  const excluded = [];
  const registryIds = Array.isArray(data.registry_calculator_ids) ? new Set(data.registry_calculator_ids) : null;
  for (const provider of data.providers) {
    const usable = (!registryIds || registryIds.has(provider.program_id)) && (
      provider.matrix_bound ? (provider.medications || []).some(isComparableCashRow) : (provider.medications || []).length > 0
      || provider.mode === "manual"
      || provider.mode === "autofill" && Number.isFinite(provider.first_month_base_usd) && Number.isFinite(provider.recurring_month_base_usd)
      || provider.mode === undefined && Number.isFinite(provider.first_month_base_usd) && Number.isFinite(provider.recurring_month_base_usd)
    );
    (usable ? eligible : excluded).push(provider);
  }
  return { eligible, excluded };
}

export function renderCostCalculator(data) {
  return decorateCostCalculatorDesign(renderCostCalculatorBase(data)).replace('</main>', PRICE_STATE_DISCLOSURE+'</main>');
}

// DESIGN PASS 2026-08-26 (calculator-tools spec, GLPWinner emulation): the base
// markup now carries the split hero-workspace geometry itself, so this
// decorator only (a) applies the shared palette-action button treatment and
// (b) appends the presentation-only scripts: the existing result count-up
// (byte-identical), a load count-up for the published-price anchor, and the
// months preset pills. None of them touch calculation, analytics, pricing
// plumbing, or URL-param behavior — those live untouched in the base script.
// Design pass 2026-08-27 (Phase-2 selection #7, count-up audit-then-upgrade):
// the anchor count-up ([data-cost-countup], second IIFE) is this page's OWN
// runtime, so it is upgraded in place rather than duplicated in site.js —
// reconciled to the selection's contract: 600ms (was 750ms), fires ONCE
// on-enter via IntersectionObserver (was at parse time). Reduced motion and
// touch/mobile rendering keep the server-rendered final value so changing digit
// widths cannot move the rest of the first viewport. tabular-nums already binds
// in 50-tools.
function decorateCostCalculatorDesign(html) {
  return html
    .replaceAll('class="gcs-button"', 'class="gcs-button cs-palette-action"')
    .replace(
      '</body>',
      `<script>(()=>{const ids=['result-first','result-recurring','result-period'];const enhanced=matchMedia('(prefers-reduced-motion: no-preference) and (pointer: fine) and (min-width: 901px)').matches;const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});function animate(){for(const id of ids){const el=document.getElementById(id);if(!el)continue;const final=el.textContent;const value=Number(final.replace(/[^0-9.]/g,''));if(!enhanced||!Number.isFinite(value)||value<=0){el.textContent=final;continue}const started=performance.now();const step=now=>{const t=Math.min(1,(now-started)/650);el.textContent=money.format(Math.round(value*(1-Math.pow(1-t,3))));if(t<1)requestAnimationFrame(step);else el.textContent=final};requestAnimationFrame(step)}}const form=document.getElementById('cost-form');form?.addEventListener('submit',()=>requestAnimationFrame(animate));if(!document.getElementById('cost-result')?.hidden)requestAnimationFrame(animate)})();(()=>{if(!matchMedia('(prefers-reduced-motion: no-preference) and (pointer: fine) and (min-width: 901px)').matches)return;const plain=new Intl.NumberFormat('en-US');const run=el=>{const final=el.textContent;const value=Number(final.replace(/[^0-9.]/g,''));if(!Number.isFinite(value)||value<=0)return;const started=performance.now();const step=now=>{const t=Math.min(1,(now-started)/600);el.textContent=plain.format(Math.round(value*(1-Math.pow(1-t,3))));if(t<1)requestAnimationFrame(step);else el.textContent=final};requestAnimationFrame(step)};const targets=[...document.querySelectorAll('[data-cost-countup]')];if(!targets.length)return;if(!('IntersectionObserver' in window)){targets.forEach(run);return}const seen=new WeakSet();const io=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting||seen.has(entry.target))continue;seen.add(entry.target);io.unobserve(entry.target);run(entry.target)}},{threshold:0.5});for(const el of targets)io.observe(el)})();(()=>{const months=document.getElementById('months'),wrap=document.querySelector('[data-months-pills]');if(!months||!wrap)return;const pills=[...wrap.querySelectorAll('.cost-pill')];const sync=()=>{for(const pill of pills)pill.setAttribute('aria-pressed',String(months.value===pill.dataset.months))};for(const pill of pills)pill.addEventListener('click',()=>{months.value=pill.dataset.months;sync()});months.addEventListener('input',sync);document.getElementById('cost-form')?.addEventListener('reset',()=>requestAnimationFrame(sync));wrap.hidden=false;sync()})();</script></body>`,
    );
}

function renderCostCalculatorBase(data) {
  const { eligible } = costCalculatorDropdownProviders(data);
  const options = eligible.map((provider) => `<option value="${esc(provider.program_id)}" data-mode="${esc(provider.mode || "autofill")}" data-first="${provider.first_month_base_usd ?? ""}" data-recurring="${provider.recurring_month_base_usd ?? ""}" data-onetime="${provider.one_time_fee_usd ?? ""}" data-context="${esc(provider.price_context)}" data-gap="${esc(provider.evidence_gap_copy || "")}" data-source="${esc(provider.source_url)}" data-checked="${esc(provider.checked_as_of)}">${esc(provider.provider)}</option>`).join("");
  // Keep the derived matrix coverage in the calculator's runtime payload. The
  // browser uses only provider fields, while the bidirectional claim ledger can
  // prove all five canonical coverage counts without a hidden DOM text dump.
  const coveragePayload = {
    providers_total: data.pricing_coverage.providers,
    providers_with_evidenced_pricing: data.pricing_coverage.with_evidenced_pricing,
    providers_pricing_unavailable: data.pricing_coverage.pricing_unavailable,
    medication_rows: data.pricing_coverage.medication_rows,
    rows_with_intro_month_1: data.pricing_coverage.rows_with_intro_month_1,
  };
  // The calculator runtime never reads dose-pricing governance metadata. Keep it
  // out of generated HTML so OMIT-only statuses cannot become public copy.
  const publicRuntimeProvider = (provider) => ({
    ...provider,
    medications: (provider.medications || []).map(({ dose_pricing: _dosePricing, ...medication }) => medication),
  });
  const runtimeProviders = eligible.map((provider, index) => {
    const projected = publicRuntimeProvider(provider);
    return index === 0 ? { ...projected, pricing_coverage: coveragePayload } : projected;
  });
  const dataJson = JSON.stringify(runtimeProviders).replaceAll("<", "\\u003c");
  const expandedBase = JSON.stringify(data.expanded_comparison_path || data.related_comparison_path);
  const anchorPrefix = JSON.stringify(data.provider_anchor_prefix || "provider-");
  // DESIGN PASS 2026-08-26 (calculator-tools spec fixes #2/#3): the estimate
  // column is never empty at first paint. It opens on the published-price
  // spread across the compared programs — derived from the SAME evidenced
  // matrix rows the calculator autofills from (quote-bound, dated), so the
  // anchor can never disagree with the tool beneath it. No matrix → no anchor;
  // the prompt still keeps the column alive rather than inventing a number.
  const monthlyEvidence = [];
  for (const provider of data.providers) {
    for (const medication of provider.medications || []) {
      if (Number.isFinite(medication.ongoing_usd) && medication.cadence === "month") monthlyEvidence.push(medication);
    }
  }
  const anchorAmount = (value) => Math.round(value).toLocaleString("en-US");
  const anchorLow = monthlyEvidence.length ? Math.min(...monthlyEvidence.map((row) => row.ongoing_usd)) : null;
  const anchorHigh = monthlyEvidence.length ? Math.max(...monthlyEvidence.map((row) => row.ongoing_usd)) : null;
  const anchorChecked = monthlyEvidence.reduce((latest, row) => (row.captured_on > latest ? row.captured_on : latest), "");
  const anchorBlock = monthlyEvidence.length
    ? `<p class="cost-anchor-eyebrow">Compared programs publish between</p><p class="cost-anchor"><span class="sr-only">${anchorAmount(anchorLow)} to ${anchorAmount(anchorHigh)} dollars a month</span><span aria-hidden="true" class="cost-anchor-currency">$</span><span aria-hidden="true" class="cost-anchor-value" data-cost-countup>${anchorAmount(anchorLow)}</span><span aria-hidden="true" class="cost-anchor-join">to</span><span aria-hidden="true" class="cost-anchor-currency">$</span><span aria-hidden="true" class="cost-anchor-value" data-cost-countup>${anchorAmount(anchorHigh)}</span><span aria-hidden="true" class="cost-anchor-period">/ month</span></p><p class="cost-anchor-note">${monthlyEvidence.length} published monthly prices, each quoted and dated · checked through ${esc(anchorChecked)}</p>`
    : "";
  const typedPanel = `<section data-calculator-typed-offers><h2>Reported plan information — manual calculation only</h2><p>These offers never autofill cash charges. Select a plan, then enter your complete quoted charges and known fees (including an explicit zero if no fee applies).</p>${eligible.map(p=>(p.medications||[]).filter(isTypedPrice).map(r=>`<div data-typed-provider="${esc(p.program_id)}"><h3>${esc(p.provider)}</h3>${renderTypedPrice(r)}</div>`).join('')).join('')}</section>`;
  const idlePanel = `<div id="cost-idle" class="cost-idle"><hr class="cost-intro-rule" aria-hidden="true">${anchorBlock}<p class="cost-anchor-prompt">Pick a provider to see your number. Autofilled prices link to the first-party page they were captured from.</p></div>`;
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #7): the calculator
  // shipped publisher-Organization-only markup. It now declares itself the same
  // way the quiz does — WebApplication (HealthApplication category) — plus a
  // BreadcrumbList. Honest page facts only; no ratings, nothing fabricated.
  const pageSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `https://glpclinicscout.com${data.path}#app`,
        name: data.h1,
        url: `https://glpclinicscout.com${data.path}`,
        applicationCategory: "HealthApplication",
        description: data.description,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `https://glpclinicscout.com${data.path}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://glpclinicscout.com/" },
          { "@type": "ListItem", position: 2, name: data.h1, item: `https://glpclinicscout.com${data.path}` },
        ],
      },
    ],
  }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en" data-release="release-ready"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow,max-image-preview:large"><title>${esc(data.title)} | Clinic Scout</title><meta name="description" content="${esc(data.description)}"><link rel="canonical" href="https://glpclinicscout.com${esc(data.path)}"><script type="application/ld+json">${pageSchema}</script><style data-preserve>
  .cost-form,.cost-result{padding:clamp(22px,3vw,34px);border:1px solid rgba(20,32,27,.08);border-radius:var(--radius-panel,26px);background:var(--cs-paper-card,#fffdf7);color:var(--cs-ink-on-paper,#14201b);box-shadow:var(--cs-card-shadow-paper,0 12px 32px -18px rgba(20,32,27,.25))}.cost-form{display:grid;gap:16px}.cost-form label{display:grid;gap:4px}.cost-label{font-weight:700;font-family:var(--font-display,inherit);letter-spacing:-.01em}.cost-hint{font-weight:500;font-size:.82rem;line-height:1.35;color:var(--cs-muted-on-paper,#51645c)}.cost-form input,.cost-form select{width:100%;min-height:50px;margin-top:3px;padding:10px 14px;border:1px solid rgba(20,32,27,.2);border-radius:14px;background:#fff;color:var(--cs-ink-on-paper,#14201b);font:inherit;transition:border-color 150ms ease,box-shadow 150ms ease,background 150ms ease}.cost-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}.cost-source{padding:14px 16px;border-left:4px solid #b07900;background:rgba(240,178,63,.15);border-radius:0 10px 10px 0;color:var(--cs-ink-on-paper,#14201b)}.cost-result{position:sticky;top:96px}.cost-breakdown{display:grid;gap:0;margin:18px 0}.cost-breakdown div{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:12px 0;border-bottom:1px dashed rgba(20,32,27,.22)}.cost-breakdown strong{font-family:var(--font-display,inherit);font-weight:800;font-variant-numeric:tabular-nums;font-size:1.12rem}.cost-actions{flex-direction:column;align-items:stretch;margin-top:6px}.cost-result[hidden]{display:none}@media(max-width:860px){.cost-result{position:static}}
  .cost-form input[readonly]{background:#f2faf6;border-color:rgba(14,125,92,.32);color:var(--cs-ink-on-paper,#14201b);cursor:default}
  .cost-months-field{grid-column:1/-1;display:grid;gap:4px}.cost-months-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:3px}.cost-form .cost-months-row input{width:96px;flex:none;margin-top:0}.cost-months-pills{display:flex;flex-wrap:wrap;gap:8px}.cost-months-pills[hidden]{display:none}.cost-pill{min-height:44px;min-width:52px;padding:8px 14px;border:1px solid rgba(20,32,27,.22);border-radius:999px;background:#fff;color:var(--cs-ink-on-paper,#14201b);font:inherit;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer;transition:border-color 150ms ease,background 150ms ease,box-shadow 150ms ease}.cost-pill:hover{border-color:rgba(14,125,92,.55)}.cost-pill:focus-visible{outline:2px solid #0e7d5c;outline-offset:2px}.cost-pill[aria-pressed="true"]{border-color:#0e7d5c;background:rgba(14,125,92,.1);box-shadow:0 0 0 1px rgba(14,125,92,.35);color:#0b4a37}
  @media (prefers-reduced-motion:no-preference){#cost-medication-field:not([hidden]),#cost-source:not([hidden]),#cost-unavailable:not([hidden]),#cost-price-note:not([hidden]){animation:cost-reveal 200ms var(--ease-out-expo,ease-out) both}.cost-result:not([hidden]){animation:cost-receipt-pop 260ms var(--ease-out-expo,ease-out) both}}@keyframes cost-reveal{from{opacity:0;transform:translateY(6px)}}@keyframes cost-receipt-pop{from{opacity:0;transform:scale(.965)}}.cost-locked-hint{display:block;margin-top:4px;font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#0e7d5c}.cost-locked-hint[hidden]{display:none}.cost-price-note{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:.85rem;color:var(--cs-muted-on-paper,#51645c)}.cost-price-note[hidden]{display:none}.cost-linkbtn{min-height:auto;background:none;border:0;padding:0;font:inherit;font-weight:750;color:var(--cs-ink-on-paper,#14201b);text-decoration:underline;text-underline-offset:2px;cursor:pointer}.cost-linkbtn:hover{color:#0e7d5c}.cost-fulllist{margin-top:10px}.cost-unavailable{padding:14px 16px;border-left:4px solid rgba(20,32,27,.3);background:rgba(20,32,27,.05);border-radius:0 10px 10px 0;font-size:.92rem;line-height:1.45}.cost-unavailable[hidden]{display:none}.cost-quote{margin:8px 0;padding:8px 12px;border-left:3px solid #b07900;background:rgba(240,178,63,.08);font-size:.86rem;line-height:1.45;font-style:italic;border-radius:0 8px 8px 0}.cost-quote[hidden]{display:none}.cost-basis{display:block;margin-top:4px;font-size:.72rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#8a6100}.cost-basis[hidden]{display:none}.cost-fulllist a{color:var(--cs-ink-on-paper,#14201b);font-weight:700}
  .cost-form,.cost-result{--cs-ink-on-paper:#f5fbf8;--cs-muted-on-paper:#afc4bb;background:linear-gradient(155deg,rgba(14,31,27,.98),rgba(8,20,29,.96))!important;color:#f5fbf8!important;border-color:rgba(158,224,198,.22)!important;box-shadow:0 28px 70px -42px rgba(0,0,0,.88),inset 0 1px 0 rgba(255,255,255,.05)!important}.cost-form input,.cost-form select{background-color:transparent!important;color:#f5fbf8!important;border:0!important;border-bottom:1px solid rgba(177,224,207,.42)!important;border-radius:0!important;padding-inline:2px 48px!important;box-shadow:none!important}.cost-form select{appearance:none;background-color:transparent!important;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='none'%3E%3Cpath d='m5 7 5 5 5-5' stroke='%2378e0b8' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 5px center!important;background-size:20px 20px!important;cursor:pointer}.cost-form select:hover{border-bottom-color:#bff5df!important;background-color:rgba(120,224,184,.045)!important}.cost-form select option{background:#10211d;color:#f5fbf8}.cost-form input:focus-visible,.cost-form select:focus-visible{outline:0!important;border-bottom-color:#78e0b8!important;box-shadow:0 2px 0 #78e0b8!important}.cost-form input[readonly]{background:transparent!important;color:#d8e7e0!important;border-color:rgba(177,224,207,.25)!important}.cost-source,.cost-unavailable,.cost-quote{color:#e8f3ee;background:rgba(255,255,255,.055)}.cost-pill{background:rgba(255,255,255,.045);color:#e8f3ee;border-color:rgba(177,224,207,.3)}.cost-pill[aria-pressed="true"]{background:rgba(76,216,164,.16);color:#bff5df}.cost-affiliate-offer{background:rgba(255,255,255,.05)!important;border-color:rgba(158,224,198,.22)!important}.cost-affiliate-disclosure{color:#afc4bb!important}
  </style></head><body data-page="cost-calculator"><main class="cost-calculator-page"><section class="gcs-section cost-workspace" data-motion="fade"><div class="gcs-container"><div class="calc-layout" data-motion-group data-motion-stagger="0.1"><header class="cost-intro"><p class="gcs-kicker">Free planning tool · no signup</p><h1>${esc(data.h1)}</h1><p class="gcs-lede">${esc(data.description)}</p></header>${idlePanel}${typedPanel}<form id="cost-form" class="cost-form"><label><span class="cost-label">Provider program</span><small class="cost-hint">Every compared provider is selectable. Exact comparable prices autofill; evidence gaps open blank manual entry.</small><select id="provider" name="provider" required><option value="">Choose a provider</option>${options}</select></label><label id="cost-medication-field" hidden><span class="cost-label">Medication</span><small class="cost-hint">Only the medications this provider actually publishes a price for</small><select id="medication" name="medication"></select></label><div id="cost-unavailable" class="cost-unavailable" hidden><strong>Pricing unavailable for this provider.</strong> <span id="cost-unavailable-why"></span> Enter the amounts you were quoted below and the estimate still works.</div><div id="cost-source" class="cost-source" hidden><strong id="cost-context"></strong><p id="cost-evidence-gap" hidden></p><blockquote id="cost-quote" class="cost-quote" hidden></blockquote><small>Published price captured <span id="cost-checked"></span> · <a id="cost-source-link" href="/providers/" rel="noopener"${citationAttr(CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE)}>view the provider's page</a></small></div><div id="cost-price-note" class="cost-price-note" hidden><span class="cost-price-note-text">These prices come from the provider's published pricing.</span> <button type="button" id="edit-prices" class="cost-linkbtn" aria-pressed="false">Edit prices</button></div><div class="cost-grid"><label><span class="cost-label">Month 1</span><small class="cost-hint">What this provider advertises for your first month</small><input id="first-base" name="first" type="number" min="0" max="10000" step="1" inputmode="decimal" required><small class="cost-locked-hint" data-locked-hint hidden>From published pricing</small><small class="cost-basis" id="cost-first-basis" hidden></small></label><label><span class="cost-label">Ongoing months</span><small class="cost-hint">The regular monthly price from month 2 onward</small><input id="recurring-base" name="recurring" type="number" min="0" max="10000" step="1" inputmode="decimal" required><small class="cost-locked-hint" data-locked-hint hidden>From published pricing</small><small class="cost-basis" id="cost-recurring-basis" hidden></small></label><label><span class="cost-label">One-time startup fees</span><small class="cost-hint">Signup or consultation fees charged once</small><input id="one-time" name="fees" type="number" min="0" max="10000" step="1" inputmode="decimal" value="0"><small class="cost-locked-hint" data-locked-hint hidden>From published pricing</small></label><label><span class="cost-label">Monthly extras</span><small class="cost-hint">Add-ons like shipping or coaching, per month</small><input id="add-ons" name="addons" type="number" min="0" max="10000" step="1" inputmode="decimal" value="0"></label><label><span class="cost-label">Monthly savings</span><small class="cost-hint">Discounts, coupons, or insurance help, per month</small><input id="discount" name="discount" type="number" min="0" max="10000" step="1" inputmode="decimal" value="0"></label><div class="cost-months-field"><label for="months"><span class="cost-label">How many months?</span><small class="cost-hint">How far ahead to plan</small></label><div class="cost-months-row"><div class="cost-months-pills" data-months-pills hidden><button type="button" class="cost-pill" data-months="1" aria-pressed="false" aria-label="1 month">1</button><button type="button" class="cost-pill" data-months="3" aria-pressed="true" aria-label="3 months">3</button><button type="button" class="cost-pill" data-months="6" aria-pressed="false" aria-label="6 months">6</button><button type="button" class="cost-pill" data-months="12" aria-pressed="false" aria-label="12 months">12</button></div><input id="months" name="months" type="number" min="1" max="${esc(data.max_months)}" step="1" inputmode="numeric" value="3"></div></div></div><div class="gcs-actions"><button class="gcs-button" type="submit">Calculate estimate</button><button class="gcs-button secondary" type="reset" data-cost-reset>Reset</button></div></form><aside id="cost-result" class="cost-result" aria-live="polite" hidden data-calculator-receipt><p class="gcs-kicker">Your estimate</p><h2 id="result-provider">Planning total</h2><p id="result-medication" class="gcs-note" hidden></p><div class="cost-breakdown"><div><span>Month 1</span><strong id="result-first"></strong></div><div><span>Ongoing months</span><strong id="result-recurring"></strong></div><div><span id="result-period-label">Period total</span><strong id="result-period"></strong></div></div><p class="gcs-note">${esc(data.disclaimer)}</p><div class="gcs-actions cost-actions"><a id="cost-compare-link" class="gcs-button" href="${esc(data.expanded_comparison_path)}">Compare these providers →</a><a class="gcs-button secondary" href="${esc(data.quiz_path)}">Find my match</a><button id="copy-cost-link" class="gcs-button secondary" type="button">Copy shareable link</button></div><p class="gcs-note cost-fulllist"><a href="${esc(data.related_comparison_path)}">See our full ranked provider list →</a></p><p id="copy-status" class="gcs-note" aria-live="polite"></p></aside></div></div></section></main><script>window.GCS_COST_PROVIDERS=${dataJson};(()=>{const form=document.getElementById('cost-form'),provider=document.getElementById('provider'),medication=document.getElementById('medication'),medicationField=document.getElementById('cost-medication-field'),unavailable=document.getElementById('cost-unavailable'),unavailableWhy=document.getElementById('cost-unavailable-why'),quote=document.getElementById('cost-quote'),firstBasis=document.getElementById('cost-first-basis'),recurringBasis=document.getElementById('cost-recurring-basis'),resultMedication=document.getElementById('result-medication'),first=document.getElementById('first-base'),recurring=document.getElementById('recurring-base'),fees=document.getElementById('one-time'),addons=document.getElementById('add-ons'),discount=document.getElementById('discount'),months=document.getElementById('months'),source=document.getElementById('cost-source'),gap=document.getElementById('cost-evidence-gap'),result=document.getElementById('cost-result'),editBtn=document.getElementById('edit-prices'),priceNote=document.getElementById('cost-price-note'),compareLink=document.getElementById('cost-compare-link'),lockedHints=document.querySelectorAll('[data-locked-hint]');const BY_ID=Object.fromEntries((window.GCS_COST_PROVIDERS||[]).map(p=>[p.program_id,p]));function currentProvider(){return BY_ID[provider.value]||null}function currentMedication(){const p=currentProvider();if(!p||!(p.medications||[]).length)return null;const meds=p.medications||[];return meds.find(m=>(m.entry_key||m.medication_id)===medication.value)||meds.find(m=>m.medication_id===medication.value)||meds[0]}const EXPANDED_BASE=${expandedBase},ANCHOR_PREFIX=${anchorPrefix};const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});const clamp=(input,min,max)=>Math.min(max,Math.max(min,Number(input.value)||0));const priceFields=[first,recurring,fees];let pricesUnlocked=false;function fillFromMedication(){const p=currentProvider(),m=currentMedication();if(!p)return;if(m?.display_only){first.value='';recurring.value='';fees.value='';firstBasis.hidden=true;recurringBasis.hidden=true;result.hidden=true;return}if(m){first.value=m.month_1_usd==null?'':String(m.month_1_usd);recurring.value=m.ongoing_usd==null?'':String(m.ongoing_usd);fees.value=String(p.one_time_fee_usd||0);firstBasis.textContent=m.month_1_basis==='intro'?'Intro price — first month only':'No separate intro price published';firstBasis.hidden=false;recurringBasis.textContent=m.cadence&&m.cadence!=='month'?('Published per '+m.cadence):'Published monthly price';recurringBasis.hidden=false;return}first.value='';recurring.value='';fees.value='0';firstBasis.hidden=true;recurringBasis.hidden=true}
function renderMedications(){const p=currentProvider();medication.replaceChildren();const meds=(p&&p.medications)||[];for(const m of meds){const option=document.createElement('option');option.value=m.entry_key||m.medication_id;option.textContent=m.display_label||m.label;option.dataset.medicationId=m.medication_id;medication.append(option)}medicationField.hidden=!meds.length;unavailable.hidden=!p||meds.length>0;if(p&&!meds.length)unavailableWhy.textContent=p.pricing_unavailable_reason||'';}
function showEvidence(){const p=currentProvider(),m=currentMedication();if(!p){source.hidden=true;quote.hidden=true;return}if(m?.display_only){source.hidden=true;quote.hidden=true;gap.hidden=true;return}document.getElementById('cost-context').textContent=m?((m.display_label||m.label)+((m.display_label||'').includes('—')?' · ':' — ')+(m.month_1_basis==='intro'?('$'+m.month_1_usd+' first month, then $'+m.ongoing_usd+'/'+(m.cadence||'month')):('$'+m.ongoing_usd+' per '+(m.cadence||'month')))):p.price_context;gap.textContent=m?'':(p.evidence_gap_copy||'');gap.hidden=!gap.textContent;quote.textContent=m?('\u201c'+m.quote+'\u201d'):'';quote.hidden=!m;document.getElementById('cost-checked').textContent=m?m.captured_on:p.checked_as_of;document.getElementById('cost-source-link').href=m?m.source_url:p.source_url;source.hidden=false}function refreshLock(){const hasProvider=!!provider.value;const manual=hasProvider&&(!currentMedication()||currentMedication().display_only===true);priceNote.hidden=!hasProvider||manual;const locked=hasProvider&&!manual&&!pricesUnlocked;for(const el of priceFields){if(locked){el.setAttribute('readonly','');el.setAttribute('aria-readonly','true')}else{el.removeAttribute('readonly');el.removeAttribute('aria-readonly')}}for(const h of lockedHints)h.hidden=!locked;editBtn.hidden=manual;editBtn.textContent=pricesUnlocked?'Use published prices':'Edit prices';editBtn.setAttribute('aria-pressed',String(pricesUnlocked))}function selectProvider(){const option=provider.selectedOptions[0];if(!option?.value){medicationField.hidden=true;unavailable.hidden=true;source.hidden=true;quote.hidden=true;gap.hidden=true;gap.textContent='';first.value='';recurring.value='';fees.value='0';firstBasis.hidden=true;recurringBasis.hidden=true;pricesUnlocked=false;compareLink.href=EXPANDED_BASE;compareLink.textContent='Compare these providers \u2192';refreshLock();return}renderMedications();pricesUnlocked=!currentMedication();fillFromMedication();showEvidence();compareLink.href=EXPANDED_BASE+'#'+ANCHOR_PREFIX+option.value;compareLink.textContent='Compare these providers \u2192';refreshLock();if(pricesUnlocked)first.focus()}
function selectMedication(){pricesUnlocked=false;fillFromMedication();showEvidence();refreshLock()}function params(){return new URLSearchParams({provider:provider.value,medication:medication.value||'',first:String(clamp(first,0,10000)),recurring:String(clamp(recurring,0,10000)),fees:String(clamp(fees,0,10000)),addons:String(clamp(addons,0,10000)),discount:String(clamp(discount,0,10000)),months:String(clamp(months,1,${esc(data.max_months)}))})}function calculate(event){event?.preventDefault();if(!provider.value||first.value===''||recurring.value===''||(currentMedication()?.display_only&&fees.value==='')){form.reportValidity();return}const firstTotal=Math.max(0,clamp(first,0,10000)+clamp(fees,0,10000)+clamp(addons,0,10000)-clamp(discount,0,10000));const recurringTotal=Math.max(0,clamp(recurring,0,10000)+clamp(addons,0,10000)-clamp(discount,0,10000));const period=clamp(months,1,${esc(data.max_months)});const periodTotal=firstTotal+recurringTotal*(period-1);document.getElementById('result-provider').textContent='Planning total';const chosen=currentMedication();resultMedication.textContent=chosen?.display_only?'User-entered complete quote — not a source-reported total':chosen?((chosen.display_label||chosen.label)+' \u00b7 published price captured '+chosen.captured_on):'Prices you entered — this provider does not publish a comparable price.';resultMedication.hidden=false;document.getElementById('result-first').textContent=money.format(firstTotal);document.getElementById('result-recurring').textContent=money.format(recurringTotal);document.getElementById('result-period-label').textContent='Period total';document.getElementById('result-period').textContent=money.format(periodTotal);result.hidden=false;history.replaceState(null,'',location.pathname+'?'+params().toString());window.GCSAnalytics?.event('cost_calculator_complete',{page_slug:location.pathname,provider:provider.value});result.scrollIntoView({behavior:'smooth',block:'nearest'})}provider.addEventListener('change',()=>{selectProvider();window.GCSAnalytics?.event('cost_calculator_used',{page_slug:location.pathname})});editBtn.addEventListener('click',()=>{if(!provider.value)return;pricesUnlocked=!pricesUnlocked;if(!pricesUnlocked)fillFromMedication();refreshLock();if(pricesUnlocked)first.focus()});medication.addEventListener('change',()=>{selectMedication();window.GCSAnalytics?.event('cost_calculator_medication_selected',{page_slug:location.pathname,provider:provider.value,medication:medication.value})});form.addEventListener('submit',calculate);form.addEventListener('reset',event=>{event.preventDefault();provider.value='';medication.value='';addons.value='0';discount.value='0';months.value='3';selectProvider();result.hidden=true;history.replaceState(null,'',location.pathname);document.getElementById('copy-status').textContent=''});document.getElementById('copy-cost-link').addEventListener('click',async()=>{const url=location.origin+location.pathname+'?'+params().toString();try{await navigator.clipboard.writeText(url);document.getElementById('copy-status').textContent='Estimate link copied.'}catch{document.getElementById('copy-status').textContent=url}});const q=new URLSearchParams(location.search);if(q.get('provider')&&[...provider.options].some(option=>option.value===q.get('provider'))){provider.value=q.get('provider');selectProvider();if(q.get('medication')){const want=q.get('medication');const hit=[...medication.options].find(option=>option.value===want)||[...medication.options].find(option=>option.dataset.medicationId===want);if(!hit){provider.value='';medication.value='';selectProvider();result.hidden=true;document.getElementById('copy-status').textContent='This saved medication option is unavailable. Choose a current provider and medication.';return}medication.value=hit.value;selectMedication()}let edited=false;for(const [key,input] of [['first',first],['recurring',recurring],['fees',fees],['addons',addons],['discount',discount],['months',months]]){if(q.has(key)){if((key==='first'||key==='recurring'||key==='fees')&&q.get(key)!==input.value)edited=true;input.value=q.get(key)}}if(edited){pricesUnlocked=true;refreshLock()}calculate()}})();</script></body></html>`;
}
