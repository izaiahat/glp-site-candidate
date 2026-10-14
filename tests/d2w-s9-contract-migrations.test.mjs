import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditTree } from '../scripts/validate-approved-provider-link-monetization.mjs';
import { loadApprovedProviderDomainMap } from '../src/approved-provider-domains.mjs';
import { loadGoSelection } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import { assertApprovedMapCoverage, assertCitationCoverage, citationBaseline, loadHistoricalS9DomainMap } from './helpers/d2w-s9-citation-canary.mjs';
import { detailPrograms, readData } from './helpers/d2w-s9-contracts.mjs';
const fixture = new URL('./fixtures/approved-provider-link-sweep-prefix/', import.meta.url).pathname;

test('S9 citation floor decreases only for the exact receipted held Telos source', () => {
  assert.throws(() => assertApprovedMapCoverage(loadApprovedProviderDomainMap()), /approved domain identity drift:shedrx.com/,
    'today\'s narrower identities are not the immutable historical S9 canary');
  const map = loadHistoricalS9DomainMap();
  assertApprovedMapCoverage(map);
  const report = auditTree(fixture, { map });
  assertCitationCoverage(report);
  // Counterfactual detector-only map, never registry/promotion/source mutation:
  // prove the historical canary differs by exactly the one removed citation.
  const restored = { domains: new Map(map.domains), programs: map.programs };
  restored.domains.set('telosrx.com', { program_ids: ['telos-rx'] });
  const before = auditTree(fixture, { map: restored });
  assert.equal(before.counts.marked_citation, 35);
  assert.deepEqual(before.ledger.marked_citation.filter(row => row.program_ids.includes('telos-rx')),
    [{ file: 'glp-1-price-index/index.html', href: 'https://telosrx.com/pages/for-men', rel: 'noopener', program_ids: ['telos-rx'], reason: 'first_party_price_evidence' }]);
  assert.deepEqual(before.ledger.marked_citation.filter(row => !row.program_ids.includes('telos-rx')), report.ledger.marked_citation);
  assert.throws(() => assertApprovedMapCoverage(restored), /held Telos host reinstated/);
});

test('S9 every remaining approved domain omission trips identity coverage even at an unchanged count', () => {
  const map = loadHistoricalS9DomainMap();
  for (const [host] of citationBaseline.domains) {
    const omitted = { domains: new Map(map.domains), programs: map.programs };
    omitted.domains.delete(host);
    omitted.domains.set('equal-count-substitution.invalid', { program_ids: ['unapproved'] });
    assert.equal(omitted.domains.size, map.domains.size);
    assert.throws(() => assertApprovedMapCoverage(omitted), /approved domain omitted/, host);
  }
  const report = auditTree(fixture, { map });
  for (let i = 0; i < report.ledger.marked_citation.length; i++) {
    const swapped = structuredClone(report);
    swapped.ledger.marked_citation[i].href = 'https://omitted-approved-source.invalid/';
    assert.throws(() => assertCitationCoverage(swapped), /citation canary identity coverage changed/);
  }
});

test('S9 real detector rejects unmarked links to every approved domain and accepts marked controls', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'd2w-s9-citation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const map = loadApprovedProviderDomainMap();
  const targets = [...map.domains.keys()].map(host => `https://${host}/d2w-unmarked-negative-control`);
  const file = path.join(root, 'negative.html');
  writeFileSync(file, targets.map(href => `<a href="${href}">Provider source</a>`).join('\n'));
  const negative = auditTree(file, { map });
  assert.equal(negative.status, 'FAIL');
  assert.deepEqual(negative.findings.filter(f => f.class === 'unmarked_bare_approved_provider_link').map(f => f.href).sort(), targets.sort());
  writeFileSync(file, targets.map(href => `<a href="${href}" data-citation="first_party_price_evidence" rel="nofollow noopener">Provider source</a>`).join('\n'));
  const positive = auditTree(file, { map });
  assert.equal(positive.status, 'PASS');
  assert.equal(positive.counts.marked_citation, targets.length);
});

test('S9 held canonical and alias remain receipt-bound, absent from approved map and promotion', () => {
  const bytes = readFileSync(new URL('../data/telos-research-hold-receipt.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'f18426e9dea271a1c8ae5b234324ddbb57c3c524e61c1494dd8c281174c9c585');
  const registry = readData('program-registry.json');
  for (const id of ['telos-rx', 'telos-rx-review']) {
    const row = registry.programs.find(p => p.program_id === id);
    assert.ok(row, id);
    assert.equal(row.commercial_state, 'held');
    assert.equal(row.go.entry_state, 'held');
    const p = row.profiles['glp-clinic-scout'];
    assert.equal(p.wired, false);
    for (const surface of ['compare', 'quiz', 'calculator', 'go']) assert.equal(p.surfaces[surface], false);
    assert.equal(GO_RUNTIME_MANIFEST.programs[id], undefined);
    assert.notEqual(loadGoSelection().programs[id]?.status, 'VERIFIED');
  }
  assertApprovedMapCoverage(loadHistoricalS9DomainMap());
  const promoted = loadApprovedProviderDomainMap();
  promoted.programs.set('telos-rx', { program_id: 'telos-rx' });
  assert.throws(() => assertApprovedMapCoverage(promoted), /held Telos program promoted/);
});

test('S9 renderer identity owner excludes identity-only aliases but retains held editorial detail', () => {
  const registry = readData('program-registry.json');
  const graph = readData('phase3-page-graph.json');
  const ids = detailPrograms(registry, graph).map(p => p.program_id);
  assert.ok(ids.includes('telos-rx'));
  assert.equal(ids.includes('telos-rx-review'), false);
  const duplicate = structuredClone(registry);
  duplicate.programs.push(structuredClone(duplicate.programs.find(p => p.program_id === 'telos-rx')));
  assert.throws(() => detailPrograms(duplicate, graph), /phase3_provider_work_order_duplicate/);
});
