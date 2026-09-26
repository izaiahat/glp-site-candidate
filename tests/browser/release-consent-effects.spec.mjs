import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

// Real served UI and storage; no policy, SDK, consent, or geography mocks.
// Candidate/local suppression remains intact: this is not production-seal proof.
for (const route of ['/', '/providers/', '/tools/glp-1-cost-calculator/']) {
  test(`D1 real consent deny reload regrant ${route}`, async ({ page, context }, info) => {
    const attempts = [], phases = [];
    let phase = 'initial';
    const localOrigin = new URL(info.project.use.baseURL).origin;
    // Install before navigation, catch popups as well, never retain private URLs/bodies.
    await context.route('**/*', async interception => {
      const request = interception.request(), url = new URL(request.url());
      if (url.origin === localOrigin && ['GET', 'HEAD'].includes(request.method())) return interception.continue();
      attempts.push({ phase, method: request.method(), target_sha256: createHash('sha256').update(request.url()).digest('hex') });
      return interception.abort('blockedbyclient');
    });
    const read = () => page.evaluate(() => ({
      effective: window.GCSConsent.effective(), purposes: window.GCSConsent.purposes(),
      exports: window.GCSConsent.allowsExports(), policy: window.GCS_EXPORT_POLICY,
      saved: JSON.parse(localStorage.getItem('gcs_tracking_consent_v1')),
    }));
    const check = async (choice) => {
      await expect.poll(async () => (await read()).effective).toBe(choice);
      const state = await read();
      expect(state.saved).toMatchObject({ analytics: choice, advertising: 'denied', record_type: 'preference_only' });
      expect(state.purposes).toEqual({ analytics: choice, advertising: 'denied' });
      expect(state.exports).toBe(false);
      expect(state.policy).toMatchObject({ stage: 'candidate', third_party_exports: false });
      phases.push({ phase, ...state });
      expect(attempts, 'no nonlocal or write request, including vendor/PHI exports').toEqual([]);
    };
    try {
      expect((await page.goto(route, { waitUntil: 'networkidle' })).status()).toBe(200);
      await page.evaluate(() => window.GCSConsentReady);
      await page.locator('#gcs-consent [data-consent-open]').click();
      phase = 'denied';
      await page.getByRole('button', { name: 'Turn off analytics', exact: true }).click();
      await check('denied');
      phase = 'denied-reload';
      await page.reload({ waitUntil: 'networkidle' });
      await page.evaluate(() => window.GCSConsentReady);
      await check('denied');
      // Call the real event API with an artificial poison value, never replace it.
      expect(await page.evaluate(() => window.GCSAnalytics.event('quiz_complete', { quiz_answers: 'D1_SYNTHETIC_PHI_CANARY', email: 'd1@example.invalid' }))).toBe(false);
      await page.locator('footer a[href^="/privacy/cookies/"]').first().click();
      phase = 'regranted';
      await page.getByRole('button', { name: 'Turn on analytics', exact: true }).click();
      await check('granted');
      phase = 'regranted-reload';
      await page.reload({ waitUntil: 'networkidle' });
      await page.evaluate(() => window.GCSConsentReady);
      await check('granted');
      // Revoke the saved grant with the actual footer control, not a storage write.
      await page.locator('footer a[href^="/privacy/cookies/"]').first().click();
      phase = 'revoked';
      await page.getByRole('button', { name: 'Turn off analytics', exact: true }).click();
      await check('denied');
    } finally {
      await info.attach('D1-real-consent-effects', { body: JSON.stringify({ route, phases, attempts }), contentType: 'application/json' });
    }
  });
}
