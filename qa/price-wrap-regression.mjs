// Local-only source-bound price reflow probe. No credentials or affiliate visits.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const [rootArg, outArg, phase = 'after'] = process.argv.slice(2);
assert(rootArg && outArg, 'usage: node qa/price-wrap-regression.mjs PUBLIC_ROOT OUT_DIR before|after');
const root = path.resolve(rootArg), out = path.resolve(outArg);
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' || url.pathname.startsWith('/go/')) { res.writeHead(403).end(); return; }
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const cases = [], blocked = [];
try {
  for (const route of ['/providers/', '/self-pay/']) for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', async req => {
      const url = new URL(req.request().url());
      if (url.origin !== origin || req.request().method() !== 'GET' || url.pathname.startsWith('/go/')) {
        blocked.push({ route, width, url: url.origin + url.pathname, method: req.request().method() });
        await req.abort();
      } else await req.continue();
    });
    const page = await context.newPage();
    await page.goto(origin + route, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // Visit every card so lazy payload hydration and content visibility are real.
    // Exhaust the site's own pagination, without visiting any provider CTA.
    const more = page.locator('[data-provider-load-more]:visible');
    for (let n = 0; await more.count(); n++) {
      assert(n < 10, 'bounded provider pagination');
      await more.evaluate(button => button.click());
      await page.waitForTimeout(100);
    }
    const allCards = await page.locator('[data-phase3-provider]').count();
    const hiddenCards = await page.locator('[data-phase3-provider]').evaluateAll(els => els.filter(el => !el.getBoundingClientRect().height).map(el => ({ program: el.dataset.program, hidden: el.hidden, parent: el.parentElement.className })));
    console.log(JSON.stringify({ route, width, allCards, hiddenCards }));
    const cards = page.locator('[data-phase3-provider]:visible');
    const cardCount = await cards.count();
    for (let i = 0; i < cardCount; i++) {
      await cards.nth(i).scrollIntoViewIfNeeded();
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(300);
    const prices = page.locator('.p3-source-price > strong:visible, .typed-price-line > strong:visible');
    const count = await prices.count();
    assert(count > 0, `${route}: non-empty price denominator`);
    const amounts = [];
    for (let i = 0; i < count; i++) {
      const price = prices.nth(i);
      await price.scrollIntoViewIfNeeded();
      amounts.push(...await price.evaluate(el => {
        const node = el.firstChild;
        if (el.childNodes.length !== 1 || node.nodeType !== Node.TEXT_NODE) throw new Error('Expected a text-only amount element');
        const matches = [...node.textContent.matchAll(/\$\d[\d,.]*/g)];
        if (!matches.length) throw new Error('Expected at least one currency amount');
        return matches.map(match => {
          const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
          const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
          const lines = [...new Set(rects.map(r => Math.round(r.top * 10) / 10))];
          const box = el.getBoundingClientRect(), parent = el.closest('.p3-source-price, .typed-price-line').getBoundingClientRect();
          return { text: match[0], lines: lines.length, rects: rects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })), whiteSpace: getComputedStyle(el).whiteSpace,
            fitsContainer: rects.every(r => r.left >= parent.left - 1 && r.right <= parent.right + 1),
            program: el.closest('[data-program]')?.dataset.program || null, boxWidth: box.width };
        });
      }));
    }
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(100);
    const name = `${phase}-${route.replaceAll('/', '')}-${width}`;
    await page.screenshot({ path: path.join(out, name + '-full.png'), fullPage: true });
    if (route === '/providers/') {
      const yucca = page.locator('[data-phase3-provider][data-program="yucca-health-xentraffic-offer-3117"]');
      await yucca.scrollIntoViewIfNeeded();
      await yucca.screenshot({ path: path.join(out, name + '-yucca.png') });
    }
    cases.push({ route, width, allCards, hiddenCards, cardCount, priceElementCount: count, amountCount: amounts.length, amounts, overflow, pass: amounts.every(a => a.lines === 1 && a.fitsContainer) && overflow.document <= width && overflow.body <= width });
    writeFileSync(path.join(out, phase + '-browser.json'), JSON.stringify({ phase, root, cases, blocked, complete: cases.length === 6 }, null, 2) + '\n');
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(JSON.stringify({ phase, cases: cases.length, prices: cases.reduce((n, c) => n + c.amountCount, 0), failedCases: cases.filter(c => !c.pass).map(c => ({ route: c.route, width: c.width, wrapped: c.amounts.filter(a => a.lines !== 1).length, containerOverflow: c.amounts.filter(a => !a.fitsContainer).length, overflow: c.overflow })), blocked: blocked.length }));
assert(cases.every(c => c.pass), 'Price amounts must have one text line, fit their container, and cause no page overflow');
