import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { javascriptProviderMarkup } from './d2p-noscript.mjs';

// Fable Pass7 listing-template rows 06/07 supersede only the old C hero.
// Runtime geometry/mobile gates remain separate and unchanged.
export function assertCompoundedListing(html) {
  const dom = new JSDOM(javascriptProviderMarkup(html));
  const d = dom.window.document;
  try {
  const main = d.querySelector('main[data-listing-archetype="C"]');
  assert.ok(main, 'accepted compounded listing C');
  const one = selector => { const nodes = main.querySelectorAll(selector); assert.equal(nodes.length, 1, selector); return nodes[0]; };
  const intro = one('.listing__intro');
  assert.ok(intro.querySelector('h1[data-state-heading]'), 'state heading');
  assert.equal(intro.querySelectorAll('[data-filter-result]').length, 1, 'one source-derived count');
  const filters = one('[data-provider-filters]');
  const grid = one('[data-phase3-provider-grid]');
  assert.ok(grid.classList.contains('listing-grid'), 'shared grid geometry');
  assert.ok(intro.compareDocumentPosition(filters) & 4, 'support before filters');
  assert.ok(filters.compareDocumentPosition(grid) & 4, 'filters before grid');
  for (const name of ['treatment','type','plan','dose','sort']) assert.ok(filters.querySelector(`[data-filter="${name}"]`), name);
  assert.equal(main.querySelectorAll('.p3-category-hero').length, 0, 'superseded hero must not return');
  const cards = [...grid.querySelectorAll('article[data-phase3-provider]')];
  assert.ok(cards.length, 'source-backed result cards');
  for (const card of cards) {
    assert.ok(card.dataset.program, 'identity');
    assert.equal(card.querySelectorAll('[data-provider-card-contract="option-c"]').length, 1, 'Option C');
    assert.equal(card.querySelectorAll('[data-card-review]').length, 1, 'review action');
    assert.equal(card.querySelectorAll('[data-analytics-event="affiliate_click"],[data-affiliate-unavailable]').length, 1, 'one governed action or explicit hold');
  }
  } finally { dom.window.close(); }
}
