import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPhase3PageGraph, insuranceWizard } from '../src/phase3-page-graph.mjs';

const expectedLabels = ['Not covered / unsure', 'Probably not', 'Probably', 'Covered'];
const read = (file) => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

test('D47: all five brand renderers expose the labelled monthly estimate input consumed by the wizard runtime', () => {
  const graph = read('data/phase3-page-graph.json');
  const pricingMatrix = read('data/provider-pricing-matrix.json');
  const articles = ['data/blog/content-batch.json', 'data/blog/content-national-wow-additions.json']
    .flatMap(file => read(file).articles)
    .filter(article => article.canonical_path.startsWith('/guides/') && !/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(article.canonical_path));
  const { pages } = buildPhase3PageGraph({
    graph,
    pharmacyInput: read('data/phase3-pharmacy-render-input.json'),
    pricingMatrix,
    programRegistry: read('data/program-registry.json'),
    homeSpec: { rows: [] }, articles, couponOffersByProgram: {},
  });
  const routes = ['/wegovy-pill/', '/wegovy/', '/ozempic/', '/mounjaro/', '/zepbound/'];
  const checks = routes.map(route => {
    const html = pages.find(page => page.route === route)?.html || '';
    const form = html.match(/<form\b[^>]*data-insurance-wizard[^>]*>([\s\S]*?)<\/form>/)?.[1] || '';
    const wizard = html.match(/<form\b[^>]*data-insurance-wizard[^>]*>/)?.[0] || '';
    const attr = (key) => wizard.match(new RegExp(`${key}="([^"]*)"`))?.[1];
    const labelMarkup = form.match(/<div class="p3-progress-labels"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
    assert.deepEqual([...labelMarkup.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map(match => match[1]), expectedLabels, `${route}: D47 coverage labels`);
    assert.match(form, /name="coverage" type="range" min="0" max="3" step="1" value="0"/);
    assert.match(form, /aria-valuetext="Not covered \/ unsure"/);
    assert.doesNotMatch(form, /name="(?:progress|oop_max|oop_spent)"|Plan progress|Not started|Early|Most met/);
    assert.deepEqual([...form.matchAll(/data-copay="([^"]*)"/g)].map(match => match[1]), ['0', '25', '50', '75']);
    assert.equal([...form.matchAll(/data-copay="[^"]*" aria-pressed="false"/g)].length, 4);
    const amount = attr('data-self-pay-amount');
    assert.notEqual(amount, undefined, `${route}: missing evidence contract`);
    if (amount === '') {
      for (const key of ['cadence', 'source', 'checked']) assert.equal(attr(`data-self-pay-${key}`), '');
      assert.match(html, /A source-linked monthly self-pay amount is not available/);
    } else {
      const brand = graph.brand_pages.find(page => page.route === route);
      const rows = Object.values(pricingMatrix.providers).flatMap(entry => entry.medications || []);
      const row = rows.find(row => brand.medication_ids.includes(row.medication_id)
        && String(row.ongoing_usd) === amount && row.cadence === attr('data-self-pay-cadence')
        && row.captured_on === attr('data-self-pay-checked')
        && row.source_url && new URL(row.source_url).href.replaceAll('&', '&amp;') === attr('data-self-pay-source'));
      assert.ok(row, `${route}: estimate has no matching price-source row`);
      assert.equal(row.cadence, 'month');
      assert.ok(Number.isFinite(row.ongoing_usd) && row.ongoing_usd >= 0);
      assert.match(html, /data-insurance-source/);
    }
    const input = form.match(/<label>Estimated monthly out-of-pocket\s*<input\b[^>]*name="monthly_oop"[^>]*><\/label>/)?.[0] || '';
    return { route, present: Boolean(input), numeric: /type="number"/.test(input), nonnegative: /min="0"/.test(input), empty: !/\bvalue=/.test(input), finish: /data-insurance-complete/.test(form) };
  });
  assert.deepEqual(checks, routes.map(route => ({ route, present: true, numeric: true, nonnegative: true, empty: true, finish: true })));
});


test('D47: incomplete, nonmonthly and wrong-medication evidence stays unknown', () => {
  const page = read('data/phase3-page-graph.json').brand_pages.find(page => page.route === '/wegovy/');
  const rows = Object.values(read('data/provider-pricing-matrix.json').providers).flatMap(entry => entry.medications || []);
  const row = rows.find(row => page.medication_ids.includes(row.medication_id)
    && Number.isFinite(row.ongoing_usd) && row.ongoing_usd >= 0
    && row.cadence === 'month' && /^\d{4}-\d{2}-\d{2}$/.test(row.captured_on)
    && /^https?:\/\//.test(row.source_url));
  assert.ok(row, 'A real source row is required; do not invent a price fixture');
  assert.match(insuranceWizard(page, row), /data-insurance-source/);
  for (const invalid of [null, { ...row, ongoing_usd: null }, { ...row, ongoing_usd: NaN },
    { ...row, source_url: '' }, { ...row, source_url: 'javascript:void(0)' },
    { ...row, captured_on: '' }, { ...row, cadence: '' }, { ...row, cadence: 'week' },
    { ...row, medication_id: 'not-this-medication' }]) {
    const html = insuranceWizard(page, invalid);
    assert.match(html, /data-self-pay-amount=""/);
    assert.doesNotMatch(html, /data-insurance-source/);
    assert.match(html, /unknown does not mean free/);
  }
});

test('D47: palette fill and reduced-motion thumb rules remain source-owned', () => {
  const css = fs.readFileSync(new URL('../assets/css-src/11-phase3.css', import.meta.url), 'utf8');
  assert.match(css, /var\(--p3-progress, 0%\)/);
  assert.match(css, /\.p3-progress-labels span\.is-active\s*\{[^}]*background: var\(--cs-accent-gradient\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.p3-insurance input\[type="range"\]::-webkit-slider-thumb \{ transition: none; \}\s*\.p3-insurance input\[type="range"\]::-moz-range-thumb \{ transition: none; \}/);
});
