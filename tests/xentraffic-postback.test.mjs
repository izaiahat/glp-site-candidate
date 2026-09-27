import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleGoRequest, networkAccountRef } from '../src/worker.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import { XENTRAFFIC_BINDINGS } from '../src/xentraffic-attribution.mjs';

// Offline synthetic fixtures only. No HTTP client or tracking navigation.
const KEY = 'glp90-synthetic-test-only';
const CLICK = 'c1-010101010101010101010101';
const UUID = '018f2f32-89ab-7def-8123-000000000001';
const PROGRAM = 'eden-xentraffic-offer-3051';
const OFFER = '3051';
const ACCOUNT = '4384';
const programs = Array.isArray(GO_RUNTIME_MANIFEST.programs)
  ? GO_RUNTIME_MANIFEST.programs : Object.values(GO_RUNTIME_MANIFEST.programs);

function fixture(t) {
  const directory = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'glp90-offline-'));
  const path = join(directory, 'ledger.sqlite');
  let sql = new DatabaseSync(path);
  t.after(() => { sql.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const file of ['001_click_map.sql', '006_affiliati_attribution_join.sql', '007_postback_scoped_identity.sql']) {
    sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const calls = [];
  const faults = { loseWriteReply: false, failRead: false, discardWrite: false };
  const db = { prepare(query) { calls.push(query); return { bind(...args) { return {
    async all() {
      if (faults.failRead && query.includes('analytics_revenue_ledger_v1')) throw new Error('synthetic_read_failure');
      return { results: sql.prepare(query).all(...args) };
    },
    async run() {
      if (faults.discardWrite && query.startsWith('INSERT INTO analytics_revenue')) return { meta: { changes: 1 } };
      const r = sql.prepare(query).run(...args);
      if (faults.loseWriteReply && query.startsWith('INSERT INTO analytics_revenue')) throw new Error('synthetic_lost_reply');
      return { meta: { changes: Number(r.changes) } };
    },
  }; } }; } };
  const seed = ({ click = CLICK, program = PROGRAM, offer = OFFER, account = ACCOUNT, network = 'xentraffic', isTest = null, probe = null } = {}) => {
    sql.prepare("INSERT INTO affiliate_click_map (click_token,event_id,page_slug,link_position,program_id,merchant,variant,yyyymm,created_at,ivt_status,ua_class,referrer_class,analytics_consent,ga4_status,network,network_offer_id,network_account_ref,is_test,probe_ref) VALUES (?,?,'providers','fv2s1',?,'synthetic','a','202609','2026-09-27T00:00:00Z','valid','browser','none','denied','suppressed',?,?,?,?,?)")
      .run(click, click, program, network, offer, account, isTest, probe);
  };
  return { db, calls, faults, seed,
    rows: () => sql.prepare('SELECT * FROM analytics_revenue_ledger_v1 ORDER BY rowid').all(),
    clicks: () => sql.prepare('SELECT * FROM affiliate_click_map ORDER BY rowid').all(),
    reopen() { sql.close(); sql = new DatabaseSync(path); },
  };
}

async function invoke(f, changes = {}, envChanges = {}, extra = [], requestInit = {}) {
  const moduleUrl = new URL('../functions/api/postback/xentraffic.js', import.meta.url);
  const { onRequest } = await import(moduleUrl);
  const url = new URL('https://receiver.invalid/api/postback/xentraffic');
  const fields = { pb_key: KEY, payout: '12.34', offer_id: OFFER,
    transaction_id: 'synthetic-transaction-1', sub1: CLICK, sub2: 'synthetic-placement', ...changes };
  for (const [key, value] of Object.entries(fields)) if (value !== null) url.searchParams.set(key, value);
  for (const [key, value] of extra) url.searchParams.append(key, value);
  const response = await onRequest({ request: new Request(url, requestInit), env: {
    XENTRAFFIC_POSTBACK_KEY: KEY, GLP_DB: f.db, ...envChanges,
  } });
  return { code: response.status, body: await response.json() };
}

function candidate(program) {
  // Only synthetic request-local authority; no manifest or operational gates changed.
  return { ...structuredClone(program), redirector_tos_verified: true,
    redirector_tos_source_url: 'https://terms.invalid/test-only', redirector_tos_verified_as_of: '2026-09-01' };
}

test('GLP90 regression: actual XenTraffic click writer stores exact account lineage and unchanged sub1', async t => {
  const f = fixture(t);
  const p = candidate(programs.find(p => p.program_id === PROGRAM));
  assert.equal(networkAccountRef(p), ACCOUNT); // Reproduced predecessor defect: NULL.
  const env = { GLP_DB: f.db, PROGRAM_MANIFEST: { programs: [p] }, AFFILIATE_RUNTIME_MODE: 'production',
    AFFILIATE_LIVE_GATE: `operator-approved:${p.operator_selection_receipt_sha256}`,
    CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  for (const click of [null, UUID]) {
    const u = new URL(`https://site.invalid/go/${PROGRAM}?s=providers.fv2s1&v=a`);
    if (click) u.searchParams.set('cs_click_id', click);
    const r = await handleGoRequest(new Request(u, { headers: { 'user-agent': 'Offline Browser Fixture' } }), env, PROGRAM);
    assert.equal(r.headers.get('X-Attribution-Log'), 'mapped');
    const row = f.clicks().at(-1);
    assert.equal(row.network_account_ref, ACCOUNT);
    assert.equal(row.program_id, PROGRAM);
    assert.equal(row.network_offer_id, OFFER);
    assert.equal(new URL(r.headers.get('location')).searchParams.get('sub1'), row.click_token);
    if (click) assert.equal(row.click_token, click);
    else assert.match(row.click_token, /^c1-[a-f0-9]{24}$/);
  }
  for (const change of [{ network: 'everflow' }, { program_id: 'unknown' }, { network_offer_id: '99999' },
    { tracking: { ...p.tracking, base_url: 'https://other.invalid/841W6MT/6D9WBFD/' } }]) {
    assert.equal(networkAccountRef({ ...p, ...change }), null);
  }
  assert.equal(networkAccountRef({ network: 'affiliati', tracking: { base_url: 'https://example.invalid/?a=15309' } }), '15309');
  const selection = JSON.parse(readFileSync(new URL('../data/go-selection-receipt.json', import.meta.url), 'utf8'));
  const selected = selection.programs.filter(p => p.network === 'xentraffic' && p.disposition === 'ADOPT');
  const tuples = selected.map(p => ({ programId: p.program_id, offerId: p.network_offer_id, trackingUrl: p.issued_link }));
  const sorted = rows => rows.toSorted((a, b) => a.programId.localeCompare(b.programId));
  assert.equal(selected.length, 7);
  assert.deepEqual(sorted(XENTRAFFIC_BINDINGS), sorted(tuples));
  for (const row of selected) assert.equal(networkAccountRef(programs.find(p => p.program_id === row.program_id)), ACCOUNT);
  for (const row of selection.programs.filter(p => p.network === 'xentraffic' && p.disposition === 'HOLD')) {
    assert.equal(networkAccountRef({ ...row, tracking: { base_url: row.issued_link } }), null);
  }
  const before = f.clicks();
  const drifted = { ...p, network_offer_id: '9999' };
  const held = await handleGoRequest(new Request(`https://site.invalid/go/${PROGRAM}?s=providers.fv2s1&v=a`, {
    headers: { 'user-agent': 'Offline Browser Fixture' },
  }), { ...env, PROGRAM_MANIFEST: { programs: [drifted] } }, PROGRAM);
  assert.equal(held.headers.get('X-Redirect-Reason'), 'xentraffic-account-identity-held');
  assert.deepEqual(f.clicks(), before, 'unbound account must not create another NULL lineage row');
});

test('GLP90 acceptance 1: authenticated valid acceptance', async t => {
  assert.ok(existsSync(new URL('../functions/api/postback/xentraffic.js', import.meta.url)), 'candidate receiver must exist');
  const f = fixture(t);
  f.seed();
  assert.equal((await invoke(f, {}, { XENTRAFFIC_POSTBACK_KEY: undefined, AFFILIATI_POSTBACK_KEY: KEY })).code, 503);
  for (const pb_key of [null, 'incorrect-synthetic-key']) {
    assert.equal((await invoke(f, { pb_key, sub1: 'invalid' })).code, 403);
  }
  assert.equal((await invoke(f, {}, {}, [['pb_key', KEY]])).code, 403);
  assert.equal(f.calls.length, 0, 'authenticate before payload parsing or SQL');
  assert.equal((await invoke(f, {}, { GLP_DB: undefined })).code, 503);
  const accepted = await invoke(f);
  assert.deepEqual(accepted, { code: 200, body: { status: 'RECORDED', inserted: 1 } });
  const [row] = f.rows();
  assert.equal(row.network, 'xentraffic');
  assert.equal(row.network_account_ref, ACCOUNT);
  assert.equal(row.program_id, PROGRAM);
  assert.equal(row.cs_click_id, CLICK);
  assert.equal(row.conversion_id, 'synthetic-transaction-1');
  assert.equal(row.network_click_id, null, 'transaction_id must not masquerade as our click identity');
  assert.equal(row.commission_minor, 1234);
  assert.equal(row.currency, null, 'currency absent from the five-field contract remains unknown');
  const attrs = JSON.parse(row.attributes_json);
  assert.equal(attrs.network_tenant_ref, '2068');
  assert.equal(attrs.offer_id, OFFER);
  assert.equal(attrs.owned_click_join, true);
  assert.equal(row.event_type, 'accepted_conversion');
  const { onRequest } = await import('../functions/api/postback/xentraffic.js');
  assert.equal((await onRequest({ request: new Request('https://receiver.invalid/api/postback/xentraffic', { method: 'POST' }), env: {} })).status, 405);
});

test('GLP90 acceptance 2: durable transaction dedupe', async t => {
  const f = fixture(t); f.seed();
  assert.equal((await invoke(f)).body.status, 'RECORDED');
  const original = f.rows();
  f.reopen(); // Real on-disk SQLite connection/process-state boundary, no in-memory dedupe.
  assert.deepEqual(await invoke(f), { code: 200, body: { status: 'DUPLICATE', inserted: 0 } });
  assert.deepEqual(f.rows(), original);
  const raced = await Promise.all([invoke(f, { transaction_id: 'synthetic-race' }), invoke(f, { transaction_id: 'synthetic-race' })]);
  assert.deepEqual(raced.map(r => r.body.status).sort(), ['DUPLICATE', 'RECORDED']);
  assert.equal(f.rows().length, 2);
  f.faults.loseWriteReply = true;
  assert.equal((await invoke(f, { transaction_id: 'synthetic-ambiguous-write' })).body.status, 'DUPLICATE');
  assert.equal(f.rows().length, 3);
  f.faults.loseWriteReply = false;
  f.faults.failRead = true;
  const before = f.rows();
  assert.equal((await invoke(f, { transaction_id: 'synthetic-read-down' })).code, 503);
  assert.deepEqual(f.rows(), before);
  f.faults.failRead = false;
  f.faults.discardWrite = true;
  assert.equal((await invoke(f, { transaction_id: 'synthetic-discarded-write' })).code, 503, 'success requires exact durable readback');
  assert.deepEqual(f.rows(), before);
});

test('GLP90 acceptance 3: reversal semantics — rejection only, never financial reversal ingestion', async t => {
  const f = fixture(t); f.seed();
  f.seed({ click: UUID });
  f.seed({ click: 'c1-020202020202020202020202', program: 'sunlight-glp1', offer: '3254' });
  assert.equal((await invoke(f)).body.status, 'RECORDED');
  const original = f.rows();
  for (const changes of [{ payout: '12.35' }, { sub2: 'changed-placement' }, { sub1: UUID },
    { sub1: 'c1-020202020202020202020202', offer_id: '3254' }]) {
    assert.deepEqual(await invoke(f, changes), { code: 409, body: { status: 'QUARANTINED', reason: 'idempotency_identity_conflict' } });
    assert.deepEqual(f.rows(), original);
  }
  for (const payout of ['-12.34', '-0.01', '-0']) {
    assert.deepEqual(await invoke(f, { payout }), { code: 400, body: { status: 'QUARANTINED', reason: 'correction_not_supported' } });
  }
  for (const changes of [{ event: 'reversal' }, { status: 'reversed' }]) {
    assert.equal((await invoke(f, changes)).body.reason, 'query_field_not_allowed');
  }
  assert.deepEqual(f.rows(), original);
  assert.equal((await invoke(f)).body.status, 'DUPLICATE', 'original remains accepted and unchanged');
});

test('GLP90 acceptance 4: invalid/missing click quarantine without storing rejected payloads', async t => {
  const f = fixture(t);
  for (const sub1 of [null, '', 'providers.fv2s1', 'not-an-owned-click', UUID.toUpperCase()]) {
    assert.deepEqual(await invoke(f, { sub1 }), { code: 400, body: { status: 'QUARANTINED', reason: 'click_identity_invalid' } });
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await invoke(f)).body.reason, 'click_identity_not_owned');
  const badRows = [
    { account: null }, { account: '9999' }, { network: 'everflow' }, { offer: '9999' },
    { program: 'unknown-program' }, { program: 'sunlight-glp1' }, { program: 'fella-health' },
  ];
  for (const [index, change] of badRows.entries()) {
    const click = `c1-${String(index + 10).padStart(24, '0')}`;
    f.seed({ click, ...change });
    assert.equal((await invoke(f, { sub1: click })).body.reason, 'click_identity_not_owned');
  }
  f.seed();
  for (const field of ['sub1', 'sub2', 'transaction_id', 'offer_id', 'payout']) {
    const result = await invoke(f, {}, {}, [[field, 'duplicate']]);
    assert.equal(result.body.status, 'QUARANTINED');
    assert.equal(result.body.reason, 'query_field_ambiguous');
  }
  for (const change of [{ offer_id: null }, { transaction_id: null }, { payout: 'NaN' }, { payout: '1e2' },
    { payout: '1.001' }, { payout: '9999999999' }, { payout: ' 1.00 ' }, { sub2: 'x'.repeat(129) }]) {
    assert.equal((await invoke(f, change)).code, 400);
  }
  assert.equal(f.rows().length, 0);
  assert.equal(f.calls.filter(q => q.startsWith('INSERT INTO analytics_revenue')).length, 0);
});

test('GLP90 acceptance 5: TEST exclusion preserves server lineage and UNKNOWN', async t => {
  const f = fixture(t);
  for (const [index, isTest, probe] of [[1, 1, null], [2, null, 'synthetic-probe'], [3, 0, 'synthetic-probe'], [4, null, null], [5, 0, null]]) {
    const click = `c1-${String(index).padStart(24, '0')}`;
    f.seed({ click, isTest, probe });
    const changes = { sub1: click, transaction_id: `synthetic-test-${index}`, payout: index === 4 ? '' : '0.00' };
    assert.equal((await invoke(f, changes)).body.status, 'RECORDED');
    assert.equal((await invoke(f, { ...changes, is_test: 'false' })).code, 400, 'caller cannot clear server TEST or invent a new field');
  }
  const rows = f.rows();
  assert.deepEqual(rows.map(r => r.event_status), ['test_recorded', 'test_recorded', 'test_recorded', 'unclassified', 'owned_click_recorded']);
  assert.deepEqual(rows.map(r => JSON.parse(r.attributes_json).is_test), [true, true, true, null, false]);
  assert.deepEqual(rows.map(r => JSON.parse(r.attributes_json).classification), ['TEST', 'TEST', 'TEST', 'UNKNOWN', 'server_classified_non_test']);
  assert.equal(rows[3].commission_minor, null);
  assert.equal(rows[0].commission_minor, 0);
  assert.equal(rows.filter(r => ['commission', 'payment', 'reversal'].includes(r.event_type)).length, 0);
  assert.ok(rows.every(r => !['approved', 'payable', 'paid', 'reversed'].includes(r.event_status)));
});

test('GLP90 acceptance 6: privacy-preserving storage has only bounded reconciliation fields', async t => {
  const f = fixture(t); f.seed({ probe: 'synthetic-private-probe-marker' });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('network_forbidden_in_offline_test'); });
  const result = await invoke(f, { sub2: 'synthetic-private-sub2-marker' }, {}, [], { headers: {
    cookie: 'synthetic-cookie-marker', referer: 'https://private.invalid/synthetic-health-marker',
    'cf-connecting-ip': '192.0.2.123', 'user-agent': 'synthetic-private-user-agent',
  } });
  assert.equal(result.code, 200);
  const original = f.rows();
  const attrs = JSON.parse(original[0].attributes_json);
  assert.deepEqual(Object.keys(attrs).sort(), ['classification', 'is_test', 'network_account_ref', 'network_tenant_ref',
    'offer_id', 'owned_click_join', 'receiver_schema', 'source', 'sub2_sha256'].sort());
  assert.match(attrs.sub2_sha256, /^[a-f0-9]{64}$/);
  const persistedOrReturned = JSON.stringify({ rows: original, result });
  for (const marker of [KEY, 'synthetic-private-sub2-marker', 'synthetic-private-probe-marker', 'synthetic-cookie-marker',
    'private.invalid', 'synthetic-health-marker', '192.0.2.123', 'synthetic-private-user-agent', 'pb_key']) {
    assert.ok(!persistedOrReturned.includes(marker), `must not persist/echo ${marker}`);
  }
  for (const [key, value] of [['email', 'synthetic-person@example.invalid'], ['diagnosis', 'synthetic-sensitive'],
    ['page_location', 'https://private.invalid/health'], ['network_account_ref', '9999']]) {
    assert.deepEqual(await invoke(f, { [key]: value }), { code: 400, body: { status: 'QUARANTINED', reason: 'query_field_not_allowed' } });
  }
  for (const value of ['synthetic-person@example.invalid', 'https://private.invalid/health', 'line\nbreak']) {
    assert.equal((await invoke(f, { transaction_id: value })).code, 400);
    assert.equal((await invoke(f, { sub2: value })).code, 400);
  }
  assert.deepEqual(f.rows(), original);
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});
