import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

// Source-runtime regression: actual built documents, current registered JS.
// This server writes no candidate artifacts and sends no external requests.
const root = path.resolve(new URL('../', import.meta.url).pathname);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
let server, browser, origin;
before(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const sourceRuntime = ['/assets/site.js', '/assets/motion.js', '/assets/quiz-page.js'].includes(pathname);
    const base = sourceRuntime ? root : path.join(root, 'public');
    let file = path.resolve(base, '.' + decodeURIComponent(pathname));
    if (file !== base && !file.startsWith(base + path.sep)) { response.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', ...options });
  ctx.setDefaultTimeout(8000);
  await ctx.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    return url.origin === origin && request.method() === 'GET' && !/^\/(?:api|go|out)(?:\/|$)/.test(url.pathname)
      ? route.continue() : route.abort('blockedbyclient');
  });
  return ctx;
}
async function open(page, route) {
  const response = await page.goto(origin + route);
  assert.equal(response.status(), 200, 'actual document serves successfully');
  const reject = page.getByRole('button', { name: /^(Reject optional|Turn off analytics)$/ });
  if (await reject.isVisible()) await reject.click();
}

test('W6 natural completion returns by visit history without saved quiz answers', async () => {
  const ctx = await context({ reducedMotion: 'reduce' });
  const externalAttempts = [];
  ctx.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) externalAttempts.push(url.href);
  });
  let returning;
  try {
    const page = await ctx.newPage();
    await open(page, '/');
    await open(page, '/quiz/provider-fit/');
    await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
    await page.locator('[data-single="current_use"][data-value="no"]').click();
    await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
    await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
    await page.locator('[data-quiz-select="state"]').selectOption('OR');
    await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
    await page.locator('[data-quiz-finish]').click();
    await page.waitForURL(url => url.origin === origin && url.pathname === '/matches/customized/'
      && url.searchParams.get('state') === 'OR' && url.searchParams.get('drug') === 'SEMAGLUTIDE'
      && url.searchParams.get('source') === 'survey');
    await page.locator('[data-matches-results]').waitFor({ state: 'visible' });
    assert.ok(await page.locator('[data-result-cards] .qz-card').count() > 0);
    assert.deepEqual(externalAttempts, [], 'a blocked third-party request is not a privacy pass');
    assert.deepEqual(await page.evaluate(() => ['localStorage', 'sessionStorage'].flatMap(store =>
      ['gcs.quiz.provider-fit.progress.v1', 'gcs.quiz.provider-fit.preferences.v1'].map(key => window[store].getItem(key)))), [null, null, null, null]);
    const state = await ctx.storageState();
    const visit = JSON.parse(state.origins.find(row => row.origin === origin).localStorage.find(row => row.name === 'gcs.visit.v1').value);
    assert.equal(visit.lastPath, '/matches/customized/');
    assert.equal(visit.lastPath.includes('?'), false);
    await ctx.close();
    returning = await context({ storageState: state, reducedMotion: 'reduce' });
    const next = await returning.newPage();
    await open(next, '/');
    assert.match(await next.locator('.cs-welcome-toast').innerText(), /Pick up where you left off/);
    assert.doesNotMatch(await next.locator('.cs-welcome-toast').innerText(), /saved preferences|Open your matches/);
    assert.equal(await next.locator('.cs-welcome-toast a').getAttribute('href'), '/matches/customized/');
    await next.locator('.cs-welcome-toast a').click();
    await next.locator('[data-matches-medication]').waitFor({ state: 'visible' });
    assert.equal(new URL(next.url()).search, '');
    assert.equal(await next.locator('[data-matches-results]').isVisible(), false);
    await next.locator('[data-full-quiz-link]').click();
    await next.locator('[data-quiz-position="0"]').waitFor({ state: 'visible' });
    assert.equal(await next.locator('[data-quiz-select="state"]').inputValue(), '');
    assert.equal(await next.locator('[data-quiz-position="0"] [data-quiz-next]').getAttribute('data-armed'), 'false');
    assert.equal(await next.locator('.cs-welcome-toast').count(), 0);
  } finally { await ctx.close(); await returning?.close(); }
});

test('W6 legacy profiles never restore answers or paint preferences, including stale and future records', async () => {
  for (const age of [0, 31 * 86400000, -86400000, null]) {
    const ctx = await context({ reducedMotion: 'reduce' });
    try {
      const page = await ctx.newPage();
      await page.addInitScript(({ age }) => {
        const saved_at = Date.now() - (age || 0);
        localStorage.setItem('gcs.visit.v1', JSON.stringify({
          lastPath: '/matches/customized/', lastTitle: 'Find providers', lastSeenAt: Date.now() - 1000,
        }));
        for (const store of ['localStorage', 'sessionStorage']) {
          window[store].setItem('gcs.quiz.provider-fit.progress.v1', age === null ? '{' : JSON.stringify({
            schema: 'gcs-quiz-provider-fit-progress-v1', completed: true, saved_at,
            answers: { state: 'OR', intents: ['SEMAGLUTIDE'], monthly_cost: '425' },
          }));
          window[store].setItem('gcs.quiz.provider-fit.preferences.v1', age === null ? '{' : JSON.stringify({
            schema: 'gcs-quiz-provider-fit-preferences-v1', matches: ['alpha'], saved_at,
          }));
        }
      }, { age });
      await open(page, '/');
      assert.match(await page.locator('.cs-welcome-toast').innerText(), /Pick up where you left off/);
      assert.doesNotMatch(await page.locator('body').innerText(), /Your saved preferences are ready|Matches your preferences|Open your matches/);
      assert.equal(await page.locator('[data-preference-popover]').count(), 0);
      assert.deepEqual(await page.evaluate(() => ['localStorage', 'sessionStorage'].flatMap(store =>
        ['gcs.quiz.provider-fit.progress.v1', 'gcs.quiz.provider-fit.preferences.v1'].map(key => window[store].getItem(key)))), [null, null, null, null]);
    } finally { await ctx.close(); }
  }
});

test('W6 stale or future visit timestamps cannot authorize a return prompt', async () => {
  for (const age of [31 * 86400000, -86400000]) {
    const ctx = await context({ reducedMotion: 'reduce' });
    try {
      const page = await ctx.newPage();
      await page.addInitScript(age => localStorage.setItem('gcs.visit.v1', JSON.stringify({
        lastPath: '/matches/customized/', lastTitle: 'Find providers', lastSeenAt: Date.now() - age,
      })), age);
      await open(page, '/');
      assert.equal(await page.locator('.cs-welcome-toast').count(), 0);
    } finally { await ctx.close(); }
  }
});

test('D21 value proposition slides down out and up in', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await open(page, '/');
    await page.waitForFunction(() => window.CS_MOTION?.gsap);
    const frames = await page.locator('[data-home-value]').evaluate(node => new Promise(resolve => {
      const rows = [], start = performance.now();
      function frame(now) {
        const style = getComputedStyle(node);
        rows.push({ text: node.textContent, y: style.transform === 'none' ? 0 : new DOMMatrix(style.transform).m42, opacity: Number(style.opacity) });
        if (now - start > 14600) resolve(rows); else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }));
    assert.ok(new Set(frames.map(row => row.text)).size > 1, 'real value-prop text rotates');
    for (const text of ['Compare reported monthly costs.', 'Explore insurance and self-pay paths.', 'Compare compounded treatment options.', 'See providers’ reported prior-authorization support.']) assert.ok(frames.some(row => row.text === text), `cycle includes ${text}`);
    assert.ok(frames.some(row => row.y > 2 && row.opacity < 1), 'outgoing text moves down');
    const changed = frames.findIndex(row => row.text !== frames[0].text);
    assert.ok(frames.slice(changed).some(row => row.y > 2), 'incoming text starts below final position');
    assert.ok(frames.slice(changed).some(row => Math.abs(row.y) < 1 && row.opacity === 1), 'incoming text settles visibly');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('[data-home-value]').evaluate(node => getComputedStyle(node).transform), 'none');
  } finally { await ctx.close(); }
});

test('D36 authored non-hero sections replay; reduced motion stays readable', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await open(page, '/');
    await page.waitForFunction(() => window.CS_MOTION?.gsap);
    const result = await page.evaluate(async () => {
      window.CS_MOTION.stop();
      const node = [...document.querySelectorAll('[data-h17-card]')].find(node => node.getBoundingClientRect().top > innerHeight);
      if (!node) throw Error('No source H17 replay target');
      const frames = async () => {
        node.scrollIntoView({ block: 'center', behavior: 'instant' });
        window.ScrollTrigger.update();
        const values = [], started = performance.now();
        await new Promise(resolve => {
          const sample = now => {
            const art = node.querySelector('.cs-home2-logistics__art');
            const copy = node.querySelector('.cs-home2-logistics__copy');
            const x = el => getComputedStyle(el).transform === 'none' ? 0 : new DOMMatrix(getComputedStyle(el).transform).m41;
            values.push({ art: x(art), copy: x(copy) });
            if (now - started > 1000) resolve(); else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        return values;
      };
      const first = await frames();
      scrollTo({ top: 0, behavior: 'instant' });
      window.ScrollTrigger.update();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const second = await frames();
      return { first, second, once: node.dataset.motionOnce };
    });
    assert.equal(result.once, 'false');
    for (const frames of [result.first, result.second]) assert.ok(frames.some(row => row.art * row.copy < -1), 'art and copy enter from opposite sides on each visit');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.CS_MOTION.reduced === true);
    assert.equal(await page.evaluate(() => window.CS_MOTION.lenis), null);
    assert.ok(await page.locator('[data-h17-card]').evaluateAll(nodes => nodes.every(node => Number(getComputedStyle(node).opacity) === 1)));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, '/wegovy/');
    await page.waitForFunction(() => window.CS_MOTION?.gsap);
    assert.ok(await page.locator('main > section').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => node.dataset.motion && node.dataset.motionOnce === 'false')), 'brand content sections have replay bindings');
  } finally { await ctx.close(); }
  const plain = await context({ javaScriptEnabled: false });
  try {
    const page = await plain.newPage();
    await open(page, '/wegovy/');
    assert.ok(await page.locator('main').evaluate(node => node.getBoundingClientRect().height > 0 && node.textContent.trim().length > 0 && Number(getComputedStyle(node).opacity) === 1));
  } finally { await plain.close(); }
});

test('D47 likelihood ordering and input-based finished monthly estimate', async () => {
  const ctx = await context({ reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    await open(page, '/wegovy/');
    const form = page.locator('[data-insurance-wizard]');
    const slider = form.locator('[name="coverage"]');
    await slider.focus();
    await page.keyboard.press('End');
    const labels = await form.locator('.p3-progress-labels span').allTextContents();
    assert.deepEqual(labels, ['Not covered / unsure', 'Probably not', 'Probably', 'Covered']);
    assert.equal(await slider.inputValue(), '3');
    assert.match(await form.locator('[data-insurance-result]').innerText(), /unknown/i);
    await form.locator('[data-copay="50"]').click();
    await form.locator('[data-insurance-complete]').click();
    const result = await form.locator('[data-insurance-result]').innerText();
    assert.match(result, /Estimated monthly out-of-pocket.*\$50/i);
    assert.match(result, /your (?:entered|selected|own).*not.*(?:coverage|quote)/i);
    assert.doesNotMatch(await form.locator('[data-insurance-complete]').innerText(), /saved/i);
  } finally { await ctx.close(); }
});
