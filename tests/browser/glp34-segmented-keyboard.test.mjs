import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { renderPhase3FilterControls } from '../../src/phase3-page-graph.mjs';

const graph = JSON.parse(fs.readFileSync(new URL('../../data/phase3-page-graph.json', import.meta.url)));
const runtime = fs.readFileSync(new URL('../../assets/site.js', import.meta.url), 'utf8');
const compound = graph.compounded_pages[0];
const controls = renderPhase3FilterControls(compound, [], null, graph);
const card = drug => `<article data-phase3-provider data-program="${drug}" data-drugs="${drug}" data-forms="compounded" data-duration="1 3 6 12" data-dose-values="0.25 0.5 1 1.7 2.4" data-price="100">Fixture ${drug}</article>`;

test('provider segments share roving activation, disabled skipping, URL hydration and visible controls', async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/site.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/site.js' ? runtime : `<!doctype html><main class="listing">${controls}<section class="p3-provider-section"><p data-filter-result></p><div data-phase3-provider-grid>${card('SEMAGLUTIDE')}${card('TIRZEPATIDE')}</div><p data-filter-empty hidden>None</p></section></main><script src="/site.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/providers/?sort=cheapest`);
    await page.locator('[data-filter-state-ready="true"]').waitFor({ state: 'attached', timeout: 1500 });
    const groups = page.locator('[data-filter-group]');
    for (const group of await groups.all()) {
      assert.equal(await group.getAttribute('role'), 'tablist');
      assert.equal(await group.isVisible(), true);
      const enabled = group.locator('[role="tab"]:not([disabled])');
      const count = await enabled.count();
      await enabled.first().focus();
      for (const [key, index] of [['End', count - 1], ['Home', 0], ['ArrowRight', count > 1 ? 1 : 0], ['ArrowLeft', 0], ['ArrowLeft', count - 1], ['ArrowRight', 0]]) {
        await page.keyboard.press(key);
        assert.deepEqual(await group.evaluate(node => {
          const tabs = [...node.querySelectorAll('[role="tab"]')];
          return { active: tabs.filter(tab => !tab.disabled).indexOf(document.activeElement), roving: tabs.filter(tab => tab.tabIndex === 0).length, selected: tabs.filter(tab => tab.getAttribute('aria-selected') === 'true').length, disabled: tabs.filter(tab => tab.disabled && (tab.tabIndex !== -1 || tab.getAttribute('aria-selected') !== 'false')).length };
        }), { active: index, roving: 1, selected: 1, disabled: 0 }, `${await group.getAttribute('data-filter-group')}: ${key}`);
      }
    }
    const treatment = page.locator('[data-filter-group="treatment"]');
    await treatment.locator('button').first().focus();
    await page.keyboard.press('End');
    const drug = await treatment.locator('[aria-selected="true"]').getAttribute('data-value');
    assert.equal(new URL(page.url()).searchParams.get('drug'), drug);
    assert.equal(await page.locator('[data-phase3-provider]:not([hidden])').count(), 1);
    await page.reload();
    await page.locator('[data-filter-state-ready="true"]').waitFor({ state: 'attached', timeout: 1500 });
    assert.equal(await treatment.locator('[aria-selected="true"]').getAttribute('data-value'), drug);
    // Product navigation preserves supported state, not arbitrary query parameters.
    await page.goto(`${origin}${compound.route}?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest&state=OR&fixture=keep`);
    await page.locator('[data-filter-state-ready="true"]').waitFor({ state: 'attached', timeout: 1500 });
    await page.locator('[data-filter-group="treatment"] button').first().focus();
    await page.keyboard.press('End');
    await page.waitForURL(url => url.pathname.includes('tirzepatide'));
    assert.equal(new URL(page.url()).searchParams.get('state'), 'OR');
    assert.equal(new URL(page.url()).searchParams.get('fixture'), null);
    assert.deepEqual(errors, []);
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJS.newPage();
    await plain.goto(`${origin}/providers/`);
    assert.equal(await plain.locator('details.p3-more-filters').count(), 0);
    for (const group of await plain.locator('[data-filter-group]').all()) assert.equal(await group.isVisible(), true);
    assert.equal(await plain.locator('[data-phase3-provider]:visible').count(), 2);
    assert.ok(await plain.locator('[data-cross-route-options] a[href]').count());
    await noJS.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
