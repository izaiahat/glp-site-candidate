import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isTypedPrice, typedPriceText, readerPriceText, sanitizeCapturedWording } from '../../src/typed-price-labels.mjs';

// Match each current medication/plan to its own quotation, source and capture
// clock. A legacy provider-wide cost sentence cannot own a different plan.
export function assertCurrentCardPrice(markup, rows, { showDate = true } = {}) {
  const dom = new JSDOM(markup);
  const d = dom.window.document;
  try {
  const cells = [...d.querySelectorAll('dl[data-provider-card-contract] > div')];
  const cost = cells.find(c => c.querySelector('dt')?.textContent === 'Total monthly cost')?.querySelector('dd');
  assert.ok(cost, 'current cost cell');
  const blocks = [...cost.querySelectorAll('.typed-price,.p3-source-price')];
  assert.equal(blocks.length, rows.length, 'every current price row, no invented plan');
  for (const [i, row] of rows.entries()) {
    const block = blocks[i];
    if (isTypedPrice(row)) {
      assert.equal(block.dataset.priceRowId, row.row_id);
      assert.equal(block.dataset.typedPriceKind, readerPriceText(row.price_kind));
      const plan = String(row.plan_label || '').replace(/^Reported S32 offer:\s*/i, '').trim();
      assert.equal(block.querySelector('h4')?.textContent, !plan || plan === row.label ? row.label : `${row.label} — ${plan}`);
      assert.equal(block.querySelector('.typed-price-line')?.textContent, typedPriceText(row, { labelOnly: true }));
      assert.equal(block.querySelector('[data-price-limitations]')?.textContent,
        [...row.qualifiers, ...row.unknown_components, 'Informational only; enter your complete quote manually.'].map(readerPriceText).join(' '));
      const witnesses = [...new Map([...(row.evidence || []), ...(row.identity_evidence || []), ...Object.values(row.facts || {}).flatMap(f => f.evidence || [])].map(w => [JSON.stringify(w), w])).values()];
      const actual = [...block.querySelectorAll('ul > li')].map(li => ({
        source: li.querySelector('a[data-citation="first_party_price_evidence"]')?.getAttribute('href'),
        date: showDate ? li.querySelector('time')?.getAttribute('datetime') : li.dataset.sourceChecked,
        quote: li.querySelector('blockquote')?.textContent,
      }));
      assert.deepEqual(actual, witnesses.map(w => ({ source: w.source_url, date: w.captured_at_utc.slice(0, 10), quote: sanitizeCapturedWording(w.quote) })));
    } else {
      assert.equal(block.dataset.medication, row.medication_id);
      assert.equal(block.dataset.sourceChecked, row.captured_on);
      assert.equal(block.querySelector('.p3-price-medication')?.textContent, row.display_label || row.label);
      assert.equal(block.querySelector('strong')?.textContent, '$' + row.ongoing_usd.toLocaleString('en-US', { maximumFractionDigits: 2 }));
      assert.equal(block.querySelector('strong + span')?.textContent, '/' + (row.cadence || 'month'));
      assert.equal(block.querySelector('blockquote')?.textContent, row.quote);
      assert.equal(block.querySelector('a[data-citation="first_party_price_evidence"]')?.getAttribute('href'), row.source_url);
      if (showDate) assert.equal(block.querySelector('time')?.getAttribute('datetime'), row.captured_on);
    }
  }
  } finally { dom.window.close(); }
}
