import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const port = process.env.CI_SMOKE_PORT || '4199';
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/serve-review.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: port }, stdio: ['ignore', 'ignore', 'inherit'],
});
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (server.exitCode !== null) throw new Error('review_server_exited');
    try { ready = (await fetch(base, { redirect: 'manual' })).status === 200; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'candidate-owned Pages-equivalent review server ready');
  const review = readdirSync('public/reviews').find(name => existsSync(`public/reviews/${name}/index.html`));
  assert.ok(review, 'nonempty generated review denominator');
  for (const route of ['/', '/providers/', `/reviews/${review}/`, '/sitemap.xml']) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 0, route);
  }
  // Do not follow redirects, especially affiliate destinations.
  const response = await fetch(base + '/go/ci-nonexistent-program', { redirect: 'manual' });
  assert.equal(response.status, 307, 'unknown /go uses the registered first-party fallback');
  assert.equal(response.headers.get('x-redirect-reason'), 'unknown-program');
  const fallback = new URL(response.headers.get('location'));
  assert.equal(fallback.origin, 'https://glpclinicscout.com');
  assert.equal(fallback.pathname, '/best/online-glp-1-providers/');
  // Inspect this response; never follow it to production or an affiliate.
  console.log('ci-smoke PASS: 4 key routes, unknown /go fail-closed; zero external requests');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
}
