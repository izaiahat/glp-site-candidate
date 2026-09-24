import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('local Playwright review server exports its base URL to browser specs', () => {
  const env = { ...process.env };
  delete env.PLAYWRIGHT_BASE_URL;
  const script = `const config=(await import('./playwright.config.mjs')).default;console.log(JSON.stringify({declared:process.env.PLAYWRIGHT_BASE_URL,configured:config.use.baseURL,server:config.webServer?.command}))`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.declared, 'http://127.0.0.1:4187');
  assert.equal(result.configured, result.declared);
  assert.equal(result.server, 'node scripts/serve-review.mjs');
});
