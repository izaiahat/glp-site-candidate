import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildApprovedProviderDomainMap } from '../../src/approved-provider-domains.mjs';
// The frozen S9 identities/citations own this actual pre-append Git era,
// not today's relationship/alias state. This is a detector-only test map;
// production and native current-domain tests still use the current loader.
export function loadHistoricalS9DomainMap() {
  const ref = 'fe0df36e273e26a994e6c75d09729295a219e6e8';
  const inputs = {
    registry: ['program-registry.json', '7fd52a55dd68967fb2d4428d62785a41457281dac07c1a4f24129677869ab94f'],
    moneyPageSpecs: ['money-page-specs.json', '0b67ae04770fa7d8c96164383877881a88334a59b1a98b6c166991acd9c37638'],
    contentLedger: ['program-content-ledger.json', 'e298a9d9a81313d8b05536c903776dbca24511463f80b265d486b5a14c80fd72'],
    providerContracts: ['provider-page-contracts.json', 'edcbabb72522b0884f6d6ac97a813b6bf7afc2bb63bf4302c42162a0d03ffef6'],
    approvedRegistry: ['approved-program-registry.json', 'f20a9f5639d189230f15227dead2d9ec54bb6dc916107e9f745cb1c07be8b404'],
    pricingMatrix: ['provider-pricing-matrix.json', 'ec690253849f67f2b8eb0411540f541601d929d97e6d81d1e7e7d1be259e5b37'],
  };
  const data = {};
  for (const [key, [file, sha256]] of Object.entries(inputs)) {
    const bytes = execFileSync('git', ['show', `${ref}:data/${file}`], {
      cwd: new URL('../../', import.meta.url), maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, `S9 historical input drift:${file}`);
    data[key] = JSON.parse(bytes);
  }
  return buildApprovedProviderDomainMap(data);
}
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
