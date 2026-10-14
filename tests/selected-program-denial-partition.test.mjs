import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAffiliateLinkMap } from '../src/affiliate-link-map.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { historicalAgelessPromotion } from './fixtures/historical-ageless-promotion.mjs';

const read = file => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const originals = {
  money: read('money-page-specs.json'), registry: read('program-registry.json'),
  selection: read('affiliate-activation-selection.json'), promotionAuthority: loadGoPromotionAuthority(),
};
const owners = [
  ['direct-affiliate-lane.test.mjs', 'the all-or-nothing money link map still resolves every selected program'],
  ['high-intent-affiliate-surfaces.test.mjs', 'calculator and quiz share one fail-closed transparent-direct resolver'],
];

// Execute both complete maintained callbacks with current real catalog/authority
// inputs. Mutations below are adverse fixtures, never replacement authorities.
function callback(file, title, values, resolver = buildAffiliateLinkMap) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf(`test(${JSON.stringify(title)},`);
  assert.ok(start >= 0, `${file}: owning callback exists`);
  const end = source.indexOf('\ntest(', start + 1);
  const statement = source.slice(start, end < 0 ? source.length : end);
  let body;
  new Function('test', 'assert', 'buildAffiliateLinkMap', 'loadGoPromotionAuthority', 'historicalAgelessPromotion', 'inputs', 'money', 'registry', 'selection', statement)(
    (_name, run) => { body = run; }, assert, resolver, () => values.promotionAuthority, historicalAgelessPromotion,
    async () => values, values.money, values.registry, values.selection,
  );
  assert.equal(typeof body, 'function');
  return body;
}

test('current selected-program oracle requires complete live-or-authenticated-denied partition on every owning surface', async () => {
  for (const [file, title] of owners) {
    await callback(file, title, originals)();
    // A lower live count is not sufficient: permission/provenance drift and
    // unexpected missing healthy members must all fail the same owning oracle.
    for (const mutate of [
      v => { v.promotionAuthority.programs['trimi-glp-1'].reason = 'historical_pause'; },
      v => { v.promotionAuthority.programs['trimi-glp-1'].status = 'VERIFIED'; },
      v => { v.promotionAuthority.programs['trimi-glp-1'].promotion_authorized = true; },
      v => { delete v.promotionAuthority.programs['trimi-glp-1'].relationship_snapshot; },
      v => { v.promotionAuthority.programs['trimi-glp-1'].relationship_snapshot.source_checked_at = '2000-01-01T00:00:00Z'; },
      v => { v.registry.programs.find(p => p.program_id === 'trimi-glp-1').affiliate_relationship_snapshot.promotion_denied = false; },
      v => { v.registry.programs.find(p => p.program_id === 'enhance-md').commercial_state = 'held'; },
    ]) {
      const values = structuredClone(originals); mutate(values);
      await assert.rejects(async () => callback(file, title, values)(), {name: 'AssertionError'}, file);
    }
    for (const mutate of [
      map => { delete map['trimi-glp-1']; },
      map => { map['trimi-glp-1'].live = true; },
      map => { map['trimi-glp-1'].affiliate_href = 'https://attacker.invalid/'; },
      map => { map['trimi-glp-1'].go_href = '/go/trimi-glp-1'; },
      map => { delete map['enhance-md']; },
    ]) {
      const resolver = (...args) => {
        const map = buildAffiliateLinkMap(...args);
        // Preserve the owner's separate omitted-authority negative control;
        // fault only the authenticated current-output maps under review.
        if (args[5]?.promotionAuthority) mutate(map);
        return map;
      };
      await assert.rejects(async () => callback(file, title, originals, resolver)(), {name: 'AssertionError'}, file);
    }
  }
});
