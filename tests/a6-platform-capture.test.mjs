import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/platform-click-context.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});
const now = Date.parse('2026-09-09T03:00:00Z');
const binding = { click_token: '01992fee-0000-7000-8000-000000000001', program_id: 'fixture-only', network: 'affiliati', network_offer_id: 'TEST1', network_account_ref: 'TESTACCOUNT' };
function evidence() {
  return { ...binding, origin: 'https://example.invalid', observed_at_ms: now - 60000,
    expires_at_ms: now + 60000, is_test: true, provenance: 'offline_fixture',
    identifiers: { msclkid: 'FAKE_MS_OFFLINE_ONLY', fbclid: 'FAKE_FB_AbC', fbp: 'fb.1.1788922740000.1234', gclid: 'FAKE_GOOGLE' },
    consent: { origin: 'https://example.invalid', receipt_id: 'fixture-receipt', version: '1', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', withdrawn: false, expires_at_ms: now + 60000 },
    permission: { origin: 'https://example.invalid', evidence_ref: 'offline-fixture-not-approval', event_class: 'non_sensitive_b2b', allowed_platforms: ['meta','microsoft','google'], expires_at_ms: now + 60000 }
  };
}
test('legacy pure JSON grants cannot substitute for registered TEST capture (positive successor: D2n)', () => {
  assert.equal(typeof api.buildPlatformContext, 'function', 'capture behavior not implemented');
  const row = evidence();
  const accepted = api.buildPlatformContext(row, binding, row.origin, now);
  assert.equal(accepted, null, 'legacy pure-JSON multi-platform grant is not server authority');
  row.consent.ad_user_data = 'denied';
  assert.equal(api.buildPlatformContext(row, binding, row.origin, now), null);
});

test('legacy resolver inputs stay off by default and enabled is not an authorization mode', async () => {
  assert.equal(typeof api.loadPlatformContext, 'function', 'server resolver missing');
  const row = evidence(); row.provenance = 'observed_browser';
  let queries = 0;
  const env = { GLP_DB: { prepare(sql) { queries++; assert.match(sql, /JOIN a6_advertising_consent_receipts/); return { bind(...args) {
    assert.equal(args[1], binding.click_token);
    return { first: async () => ({ context_json: JSON.stringify(row), consent_json: JSON.stringify(row.consent), permission_json: JSON.stringify(row.permission) }) };
  } }; } } };
  const request = new Request('https://example.invalid/go/fixture-only?s=test.hero&v=a', {headers: {cookie: `a6_click_handoff=${'a'.repeat(64)}`}});
  assert.equal(await api.loadPlatformContext(request, env, binding, now), null);
  assert.equal(queries, 0);
  env.A6_PLATFORM_CAPTURE_MODE = 'enabled';
  assert.equal(await api.loadPlatformContext(request, env, binding, now), null);
  assert.equal(queries, 0, 'legacy enabled is not TEST authorization');
  row.consent.withdrawn = true;
  assert.equal(await api.loadPlatformContext(request, env, binding, now), null);
});

test('grant and policy scopes cannot be borrowed from a different first-party origin',()=>{
 for(const field of ['consent','permission']) {
  const row=evidence(); row[field].origin='https://another.invalid';
  assert.equal(api.buildPlatformContext(row,binding,row.origin,now),null);
 }
});

test('ordinary /go preserves click identity without attaching or forwarding legacy platform context', async () => {
  const { handleGoRequest } = await import('../src/worker.mjs');
  const row=evidence(); row.network_offer_id='1'; row.network_account_ref='1'; row.provenance='observed_browser';
  row.observed_at_ms=Date.now()-1000; row.expires_at_ms=Date.now()+60000;
  row.consent.expires_at_ms=row.expires_at_ms; row.permission.expires_at_ms=row.expires_at_ms;
  const queries=[];
  const env={ A6_PLATFORM_CAPTURE_MODE:'enabled', AFFILIATE_RUNTIME_MODE:'production', AFFILIATE_LIVE_GATE:'operator-approved:OFFLINE-FIXTURE', CLICK_RATE_LIMITER:{limit:async()=>({success:true})},
    PROGRAM_MANIFEST:{programs:[{program_id:row.program_id,network:'affiliati',network_offer_id:'1',link_mode:'server_redirect',go_route_wired:true,live_link_allowed:true,promotion_authorized:true,status:'live_operator_approved',operator_selection_receipt_sha256:'OFFLINE-FIXTURE',allowed_page_roles:['test'],allowed_positions:['hero'],allowed_variants:['a'],constructor_verified:true,advertiser_permission_verified:true,encoding_verified:true,privacy_qa_passed:true,redirector_tos_verified:true,redirector_tos_source_url:'https://example.invalid/terms',redirector_tos_verified_as_of:'2026-09-09',tracking:{base_url:'https://example.invalid/?a=1&c=1',allowed_tracking_hosts:['example.invalid'],generated_link_readback_verified:true}}]},
    GLP_DB:{prepare(sql){return {bind(...args){queries.push({sql,args});return {first:async()=>({context_json:JSON.stringify(row),consent_json:JSON.stringify(row.consent),permission_json:JSON.stringify(row.permission)}),run:async()=>({success:true})}}}}}
  };
  const request=new Request(`https://example.invalid/go/fixture-only?s=test.hero&v=a&cs_click_id=${row.click_token}`,{headers:{'user-agent':'Mozilla/5.0','cookie':`a6_click_handoff=${'a'.repeat(64)}`}});
  const response=await handleGoRequest(request,env,row.program_id);
  assert.equal(response.headers.get('X-Redirect-Reason'),'affiliate-live');
  const insert=queries.find(q=>q.sql.startsWith('INSERT INTO affiliate_click_map'));
  assert.equal(insert.sql.includes('platform_context_json'), false, 'ordinary INSERT cannot attach platform context');
  assert.equal(insert.sql.includes('is_test'), false, 'ordinary click TEST status is never derived from a grant');
  assert.equal(insert.args.at(-1),'1');
  const target=new URL(response.headers.get('Location'));
  assert.equal(target.searchParams.get('s2'),row.click_token); assert.equal(target.searchParams.get('s1'),'test.hero');
  assert.equal(target.searchParams.has('gclid'),false); assert.equal(target.searchParams.has('msclkid'),false);
  assert.equal(response.headers.get('X-GA4-Server-Event'),'configuration-held');
});
