import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadAffiliateLinkMap} from '../../src/affiliate-link-map.mjs';
import {loadGoSelection, loadGoPromotionAuthority} from '../../src/go-runtime-selection.mjs';
import {governedWegovyIds, governedWegovyUnpricedIds} from './governed-cohort.mjs';
const matrix = JSON.parse(readFileSync(new URL('../../data/provider-pricing-matrix.json', import.meta.url))).providers;

// Read-only observation; native observers, consent controls and errors remain live.
// No external destination (including a /go redirect) may be requested.
test.beforeEach(async ({page, baseURL}) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/go/')
      ? route.continue() : route.abort('blockedbyclient');
  });
});

test('C01 quiz clearance never mutates layout during ResizeObserver delivery', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let delivering = false;
    window.__clearanceObservation = { deliveries: 0, writes: [] };
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      constructor(callback) {
        super((entries, observer) => {
          if (entries.some(entry => entry.target.id === 'gcs-consent')) window.__clearanceObservation.deliveries++;
          delivering = true;
          try { callback(entries, observer); } finally { delivering = false; }
        });
      }
    };
    const set = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (...args) {
      if (delivering && args[0] === '--consent-clearance') window.__clearanceObservation.writes.push(args);
      return set.apply(this, args);
    };
  });
  await page.setViewportSize({width:1440, height:900});
  await page.goto('/quiz/provider-fit/');
  await expect.poll(() => page.evaluate(() => window.__clearanceObservation.deliveries)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--consent-clearance')))).toBeGreaterThan(0);
  await page.setViewportSize({width:1280, height:900});
  await expect(page.locator('#gcs-consent')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => window.__clearanceObservation.writes)).toEqual([]);
  expect(errors).toEqual([]);
});

test('F25 each comparable card exposes its current price quote and capture date', async ({page}) => {
  await page.goto('/lp/best-providers/compounded-semaglutide/');
  const cards = page.locator('#provider-results article[data-program]');
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) {
    const id = await card.getAttribute('data-program');
    const rows = matrix[id].medications.filter(row => row.medication_id === 'compounded-semaglutide-injection' && Number.isFinite(row.ongoing_usd));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const evidence = card.locator('details').filter({has: page.locator('blockquote')}).filter({hasText: row.quote});
      await expect(evidence).toHaveCount(1);
      await evidence.locator('summary').click();
      await expect(evidence.locator('blockquote')).toHaveText(row.quote);
      await expect(evidence.locator('blockquote')).toBeVisible();
      await expect(evidence.locator('time')).toHaveAttribute('datetime', row.captured_on);
      await expect(evidence.locator('a')).toHaveAttribute('href', row.source_url);
    }
  }
});

test('F09 home price choices settle at the source amount in both motion modes', async ({page}) => {
  await page.goto('/');
  const amounts = new Set(Object.values(matrix).flatMap(provider => provider.medications).map(row => row.ongoing_usd).filter(Number.isFinite));
  const card = page.locator('[data-price-card]').first();
  const choices = card.locator('[data-price-choice]');
  await expect(choices).toHaveCount(2);
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({reducedMotion});
    for (const index of [1, 0]) {
      const target = Number(await choices.nth(index).getAttribute('data-price-value'));
      expect(amounts.has(target)).toBe(true);
      await choices.nth(index).click();
      await expect(card.locator('[data-price-roll]')).toHaveText(`$${target.toLocaleString('en-US')}`);
      await expect(card.locator('[data-price-roll]')).toHaveAttribute('data-price-numeric', String(target));
    }
  }
});

test('F14 Wellmedr and Sprout preserve their current approved rail after full hydration', async ({page}) => {
  const links = loadAffiliateLinkMap('compare');
  const selection = Object.values(loadGoSelection().programs);
  const authority = loadGoPromotionAuthority().programs;
  const sha = value => createHash('sha256').update(value).digest('hex');
  await page.goto('/providers/');
  const more = page.locator('[data-provider-load-more]');
  while (await more.isVisible()) await more.click();
  for (const id of ['wellmedr-review', 'sprout-health']) {
    const card = page.locator(`#provider-results article[data-program="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    const link = card.locator('a[data-analytics-event="affiliate_click"]');
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    expect(links[id].live).toBe(true);
    const row = selection.find(row => row.render_id === id || row.program_id === id);
    const go = row?.status === 'VERIFIED' && row.disposition === 'ADOPT' && authority[row.program_id]?.promotion_authorized;
    const slot = await link.getAttribute('data-subid');
    expect(slot).toMatch(/^providers\.pc\d+$/);
    await expect(link).toHaveAttribute('data-link-mode', go ? 'server-redirect' : 'transparent-direct');
    const expected = go ? `${row.route}?s=${slot}&v=a` : links[id].affiliate_href;
    expect(sha(await link.getAttribute('href'))).toBe(sha(expected));
    await expect(link).toHaveAttribute('rel', /\bsponsored\b/);
    await expect(link).toHaveAttribute('rel', /\bnofollow\b/);
  }
});

test('F26 no-JS Wegovy retains the current source cohort including unpriced providers', async ({browser, baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled:false, serviceWorkers:'block'});
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/go/') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(baseURL+'/wegovy/');
    const expected = [...new Set([...governedWegovyIds(), ...governedWegovyUnpricedIds()])].sort();
    expect(expected.length).toBeGreaterThan(0);
    const ids = await page.locator('article[data-program]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.program).sort());
    expect(ids).toEqual(expected);
  } finally { await context.close(); }
});
