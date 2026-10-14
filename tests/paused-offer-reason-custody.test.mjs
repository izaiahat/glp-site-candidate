import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { historicalAgelessPromotion } from './fixtures/historical-ageless-promotion.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';

const registry = JSON.parse(readFileSync(new URL('../data/program-registry.json', import.meta.url), 'utf8'));
const current = loadGoPromotionAuthority();
const files = ['affiliate-outbound-mode.test.mjs', 'affiliate-expansion-13.test.mjs', 'direct-affiliate-lane.test.mjs', 'high-intent-affiliate-surfaces.test.mjs'];

test('maintained paused-offer assertions keep historical reason separate from current denial provenance', () => {
  const historicalBytes = readFileSync(new URL('./fixtures/ageless-promotion-pre-relationship.json', import.meta.url));
  assert.equal(historicalAgelessPromotion().status, 'WITHHELD');
  assert.equal(historicalAgelessPromotion().promotion_authorized, false);
  assert.throws(() => historicalAgelessPromotion(Buffer.concat([historicalBytes, Buffer.from('\nunauthorized drift')])), {name: 'AssertionError'});
  assert.throws(() => historicalAgelessPromotion(readFileSync(new URL('../data/go-runtime-promotion-authority.json', import.meta.url))), {name: 'AssertionError'});
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    // Execute the maintained assertions themselves, not copied expectations or
    // whole renderer/output bodies; these four owners use three map shapes.
    const lines = source.split('\n').filter(line => /^\s*assert\./.test(line) &&
      (/network_paused_katalys_offer_1538|sole_writer_relationship_paused/.test(line) ||
       /(?:\["try-ageless"\]|\[PAUSED_AGELESS\])\??\.(?:promotion_authorized|relationship_snapshot)/.test(line)));
    const run = new Function('assert', 'historicalAgelessPromotion', 'promotions', 'promotion', 'promotionAuthority', 'registry', 'PAUSED_AGELESS', lines.join('\n'));
    const execute = authority => run(assert, historicalAgelessPromotion, authority.programs, authority.programs, authority, registry, 'try-ageless');
    execute(current);
    assert.equal(lines.length, 4, `${file}: historical pin plus exact current reason, denial bit and identity-bound snapshot`);
    for (const mutate of [
      row => { row.reason = 'network_paused_katalys_offer_1538'; },
      row => { row.promotion_authorized = true; },
      row => { delete row.relationship_snapshot; },
      row => { row.relationship_snapshot.program_id = 'unrelated-offer'; },
    ]) {
      const bad = structuredClone(current); mutate(bad.programs['try-ageless']);
      assert.throws(() => execute(bad), {name: 'AssertionError'}, `${file}: current denial cannot be replaced by history, permission or another identity`);
    }
  }
});
