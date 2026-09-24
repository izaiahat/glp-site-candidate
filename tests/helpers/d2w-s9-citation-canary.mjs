import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const citationBaseline = JSON.parse(readFileSync(new URL('../fixtures/d2w-s9-citation-coverage.json', import.meta.url)));
export function assertApprovedMapCoverage(map) {
  assert.equal(map.domains.has('telosrx.com'), false, 'held Telos host reinstated');
  assert.equal(map.programs.has('telos-rx'), false, 'held Telos program promoted');
  assert.equal(map.programs.has('telos-rx-review'), false, 'held Telos alias promoted');
  for (const [host, entry] of citationBaseline.domains) {
    assert.ok(map.domains.has(host), `approved domain omitted:${host}`);
    assert.deepEqual(map.domains.get(host).program_ids, entry.program_ids, `approved domain identity drift:${host}`);
  }
}
export function assertCitationCoverage(report) {
  // S9-6: only telosrx.com/pages/for-men left the fixed 35-citation
  // pre-fix canary when the receipted HOLD removed that approved host.
  assert.equal(citationBaseline.historical_floor, 35);
  assert.equal(citationBaseline.authorized_decrease, 1);
  assert.equal(report.counts.marked_citation, citationBaseline.historical_floor - citationBaseline.authorized_decrease);
  assert.deepEqual(report.ledger.marked_citation, citationBaseline.marked_citation,
    'citation canary identity coverage changed beyond the single authorized Telos removal');
}
