import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { renderReviewSubmissionPage } from '../../src/pass2-review-hub.mjs';

const read = (name) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const registry = JSON.parse(read('data/program-registry.json'));
const pharmacies = JSON.parse(read('data/phase3-pharmacy-render-input.json'));
const runtime = read('assets/review-intake.js');
const css = read('public/assets/site-review.css');
const html = renderReviewSubmissionPage({ programs: registry.programs, pharmacies }).replace('</head>', '<link rel="stylesheet" href="/lookup-fixture.css"></head>');
const expected = new Map();
const aliases = [];
for (const row of registry.programs) {
  if (!/^\/reviews\/[a-z0-9-]+\/$/.test(row.review_path || '')) continue;
  if (row.profiles?.['glp-clinic-scout']?.canonical_identity?.role === 'alias') aliases.push(row.display_name);
  else expected.set(row.display_name, 'provider');
}
for (const row of pharmacies.entries) expected.set(row.display_name, 'pharmacy');

async function checkLookup(page) {
  const input = page.locator('#primary-entity-input');
  const list = page.locator('[data-review-combobox="primary"] [data-review-combobox-list]');
  await expect(input, 'combobox-role').toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAccessibleName(/Provider or pharmacy/);
  await expect(input).toHaveAttribute('aria-autocomplete', 'list');
  const listId = await input.getAttribute('aria-controls');
  expect(listId).toBeTruthy();
  await expect(list).toHaveAttribute('id', listId);
  await expect(list).toHaveAttribute('role', 'listbox');
  for (let i = 0; i < 20 && !await input.evaluate(e => e === document.activeElement); i++) await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  const focus = await input.evaluate(e => ({ visible: e.matches(':focus-visible'), style: getComputedStyle(e).outlineStyle, width: parseFloat(getComputedStyle(e).outlineWidth) }));
  expect(focus.visible).toBe(true);
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThan(0);
  const options = await list.getByRole('option').evaluateAll(nodes => nodes.map(e => [e.querySelector('.cs-combobox__name').textContent, e.querySelector('.cs-combobox__tag').textContent]));
  expect(options.sort(), 'governed-options').toEqual([...expected].sort());
  await expect(list).toBeVisible();
  expect(aliases.every(name => !options.some(([value]) => value === name))).toBe(true);
  expect(expected.get('OrderlyMeds')).toBe('provider');
  await input.fill('Orderly');
  await input.press('ArrowDown');
  await expect(input).toBeFocused();
  const activeId = await input.getAttribute('aria-activedescendant');
  expect(activeId).toBeTruthy();
  const active = list.locator(`[id="${activeId}"]`);
  await expect(active).toHaveAttribute('aria-selected', 'true');
  await expect(active).toHaveText('OrderlyMedsprovider');
  await input.press('Enter');
  await expect(input).toHaveValue('OrderlyMeds');
  await expect(page.locator('[name="entity_registration"]')).toHaveValue('registered');
  await expect(page.locator('[name="experience_type"][value="provider"]')).toBeChecked();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await expect(input).toBeFocused();
  await input.press('ArrowDown');
  await input.press('Escape');
  await expect(list).toBeHidden();
  await expect(input).toBeFocused();
}

for (const variant of ['healthy', 'reduced-motion', 'no-js', 'noop-initialization', 'disconnected-map']) {
  test(`Review lookup executable contract: ${variant}`, async ({ browser, baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent }, info) => {
    const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, userAgent, javaScriptEnabled: variant !== 'no-js', reducedMotion: variant === 'reduced-motion' ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
    const origin = new URL(baseURL).origin;
    let script = runtime;
    if (variant === 'noop-initialization') {
      const marker = 'function initializeCombobox(form, entities, prefix, hooks = {}) {';
      expect(script.split(marker)).toHaveLength(2);
      script = script.replace(marker, marker + '\n return; // controlled no-op mutant\n');
    }
    if (variant === 'disconnected-map') {
      const marker = 'function exactEntityMap(root) {';
      expect(script.split(marker)).toHaveLength(2);
      script = script.replace(marker, marker + '\n return new Map(); // controlled disconnected map\n');
    }
    const forbidden = [], errors = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || request.method() !== 'GET' || /^\/(api|go)\//.test(url.pathname)) {
        forbidden.push({ url: url.href, method: request.method() });
        return route.abort();
      }
      const bodies = { '/reviews/submit/': ['text/html', html], '/assets/review-intake.js': ['text/javascript', script], '/lookup-fixture.css': ['text/css', css] };
      const body = bodies[url.pathname];
      if (!body) return route.abort();
      return route.fulfill({ status: 200, contentType: body[0], body: body[1] });
    });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/reviews/submit/');
      if (variant === 'no-js') {
        await expect(page.getByLabel('Provider or pharmacy', { exact: false }).first()).toBeVisible();
        await expect(page.locator('[data-review-step="primary"]')).toBeVisible();
        await expect(page.locator('[data-review-step="counterpart"]')).toBeVisible();
        await expect(page.locator('[name="combined_attestation"]')).toBeVisible();
        await expect(page.locator('[name="rating"]')).toHaveCount(5);
        await expect(page.locator('[name="evidence"]')).not.toHaveAttribute('required');
      } else if (variant === 'noop-initialization' || variant === 'disconnected-map') {
        let failure;
        try { await checkLookup(page); } catch (error) { failure = error; }
        expect(failure, 'mutant must be rejected by the same effect oracle').toBeTruthy();
        expect(String(failure)).toContain(variant === 'noop-initialization' ? 'combobox-role' : 'governed-options');
        await info.attach('rejected-effect', { body: String(failure), contentType: 'text/plain' });
      } else await checkLookup(page);
      expect(forbidden).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach('lookup-state', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    } finally { await context.close(); }
  });
}
