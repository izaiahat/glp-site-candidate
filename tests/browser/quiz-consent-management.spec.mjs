import { test, expect } from '@playwright/test';

// GLP-44 accepted producer diagnosis:
// reports/ops/glp44-ingestion-continuation-20261003/PRODUCER-REQUEST.md.
// Native management only: no quiz answers, SDK fixture, capture or suppression bypass.
test('GLP44 quiz keeps native tracking choices accessible after denial, regrant and withdrawal', async ({ page, context, baseURL }, testInfo) => {
  const attempts = [], errors = [], states = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(baseURL).origin && request.method() === 'GET' && !/^\/(go|api)\//.test(url.pathname)) return route.continue();
    attempts.push({ host: url.hostname, method: request.method() });
    return route.abort();
  });
  await page.goto('/quiz/provider-fit/', { waitUntil: 'networkidle' });
  const control = page.locator('.qz-intro [data-consent-open]');
  async function snapshot(label, preference) {
    await expect.poll(() => page.evaluate(() => window.GCSConsent.purposes())).toEqual({ analytics: preference, advertising: preference });
    await expect(control).toBeVisible();
    await expect(control).toBeInViewport();
    const state = await page.evaluate(() => {
      const button = document.querySelector('.qz-intro [data-consent-open]');
      const box = button.getBoundingClientRect(), css = getComputedStyle(button);
      return {
        purposes: window.GCSConsent.purposes(), exports: window.GCSConsent.allowsExports(),
        webdriver: navigator.webdriver, posthog_loaded: window.GCS_POSTHOG_LOADED === true,
        ga4_script: !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]'),
        banner: !!document.querySelector('#gcs-consent'),
        control: { text: button.textContent.trim(), tag: button.tagName, x: box.x, y: box.y, width: box.width, height: box.height, color: css.color, background: css.backgroundColor },
        progress: document.querySelector('[data-progress-text]').textContent.trim(),
        answered: [...document.querySelectorAll('[data-phase4-questions] input,[data-phase4-questions] select')].some(el => el.value !== '') || !!document.querySelector('[data-phase4-questions] [aria-pressed="true"]'),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(state.exports).toBe(false);
    expect(state.posthog_loaded).toBe(false); expect(state.ga4_script).toBe(false);
    expect(state.answered).toBe(false); expect(state.progress).toBe('Question 1 of 7');
    expect(state.overflow).toBe(false); expect(state.control.tag).toBe('BUTTON');
    expect(state.control.height).toBeGreaterThanOrEqual(44);
    expect(state.control.width).toBeGreaterThanOrEqual(44);
    states.push({ label, ...state });
    const image = testInfo.outputPath(`${label}.png`);
    await page.screenshot({ path: image });
    await testInfo.attach(label, { path: image, contentType: 'image/png' });
  }
  await page.locator('#gcs-consent [data-consent-open]').click();
  await page.locator('#gcs-consent [data-consent="denied"]').click();
  await expect(page.locator('#gcs-consent')).toHaveCount(0);
  await snapshot('denied', 'denied');
  // Tab reaches a genuine native button; keyboard activation invokes the existing listener.
  for (let tab = 0; tab < 40; tab++) {
    await page.keyboard.press('Tab');
    if (await control.evaluate(el => el === document.activeElement)) break;
  }
  await expect(control).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#gcs-consent [data-consent="granted"]')).toBeVisible();
  await snapshot('reopened', 'denied');
  await page.locator('#gcs-consent [data-consent="granted"]').click();
  await expect(page.locator('#gcs-consent')).toHaveCount(0);
  await snapshot('regranted', 'granted');
  await control.click();
  await page.locator('#gcs-consent [data-consent="denied"]').click();
  await expect(page.locator('#gcs-consent')).toHaveCount(0);
  await snapshot('withdrawn', 'denied');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#gcs-consent')).toHaveCount(0);
  await snapshot('returning-denied', 'denied');
  await control.click();
  await expect(page.locator('#gcs-consent [data-consent="granted"]')).toBeVisible();
  expect(attempts).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach('native-consent-states', { body: JSON.stringify({ states, attempts, errors }, null, 2), contentType: 'application/json' });
});
