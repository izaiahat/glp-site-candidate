import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { startDenyProxy } from '../artifacts/ultracode/tools/qa-common.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const snapshot = path.join(root, 'public');
const origin = 'https://glpclinicscout.com';

function deniedConnect(proxyUrl, target) {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(new URL(proxyUrl).port), '127.0.0.1');
    socket.once('error', reject);
    socket.once('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    socket.once('data', (chunk) => { resolve(chunk.toString().split('\r\n')[0]); socket.destroy(); });
  });
}

test('only exact production CONNECT maps to local snapshot; other targets are denied', async () => {
  const proxy = await startDenyProxy({ snapshotDirectory: snapshot });
  const html = readFileSync(path.join(snapshot, 'providers/index.html'));
  const csp = readFileSync(path.join(snapshot, '_headers'), 'utf8').split('\n')
    .find(line => line.trim().startsWith('Content-Security-Policy:')).trim().replace(/^Content-Security-Policy:\s*/, '');
  try {
    assert.equal(await deniedConnect(proxy.url, 'glpclinicscout.com:444'), 'HTTP/1.1 502 Bad Gateway');
    assert.equal(await deniedConnect(proxy.url, 'example.com:443'), 'HTTP/1.1 502 Bad Gateway');
    for (const browserType of [chromium, webkit]) {
      const browser = await browserType.launch({ headless: true });
      try {
        const context = await browser.newContext({
          proxy: { server: proxy.url, bypass: '127.0.0.1,localhost,[::1]' },
          ignoreHTTPSErrors: true, javaScriptEnabled: false, serviceWorkers: 'block',
        });
        try {
          // Prevent page resources outside this authority from reaching the proxy.
          await context.route('**/*', route => new URL(route.request().url()).origin === origin
            ? route.continue() : route.abort('blockedbyclient'));
          const page = await context.newPage();
          const response = await page.goto(`${origin}/providers/`, { waitUntil: 'domcontentloaded' });
          assert.equal(response.status(), 200, browserType.name());
          assert.equal(await page.evaluate(() => location.origin), origin, browserType.name());
          assert.deepEqual(await response.body(), html, browserType.name());
          assert.equal(response.headers()['content-security-policy'], csp, browserType.name());
        } finally { await context.close(); }
        // The analytics oracle fulfills the main frame at the Playwright route
        // and does not disable certificate checking. WebKit still CONNECTs first.
        const intercepted = await browser.newContext({
          proxy: { server: proxy.url, bypass: '127.0.0.1,localhost,[::1]' },
          serviceWorkers: 'block', javaScriptEnabled: false,
        });
        try {
          await intercepted.route('**/*', route => route.request().url() === `${origin}/providers/`
            ? route.fulfill({ status: 200, body: html,
              headers: { 'content-type': 'text/html', 'content-security-policy': csp } })
            : route.abort('blockedbyclient'));
          const page = await intercepted.newPage();
          const response = await page.goto(`${origin}/providers/`, { waitUntil: 'domcontentloaded' });
          assert.equal(response.status(), 200, browserType.name());
          assert.equal(await page.evaluate(() => location.origin), origin, browserType.name());
        } finally { await intercepted.close(); }
      } finally { await browser.close(); }
    }
    assert.deepEqual(proxy.attempts.map(a => a.target), ['glpclinicscout.com:444', 'example.com:443']);
    assert.equal(proxy.mappedTunnels.length >= 2, true, 'both browsers must traverse mapped CONNECT');
    assert.equal(proxy.mappedTunnels.every(t => t.target === 'glpclinicscout.com:443'), true);
    console.log(`mapped_local_tunnels=${proxy.mappedTunnels.length} denied_external_attempts=${proxy.attempts.length}`);
  } finally { await proxy.close(); }
});
