import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createConsentRuntimeSource } from '../../src/consent-runtime.mjs';
import { releaseExportPolicy } from '../../src/candidate-export-policy.mjs';

// Same real consent/runtime boundary as d2i-analytics-hygiene, but the subject is
// supplied by the owning product-ready test: emitted bytes, not a source regex.
// All SDK/network/storage effects are local mocks. No external requests occur.
function sandbox(runtime, { stage = 'production-seal', gpc = false, webdriver = false,
  url = 'https://glpclinicscout.com/quiz/provider-fit/?answer=CANARY#CANARY' } = {}) {
  const scripts = [], captures = [], listeners = {}, storage = new Map();
  const location = new URL(url);
  let fetches = 0;
  const window = {
    location, AbortController, Response,
    fetch: async () => { fetches++; throw new Error('unexpected mock transport'); },
    GCS_EXPORT_POLICY: releaseExportPolicy(stage),
    GCS_ANALYTICS: { enabled: true, consent: 'unknown', measurement_id: 'G-MOCK', gtm_container_id: 'GTM-MOCK' },
    GCS_CLARITY: { enabled: false, project_id: null },
    GCS_POSTHOG: { enabled: true, api_key: 'mock-not-a-real-key', host: 'https://mock.invalid', operator_gate: 'explicit-consent-v3' },
    addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
    dispatchEvent: event => { for (const fn of listeners[event.type] || []) fn(event); },
  };
  const document = {
    readyState: 'loading', referrer: 'https://referrer.invalid/intake/?email=CANARY', title: 'CANARY clinical title',
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    documentElement: { style: { removeProperty() {} }, scrollHeight: 1000 },
    createElement() { return { listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } }; },
    head: { appendChild: script => scripts.push(script) }, set cookie(_value) {},
  };
  const context = vm.createContext({ window, document, location,
    navigator: { globalPrivacyControl: gpc, webdriver, userAgent: 'Mozilla/5.0' },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    CustomEvent: class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } }, URL, URLSearchParams });
  vm.runInContext(createConsentRuntimeSource('null', JSON.stringify('us-default-on')), context, { timeout: 1000 });
  vm.runInContext(runtime, context, { timeout: 1000 });
  return { window, scripts, captures, fetches: () => fetches,
    grant: () => window.GCSConsent.apply('granted'),
    load() {
      let options;
      window.posthog = { get_distinct_id: () => 'TEST_ANONYMOUS', init: (_key, value) => { options = value; },
        capture: (...args) => captures.push(args), opt_out_capturing() {} };
      const script = scripts.find(value => value.src.includes('array.js'));
      assert.ok(script, 'mock SDK bootstrap required');
      script.listeners.load();
      assert.ok(options, 'mock SDK initialization required');
      return options;
    },
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
const progression = ['quiz_start', 'quiz_step_complete', 'quiz_complete', 'results_view'];
const forbidden = ['cost_calculator_complete', 'provider_finder_complete'];
const poison = { answer: 'CANARY', quiz_answers: { medication: 'CANARY' }, email: 'CANARY',
  step_id: 'CANARY', step_number: 99, result_count: 99, provider: 'CANARY', page_slug: 'CANARY',
  subid: 'CANARY', cs_click_id: 'CANARY', gclid: 'CANARY', $current_url: 'CANARY', $referrer: 'CANARY' };

export function assertCurrentProductAnalyticsPrivacy(runtime) {
  const f = sandbox(runtime), options = f.load();
  assert.equal(f.window.GCSConsent.read().analytics_basis, 'global_default');
  for (const name of [...progression, ...forbidden]) {
    assert.equal(f.window.GCSAnalytics.event(name, poison), false, `${name}: no implicit progression permission`);
    assert.equal(options.before_send({ event: name, properties: poison }), null, `${name}: last-mile implicit refusal`);
    f.window.dispatchEvent({ type: 'gcs:quiz', detail: { name, ...poison } });
  }
  f.window.dispatchEvent({ type: 'gcs:quiz', detail: { name: 'comparison_sort_change', ...poison } });
  assert.equal(f.captures.length, 0, 'quiz cannot relabel itself into an ordinary allowed event');
  f.grant();
  assert.equal(f.window.GCSConsent.read().analytics_basis, 'explicit');
  for (const name of progression) {
    const before = f.captures.length;
    assert.equal(f.window.GCSAnalytics.event(name, poison), true, `${name}: explicit coarse event`);
    assert.deepEqual(plain(f.captures.at(-1).slice(0, 2)), [name, {}]);
    f.window.dispatchEvent({ type: 'gcs:quiz', detail: { name, ...poison } });
    assert.equal(f.captures.length, before + 2, `${name}: one capture per explicit invocation`);
    assert.deepEqual(plain(f.captures.at(-1).slice(0, 2)), [name, {}]);
    assert.deepEqual(plain(options.before_send({ event: name, properties: { token: 'TEST_PROJECT', ...poison } })), {
      event: name, properties: { token: 'TEST_PROJECT', distinct_id: 'TEST_ANONYMOUS', $process_person_profile: false, $host: 'glpclinicscout.com' },
    }, `${name}: no health path, caller fields or identity at the last-mile boundary`);
  }
  for (const name of [...forbidden, '__proto__', 'constructor']) {
    assert.equal(f.window.GCSAnalytics.event(name, poison), false, `${name}: remains forbidden even after grant`);
    assert.equal(options.before_send({ event: name, properties: poison }), null);
  }
  assert.doesNotMatch(JSON.stringify(f.captures), /CANARY|quiz_answers|step_number|result_count/);
  assert.doesNotMatch(JSON.stringify(f.window.dataLayer), /CANARY|quiz_answers|step_number|result_count/);
  f.window.GCSConsent.apply('denied');
  assert.equal(options.fetch_options.signal.aborted, true, 'withdrawal aborts the original consent epoch');
  const before = f.captures.length;
  for (const name of progression) {
    assert.equal(f.window.GCSAnalytics.event(name, poison), false, `${name}: revoked`);
    assert.equal(options.before_send({ event: name, properties: poison }), null, `${name}: revoked last-mile`);
  }
  assert.equal(f.captures.length, before);
  assert.equal(f.fetches(), 0, 'no network requests in this source proof');
  for (const control of [{ stage: 'candidate' }, { gpc: true }, { webdriver: true },
    { url: 'http://127.0.0.1/' }, { url: 'https://glpclinicscout.com/intake/' },
    { url: 'https://glpclinicscout.com/results/' }]) {
    const held = sandbox(runtime, control);
    held.grant();
    assert.equal(held.window.GCSConsent.allowsExports(), false, JSON.stringify(control));
    assert.equal(held.scripts.length, 0, JSON.stringify(control));
    for (const name of progression) assert.equal(held.window.GCSAnalytics.event(name, poison), false);
    assert.equal(held.fetches(), 0);
  }
}
