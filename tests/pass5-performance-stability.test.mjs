import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildCostCalculatorData, renderCostCalculator } from "../src/cost-calculator.mjs";
import { PROVIDER_REVEAL_BATCH_SIZE } from "../src/surface-tallies.mjs";

const readJson = async (relative) => JSON.parse(await readFile(new URL(`../data/${relative}`, import.meta.url), "utf8"));

test("Pass 5 first viewport keeps fonts and calculator counters layout-stable", async () => {
  const foundation = await readFile(new URL("../assets/css-src/00-foundation.css", import.meta.url), "utf8");
  assert.equal((foundation.match(/font-display:\s*optional/g) || []).length, 2);
  assert.doesNotMatch(foundation, /font-display:\s*swap/);

  const config = await readJson("cost-calculator.json");
  const money = await readJson("money-page-specs.json");
  const providerPages = await readJson("provider-page-contracts.json");
  const providerFastpath = await readJson("provider-fastpath-contract.json");
  const registry = await readJson("program-registry.json");
  const html = renderCostCalculator(buildCostCalculatorData(config, money.pages, providerPages, providerFastpath, registry));

  const enhancedMotionQuery = "(prefers-reduced-motion: no-preference) and (pointer: fine) and (min-width: 901px)";
  assert.equal((html.match(new RegExp(enhancedMotionQuery.replace(/[()]/g, "\\$&"), "g")) || []).length, 2);
  assert.doesNotMatch(html, /const reduce=matchMedia/);
  assert.match(html, /if\(!enhanced\|\|!Number\.isFinite\(value\)/);
});

test("brand-page insurance organizer keeps its server-rendered initial state off the critical JS path", async () => {
  const [runtime, wegovy] = await Promise.all([
    readFile(new URL("../assets/site.js", import.meta.url), "utf8"),
    readFile(new URL("../public/wegovy/index.html", import.meta.url), "utf8"),
  ]);
  const wizard = wegovy.match(/<form\b[^>]*\bdata-insurance-wizard\b[^>]*>[\s\S]*?<\/form>/)?.[0];
  const wizardRuntime = runtime.match(/  document\.querySelectorAll\('\[data-insurance-wizard\]'\)\.forEach\(\(form\) => \{[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(wizard, "the server-rendered coverage wizard must be present");
  assert.ok(wizardRuntime, "the coverage wizard initializer must be present");
  assert.match(wizard, /<output data-coverage-label>Not covered \/ unsure<\/output>/);
  assert.match(wizard, /<input name="coverage" type="range" min="0" max="3" step="1" value="0" aria-label="Your coverage expectation \(self-reported\)" aria-valuetext="Not covered \/ unsure" style="--p3-progress:0%">/);
  assert.match(wizard, /<output id="insurance-result-wegovy" class="p3-insurance-result" data-insurance-result aria-live="polite" aria-atomic="true">Choose your coverage expectation, then finish your estimate\.<\/output>/);
  assert.match(wizardRuntime, /const coverageOutput = form\.querySelector\('\[data-coverage-label\]'\);/);
  assert.match(wizard, /<div class="p3-progress-labels" aria-hidden="true"><span class="is-active">Not covered \/ unsure<\/span><span>Probably not<\/span><span>Probably<\/span><span>Covered<\/span><\/div>/);
  assert.match(wizard, /<button[^>]*data-insurance-complete[^>]* disabled>Finish estimate<\/button>/);
  assert.match(wizardRuntime, /coverage\.addEventListener\('input', paint\);/);
  assert.match(wizardRuntime, /coverage\.addEventListener\('change', paint\);/);
  assert.doesNotMatch(wizardRuntime, /^ {4}paint\(\);/m, "wizard setup must not repaint the server-rendered initial state");
  assert.doesNotMatch(runtime, /form\.closest\('\[data-with-without-insurance\]'\)[\s\S]{0,500}?\n\s*paint\(\);\n\s*}\);/);
});

test("consent clearance reserves the measured mobile slot without a forced layout read", async () => {
  // Browser overlap, nonoverlap, zero/positive slot and focus-listener lifecycle:
  // browser/motion-mobile-contracts-regression.spec.mjs: "quiz consent measures a real slot".
  const runtime = await readFile(new URL("../src/consent-runtime.mjs", import.meta.url), "utf8");
  assert.match(runtime, /window\.innerWidth<=920\|\|document\.body\?\.dataset\?\.page==='quiz-provider-fit'/);
  assert.match(runtime, /const reserved=height===null\?320:Math\.ceil\(height\+bottom\+8\)/);
  assert.match(runtime, /entry\?\.borderBoxSize/);
  const initialClearance = runtime.slice(runtime.indexOf('const clearance=()=>'), runtime.indexOf('const focusClearance='));
  assert.ok(initialClearance.startsWith('const clearance=()=>'), 'initial clearance owner present');
  assert.doesNotMatch(initialClearance, /root\.(?:offsetHeight|offsetWidth|clientHeight|clientWidth|getBoundingClientRect)\b/);
  const focusCorrection = runtime.slice(runtime.indexOf('const focusClearance='), runtime.indexOf("document.addEventListener('focusin',focusClearance)"));
  assert.match(focusCorrection, /window\.requestAnimationFrame\(\(\)=>\{/);
  assert.match(focusCorrection, /target=node\.getBoundingClientRect\(\),notice=root\.getBoundingClientRect\(\)/);
  assert.match(focusCorrection, /target\.right>notice\.left&&target\.left<notice\.right&&target\.top<notice\.bottom&&target\.bottom\+8>notice\.top/);
  assert.match(focusCorrection, /window\.scrollBy\(\{top:target\.bottom\+8-notice\.top/);
  assert.match(runtime, /observer\?\.disconnect\(\)[^\n]*removeEventListener\?\.\('resize',clearance\)[^\n]*removeEventListener\?\.\('focusin',focusClearance\)/);
  const clearanceOwner = runtime.match(/const clearance=\(\)=>\{[^\n]*\};/)?.[0];
  assert.ok(clearanceOwner, 'executable clearance owner present');
  const clearanceFor = ({ width, page, height, sticky = 0, connected = true }) => {
    let value;
    const root = { isConnected: connected, getBoundingClientRect() { throw Error('initial root layout read'); } };
    const document = { body: { dataset: { page } }, documentElement: { style: {
      getPropertyValue: () => String(sticky),
      setProperty: (name, next) => { assert.equal(name, '--consent-clearance'); value = next; },
    } } };
    new Function('root', 'document', 'window', 'height', `${clearanceOwner} clearance();`)(root, document, { innerWidth: width }, height);
    return value;
  };
  assert.equal(clearanceFor({ width: 1200, page: 'home', height: 140 }), '0px');
  assert.equal(clearanceFor({ width: 390, page: 'home', height: 140, sticky: 96 }), '252px');
  assert.equal(clearanceFor({ width: 1200, page: 'quiz-provider-fit', height: 140 }), '168px');
  assert.equal(clearanceFor({ width: 390, page: 'home', height: null }), '320px');
  assert.equal(clearanceFor({ width: 390, page: 'home', height: 140, connected: false }), undefined);
});

test("route-default product filters preserve server DOM instead of forcing a critical-window grid repaint", async () => {
  // Actual default/nondefault card effects: browser/motion-mobile-contracts-regression.spec.mjs:
  // "product default leaves served cards alone". History/back/reset effects depend on
  // browser/compare-facet-integrity.spec.mjs:167-241, not on the predicate below.
  const runtime = await readFile(new URL("../assets/site.js", import.meta.url), "utf8");
  const initial = runtime.slice(runtime.indexOf('const serverMarkupMatchesQuery ='), runtime.indexOf('const hydrateFilterState ='));
  assert.match(initial, /!searchForm && !isBrandPath\(\) && !hasNonDefaultFilter/);
  assert.match(initial, /!requestedDrug \|\| medicationToken\(requestedDrug\) === routeDefaultDrug/);
  assert.match(initial, /!requestedForm \|\| formToken\(requestedForm\) === routeDefaultForm/);
  assert.match(initial, /requestedSort === 'cheapest'/);
  assert.match(initial, /!serverMarkupNeedsProgressiveDisclosure/);
  assert.match(initial, /!serverMarkupNeedsHydration/);
  assert.match(initial, /if \(serverMarkupMatchesQuery\) \{[\s\S]*?writeUrl\(\);[\s\S]*?return;/);
  assert.match(initial, /filterStateButtons\(\);\n\s*apply\(\{ persist: true, historyMode: 'replace' \}\);/);
  const predicate = initial.match(/const serverMarkupMatchesQuery = ([\s\S]*?);\n/)?.[1];
  assert.ok(predicate, 'route-default predicate present');
  const matches = ({ search = false, brand = false, nondefault = false, drug = null, form = null, sort = 'cheapest', progressive = false, hydration = false } = {}) => {
    const context = { searchForm: search, isBrandPath: () => brand, hasNonDefaultFilter: nondefault,
      requestedDrug: drug, routeDefaultDrug: 'semaglutide', medicationToken: x => x,
      requestedForm: form, routeDefaultForm: 'injection', formToken: x => x,
      requestedSort: sort, serverMarkupNeedsProgressiveDisclosure: progressive, serverMarkupNeedsHydration: hydration };
    return new Function('c', `with(c){return (${predicate});}`)(context);
  };
  assert.equal(matches(), true, 'true default leaves server DOM untouched');
  assert.equal(matches({ drug: 'semaglutide', form: 'injection' }), true, 'route-default query restoration stays a no-op');
  for (const variant of [{ nondefault: true }, { search: true }, { brand: true }, { drug: 'tirzepatide' },
    { form: 'pill' }, { sort: 'newest' }, { progressive: true }, { hydration: true }]) {
    assert.equal(matches(variant), false, `nondefault/progressive state must hydrate: ${JSON.stringify(variant)}`);
  }
});

test("Phase 3 performance containment does not collapse whole sections over later controls", async () => {
  const [phase3Css, funnelCss] = await Promise.all([
    readFile(new URL("../assets/css-src/11-phase3.css", import.meta.url), "utf8"),
    readFile(new URL("../assets/css-src/47-funnel-v2.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(phase3Css, /\.p3-page\s*>\s*:is\(section, aside\)[\s\S]*?content-visibility:\s*auto/);
  assert.match(phase3Css, /\.p3-provider-grid > \.p3-provider-card \{\s*content-visibility:\s*auto;\s*contain-intrinsic-size:\s*auto 522px;/);

  assert.match(phase3Css, /@media \(max-width: 760px\)[\s\S]*?\.p3-provider-section\[data-initial-visible\] \.p3-provider-grid > \.p3-provider-card \{\s*content-visibility:\s*visible;\s*contain-intrinsic-size:\s*none;/);
  assert.match(phase3Css, /\.p3-card-evidence-links \.p3-card-link \{\s*min-height:\s*44px/);
  assert.match(funnelCss, /\.fv2 \{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:\s*auto 980px;/);
  assert.match(funnelCss, /@media \(max-width: 760px\)[\s\S]*?\.fv2 \{[^}]*content-visibility:\s*visible;[^}]*contain-intrinsic-size:\s*none;/);
  assert.match(funnelCss, /\.fv2-head \.gcs-kicker \{ color: #0e7d5c; \}/);
});

test("provider hub defers bodies after the source-derived initial cohort without losing filters or no-JS cards", async () => {
  const [providers, runtime, build, renderer] = await Promise.all([
    readFile(new URL("../public/providers/index.html", import.meta.url), "utf8"),
    readFile(new URL("../assets/site.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-staging.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/phase3-page-graph.mjs", import.meta.url), "utf8"),
  ]);
  const initialVisible = Number(renderer.match(/const initialVisible = (\d+);/)?.[1]);
  assert.equal(initialVisible, 12, 'governed initial directory cohort');
  assert.equal(PROVIDER_REVEAL_BATCH_SIZE, 12, 'governed reveal batch');
  const providerCardTotal = (javascriptProviderMarkup(providers).match(/data-phase3-provider(?:\s|>)/g) || []).length;
  assert.ok(providerCardTotal >= 35, `expected at least 35 provider cards, saw ${providerCardTotal}`);
  assert.ok(providerCardTotal > initialVisible, 'fixture exercises a deferred remainder');
  assert.match(providers, new RegExp(`<section[^>]*class="listing-results p3-provider-section"[^>]*data-initial-visible="${initialVisible}"`));
  const deferredCount = providerCardTotal - initialVisible;
  assert.equal((providers.match(/data-provider-lazy-index=/g) || []).length, deferredCount);
  assert.equal((providers.match(/data-provider-noscript-card/g) || []).length, deferredCount, 'every deferred card has a no-JS body');
  assert.match(providers, new RegExp(`<span class="listing__count" data-filter-result[^>]*>${providerCardTotal} provider records<\\/span>`), 'live status uses complete eligible total, not page limit');
  assert.ok(providers.includes(`>Show ${Math.min(PROVIDER_REVEAL_BATCH_SIZE, deferredCount)} more providers</button>`));
  assert.match(providers, /data-provider-filters/);
  assert.match(providers, /type="application\/json" data-provider-card-payloads data-src="\/assets\/provider-card-payloads\.[a-f0-9]{16}\.json">\[\]<\/script>/);
  assert.match(runtime, /const hydrateCard = \(card\) =>/);
  assert.match(runtime, /const loadDeferredCardBodies = \(\) =>/);
  assert.match(runtime, /let pageLimit = Math\.max\(1, Number\(section\.dataset\.initialVisible\) \|\| batchSize\);/);
  assert.match(runtime, /if \(show\) \{\s*if \(!hydrateCard\(card\)\)/);
  assert.match(runtime, /if \(\['\/providers\/', '\/wegovy\/'\]\.includes\(location\.pathname\)\) \{\s*filters\.dataset\.mobileFilterReady = 'inline';/);
  assert.match(runtime, /const canDeferWegovyDefaults = currentProductPath === '\/wegovy\/'/);
  assert.match(runtime, /activationRoot\.addEventListener\('pointerdown', activate, \{ capture: true, once: true \}\);/);
  assert.match(runtime, /activationRoot\.addEventListener\('keydown', activate, \{ capture: true, once: true \}\);/);
  assert.match(runtime, /const serverMarkupNeedsHydration = cards\.some/);
  assert.match(runtime, /new IntersectionObserver/);
  assert.match(build, /\["providers\/index\.html", "wegovy\/index\.html"\]\.includes\(page\.file\)/);
  assert.match(build, /const lazyCardCount = \(phase3Html\.match\(\/data-provider-lazy-index=\/g\) \|\| \[\]\)\.length;/);
  assert.doesNotMatch(build, /payload\.length !== 20/);
});
import { javascriptProviderMarkup } from './helpers/d2p-noscript.mjs';
