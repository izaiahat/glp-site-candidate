import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// P21: test freshly built documents, not replacement DOM or source-runtime overrides.
const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(root, 'public');
const graph = JSON.parse(await readFile(path.join(root, 'data/phase3-page-graph.json'), 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
const originalTip = 'Starting prices use a dated provider-published option or an official manufacturer self-pay offer. Eligibility, dose, and current terms can change the price.';
const expectedTip = 'Starting price is the lowest published tier on the dated page; it may apply only to the lowest listed dose. Providers change prices. ' + originalTip;
// Comparison utilities condensed from each medication's own railSpec.status.
// Keep the existing destination contract, including the Wegovy-pill form token.
const medications = [
  ['Compounded semaglutide', 'Compare program inclusions', 'Compare injectable semaglutide programs and what each one includes.', '/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest'],
  ['Compounded tirzepatide', 'Compare monthly program costs', 'Compare injectable tirzepatide programs and their monthly costs.', '/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest'],
  ['Wegovy pill', 'Explore the oral route', 'Understand the oral route, provider pathways, and cost questions.', '/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest'],
  ['Ozempic', 'Compare Ozempic pathways', 'Compare providers with published Ozempic pathways.', '/ozempic/?drug=OZEMPIC&form=BRAND_NAME&sort=cheapest'],
  ['Wegovy', 'Compare Wegovy pathways', 'Compare providers with published Wegovy pathways.', '/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest'],
  ['Mounjaro', 'Compare Mounjaro pathways', 'Compare providers with published Mounjaro pathways.', '/mounjaro/?drug=MOUNJARO&form=BRAND_NAME&sort=cheapest'],
  ['Zepbound', 'Compare Zepbound pathways', 'Compare providers with published Zepbound pathways.', '/zepbound/?drug=ZEPBOUND&form=BRAND_NAME&sort=cheapest'],
];
let server, browser, origin;
before(async () => {
  server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = path.resolve(publicRoot, '.' + pathname);
      if (file !== publicRoot && !file.startsWith(publicRoot + path.sep)) { response.writeHead(403).end(); return; }
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      response.end(await readFile(file));
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
async function withPage(width, options, run) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
  context.setDefaultTimeout(8000);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    return url.origin === origin && request.method() === 'GET' && !/^\/(?:api|go|out)(?:\/|$)/.test(url.pathname)
      ? route.continue() : route.abort('blockedbyclient');
  });
  try { await run(await context.newPage()); } finally { await context.close(); }
}
async function open(page, route) {
  const response = await page.goto(origin + route);
  assert.equal(response?.status(), 200, route);
  const reject = page.getByRole('button', { name: 'Reject optional', exact: true });
  if (await reject.isVisible()) await reject.click();
  await page.evaluate(() => document.fonts.ready);
}
async function sampleMail(icon) {
  return icon.evaluate(node => new Promise(resolve => {
    const positions = [], start = performance.now();
    function frame(now) {
      const transform = getComputedStyle(node).transform;
      positions.push(transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42);
      if (now - start >= 2000) resolve(positions); else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
}

for (const width of [1440, 390]) {
  test(`P21 D16 news mail matches Insights and respects motion preference at ${width}`, async () => {
    await withPage(width, { reducedMotion: 'no-preference' }, async page => {
      await open(page, '/');
      const button = page.locator('.cs-home2-news-section [data-subscribe-open]');
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAccessibleName('Get the weekly price watch');
      assert.equal((await button.textContent()).trim(), 'Get the weekly price watch');
      assert.ok((await button.getAttribute('class')).split(/\s+/).includes('cs-palette-action'));
      const icon = button.locator('svg.cs-subscribe-mail');
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
      await expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
      await expect(icon).toHaveAttribute('fill', 'none');
      await expect(icon).toHaveAttribute('stroke', 'currentColor');
      await expect(icon).toHaveAttribute('stroke-width', '1.8');
      assert.deepEqual(await icon.locator('rect').evaluate(node => ['x', 'y', 'width', 'height', 'rx'].map(key => node.getAttribute(key))), ['3', '5', '18', '14', '2']);
      await expect(icon.locator('path')).toHaveAttribute('d', 'm3 6 9 7 9-7');
      await button.scrollIntoViewIfNeeded();
      await page.mouse.move(1, 1);
      await expect(icon).toBeVisible();
      assert.equal(await icon.evaluate(node => getComputedStyle(node).animationName), 'cs-home-news-mail-bounce');
      const positions = await sampleMail(icon);
      assert.ok(Math.max(...positions) > Math.min(...positions), 'mail actually moves, not just a named keyframe');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await icon.evaluate(node => getComputedStyle(node).animationName), 'none');
      assert.equal(await icon.evaluate(node => getComputedStyle(node).transform), 'none');
      await expect(icon).toBeVisible();
      const newsSvg = await icon.evaluate(node => node.outerHTML);
      await open(page, '/insights/');
      const insightsSvg = page.locator('.cs-ins-head-row [data-subscribe-open] svg.cs-subscribe-mail');
      await expect(insightsSvg).toHaveCount(1);
      assert.equal(await insightsSvg.evaluate(node => node.outerHTML), newsSvg);
    });
  });

  for (const javaScriptEnabled of [true, false]) {
    test(`P21 D29 seven visible one-line benefits at ${width}, JavaScript ${javaScriptEnabled}`, async () => {
      await withPage(width, { javaScriptEnabled }, async page => {
        await open(page, '/');
        const cards = page.locator('[data-med-card]');
        await expect(cards).toHaveCount(medications.length);
        for (const [index, [name, benefit, status, href]] of medications.entries()) {
          const card = cards.nth(index), line = card.locator('.cs-home-med__benefit');
          await expect(card.locator('h3')).toHaveText(name);
          await expect(card).toHaveAttribute('href', href);
          await expect(card).toHaveAttribute('aria-label', `${name} — ${status}`);
          await expect(card.locator('picture')).toHaveCount(1);
          await expect(card.locator('.cs-home-med__qualifier')).toHaveText(index < 2 ? 'Compounded option' : 'Brand option');
          await expect(card.locator('.cs-home-med__pill')).toHaveText(/^(?:Starts at \$[\d,.]+\/mo|Find a provider)$/);
          await expect(line).toHaveCount(1);
          await expect(line).toHaveText(benefit);
          await expect(line).toBeVisible();
          const geometry = await line.evaluate(node => {
            const card = node.closest('[data-med-card]'), box = card.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(node);
            const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
            const heading = card.querySelector('h3').getBoundingClientRect();
            const foot = card.querySelector('.cs-home-med__foot').getBoundingClientRect();
            let opaque = true;
            for (let item = node; item && item !== card.parentElement; item = item.parentElement) {
              const style = getComputedStyle(item);
              opaque &&= Number(style.opacity) > 0 && style.visibility === 'visible' && style.display !== 'none';
            }
            return { lines: rects.length, opaque, hidden: node.hidden || node.getAttribute('aria-hidden') === 'true', contained: rects.every(rect => rect.left >= box.left && rect.right <= box.right && rect.top >= heading.bottom && rect.bottom <= foot.top) };
          });
          assert.equal(geometry.lines, 1, `${name}: real text line, not an aria-label or ellipsis`);
          assert.ok(geometry.opaque && !geometry.hidden && geometry.contained, `${name}: readable between name and CTA within its own card`);
        }
      });
    });
  }

  test(`P21 D32 i trigger and both tooltip qualifications at ${width}`, async () => {
    await withPage(width, {}, async page => {
      await open(page, '/');
      const cards = page.locator('[data-price-card]');
      await expect(cards).toHaveCount(2);
      const ids = new Set();
      for (const card of await cards.all()) {
        const trigger = card.locator('[data-price-info]'), tip = card.locator('[role="tooltip"]');
        await expect(trigger).toHaveText('i');
        await expect(trigger).toHaveAccessibleName('Price details');
        await expect(trigger).toHaveAttribute('type', 'button');
        const id = await tip.getAttribute('id');
        assert.ok(id && !ids.has(id)); ids.add(id);
        await expect(trigger).toHaveAttribute('aria-controls', id);
        await expect(trigger).toHaveAttribute('aria-describedby', id);
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(tip).toBeHidden();
        await expect(tip).toHaveText(expectedTip);
        await expect(card.locator('[data-price-destination]')).toHaveText('Compare providers');
      }
      assert.deepEqual((await cards.nth(1).locator('[data-price-choice]').allTextContents()).sort(), ['Ozempic', 'Wegovy pill', 'Mounjaro', 'Wegovy', 'Zepbound'].sort());
    });
  });

  test(`P21 D35 reader copy, LP card provenance and retained route range at ${width}`, async () => {
    const routes = [...graph.brand_pages, ...graph.compounded_pages, ...graph.bulk_pages].map(page => page.route);
    assert.equal(routes.length, 9);
    assert.equal(new Set(routes).size, 9);
    await withPage(width, {}, async page => {
      for (const route of routes) {
        const html = await readFile(path.join(publicRoot, route.slice(1), 'index.html'), 'utf8');
        assert.ok(!html.includes('No comparable price in our capture.'), `${route}: includes deferred payloads too`);
        await open(page, route);
        if (route === '/6-month/') {
          // Ageless is paused: the current six-month source-backed cohort is
          // genuinely empty. Do not manufacture an unpublished card to keep
          // the historical nonempty-population assertion green.
          await expect(page.locator('[data-phase3-provider-grid] [data-program]')).toHaveCount(0);
          await expect(page.locator('[data-unpublished-provider-section]')).toHaveCount(0);
          await expect(page.locator('[data-filter-empty]')).toContainText('No source-backed record matches those filters. An empty result is not a medical or availability conclusion.');
          await expect(page.locator('[data-filter-empty] [data-filter-reset]')).toHaveCount(1);
          continue;
        }
        const unpublished = page.locator('[data-unpublished-price-card]');
        assert.ok(await unpublished.count() > 0, `${route}: no silently empty population`);
        for (const card of await unpublished.all()) {
          await expect(card).toHaveAttribute('data-price', '');
          await expect(card).toHaveAttribute('data-price-map', '');
        }
        const visibleUnpublished = page.locator('[data-unpublished-price-card]:visible');
        assert.ok(await visibleUnpublished.count() > 0, `${route}: no silently empty visible population`);
        for (const card of await visibleUnpublished.all()) {
          const readerCopy = card.locator('.p3-card-ledger small').filter({ hasText: /^No comparable published price\.$/ });
          await expect(readerCopy).toHaveCount(1);
          await expect(readerCopy).toBeVisible();
        }
        if (!graph.compounded_pages.some(item => item.route === route)) continue;
        const cards = page.locator('.p3-provider-card');
        assert.ok(await cards.count() > 0);
        await expect(cards.locator('time')).toHaveCount(0);
        for (const card of await cards.all()) assert.doesNotMatch(await card.innerText(), /checked\s+\d{4}-\d{2}-\d{2}/i);
        const sourceCards = page.locator('.p3-provider-card:not([data-unpublished-price-card])');
        assert.ok(await sourceCards.count() > 0);
        for (const card of await sourceCards.all()) {
          const sources = card.locator('[data-source-checked]');
          assert.ok(await sources.count() > 0);
          for (const source of await sources.all()) {
            await expect(source).toHaveAttribute('data-source-checked', /^\d{4}-\d{2}-\d{2}$/);
            await expect(source.locator('a[data-citation]')).toHaveCount(1);
          }
          await expect(card.locator('.p3-card-contract dt')).toHaveCount(3);
          assert.ok(await card.locator('.p3-provenance').count() > 0);
        }
        const range = page.locator('.listing__intro [data-prices-checked-date]');
        await expect(range).toHaveCount(1);
        await expect(range).toBeVisible();
        await expect(range).toHaveText(/^\d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}$/);
        assert.equal(await range.evaluate(node => Boolean(node.closest('.p3-provider-card'))), false);
        if (route === '/lp/best-providers/compounded-tirzepatide/') {
          // The checked window covers all cards, including deferred payloads.
          // The 08-06 source was omitted by the old literal 09-01 start.
          const dates = [...html.matchAll(/data-source-checked=\\?"(\d{4}-\d{2}-\d{2})\\?"/g)].map(match => match[1]);
          assert.ok(dates.includes('2026-08-06'), 'oldest source-backed card remains in the route payload');
          assert.ok(dates.includes('2026-09-09'), 'newest source-backed card remains in the route payload');
          await expect(range).toHaveText(`${dates.toSorted()[0]} – ${dates.toSorted().at(-1)}`);
        }
      }
    });
  });
}
