import test from 'node:test';
import assert from 'node:assert/strict';
import { waitW17Readiness } from './w17-readiness.mjs';

async function boundedRead(target) {
  let timer;
  const sentinel = new Promise(resolve => { timer = setTimeout(() => resolve({ hung: true }), 150); });
  try { return await Promise.race([waitW17Readiness(target, { timeout: 20 }), sentinel]); }
  finally { clearTimeout(timer); }
}

test('held font readiness returns unresolved within the caller budget', async () => {
  let sampled = false;
  const result = await boundedRead({ page: () => ({ evaluate: () => new Promise(() => {}) }), evaluate: () => { sampled = true; } });
  assert.equal(result.hung, undefined, 'font await escaped the helper deadline');
  assert.equal(result.ready, false);
  assert.match(result.reason, /deadline/);
  assert.equal(sampled, false, 'held fonts cannot qualify paint');
});

test('stalled geometry observation returns unresolved within the caller budget', async () => {
  const result = await boundedRead({ page: () => ({ evaluate: async () => {} }), evaluate: () => new Promise(() => {}) });
  assert.equal(result.hung, undefined, 'geometry await escaped the helper deadline');
  assert.equal(result.ready, false);
});

test('completed observer result is returned without inventing paint evidence', async () => {
  const observation = { ready: true, samples: 7, stable: 6 };
  const result = await boundedRead({ page: () => ({ evaluate: async () => {} }), evaluate: async () => observation });
  assert.deepEqual(result, observation);
  assert.equal('ratio' in result, false);
});
