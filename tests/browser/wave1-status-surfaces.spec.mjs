import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { governedProviderIds } from './governed-cohort.mjs';

const moneyRoutes = [
  '/best/online-glp-1-providers/',
  '/cost/online-glp-1-programs/',
  '/compare/glp-1-insurance-support-vs-self-pay/',
  '/best/expanded-curated-glp-1-programs/',
  '/best/glp-1-shipping-review-times/',

  '/compare/serena-health-vs-oak-longevity/',
  '/compare/found-vs-yourera/',
  '/compare/trimi-vs-shed/',
  '/compare/healthrx-vs-agelessrx/',
  '/compare/wellorithm-vs-enhance-md/',
  '/compare/month-to-month-vs-annual-glp-1-programs/',
  '/compare/glp-1-program-shipping-and-clinician-review/',
];
const retiredMoneyRoute = '/compare/synergy-rx-vs-carebarerx/';
const redirects = readFileSync(new URL('../../public/_redirects', import.meta.url), 'utf8');
const forbidden = /held\s+correction\s+intake|correction\s+intake\s+is\s+held|affiliate\s+routes?\s+(?:remain\s+)?(?:held|inert)|(?:all|every)\s+(?:affiliate\s+)?routes?\s+(?:remain\s+)?inert|no treatment recommendation or live promotion|live promotions\s+none|promotion(?:al)? authorization|live-link permission|no active affiliate route|no promotional or affiliate route|non-promotional and noindex|staged city evidence pages|approval tied to the exact content hash|staging comparison is link-dark/i;

async function text(page, route) {
  const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
  expect(response?.status(), route).toBe(200);
  return page.locator('body').innerText();
}

test('homepage exposes evidence metrics, not affiliate workflow state', async ({ page }) => {
  const body = await text(page, '/');
  expect(body).not.toMatch(forbidden);
  // Option C A3.2: evidence-qualified card count replaces the retired cash-price hero.
  expect(body).toContain(`Compare ${governedProviderIds().length} evidence-qualified cards`);
  await expect(page.getByRole('heading', { level: 2, name: 'Six checks before you pay.' })).toBeVisible();
  await expect(page.locator('a[href="/review-standards/"]').first()).toHaveAttribute('href', '/review-standards/');
});

test('directory index stays retired and exposes no stale consumer directory', async ({ page }) => {
  const response = await page.goto('/directory/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(404);
  await expect(page.locator('[data-city-card], [data-city-search]')).toHaveCount(0);
});

test('clinic page stays retired and exposes no stale correction UI', async ({ page }) => {
  const response = await page.goto('/clinics/portland-or/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(404);
  await expect(page.locator('#claim-correction, [data-directory-results]')).toHaveCount(0);
});

test('review standards do not expose content-hash approval workflow', async ({ page }) => {
  const body = await text(page, '/review-standards/');
  expect(body).not.toMatch(forbidden);
  expect(body).toContain('named qualified reviewer');
});

test('all active money pages contain no affiliate release-status copy and the retired comparison stays redirected', async ({ page, request }) => {
  for (const route of moneyRoutes) {
    const body = await text(page, route);
    expect(body, route).not.toMatch(forbidden);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots, route).toMatch(/^index,follow/i);
  }
  const redirectResponse = await request.get(retiredMoneyRoute, { maxRedirects: 0 });
  expect(redirectResponse.status()).toBe(301);
  const location = redirectResponse.headers().location;
  expect(location).toBeTruthy();
  expect(new URL(location, redirectResponse.url()).href)
    .toBe(new URL('/providers/', redirectResponse.url()).href);
  expect(redirects.split(/\r?\n/)).toContain(`${retiredMoneyRoute} /providers/ 301`);
  const retiredResponse = await page.goto(retiredMoneyRoute, { waitUntil: 'domcontentloaded' });
  expect(retiredResponse?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/providers/');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://glpclinicscout.com/providers/');
  expect(await page.locator('body').innerText()).not.toMatch(forbidden);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index,follow/i);
});
