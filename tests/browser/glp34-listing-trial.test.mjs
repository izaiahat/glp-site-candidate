import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { navigateListingTrial } from './glp34-listing-handler.mjs';

test('listing trials restore their seed and await filter state initialization', async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<main><div data-provider-filters></div></main><script>
      setTimeout(() => {
        const filters = document.querySelector('[data-provider-filters]');
        filters.textContent = localStorage.getItem('gcs.state.v1') || 'unset';
        filters.dataset.filterStateReady = 'true';
      }, 80);
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    const seed = JSON.stringify({ state: 'OR' });
    for (const previous of ['CA', 'NY']) {
      await page.evaluate(value => localStorage.setItem('gcs.state.v1', value), previous);
      await navigateListingTrial(page, origin, seed);
      assert.equal(await page.locator('[data-provider-filters]').textContent(), seed);
    }
    await navigateListingTrial(page, origin, null);
    assert.equal(await page.locator('[data-provider-filters]').textContent(), 'unset');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
