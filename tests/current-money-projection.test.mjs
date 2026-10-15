import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMoneyPage } from '../src/money-page.mjs';
import { loadGoPromotionAuthority, loadGoSelection } from '../src/go-runtime-selection.mjs';
import { currentMoneyInputs, currentMoneyPages, expectedMoneyIds, assertMoneyDenial, readMoneyData } from './helpers/current-money-projection.mjs';
import { historicalAgelessPromotion } from './fixtures/historical-ageless-promotion.mjs';

const source = readFileSync(new URL('./affiliate-expansion-13.test.mjs', import.meta.url), 'utf8');
const begin = source.indexOf('test("money programs render approved'), end = source.indexOf('\ntest(', begin + 1);
assert.ok(begin > 0 && end > begin);
const statement = source.slice(begin, end);
const declarations = source.slice(source.indexOf('const NETWORK_HOSTS = '), source.indexOf('test("Sheet-derived selection'));
const original = {money:readMoneyData('money-page-specs.json'), registry:readMoneyData('program-registry.json'),
  identity:readMoneyData('identity-registry.json'), selection:readMoneyData('affiliate-activation-selection.json'),
  wireApprovals:readMoneyData('affiliate-wire-in-approvals.json'), promotion:loadGoPromotionAuthority().programs};
function run(values = original, project = currentMoneyPages, render = renderMoneyPage) {
  let body;
  const context = {...values, assert, renderMoneyPage:render, historicalAgelessPromotion,
    selectedIds:new Set(values.selection.programs.map(p => p.program_id)),
    selectedGo:new Map(Object.values(loadGoSelection().programs).map(p => [p.render_id, p])),
    currentMoneyInputs, currentMoneyPages:project, expectedMoneyIds, assertMoneyDenial,
    test:(_name, callback) => { body = callback; }};
  new Function(...Object.keys(context), declarations + statement)(...Object.values(context));
  return body();
}

test('current money owning callback uses the complete builder projection without losing healthy identities or relaxing denials', () => {
  run();
  for (const mutate of [
    v => { v.promotion['trimi-glp-1'].status = 'VERIFIED'; },
    v => { v.promotion['trimi-glp-1'].promotion_authorized = true; },
    v => { delete v.promotion['trimi-glp-1'].relationship_snapshot; },
    v => { v.registry.programs.find(p => p.program_id === 'trimi-glp-1').affiliate_relationship_snapshot.source_checked_at = '2000-01-01T00:00:00Z'; },
    v => { v.promotion['enhance-md'].status = 'WITHHELD'; v.promotion['enhance-md'].promotion_authorized = false; },
    v => { v.registry.programs.find(p => p.program_id === 'katalys-1516').profiles['glp-clinic-scout'].canonical_identity.canonical_program_id = 'telos-rx'; },
  ]) {
    const bad = structuredClone(original); mutate(bad);
    assert.throws(() => run(bad), {name:'AssertionError'});
  }
  for (const mutate of [
    pages => { for (const p of pages) p.rows = p.rows.filter(r => r.program_id !== 'enhance-md'); },
    pages => { pages[0].rows.push({...pages[0].rows[0]}); },
    pages => { pages[0].rows.push(original.money.pages[0].rows.find(r => r.program_id === 'shed')); },
  ]) assert.throws(() => run(original, () => {const pages = currentMoneyPages(); mutate(pages); return pages;}));
  assert.throws(() => run(original, currentMoneyPages, (page, identity) => renderMoneyPage(page, identity) + '<a href="/go/trimi-glp-1" data-program="trimi-glp-1">synthetic leak</a>'), {name:'AssertionError'});
});
