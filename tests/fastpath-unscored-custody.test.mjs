import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildProviderReviewSpecs, renderProviderReviewPage } from '../src/provider-review.mjs';
import { scoreProvider } from '../src/money-page.mjs';
import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import { historicalUnscoredBlock, HISTORICAL_SCORE_REF } from './fixtures/historical-unscored-copy.mjs';
import { historicalEndedValidator, historicalEndedRenderer, historicalEndedSource } from './fixtures/historical-ended-review.mjs';
const read = file => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url)));
const values = [read('money-page-specs.json'), read('provider-page-contracts.json'), read('provider-fastpath-contract.json'), read('identity-registry.json'), read('program-registry.json'), read('provider-pricing-matrix.json')];
const title = 'provider-review specs cover the registry projection with three explicit hard holds';
function owner(render = renderProviderReviewPage, historical = historicalUnscoredBlock) {
  const source = readFileSync(new URL('./provider-fastpath-plus5.test.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(`test(${JSON.stringify(title)},`);
  assert.ok(start >= 0);
  const end = source.indexOf('\ntest(', start + 1);
  let callback;
  new Function('test', 'assert', 'buildProviderReviewSpecs', 'renderProviderReviewPage', 'scoreProvider', 'loadGoSelection', 'historicalUnscoredBlock', 'GO_RUNTIME_MANIFEST', 'money', 'pages', 'fastpath', 'identity', 'registry', 'pricing', source.slice(start, end < 0 ? source.length : end))(
    (_title, run) => { callback = run; }, assert, buildProviderReviewSpecs, render, scoreProvider, loadGoSelection, historical, GO_RUNTIME_MANIFEST, ...values,
  );
  return callback;
}
test('current fastpath unscored oracle refuses an unsupported missing-information claim and numeric score', () => {
  owner()();
  for (const mutate of [
    html => html.replace(/No comparable editorial score is assigned to [^<]+\. This is not a claim that provider information is unpublished\./g, 'The provider has not published enough evidence; insufficient information.'),
    html => html.replace(/No comparable editorial score is assigned to [^<]+\. This is not a claim that provider information is unpublished\./g, 'No comparable editorial score is assigned to this provider.'),
    html => html.replace('<p class="score score-unscored">Not scored</p>', '<p class="score">0.0/10</p>'),
    html => html.replace('<p class="score score-unscored">Not scored</p>', '<p class="score score-unscored">Score pending evidence</p>'),
  ]) {
    let faulted = 0;
    assert.throws(() => owner((spec, ...args) => {
      const html = renderProviderReviewPage(spec, ...args);
      if (scoreProvider(spec.row) !== null) return html;
      const bad = mutate(html);
      assert.notEqual(bad, html, 'fault must exercise current real unscored output');
      faulted++;
      return bad;
    })(), {name: 'AssertionError'});
    assert.ok(faulted > 0);
  }
  assert.throws(() => owner(renderProviderReviewPage, () => '<p class="score-basis">Unauthorized substitute</p>')(), {name: 'AssertionError'});
});
test('ended fastpath review retains its explicit held state after its obsolete CTA is omitted', () => {
  const specs = buildProviderReviewSpecs(values[0].pages, values[1], values[2], values[4], 'glp-clinic-scout');
  const pallas = specs.find(item => item.program_id === 'pallas-health-review');
  assert.ok(pallas);
  const html = renderProviderReviewPage(pallas, values[3]);
  assert.match(html, /Our affiliate relationship with this provider ended on 2026-09-30/);
  assert.match(html, /<section class="affiliate-status"[^>]+data-affiliate-state="held"/);
  assert.match(html, /data-link-dark="true"/);
  assert.doesNotMatch(html, /data-link-mode="transparent-direct"|href="\/go\/|Partner link unavailable/);
});

test('real ended Pallas rendering satisfies the complete maintained fastpath validator branch', async () => {
  // Executable counterexample from independent review 5525275814. No build,
  // fabricated HTML, writer invocation or promotion-authority substitution.
  const id = 'pallas-health-review';
  const spec = buildProviderReviewSpecs(values[0].pages, values[1], values[2], values[4], 'glp-clinic-scout').find(item => item.program_id === id);
  assert.ok(spec);
  const html = renderProviderReviewPage(spec, values[3]);
  const source = readFileSync(new URL('../scripts/validate-provider-fastpath-plus5.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  const selected = currentSelection?.programs?.[provider.program_id];');
  const end = source.indexOf('  // 2026-08-06 cluster 1:', start);
  assert.ok(start > 0 && end > start);
  const run = new (Object.getPrototypeOf(async function(){}).constructor)('assert', 'provider', 'currentSelection', 'promotionAuthority', 'GO_RUNTIME_MANIFEST', 'html', 'programRegistry', `let activeAffiliateCtas=0; const commerciallyActive=false; ${source.slice(start,end)}; return activeAffiliateCtas;`);
  const verify = (output = html, registry = values[4]) => run(assert, values[2].providers.find(item => item.program_id === id), loadGoSelection(), loadGoPromotionAuthority().programs, GO_RUNTIME_MANIFEST, output, registry);
  assert.equal(await verify(), 0);
  // The exact original no-marker assertion remains on real authenticated
  // predecessor-renderer output; current output must fail that old oracle.
  const prior = await historicalEndedRenderer();
  const historicalHtml = prior.renderProviderReviewPage(spec, values[3]);
  assert.doesNotMatch(historicalHtml, /data-affiliate-state="held"/);
  const historicalRun = historicalEndedValidator();
  const verifyHistorical = output => historicalRun(assert, values[2].providers.find(item => item.program_id === id), loadGoSelection(), loadGoPromotionAuthority().programs, GO_RUNTIME_MANIFEST, output, values[4]);
  assert.equal(await verifyHistorical(historicalHtml), 0);
  await assert.rejects(verifyHistorical(html), assert.AssertionError);
  await assert.rejects(verify(historicalHtml), assert.AssertionError);
  // Neither moving the marker onto an obsolete CTA nor losing any current
  // denial/disclosure obligation is accepted by the real maintained branch.
  const relationship = values[4].programs.find(item => item.program_id === id).affiliate_relationship_snapshot;
  for (const output of [
    html.replace(' data-affiliate-state="held"', ''),
    html.replace(' data-affiliate-state="held"', '') + '<p data-affiliate-state="held">Partner link unavailable</p>',
    html + '<p data-affiliate-state="held"></p>',
    html.replace('data-link-dark="true"', ''),
    html.replace(relationship.ended_effective_at, '1900-01-01'),
    html.replace('This editorial review is retained', ''),
    html + '<a href="/go/pallas-health-review" data-affiliate-state="active"></a>',
    html + '<a rel="sponsored" href="https://fixture.invalid/">Partner</a>',
    html + '<a data-analytics-event="affiliate_click">Partner</a>',
  ]) {
    assert.notEqual(output, html);
    await assert.rejects(verify(output), assert.AssertionError);
  }
  for (const patch of [{promotion_denied:false}, {editorial_retained:false}, {ended_effective_at:'September 30, 2026'}]) {
    const registry = structuredClone(values[4]);
    Object.assign(registry.programs.find(item => item.program_id === id).affiliate_relationship_snapshot, patch);
    await assert.rejects(verify(html, registry), assert.AssertionError);
  }
  for (const file of ['src/provider-review.mjs', 'scripts/validate-provider-fastpath-plus5.mjs']) {
    const original = historicalEndedSource(file);
    assert.throws(() => historicalEndedSource(file, Buffer.from(original + '\nunauthorized')), assert.AssertionError);
    assert.throws(() => historicalEndedSource(file, readFileSync(new URL(`../${file}`, import.meta.url))), assert.AssertionError);
  }
});

test('historical unscored wording refuses changed or current renderer bytes and scored rows', () => {
  const bytes = execFileSync('git', ['show', `${HISTORICAL_SCORE_REF}:src/provider-review.mjs`], {cwd: new URL('../', import.meta.url)});
  const specs = buildProviderReviewSpecs(values[0].pages, values[1], values[2], values[4], 'glp-clinic-scout');
  const spec = specs.find(item => scoreProvider(item.row) === null);
  assert.ok(spec);
  assert.match(historicalUnscoredBlock(spec.row, spec.provider, bytes), /has not published enough of the five criteria/);
  for (const wrong of [Buffer.concat([bytes, Buffer.from('\nunauthorized')]), readFileSync(new URL('../src/provider-review.mjs', import.meta.url))]) {
    assert.throws(() => historicalUnscoredBlock(spec.row, spec.provider, wrong), {name: 'AssertionError'});
  }
  const scored = specs.find(item => scoreProvider(item.row) !== null);
  assert.ok(scored);
  assert.throws(() => historicalUnscoredBlock(scored.row, scored.provider, bytes), {name: 'AssertionError'});
});
