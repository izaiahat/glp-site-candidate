import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProviderReviewSpecs, renderProviderReviewPage } from '../src/provider-review.mjs';
import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import { historicalAgelessPromotion } from './fixtures/historical-ageless-promotion.mjs';
import { assertPausedTrimiReview, assertHistoricalHeldEligibility, assertCurrentHeldEligibility, historicalReviewEligibility } from './helpers/current-review-holds.mjs';

const read = file => JSON.parse(readFileSync(new URL('../data/' + file, import.meta.url)));
const values = {
  money: read('money-page-specs.json'), providerPages: read('provider-page-contracts.json'),
  providerFastpath: read('provider-fastpath-contract.json'), registry: read('program-registry.json'),
  identity: read('identity-registry.json'), selection: read('affiliate-activation-selection.json'),
  promotion: loadGoPromotionAuthority().programs,
};
const selectedGo = new Map(Object.values(loadGoSelection().programs).map(row => [row.render_id, row]));
const source = readFileSync(new URL('./affiliate-expansion-13.test.mjs', import.meta.url), 'utf8');
const title = 'generated provider reviews use selected go routes, direct anchors, or explicit holds';
const begin = source.indexOf(`test(${JSON.stringify(title)},`), end = source.indexOf('\ntest(', begin + 1);
assert.ok(begin > 0 && end > begin);
const statement = source.slice(begin, end);
function run(input = values, render = renderProviderReviewPage, build = buildProviderReviewSpecs) {
  let body;
  const declarations = source.slice(source.indexOf('function assertSelectedReview('), source.indexOf('// 2026-08-06 surface unification:'));
  // Ageless's independent historical/current oracle is exercised unchanged by
  // paused-offer-reason-custody; here execute its real owning function too.
  const ageless = source.slice(source.indexOf('function assertPausedAgeless('), source.indexOf('const networkAnchorIds ='));
  const context = {...input, selectedGo, GO_RUNTIME_MANIFEST, assert,
    test: (_name, callback) => { body = callback; },
    buildProviderReviewSpecs: build, renderProviderReviewPage: render,
    selectedIds: new Set(input.selection.programs.map(row => row.program_id)),
    PAUSED_AGELESS: 'try-ageless', historicalAgelessPromotion, assertPausedTrimiReview,
  };
  new Function(...Object.keys(context), declarations + ageless + statement)(...Object.values(context));
  return body();
}

test('current provider-review owning oracle preserves the complete cohort and authentic paused Trimi denial', () => {
  run();
  for (const mutate of [
    v => { v.promotion['trimi-glp-1'].status = 'VERIFIED'; },
    v => { v.promotion['trimi-glp-1'].promotion_authorized = true; },
    v => { v.promotion['trimi-glp-1'].reason = 'historical_pause'; },
    v => { delete v.promotion['trimi-glp-1'].relationship_snapshot; },
    v => { v.promotion['trimi-glp-1'].relationship_snapshot.source_checked_at = '2000-01-01T00:00:00Z'; },
    v => { v.registry.programs.find(p => p.program_id === 'trimi-glp-1').affiliate_relationship_snapshot.promotion_denied = false; },
    v => { v.selection.programs = v.selection.programs.filter(p => p.program_id !== 'trimi-glp-1'); },
  ]) {
    const bad = structuredClone(values); mutate(bad);
    assert.throws(() => run(bad), {name: 'AssertionError'});
  }
  for (const leak of [
    '<a data-link-mode="transparent-direct" href="https://track.revoffers.com/">leak</a>',
    '<a href="/go/trimi-glp-1?s=reviews.rv2">leak</a>',
    '<a data-affiliate-state="active">leak</a>',
  ]) assert.throws(() => run(values, (review, identity) => renderProviderReviewPage(review, identity) + (review.program_id === 'trimi-glp-1' ? leak : '')), {name: 'AssertionError'});
  assert.throws(() => run(values, renderProviderReviewPage, (...args) => buildProviderReviewSpecs(...args).filter(r => r.program_id !== 'trimi-glp-1')), {name: 'AssertionError'});
  assert.throws(() => run(values, (review, identity) => review.program_id === 'enhance-md' ? renderProviderReviewPage(review, identity).replaceAll('data-link-mode="transparent-direct"', '') : renderProviderReviewPage(review, identity)), {name: 'AssertionError'});
});

test('paused Trimi cannot bypass the owning hold oracle through fastpath reclassification plus an active CTA', () => {
  const authentic = buildProviderReviewSpecs(values.money.pages, values.providerPages, values.providerFastpath, values.registry, 'glp-clinic-scout');
  const trimi = authentic.find(r => r.program_id === 'trimi-glp-1');
  assert.equal(trimi.fastpath_contract, undefined);
  assert.equal(values.promotion['trimi-glp-1'].status, 'WITHHELD');
  assert.equal(values.promotion['trimi-glp-1'].promotion_authorized, false);
  const actualHtml = renderProviderReviewPage(trimi, values.identity);
  // Synthetic oracle-boundary fault, not a reproduced production renderer leak.
  const leak = '<a data-affiliate-state="active" data-link-mode="transparent-direct" href="https://track.revoffers.com/">synthetic CTA</a>';
  function probe({reclassify = false, inject = false} = {}) {
    run(values,
      (r, i) => r.program_id === 'trimi-glp-1' ? actualHtml + (inject ? leak : '') : renderProviderReviewPage(r, i),
      () => authentic.map(r => reclassify && r.program_id === 'trimi-glp-1' ? {...r, fastpath_contract: {...values.providerPages.providers[0]}} : r));
  }
  probe();
  assert.throws(() => probe({inject: true}), {name: 'AssertionError'});
  assert.throws(() => probe({reclassify: true}), {name: 'AssertionError'});
  assert.throws(() => probe({reclassify: true, inject: true}), {name: 'AssertionError'}, 'Trimi identity-specific pause must survive fastpath routing; current oracle falsely ACCEPTS the active CTA');
});

const eligibilityValues = {
  eligibility: read('program-page-eligibility.json'), contentLedger: read('program-content-ledger.json'),
  programRegistry: values.registry, providerContracts: values.providerPages, providerFastpath: values.providerFastpath,
};
const trtSource = readFileSync(new URL('./trt-nation-link-dark.test.mjs', import.meta.url), 'utf8');
const heldStart = trtSource.indexOf('  assertHistoricalHeldEligibility();');
const heldEnd = trtSource.indexOf('  assert.equal(inputs.eligibility.live_program_count', heldStart);
assert.ok(heldStart > 0 && heldEnd > heldStart);
const checkHeld = inputs => new Function('assertHistoricalHeldEligibility', 'assertCurrentHeldEligibility', 'inputs', trtSource.slice(heldStart, heldEnd))(assertHistoricalHeldEligibility, assertCurrentHeldEligibility, inputs);

test('current TRT owning held-eligibility oracle requires exact editorial-only hold membership', () => {
  checkHeld(eligibilityValues);
  for (const mutate of [
    v => { v.eligibility.programs = v.eligibility.programs.filter(p => p.program_id !== 'retaclinic-review'); },
    v => { v.eligibility.programs.find(p => p.program_id === 'retaclinic-review').promotion_authorized = true; },
    v => { v.eligibility.programs.find(p => p.program_id === 'retaclinic-review').tracking = {url: 'https://attacker.invalid'}; },
    v => { v.eligibility.programs.find(p => p.program_id === 'retaclinic-review').status = 'live_operator_approved_transparent_direct'; },
    v => { v.eligibility.programs.find(p => p.program_id === 'enhance-md').promotion_authorized = false; v.eligibility.programs.find(p => p.program_id === 'enhance-md').live_link_allowed = false; },
    v => { v.programRegistry.programs.find(p => p.program_id === 'retaclinic-review').affiliate_relationship_snapshot.promotion_denied = false; },
    v => { v.programRegistry.programs.find(p => p.program_id === 'retaclinic-review').profiles['glp-clinic-scout'].surfaces.quiz = true; },
    v => { v.programRegistry.programs.find(p => p.program_id === 'retaclinic-review').profiles['glp-clinic-scout'].exceptions.compare.surface_restriction_basis = 'unrelated'; },
    v => { v.providerContracts.providers.find(p => p.program_id === 'retaclinic-review').network_contract.tracking_url = 'https://attacker.invalid'; },
    v => { v.providerContracts.providers.find(p => p.program_id === 'retaclinic-review').row_contract.promotion_authorized = true; },
    v => { v.providerFastpath.providers.find(p => p.program_id === 'retaclinic-review').affiliate_cta_state = 'ACTIVE_PROVIDER_ISSUED_DIRECT'; },
    v => { v.contentLedger.programs.find(p => p.program_id === 'retaclinic-review').live_link_allowed = true; },
    v => { v.eligibility.programs.find(p => p.program_id === 'telos-rx').go_route_wired = true; },
  ]) {
    const bad = structuredClone(eligibilityValues); mutate(bad);
    assert.throws(() => checkHeld(bad), {name: 'AssertionError'});
  }
});

test('pre-RetaClinic one-row held baseline remains authenticated and refuses current substitution', () => {
  const historical = historicalReviewEligibility();
  assertHistoricalHeldEligibility(historical);
  assert.throws(() => historicalReviewEligibility(Buffer.from(JSON.stringify(historical))), {name: 'AssertionError'});
  assert.throws(() => historicalReviewEligibility(readFileSync(new URL('../data/program-page-eligibility.json', import.meta.url))), {name: 'AssertionError'});
  assert.throws(() => assertHistoricalHeldEligibility(eligibilityValues.eligibility), {name: 'AssertionError'});
  assert.throws(() => checkHeld({...eligibilityValues, eligibility:historical}), {name: 'AssertionError'});
});
