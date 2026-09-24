// A12 registered TEST read/consume path. This is NOT a permission issuer.
// Complete A12 server-issued TEST records and separate OFFLINE fixtures use
// disjoint namespaces. No env flag makes an incomplete/REAL grant issuable.
import { canonicalPermissionJSON as canonical, validA12bVocabulary } from './a12-permission-contract.mjs';
import { createAdvertisingIssuer } from './advertising-issuer.mjs';
const HEX = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TEST = /^TEST_A12_/;
const TUPLE = 'click_token program_id network network_offer_id network_account_ref'.split(' ');
const EVENT = 'schema origin subject_ref platform account_id target_id source_type source_ref source_revision event_name purpose probe_ref binding is_test provenance identifiers observed_at_ms expires_at_ms'.split(' ').sort();
const PERMISSION = 'schema evidence_ref revision status issuer_id review_ref reviewer_id platform account_id target_id origin source_ref source_revision purpose is_test probe_ref issued_at_ms expires_at_ms revocation_epoch source_type event_class event_definition event_name allowed_identifiers allowed_payload_fields ownership_evidence_ref lawful_basis_review_ref tos_refs notice_version notice_sha256 retention_policy_ref erasure_owner transport_contract_ref payload_schema_sha256 retention_owner live_issuable'.split(' ');
const CONSENT = 'schema receipt_id version subject_ref permission_ref permission_revision permission_sha256 platform account_id target_id origin source_ref source_revision purpose is_test probe_ref issued_at_ms expires_at_ms revocation_epoch event_names notice_version notice_sha256 choice choice_at_ms ad_storage ad_user_data ad_personalization gpc withdrawn issuer_id'.split(' ');
const PROBE = 'schema probe_ref authority origin subject_ref platform account_id target_id source_ref source_revision event_name permission_sha256 consent_receipt_id consent_sha256 binding is_test issued_at_ms expires_at_ms capture_limit revocation_epoch operator_authorization_ref environment mode provenance'.split(' ');
const HANDOFF = 'schema environment mode is_test probe_ref permission_sha256 issued_at_ms expires_at_ms probe event'.split(' ');
const TOS = 'source_id requested_url final_url retrieved_on effective_date version_label captured_sha256 scope_review_ref account_acceptance_ref reviewed_at_ms'.split(' ');
const IDS = { meta: 'fbclid', microsoft: 'msclkid', google: 'gclid' };
const EVENTS = { meta: 'TEST_A12_Meta_CaptureProbe', microsoft: 'TEST_A12_Microsoft_CaptureProbe', google: 'TEST_A12_Google_CaptureProbe' };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).sort().join('\0') === [...keys].sort().join('\0');
const text = x => typeof x === 'string' && x.length > 0;
const integer = x => Number.isSafeInteger(x) && x >= 0;
const equal = (a, b) => canonical(a) === canonical(b);

async function digest(x) {
  const bytes = new TextEncoder().encode(typeof x === 'string' ? x : canonical(x));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
function parseRecord(bytes) {
  if (typeof bytes !== 'string' || bytes.length > 32768) throw Error('record_shape');
  const row = JSON.parse(bytes);
  // Canonical storage is the read contract: duplicate keys, whitespace/key-order
  // ambiguity and noncanonical numbers cannot pass exact preimage hashing/CAS.
  if (canonical(row) !== bytes) throw Error('record_noncanonical');
  return row;
}
function cookieTokens(request) {
  const found = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const at = part.indexOf('=');
    const name = (at < 0 ? part : part.slice(0, at)).trim();
    if (['gcs_ads_receipt', 'a6_click_handoff'].includes(name)) return null;
    if (!['__Host-gcs_ads_receipt', '__Host-gcs_click_handoff'].includes(name)) continue;
    if (found[name] !== undefined || at < 0) return null;
    const value = part.slice(at + 1).trim();
    if (!TOKEN.test(value)) return null;
    // 256-bit unpadded base64url, not a caller-selected digest or receipt JSON.
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=');
    if (decoded.length !== 32 || btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') !== value) return null;
    found[name] = value;
  }
  return Object.keys(found).length === 2 ? found : null;
}
export function platformCaptureDisposition(env = {}) {
  if (env.A6_PLATFORM_CAPTURE_MODE === undefined || env.A6_PLATFORM_CAPTURE_MODE === 'off') return 'capture_off';
  if (env.A6_PLATFORM_CAPTURE_MODE !== 'test_only') return 'capture_mode_invalid';
  if (!['offline_fixture','server_registered_test'].includes(env.A6_PLATFORM_CAPTURE_ENVIRONMENT)) return 'capture_environment_denied';
  return 'capture_registered_test_only';
}

const READ = `SELECT h.handoff_token, h.click_token, h.origin, h.consent_receipt_id, h.permission_ref,
 h.context_json, c.consent_json, p.permission_json, m.is_test AS click_is_test,
 m.probe_ref AS click_probe_ref, m.program_id, m.network, m.network_offer_id,
 m.network_account_ref, m.event_id, m.page_slug, m.link_position, m.variant, m.platform_context_json
 FROM a6_platform_click_handoffs h
 JOIN a6_advertising_consent_receipts c ON c.receipt_id=h.consent_receipt_id
 JOIN a6_platform_event_permissions p ON p.evidence_ref=h.permission_ref
 JOIN affiliate_click_map m ON m.click_token=h.click_token
 WHERE h.handoff_token=? AND h.click_token=? AND h.consent_receipt_id=? AND h.permission_ref=? AND h.origin=?
 AND NOT EXISTS (SELECT 1 FROM a6_platform_click_handoffs other
   WHERE other.handoff_token<>h.handoff_token AND json_extract(other.context_json,'$.probe_ref')=json_extract(h.context_json,'$.probe_ref'))
 AND NOT EXISTS (SELECT 1 FROM affiliate_click_map other
   WHERE other.click_token<>h.click_token AND other.probe_ref=m.probe_ref)`;
function windowValid(row, now, max) {
  const issued = row.issued_at_ms ?? row.observed_at_ms;
  return integer(issued) && integer(row.expires_at_ms) && issued <= now && now < row.expires_at_ms && row.expires_at_ms - issued <= max;
}
function requiredTypes(p, c, offline) {
  const permissionKeys = offline ? PERMISSION : PERMISSION.filter(k => !['retention_owner','live_issuable'].includes(k));
  if (!exact(p, permissionKeys) || !exact(c, CONSENT)) return false;
  const pNonText = 'revision is_test issued_at_ms expires_at_ms revocation_epoch allowed_identifiers allowed_payload_fields tos_refs live_issuable'.split(' ');
  const cNonText = 'permission_revision is_test issued_at_ms expires_at_ms revocation_epoch event_names choice_at_ms gpc withdrawn'.split(' ');
  if (permissionKeys.some(k => !pNonText.includes(k) && !text(p[k])) || CONSENT.some(k => !cNonText.includes(k) && !text(c[k]))) return false;
  if (!integer(p.revision) || p.revision < 1 || !integer(c.permission_revision) || !integer(p.revocation_epoch) || !integer(c.revocation_epoch) || !integer(c.choice_at_ms)) return false;
  if (![p.notice_sha256,p.payload_schema_sha256,c.receipt_id,c.permission_sha256,c.notice_sha256].every(x => HEX.test(x))) return false;
  if (!Array.isArray(p.tos_refs) || !p.tos_refs.length) return false;
  if (new Set(p.tos_refs.map(canonical)).size !== p.tos_refs.length) return false;
  return p.tos_refs.every(t => exact(t, TOS) && TOS.filter(k => !['effective_date','version_label','reviewed_at_ms'].includes(k)).every(k => text(t[k])) &&
    HEX.test(t.captured_sha256) && integer(t.reviewed_at_ms) && t.reviewed_at_ms <= p.issued_at_ms &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.retrieved_on) && (t.effective_date === null || /^\d{4}-\d{2}-\d{2}$/.test(t.effective_date)) &&
    (t.version_label === null || text(t.version_label)));
}
async function validate(row, binding, origin, now, env) {
  if (!row || row.click_is_test !== 1 || !integer(now)) return null;
  const offline = env.A6_PLATFORM_CAPTURE_ENVIRONMENT === 'offline_fixture';
  const provenance = offline ? 'offline_fixture' : 'server_registered_test';
  const h = parseRecord(row.context_json), p = parseRecord(row.permission_json), c = parseRecord(row.consent_json);
  const q = h.probe, v = h.event;
  if (!requiredTypes(p,c,offline) || !exact(h,HANDOFF) || !exact(q,PROBE) || !exact(v,EVENT)) return null;
  const schemas = offline ? ['a12-OFFLINE-FIXTURE-handoff-v1','a12-OFFLINE-FIXTURE-permission-v1','a12-OFFLINE-FIXTURE-consent-v1','a12-OFFLINE-FIXTURE-probe-v1','a12-OFFLINE-FIXTURE-event-v1'] : ['a12-platform-click-handoff-v1','a12-platform-permission-v1','a12-advertising-consent-v1','a12-registered-test-probe-v1','a12-synthetic-go-event-v1'];
  if ([h,p,c,q,v].some((x,i) => x.schema !== schemas[i])) return null;
  if (p.status !== (offline ? 'OFFLINE_FIXTURE_ONLY' : 'ELIGIBLE') || (offline && p.live_issuable !== false)) return null;
  if (!offline && (p.issuer_id !== env.A6_PERMISSION_ISSUER_ID || c.issuer_id !== env.A6_CONSENT_ISSUER_ID)) return null;
  if (h.environment !== provenance || q.environment !== provenance || h.mode !== 'TEST' || q.mode !== 'TEST' || q.authority !== (offline ? 'LOCAL_FIXTURE_ONLY' : 'SERVER_REGISTERED_TEST') || !text(q.operator_authorization_ref) || q.capture_limit !== 1) return null;
  if ([h,p,c,q,v].some(x => x.is_test !== true || x.probe_ref !== p.probe_ref) || !text(p.probe_ref) || (offline && !TEST.test(p.probe_ref)) || row.click_probe_ref !== p.probe_ref) return null;
  if (!Object.hasOwn(IDS,p.platform) || !/^https:\/\/[^/?#@]+$/.test(origin) || (offline && origin !== `https://a12-${p.platform}.invalid`)) return null;
  for (const x of [p,c,q,v]) {
    if (x.origin !== origin || x.platform !== p.platform) return null;
    for (const k of ['account_id','target_id','source_ref']) if (x[k] !== p[k] || !text(x[k]) || (offline && !TEST.test(x[k]))) return null;
    if (x.source_revision !== p.source_revision) return null;
  }
  if (p.source_type !== 'synthetic_go_probe' || v.source_type !== p.source_type || p.event_class !== 'synthetic_transport_probe') return null;
  if (p.event_name !== EVENTS[p.platform] || q.event_name !== p.event_name || v.event_name !== p.event_name || !equal(c.event_names,[p.event_name])) return null;
  if ([p,c,v].some(x => x.purpose !== 'ad_measurement') || q.provenance !== provenance || v.provenance !== provenance) return null;
  if (!validA12bVocabulary(p) || !object(v.identifiers) || !Object.keys(v.identifiers).length || Object.keys(v.identifiers).some(k => !p.allowed_identifiers.capture.includes(k)) || Object.values(v.identifiers).some(x => !text(x) || !/^[A-Za-z0-9._~-]{1,512}$/.test(x) || (offline && !TEST.test(x)))) return null;
  // Native export-field vocabulary is separate from the fixed internal EVENT
  // wrapper. This digest binds the ordered permitted payload-field array; it
  // never authorizes exporting this CaptureProbe or its internal metadata.
  if (p.payload_schema_sha256 !== await digest(p.allowed_payload_fields)) return null;
  if (!exact(q.binding,TUPLE) || !exact(v.binding,TUPLE) || !equal(q.binding,v.binding)) return null;
  if (TUPLE.some(k => !text(v.binding[k]) || v.binding[k] !== binding[k] || row[k] !== binding[k])) return null;
  // The pre-registered click is independent authority, including request route.
  if (row.event_id !== binding.click_token || ['page_slug','link_position','variant'].some(k => binding[k] !== undefined && binding[k] !== row[k])) return null;
  const pd = await digest(p), cd = await digest(c);
  if (c.permission_sha256 !== pd || q.permission_sha256 !== pd || h.permission_sha256 !== pd || q.consent_sha256 !== cd) return null;
  if (row.permission_ref !== p.evidence_ref || c.permission_ref !== p.evidence_ref || c.permission_revision !== p.revision || row.consent_receipt_id !== c.receipt_id || q.consent_receipt_id !== c.receipt_id) return null;
  if (c.notice_sha256 !== p.notice_sha256 || c.notice_version !== p.notice_version || c.revocation_epoch !== p.revocation_epoch || q.revocation_epoch !== p.revocation_epoch) return null;
  if (!text(c.subject_ref) || c.subject_ref !== q.subject_ref || c.subject_ref !== v.subject_ref || c.choice !== 'explicit_opt_in' || c.choice_at_ms > c.issued_at_ms || c.choice_at_ms < p.issued_at_ms) return null;
  if (c.ad_storage !== 'granted' || c.ad_user_data !== 'granted' || c.ad_personalization !== 'denied' || c.gpc !== false || c.withdrawn !== false) return null;
  // Consent/registration cannot retroactively authorize an earlier observation.
  if (v.observed_at_ms < c.issued_at_ms || v.observed_at_ms < p.issued_at_ms || v.observed_at_ms < q.issued_at_ms || q.issued_at_ms < c.issued_at_ms || h.issued_at_ms < v.observed_at_ms) return null;
  if (!windowValid(p,now,3600000) || !windowValid(c,now,900000) || !windowValid(q,now,900000) || !windowValid(h,now,120000) || !windowValid(v,now,120000)) return null;
  const expires = Math.min(...[p,c,q,h,v].map(x => x.expires_at_ms));
  const fingerprint = await digest({handoff:h,permission_sha256:pd,consent_sha256:cd});
  return {schema:offline?'a12-OFFLINE-FIXTURE-capture-v1':'a12-platform-click-context-v1',...v.binding,origin,platform:p.platform,account_id:p.account_id,target_id:p.target_id,source_type:p.source_type,source_ref:p.source_ref,source_revision:p.source_revision,event_name:p.event_name,event_class:p.event_class,purpose:p.purpose,subject_ref:c.subject_ref,is_test:true,probe_ref:p.probe_ref,permission_sha256:pd,permission_ref:p.evidence_ref,permission_revision:p.revision,consent_sha256:cd,consent_receipt_id:c.receipt_id,revocation_epoch:p.revocation_epoch,provenance,identifiers:v.identifiers,observed_at_ms:v.observed_at_ms,expires_at_ms:expires,capture_receipt_id:fingerprint};
}

export async function loadPlatformContext(request, env, binding, now = Date.now()) {
  // No query/body is_test, probe_ref, grant, identifiers, clock or registry pointer
  // enters this reader. Only server-selected env pointer and hashed host cookies.
  const started = Date.now();
  let guard=null;
  if (env.A17_ISSUER_STAGE !== undefined) {
    try {
      const issuer=createAdvertisingIssuer(env);
      if(!issuer||request.method!=='GET')return null;
      guard=await issuer.captureAuthority(request,binding);
      env={...env,A6_PERMISSION_REF:guard.permission_ref};
    }catch{return null;}
  }
  if (platformCaptureDisposition(env) !== 'capture_registered_test_only' || !env.GLP_DB?.prepare || !text(env.A6_PERMISSION_REF) || request.method !== 'GET' || request.headers.get('Sec-GPC') === '1') return null;
  if (env.A6_PLATFORM_CAPTURE_ENVIRONMENT === 'server_registered_test' && (!text(env.A6_PERMISSION_ISSUER_ID) || !text(env.A6_CONSENT_ISSUER_ID))) return null;
  try {
    const origin = new URL(request.url).origin;
    if (request.headers.has('Origin') && request.headers.get('Origin') !== origin) return null;
    const tokens = cookieTokens(request);
    if (!tokens || !object(binding) || TUPLE.some(k => !text(binding[k]))) return null;
    const handoffId = await digest(tokens['__Host-gcs_click_handoff']);
    const receiptId = await digest(tokens['__Host-gcs_ads_receipt']);
    const args = [handoffId,binding.click_token,receiptId,env.A6_PERMISSION_REF,origin];
    const read = () => env.GLP_DB.prepare(READ+(guard?' AND '+guard.sql:'')).bind(...args,...(guard?.args||[])).first();
    const row = await read();
    const result = await validate(row,binding,origin,now + Math.max(0,Date.now()-started),env);
    if (!result) return null;
    const bytes = canonical(result);
    if (row.platform_context_json !== null) return row.platform_context_json === bytes ? result : null;
    // UNIQUE(h.click_token) + immutable probe/click full tuple + NULL context is
    // the one-shot reservation. The context receipt consumes that reservation in
    // the SAME SQL statement; no separate handoff update can leave a crash gap.
    // Every mutable authority preimage is rechecked under SQLite's write lock.
    const sql = `UPDATE affiliate_click_map SET platform_context_json=?
      WHERE click_token=? AND event_id=? AND is_test=1 AND probe_ref=?
      AND program_id=? AND network=? AND network_offer_id=? AND network_account_ref=?
      AND page_slug=? AND link_position=? AND variant=? AND platform_context_json IS NULL
      AND ? > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      AND EXISTS (SELECT 1 FROM a6_platform_click_handoffs h
        JOIN a6_advertising_consent_receipts c ON c.receipt_id=h.consent_receipt_id
        JOIN a6_platform_event_permissions p ON p.evidence_ref=h.permission_ref
        WHERE h.handoff_token=? AND h.click_token=affiliate_click_map.click_token
        AND h.origin=? AND h.consent_receipt_id=? AND h.permission_ref=?
        AND h.context_json=? AND c.consent_json=? AND p.permission_json=?
        AND NOT EXISTS (SELECT 1 FROM a6_platform_click_handoffs other
          WHERE other.handoff_token<>h.handoff_token AND json_extract(other.context_json,'$.probe_ref')=json_extract(h.context_json,'$.probe_ref'))
        AND NOT EXISTS (SELECT 1 FROM affiliate_click_map other
          WHERE other.click_token<>h.click_token AND other.probe_ref=affiliate_click_map.probe_ref))${guard?' AND '+guard.sql:''}`;
    try {
      await env.GLP_DB.prepare(sql).bind(bytes,binding.click_token,binding.click_token,result.probe_ref,
        binding.program_id,binding.network,binding.network_offer_id,binding.network_account_ref,
        row.page_slug,row.link_position,row.variant,result.expires_at_ms,
        handoffId,origin,receiptId,env.A6_PERMISSION_REF,row.context_json,row.consent_json,row.permission_json,...(guard?.args||[])).run();
    } catch { /* Unknown effect: read exact key once; NEVER retry the write. */ }
    const after = await read();
    const current = await validate(after,binding,origin,now + Math.max(0,Date.now()-started),env);
    return current && canonical(current) === bytes && after.platform_context_json === bytes ? current : null;
  } catch { return null; }
}

// Legacy pure-JSON grants never gain registry authority. This compatibility
// export intentionally refuses; the registered DB read/CAS path above owns use.
export function buildPlatformContext() { return null; }
