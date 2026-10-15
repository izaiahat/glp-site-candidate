import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { withReviewFixture, withReviewPage } from './helpers/owned-review-fixture.mjs';

test('W17 page isolation: native failed action closes before next route/contrast collection', async () => {
  const browser = await chromium.launch();
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
      try {
        // Synthetic local pages only: a delayed navigation after an 800ms
        // action failure must not own the next route's measurement document.
        await context.route('**/*', async route => {
          const req = route.request(), u = new URL(req.url());
          if (u.origin !== 'http://w17.fixture' || req.method() !== 'GET') return route.abort();
          if (u.pathname === '/blocked/') return route.fulfill({ contentType: 'text/html', body: '<a href="/late/" style="display:none">Home</a><script>setTimeout(()=>location.href="/late/",1200)</script>' });
          return route.fulfill({ contentType: 'text/html', body: '<main><h2>What remains unverified</h2><a href="/">Start a provider search</a></main>' });
        });
        let failedPage;
        await withReviewPage(context, async page => {
          failedPage = page;
          await page.goto('http://w17.fixture/blocked/');
          const link = page.getByRole('link', { name: 'Home', includeHidden: true });
          await assert.rejects(mobile ? link.tap({ timeout: 800 }) : link.click({ timeout: 800 }), /Timeout 800ms exceeded/);
        });
        assert.equal(failedPage.isClosed(), true);
        assert.equal(context.pages().length, 0);
        await withReviewPage(context, async page => {
          await page.goto('http://w17.fixture/primecare/');
          await page.waitForTimeout(1300);
          assert.equal(new URL(page.url()).pathname, '/primecare/');
          assert.equal(await page.getByRole('heading', { name: 'What remains unverified' }).count(), 1);
          assert.equal(await page.getByRole('link', { name: 'Start a provider search' }).count(), 1);
        });
        assert.equal(context.pages().length, 0);
      } finally { await context.close(); }
    }
    await withReviewFixture(async origin => {
      for (const mobile of [false, true]) {
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
        try {
          await context.route('**/*', async route => {
            const req = route.request(), u = new URL(req.url());
            if (u.origin !== origin || req.method() !== 'GET' || /^\/(api|go|out|track)\//.test(u.pathname)) return route.abort();
            return route.continue();
          });
          for (const route of ['/pharmacies/precision-pharmacy/', '/pharmacies/primecare-pharmacy/', '/pharmacies/cypress-compounding-pharmacy/']) {
            const crumbs = await withReviewPage(context, async page => {
              await page.goto(origin + route, { waitUntil: 'networkidle' });
              assert.equal(await page.locator('.p3-unknowns h2').count(), 1);
              assert.equal(await page.locator('.p3-provider-search-shelf a').count(), 1);
              return page.locator('main nav[aria-label="Breadcrumb"] a').evaluateAll(es => es.map(e => e.getAttribute('href')));
            });
            assert.deepEqual(crumbs, ['/', '/pharmacies/']);
            for (const href of crumbs) await withReviewPage(context, async page => {
              await page.goto(origin + route, { waitUntil: 'networkidle' });
              const reject = page.getByRole('button', { name: 'Reject optional', exact: true });
              if (await reject.isVisible()) await reject.click();
              const link = page.locator('main nav[aria-label="Breadcrumb"] a[href="' + href + '"]').first();
              await (mobile ? link.tap({ timeout: 800 }) : link.click({ timeout: 800 }));
              await page.waitForURL(new URL(href, origin).href, { timeout: 3000 });
              assert.equal(page.url(), new URL(href, origin).href);
            });
            assert.equal(context.pages().length, 0);
          }
        } finally { await context.close(); }
      }
    });
  } finally { await browser.close(); }
});
