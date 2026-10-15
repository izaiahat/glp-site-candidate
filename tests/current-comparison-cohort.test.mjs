import test from 'node:test';
import assert from 'node:assert/strict';
import { readData, optionCProgramIds } from './helpers/d2w-s9-contracts.mjs';
import { governedProviderIds, governedCompoundedUnknownIds } from './browser/governed-cohort.mjs';
import { currentComparisonPrograms } from './helpers/current-comparison-cohort.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { javascriptProviderMarkup } from './helpers/d2p-noscript.mjs';
import { readFile } from 'node:fs/promises';

// F03 ended/withdrawn relationships are removed from commercial surfaces by
// effectiveAffiliateRegistry, not from frozen raw registry/evidence files.
// This independent raw-source control must accompany exact rendered-set tests.
test('current comparison oracles exclude ended relationships without dropping any healthy evidence owner', () => {
  const registry = readData('program-registry.json');
  const before = structuredClone(registry);
  const ended = registry.programs.filter(row => ['ended', 'withdrawn'].includes(row.affiliate_relationship_snapshot?.lifecycle));
  assert.ok(ended.length > 0, 'current denial control missing');
  const current = optionCProgramIds(registry);
  assert.deepEqual([...current].sort(), governedProviderIds().sort());
  for (const row of ended) {
    assert.equal(row.affiliate_relationship_snapshot.promotion_denied, true);
    assert.equal(current.includes(row.review_slug || row.program_id), false, row.program_id);
  }
  const historical = structuredClone(registry);
  for (const row of historical.programs) delete row.affiliate_relationship_snapshot;
  const historicalIds = optionCProgramIds(historical);
  const deniedIds = new Set(ended.map(row => row.review_slug || row.program_id));
  assert.deepEqual([...current].sort(), historicalIds.filter(id => !deniedIds.has(id)).sort());
  assert.equal(historicalIds.length - current.length, ended.length);
  assert.deepEqual(registry, before, 'test derivation must not edit raw holds or historical evidence');
});

test('current comparison subtraction refuses missing authority, reactivation, provenance drift and ambiguous denial', () => {
  const registry = readData('program-registry.json');
  const authority = loadGoPromotionAuthority();
  const ended = registry.programs.find(row => row.affiliate_relationship_snapshot?.lifecycle === 'ended');
  assert.ok(ended, 'native ended control required');
  for (const mutate of [
    (r, a) => { delete a.programs[ended.program_id]; },
    (r, a) => { a.programs[ended.program_id].status = 'VERIFIED'; },
    (r, a) => { a.programs[ended.program_id].promotion_authorized = true; },
    (r, a) => { delete a.programs[ended.program_id].relationship_snapshot; },
    (r, a) => { a.programs[ended.program_id].relationship_snapshot.source_checked_at = '2000-01-01'; },
    r => { r.programs.find(row => row.program_id === ended.program_id).affiliate_relationship_snapshot.promotion_denied = false; },
    r => { delete r.programs.find(row => row.program_id === ended.program_id).affiliate_relationship_snapshot.source_event_id; },
    r => { r.programs.push(structuredClone(r.programs[0])); },
  ]) {
    const r = structuredClone(registry), a = structuredClone(authority);
    mutate(r, a);
    assert.throws(() => currentComparisonPrograms(r, a), {name: 'AssertionError'});
  }
  // Missing/unknown/paused status must never silently shrink the evidence set.
  for (const lifecycle of [undefined, 'unknown', 'paused', 'active']) {
    const row = structuredClone(ended);
    row.affiliate_relationship_snapshot.lifecycle = lifecycle;
    assert.deepEqual(currentComparisonPrograms({programs: [row]}, {programs: {}}), [row]);
  }
  const rawBefore = structuredClone(registry), authorityBefore = structuredClone(authority);
  const selected = currentComparisonPrograms(registry, authority);
  const denied = new Set(registry.programs.filter(row => ['ended', 'withdrawn'].includes(row.affiliate_relationship_snapshot?.lifecycle)).map(row => row.program_id));
  assert.deepEqual(selected, registry.programs.filter(row => !denied.has(row.program_id)));
  assert.deepEqual(registry, rawBefore);
  assert.deepEqual(authority, authorityBefore);
});

test('served original Option C oracle still refuses any missing healthy card or resurrected ended card', async () => {
  const source = await readFile(new URL('./design-pass4-late-callback-closure.test.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('test("compounded state-unknown rows are separated and the provider directory enforces Option C",');
  assert.ok(start >= 0, 'maintained original callback missing');
  const end = source.indexOf('\ntest(', start + 1);
  const body = source.slice(start, end);
  const run = read => {
    let callback;
    new Function('test', 'assert', 'read', 'count', 'governedCompoundedUnknownIds', 'javascriptProviderMarkup', 'optionCProgramIds', 'governedProviderIds', body)(
      (_name, fn) => { callback = fn; }, assert, read,
      (text, pattern) => (text.match(pattern) || []).length,
      governedCompoundedUnknownIds, javascriptProviderMarkup, optionCProgramIds, governedProviderIds);
    return callback();
  };
  const read = relative => readFile(new URL('../' + relative, import.meta.url), 'utf8');
  await run(read);
  const html = await read('public/providers/index.html');
  const healthyTag = html.match(/<article\b[^>]*\bdata-phase3-provider\b[^>]*data-program="([^"]+)"[^>]*>/);
  const healthy = healthyTag?.[1];
  const ended = readData('program-registry.json').programs.find(row => row.affiliate_relationship_snapshot?.lifecycle === 'ended');
  assert.ok(healthy && ended);
  for (const replacement of ['missing-healthy-control', ended.review_slug || ended.program_id]) {
    const mutated = html.replace(healthyTag[0], healthyTag[0].replace(`data-program="${healthy}"`, `data-program="${replacement}"`));
    assert.notEqual(mutated, html);
    await assert.rejects(() => run(relative => relative === 'public/providers/index.html' ? mutated : read(relative)), {name: 'AssertionError'});
  }
});
