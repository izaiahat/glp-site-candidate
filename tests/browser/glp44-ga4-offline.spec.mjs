import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createConsentRuntimeSource} from '../../src/consent-runtime.mjs';

// Offline contract test. The SDK URL is intercepted and served a deterministic
// transport fixture; this is not independent Google's SDK/property wire proof.
const origin = 'https://glpclinicscout.com';
const sdk = readFileSync(new URL('../fixtures/glp44-gtag-stub.js', import.meta.url), 'utf8');
const bootstrap = createConsentRuntimeSource('null', JSON.stringify('prior-opt-in'));
const html = `<!doctype html><title>Clinic Scout</title><script>
window.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};
window.GCS_ANALYTICS={enabled:true,measurement_id:'G-2WQ42JY0WK',gtm_container_id:'GTM-PWR49VVK'};
${bootstrap.replaceAll('</script', '<\\/script')}
</script>`;

test('GA4 offline transport: denied/unknown zero requests and cookies; grant, revoke and history isolation', async ({browser}) => {
  const context = await browser.newContext({serviceWorkers:'block'});
  const page = await context.newPage();
  const requests = [], blocked = [];
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {configurable:true, get:()=>false});
      Object.defineProperty(navigator, 'userAgent', {configurable:true, get:()=> 'Mozilla/5.0 GLP44 offline test'});
    });
    // GLP-41 deny-proxy pattern: only the canonical test page and intercepted
    // Google endpoints may resolve. No real third-party connection is possible.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname === '/') return route.fulfill({status:200, contentType:'text/html', body:html});
      if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
        requests.push(url.href); return route.fulfill({status:200, contentType:'text/javascript', body:sdk});
      }
      if (url.hostname === 'www.google-analytics.com' && url.pathname === '/g/collect') {
        requests.push(url.href); return route.fulfill({status:204, body:''});
      }
      blocked.push(url.href); return route.abort('blockedbyclient');
    });
    await page.goto(origin + '/', {waitUntil:'load'});
    const cookies = async () => (await context.cookies(origin)).filter(cookie => cookie.name.startsWith('_ga'));
    expect(requests).toEqual([]); expect(await cookies()).toEqual([]);
    await page.evaluate(() => window.GCSConsent.apply('denied'));
    expect(requests).toEqual([]); expect(await cookies()).toEqual([]);
    await page.evaluate(() => window.GCSConsent.apply('granted'));
    await expect.poll(() => requests.filter(url => url.includes('/g/collect')).length).toBe(1);
    expect(requests.filter(url => url.includes('/gtag/js'))).toHaveLength(1);
    const payload = new URL(requests.find(url => url.includes('/g/collect')));
    expect(payload.searchParams.get('page_location')).toBe(origin + '/');
    expect(payload.searchParams.get('page_title')).toBe('Clinic Scout');
    expect(payload.searchParams.get('page_referrer')).toBe('');
    expect(await cookies()).toHaveLength(2);
    await page.evaluate(() => window.GCSConsent.apply('denied'));
    expect(await cookies()).toEqual([]);
    const atRevoke = requests.length;
    await page.evaluate(() => {
      document.title = 'dose email-canary@example.invalid';
      history.pushState({}, '', '/quiz/provider-fit/?email=canary%40example.invalid#dose');
      window.dispatchEvent(new Event('hashchange'));
      window.GCSConsent.refresh();
    });
    expect(await page.evaluate(() => window['ga-disable-G-2WQ42JY0WK'])).toBe(true);
    expect(requests).toHaveLength(atRevoke); expect(await cookies()).toEqual([]);
    expect(blocked).toEqual([]);
  } finally { await context.close(); }
});
