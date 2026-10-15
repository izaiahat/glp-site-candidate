import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('GLP361 literal npm test entrypoint executes the required isolated sponsor module-mock cases', () => {
  const command = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts.test;
  const tokens = command.split(/\s+/);
  assert.equal(tokens.shift(), 'node');
  assert.equal(tokens.pop(), 'tests/*.test.mjs');
  const result = spawnSync(process.execPath, [...tokens, 'tests/glp327-sponsor-live-content.test.mjs', 'tests/glp328-payment-observer.test.mjs'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 120000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^# fail 0$/m);
  assert.match(result.stdout, /^# pass 5$/m);
});
