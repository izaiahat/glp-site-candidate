import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleGoRequest } from '../src/worker.mjs';
const UA = 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36';

function fixture({ held = false, storageFails = false } = {}) {
  const count = { fetch: 0, random: 0, rate: 0, db: 0, envExportReads: 0 };
  const rows = [];
  const program = {
    program_id: 'fixture-program', network: 'cj', network_offer_id: '2',
    link_mode: 'server_redirect', go_route_wired: true, live_link_allowed: true,
    promotion_authorized: !held, status: 'live_operator_approved',
    operator_selection_receipt_sha256: 'LOCAL-FIXTURE-NOT-REAL-AUTHORITY',
    allowed_page_roles: ['fixture'], allowed_positions: ['top'], allowed_variants: ['q1'],
    constructor_verified: true, advertiser_permission_verified: true, encoding_verified: true,
    privacy_qa_passed: true, redirector_tos_verified: true,
    redirector_tos_source_url: 'https://official.invalid/fixture-terms', redirector_tos_verified_as_of: '2026-09-05',
    official_fallback: 'https://official.invalid/', allowed_fallback_hosts: ['official.invalid'],
    tracking: { base_url: 'https://tracking.invalid/click-1-2', allowed_tracking_hosts: ['tracking.invalid'] },
  };
  const env = {
    AFFILIATE_RUNTIME_MODE: 'production',
    AFFILIATE_LIVE_GATE: 'operator-approved:LOCAL-FIXTURE-NOT-REAL-AUTHORITY',
    PROGRAM_MANIFEST: { internal_fallback: 'https://internal.invalid/providers/', programs: [program] },
    CLICK_RATE_LIMITER: { limit: async () => { count.rate++; return { success: true }; } },
    GLP_DB: { prepare(sql) { count.db++; let values;
      return { bind(...args) { values = args; return this; }, async run() {
        if (storageFails) throw new Error('LOCAL_FIXTURE_STORAGE_FAILURE');
        rows.push({ sql, values }); return { success: true, meta: { changes: 1 } };
      } };
    } },
  };
  for (const [key, value] of Object.entries({ GA4_MEASUREMENT_ID: 'G-FIXTURE', GA4_API_SECRET: 'LOCAL-TEST-NOT-A-SECRET', GA4_SERVER_EVENTS_GATE: 'operator-approved:fixture' })) {
    Object.defineProperty(env, key, { get() { count.envExportReads++; return value; } });
  }
  globalThis.fetch = async () => { count.fetch++; return new Response('{}'); };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    subtle: webcrypto.subtle,
    getRandomValues(array) { count.random++; return webcrypto.getRandomValues(array); },
  } });
  return { count, rows, env };
}
function request(method = 'GET', headers = {}, query = 's=fixture.top&v=q1') {
  return new Request(`https://site.invalid/go/fixture-program?${query}`, {
    method, headers: { 'user-agent': UA, cookie: 'gcs_analytics_consent=granted; _ga=GA1.1.12.34', ...headers },
  });
}
function assertNoEffects(count) { assert.deepEqual(count, { fetch: 0, random: 0, rate: 0, db: 0, envExportReads: 0 }); }

test('GET keeps governed local mapping and destination but never reads export configuration or sends GA4', async () => {
  const f = fixture(); const res = await handleGoRequest(request(), f.env, 'fixture-program');
  assert.equal(res.headers.get('X-Redirect-Reason'), 'affiliate-live');
  assert.equal(new URL(res.headers.get('Location')).hostname, 'tracking.invalid');
  assert.equal(f.rows.filter(r => r.sql.startsWith('INSERT INTO affiliate_click_map')).length, 1);
  assert.equal(f.count.fetch, 0); assert.equal(f.count.envExportReads, 0);
  assert.equal(res.headers.get('X-GA4-Server-Event'), 'configuration-held');
});
for (const [label, method, headers] of [
  ['HEAD', 'HEAD', {}], ['Purpose', 'GET', { purpose: 'prefetch' }],
  ['Sec-Purpose', 'GET', { 'sec-purpose': 'prefetch;prerender' }],
  ['X-Purpose', 'GET', { 'x-purpose': 'PrErEnDeR' }], ['X-Moz', 'GET', { 'x-moz': 'prefetch' }],
]) {
  test(`${label} uses a governed non-attributed fallback without rate, mint, DB or exporter effects`, async () => {
    const f = fixture(); const res = await handleGoRequest(request(method, headers), f.env, 'fixture-program');
    assertNoEffects(f.count); assert.equal(res.status, 307);
    assert.equal(res.headers.get('Location'), 'https://official.invalid/');
    assert.equal(res.headers.get('X-Redirect-Reason'), 'non-navigational-request');
    assert.match(res.headers.get('Cache-Control'), /no-store/); assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  });
}
test('denied optional analytics does not strand an otherwise governed navigation or authorize export', async () => {
  const f = fixture(); const res = await handleGoRequest(request('GET', { cookie: 'gcs_analytics_consent=denied' }), f.env, 'fixture-program');
  assert.equal(res.headers.get('X-Redirect-Reason'), 'affiliate-live'); assert.equal(f.count.fetch, 0);
  assert.equal(res.headers.get('X-GA4-Server-Event'), 'configuration-held');
});
test('ordinary governed GET storage failure keeps existing fail-closed fallback', async () => {
  const f = fixture({ storageFails: true }); const res = await handleGoRequest(request(), f.env, 'fixture-program');
  assert.equal(res.headers.get('X-Redirect-Reason'), 'click-map-failed-closed'); assert.equal(f.count.fetch, 0);
  assert.equal(res.headers.get('Location'), 'https://internal.invalid/providers/');
});
test('held permission is not upgraded', async () => {
  const f = fixture({ held: true }); const res = await handleGoRequest(request(), f.env, 'fixture-program');
  assertNoEffects(f.count); assert.equal(res.headers.get('X-Redirect-Reason'), 'operator-or-tos-gate-held');
});
test('unknown program stays non-attributed', async () => {
  const f = fixture(); const res = await handleGoRequest(request(), f.env, 'unknown-fixture');
  assertNoEffects(f.count); assert.equal(res.headers.get('X-Redirect-Reason'), 'unknown-program');
});
test('malformed or duplicate attribution is still rejected before effects', async () => {
  for (const query of ['s=fixture.top&v=q1&v=q2', 's=elsewhere.top&v=q1', 's=fixture.top&v=invalid']) {
    const f = fixture(); const res = await handleGoRequest(request('GET', {}, query), f.env, 'fixture-program');
    assertNoEffects(f.count); assert.notEqual(res.headers.get('X-Redirect-Reason'), 'affiliate-live');
  }
});
test('ordinary GET purpose text is not treated as a human certificate or a prefetch', async () => {
  const f = fixture(); const res = await handleGoRequest(request('GET', { purpose: 'ordinary-navigation' }), f.env, 'fixture-program');
  assert.equal(f.count.rate, 1); assert.equal(res.headers.get('X-Redirect-Reason'), 'affiliate-live'); assert.equal(f.count.fetch, 0);
});
