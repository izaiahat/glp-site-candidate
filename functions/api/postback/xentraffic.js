import { XENTRAFFIC_ACCOUNT_REF, XENTRAFFIC_TENANT_ID, xentrafficProgram } from '../../../src/xentraffic-attribution.mjs';

const encoder = new TextEncoder();
const CLICK_ID = /^(?:c1-[a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const FIELDS = new Set(['pb_key', 'payout', 'offer_id', 'transaction_id', 'sub1', 'sub2']);

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: {
    'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8',
    'x-robots-tag': 'noindex,nofollow,noarchive',
  } });
}

// Same fixed-digest XOR comparison pattern as the established Pages receiver.
async function constantTimeEqual(actual, expected) {
  const [left, right] = await Promise.all([actual, expected].map(async value =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value || '')))));
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0 && (actual || '').length === expected.length;
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function canonical(value) {
  return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
}

function identity(value, field, required = true) {
  if (value === null || value === '') {
    if (required) throw new Error(`${field}_missing`);
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${field}_invalid`);
  return value;
}

function payoutMinor(value) {
  if (value === null || value === '') return null; // Unknown is not zero.
  if (value.startsWith('-')) throw new Error('correction_not_supported');
  const match = value.match(/^([0-9]{1,10})(?:\.([0-9]{1,2})0{0,2})?$/);
  if (!match) throw new Error('payout_invalid');
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (minor > 214748364700n) throw new Error('payout_invalid');
  return Number(minor);
}

function parse(params) {
  for (const key of params.keys()) {
    if (!FIELDS.has(key)) throw new Error('query_field_not_allowed');
    if (params.getAll(key).length !== 1) throw new Error('query_field_ambiguous');
  }
  const clickId = params.get('sub1');
  if (!clickId || !CLICK_ID.test(clickId)) throw new Error('click_identity_invalid');
  const offerId = identity(params.get('offer_id'), 'offer_id');
  if (!/^[1-9][0-9]{0,9}$/.test(offerId)) throw new Error('offer_id_invalid');
  return { clickId, offerId, transactionId: identity(params.get('transaction_id'), 'transaction_id'),
    payoutMinor: payoutMinor(params.get('payout')), sub2: identity(params.get('sub2'), 'sub2', false) };
}

async function revenueState(db, expected) {
  const read = await db.prepare('SELECT ledger_row_id,revenue_event_id,network,network_account_ref,program_id,network_click_id,' +
    'cs_click_id,conversion_id,order_ref_hash,event_type,event_status,currency,order_amount_minor,commission_minor,' +
    'source_file_sha256,raw_row_sha256,attributes_json FROM analytics_revenue_ledger_v1 ' +
    'WHERE network=? AND network_account_ref=? AND conversion_id=? AND event_type=? LIMIT 2')
    .bind('xentraffic', XENTRAFFIC_ACCOUNT_REF, expected.conversion_id, 'accepted_conversion').all();
  if (!Array.isArray(read?.results)) return 'invalid';
  if (read.results.length === 0) return 'missing';
  if (read.results.length !== 1) return 'invalid';
  return Object.entries(expected).every(([key, value]) => read.results[0][key] === value) ? 'exact' : 'conflict';
}

function replayResponse(state) {
  if (state === 'exact') return json(200, { status: 'DUPLICATE', inserted: 0 });
  if (state === 'conflict') return json(409, { status: 'QUARANTINED', reason: 'idempotency_identity_conflict' });
  if (state === 'invalid') return json(503, { status: 'FAIL_CLOSED', reason: 'ledger_readback_invalid' });
  return null;
}

export async function handleXentrafficPostback(request, env) {
  if (request.method !== 'GET') return json(405, { status: 'METHOD_NOT_ALLOWED' });
  // Candidate environment slot for the SAME existing XenTraffic shared secret.
  // No Affiliati fallback; a declaration is not installation or live authority.
  const expectedKey = env.XENTRAFFIC_POSTBACK_KEY;
  if (typeof expectedKey !== 'string' || !expectedKey) return json(503, { status: 'HELD', reason: 'receiver_not_configured' });
  const url = new URL(request.url);
  if (url.searchParams.getAll('pb_key').length !== 1
      || !(await constantTimeEqual(url.searchParams.get('pb_key'), expectedKey))) {
    return json(403, { status: 'FORBIDDEN' });
  }

  let payload;
  try { payload = parse(url.searchParams); }
  catch (error) { return json(400, { status: 'QUARANTINED', reason: error.message }); }
  const db = env.GLP_DB;
  if (!db?.prepare) return json(503, { status: 'HELD', reason: 'ledger_binding_missing' });
  let click;
  try {
    const read = await db.prepare('SELECT click_token,program_id,network,network_offer_id,network_account_ref,is_test,probe_ref FROM affiliate_click_map WHERE click_token=? LIMIT 2')
      .bind(payload.clickId).all();
    const rows = read?.results || [];
    if (rows.length !== 1 || rows[0].network !== 'xentraffic'
        || rows[0].network_account_ref !== XENTRAFFIC_ACCOUNT_REF
        || rows[0].network_offer_id !== payload.offerId
        || !xentrafficProgram(rows[0].program_id, payload.offerId)) {
      return json(409, { status: 'QUARANTINED', reason: 'click_identity_not_owned' });
    }
    [click] = rows;
  } catch { return json(503, { status: 'FAIL_CLOSED', reason: 'click_ledger_unavailable' }); }

  const sub2Sha256 = payload.sub2 === null ? null : await sha256(payload.sub2);
  // Only server-owned lineage classifies TEST/non-test. No inbound is_test macro.
  const isTest = click.is_test === 1 || Boolean(click.probe_ref) ? true : (click.is_test === 0 ? false : null);
  const eventStatus = isTest === true ? 'test_recorded' : (isTest === false ? 'owned_click_recorded' : 'unclassified');
  const attributes = {
    receiver_schema: 'glp-xentraffic-pages-postback-v1', source: 'xentraffic_candidate_postback',
    network_tenant_ref: XENTRAFFIC_TENANT_ID, network_account_ref: XENTRAFFIC_ACCOUNT_REF,
    offer_id: payload.offerId, sub2_sha256: sub2Sha256, owned_click_join: true,
    is_test: isTest, classification: isTest === true ? 'TEST' : (isTest === false ? 'server_classified_non_test' : 'UNKNOWN'),
  };
  // Account-wide transaction identity excludes program/click/payout: changing any
  // of those must conflict, not mint a second accepted transaction.
  const eventId = await sha256(canonical({ schema: 'glp-xentraffic-transaction-v1', network: 'xentraffic',
    tenant: XENTRAFFIC_TENANT_ID, account: XENTRAFFIC_ACCOUNT_REF, transaction: payload.transactionId }));
  const rawHash = await sha256(canonical({ click: payload.clickId, transaction: payload.transactionId,
    program: click.program_id, offer: payload.offerId, payout_minor: payload.payoutMinor,
    sub2_sha256: sub2Sha256, event_status: eventStatus }));
  const expected = { ledger_row_id: eventId, revenue_event_id: eventId, network: 'xentraffic',
    network_account_ref: XENTRAFFIC_ACCOUNT_REF, program_id: click.program_id, network_click_id: null,
    cs_click_id: payload.clickId, conversion_id: payload.transactionId, order_ref_hash: null,
    event_type: 'accepted_conversion', event_status: eventStatus, currency: null, order_amount_minor: null,
    commission_minor: payload.payoutMinor, source_file_sha256: rawHash, raw_row_sha256: rawHash,
    attributes_json: canonical(attributes) };
  try {
    const prior = replayResponse(await revenueState(db, expected));
    if (prior) return prior;
  } catch { return json(503, { status: 'FAIL_CLOSED', reason: 'ledger_readback_unavailable' }); }
  const now = new Date().toISOString();
  try {
    const inserted = await db.prepare('INSERT INTO analytics_revenue_ledger_v1 ' +
      '(ledger_row_id,revenue_event_id,network,network_account_ref,program_id,network_click_id,cs_click_id,conversion_id,' +
      'order_ref_hash,event_type,event_status,currency,order_amount_minor,commission_minor,occurred_at,imported_at,' +
      'source_file_sha256,raw_row_sha256,attributes_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(eventId, eventId, 'xentraffic', XENTRAFFIC_ACCOUNT_REF, click.program_id, null, payload.clickId,
        payload.transactionId, null, 'accepted_conversion', eventStatus, null, null, payload.payoutMinor,
        now, now, rawHash, rawHash, canonical(attributes)).run();
    if (Number(inserted?.meta?.changes) !== 1) throw new Error('insert_not_applied');
  } catch {
    // A failed/ambiguous insert is not a retry instruction. Reconcile once.
    try {
      const raced = replayResponse(await revenueState(db, expected));
      if (raced) return raced;
    } catch { /* preserve the write failure */ }
    return json(503, { status: 'FAIL_CLOSED', reason: 'ledger_write_failed' });
  }
  try {
    if (await revenueState(db, expected) !== 'exact') return json(503, { status: 'FAIL_CLOSED', reason: 'ledger_readback_invalid' });
  } catch { return json(503, { status: 'FAIL_CLOSED', reason: 'ledger_readback_unavailable' }); }
  return json(200, { status: 'RECORDED', inserted: 1 });
}

export async function onRequest({ request, env }) {
  return handleXentrafficPostback(request, env);
}
