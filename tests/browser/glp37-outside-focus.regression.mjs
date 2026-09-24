import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { chromium, expect } from '@playwright/test';

// Explicit node --test entry; no parallel replacement of the GLP-37 oracle.
const root = new URL('../../public/', import.meta.url).pathname;
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const routes = ['/3-month/', '/lp/best-providers/compounded-semaglutide/', '/ozempic/', '/providers/', '/self-pay/', '/wegovy/'];
test('outside and Escape dismissals independently restore state-opener focus', { timeout: 120000 }, async t => {
  const sitePath = path.join(root, 'assets/site.js');
  const before = await fs.readFile(sitePath);
  const mutation = process.env.GLP37_OUTSIDE_FOCUS_MUTATION === '1';
  const fixed = 'if (popover && !popover.hidden && !stateControl?.contains(event.target)) closeState({ returnFocus: true });';
  let served = before, scratch;
  if (mutation) {
    const text = before.toString();
    assert.equal(text.split(fixed).length - 1, 1, 'mutation must replace exactly one served outside-close handler');
    served = Buffer.from(text.replace(fixed, 'if (popover && !popover.hidden && !stateControl?.contains(event.target)) closeState();'));
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'glp37-outside-mutation-'));
    await fs.writeFile(path.join(scratch, 'site.js'), served);
    assert.notEqual(digest(before), digest(served), 'served mutation changes runtime bytes');
  }
  const server = http.createServer(async (q, s) => {
    try {
      const u = new URL(q.url, 'http://localhost');
      if (q.method !== 'GET') { s.writeHead(405).end(); return; }
      const file = path.resolve(root, '.' + decodeURIComponent(u.pathname) + (u.pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root)) { s.writeHead(403).end(); return; }
      const bytes = mutation && u.pathname === '/assets/site.js' ? await fs.readFile(path.join(scratch, 'site.js')) : await fs.readFile(file);
      s.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
      s.end(bytes);
    } catch { s.writeHead(404).end(); }
  });
  let browser;
  const failures = [];
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await context.route('**/*', r => {
        const u = new URL(r.request().url());
        return u.origin === origin && r.request().method() === 'GET' && !/^\/(api|go|out)(\/|$)/.test(u.pathname) ? r.continue() : r.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.setDefaultTimeout(3000);
      try {
        const runtimeResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/assets/site.js');
        await page.goto(origin + route);
        assert.equal(digest(await (await runtimeResponse).body()), digest(served), 'browser received named served runtime');
        const reject = page.getByRole('button', { name: 'Reject optional', exact: true });
        if (await reject.isVisible()) await reject.click();
        const trigger = page.locator('main [data-state-open]').first();
        const popover = page.locator('main .p3-state-popover').first();
        for (const dismissal of ['outside', 'Escape']) {
          await trigger.tap();
          await expect(popover).toBeVisible();
          await expect.poll(() => popover.evaluate(n => n.contains(document.activeElement))).toBe(true);
          if (dismissal === 'outside') await page.locator('h1').first().tap();
          else await page.keyboard.press('Escape');
          await expect(popover).toBeHidden();
          await expect(trigger).toHaveAttribute('aria-expanded', 'false');
          const restored = await trigger.evaluate(n => n === document.activeElement);
          t.diagnostic(JSON.stringify({ route, dismissal, mutation, focusRestored: restored, served_sha256: digest(served) }));
          if (!restored) failures.push(`${route} ${dismissal}: focus must return to the state opener`);
        }
      } catch (e) { failures.push(`${route}: ${e.message}`); }
      finally { await context.close(); }
    }
    assert.deepEqual(failures, [], 'outside and Escape dismissals must each restore focus to the state opener');
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
    if (scratch) await fs.rm(scratch, { recursive: true, force: true });
    assert.equal(digest(await fs.readFile(sitePath)), digest(before), 'shared emitted runtime restored/unchanged');
  }
});
