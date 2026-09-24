import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, canonical, sha} from './helpers/a17-issuer-fixture.mjs';
import {createHandoff} from '../src/platform-click-handoff.mjs';
import {loadPlatformContext} from '../src/platform-click-context.mjs';
const api = await import('../src/advertising-issuer.mjs').catch(e => { if(e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
test('A17 provides a staging-only issuer, never a default or live issuer', () => {
  assert.equal(typeof api.createAdvertisingIssuer, 'function', 'missing issuer implementation');
  for(const env of [{}, {A6_PLATFORM_CAPTURE_MODE:'test_only'}, {A6_PLATFORM_CAPTURE_MODE:'live', A17_ISSUER_STAGE:'staging'}]) assert.equal(api.createAdvertisingIssuer(env), null);
});
test('review-bound permission issuance persists exact immutable A12b records', async t => {
  const f=fixture(t), issuer=api.createAdvertisingIssuer(f.env);
  assert.equal(typeof issuer.issuePermission,'function','missing durable permission issuer');
  f.review();
  const result=await issuer.issuePermission(f.p,f.scope);
  assert.equal(result.permission_sha256,sha(f.p));
  assert.equal(f.db.prepare('SELECT permission_json FROM a6_platform_event_permissions WHERE evidence_ref=?').get(f.p.evidence_ref).permission_json,canonical(f.p));
  assert.deepEqual(await issuer.issuePermission(f.p,f.scope),result);
  await assert.rejects(()=>issuer.issuePermission({...f.p,revision:2},f.scope));
});
test('session-bound explicit advertising choice issues an HttpOnly digest-only receipt', async t => {
  const f=fixture(t),issuer=api.createAdvertisingIssuer(f.env);f.review();await issuer.issuePermission(f.p,f.scope);
  assert.equal(typeof issuer.registerSession,'function','missing authenticated TEST session registrar');
  const session=await issuer.registerSession({scope_id:f.scope.id,subject_ref:'TEST_A17_SUBJECT',jurisdiction:'TEST_SUPPORTED',age_policy:'TEST_ADULT',gpc:false});
  const request=(method='GET',body=null,cookie=session.cookie)=>new Request(f.origin+'/api/advertising-consent',{method,headers:{origin:f.origin,cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const offered=await (await api.advertisingConsent(request(),f.env)).json();
  assert.equal(offered.scope.id,f.scope.id);assert.equal(offered.receipt,null);
  const response=await api.advertisingConsent(request('POST',{scope_id:f.scope.id,choice:'explicit_opt_in',csrf:offered.csrf}),f.env);
  assert.equal(response.status,201);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/^__Host-gcs_ads_receipt=/);assert.match(cookie,/HttpOnly; Secure; SameSite=Strict; Path=\//);
  const token=cookie.split(';')[0].split('=')[1];
  const row=f.db.prepare('SELECT * FROM a6_advertising_consent_receipts').get();
  assert.equal(row.receipt_id,sha(token));assert.ok(!row.consent_json.includes(token));
  const c=JSON.parse(row.consent_json);assert.equal(c.is_test,true);assert.equal(c.ad_personalization,'denied');assert.equal(c.subject_ref,'TEST_A17_SUBJECT');
  const current=await (await api.advertisingConsent(request('GET',null,session.cookie+'; '+cookie.split(';')[0]),f.env)).json();
  assert.equal(current.receipt.choice,'explicit_opt_in');assert.equal(current.receipt.scope_id,f.scope.id);
});
async function grant(t,platform='meta',transport='capture') {
  const f=fixture(t,platform,transport),issuer=api.createAdvertisingIssuer(f.env);f.review();await issuer.issuePermission(f.p,f.scope);
  const session=await issuer.registerSession({scope_id:f.scope.id,subject_ref:'TEST_A17_SUBJECT',jurisdiction:'TEST_SUPPORTED',age_policy:'TEST_ADULT',gpc:false});
  let cookies=session.cookie.split(';')[0];
  const request=(path='/api/advertising-consent',method='GET',body=null,headers={})=>new Request(f.origin+path,{method,headers:{origin:f.origin,cookie:cookies,'content-type':'application/json',...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  const offered=await (await api.advertisingConsent(request(),f.env)).json();
  const response=await api.advertisingConsent(request(undefined,'POST',{scope_id:f.scope.id,choice:'explicit_opt_in',csrf:offered.csrf}),f.env);assert.equal(response.status,201);
  cookies+='; '+response.headers.get('set-cookie').split(';')[0];
  return {...f,issuer,request,csrf:offered.csrf,cookies};
}
test('withdrawal advances authoritative epoch and cannot be undone by a copied consent row',async t=>{
  const f=await grant(t);
  assert.equal(typeof api.revokeAdvertisingConsent,'function','missing authoritative revoke endpoint');
  const before=f.db.prepare('SELECT * FROM a6_advertising_consent_receipts').get();
  const response=await api.revokeAdvertisingConsent(f.request('/api/advertising-consent/revoke','POST',{csrf:f.csrf}),f.env);
  assert.equal(response.status,200);assert.equal((await response.json()).acknowledged,true);
  assert.equal(f.db.prepare('SELECT epoch FROM a17_issuer_revocations').get().epoch,1);
  assert.deepEqual(f.db.prepare('SELECT * FROM a6_advertising_consent_receipts').get(),before,'immutable consent evidence preserved');
  assert.equal((await api.advertisingConsent(f.request(),f.env)).status,503);
  assert.equal((await api.advertisingConsent(f.request(undefined,'POST',{scope_id:f.scope.id,choice:'explicit_opt_in',csrf:f.csrf}),f.env)).status,503);
  assert.equal((await api.revokeAdvertisingConsent(f.request('/api/advertising-consent/revoke','POST',{csrf:f.csrf}),f.env)).status,200);
  assert.equal(f.db.prepare('SELECT epoch FROM a17_issuer_revocations').get().epoch,1,'idempotent revoke');
});
async function registered(t,platform='meta') {
  const f=await grant(t,platform),binding={click_token:'01992fee-0000-7000-8000-000000000017',program_id:'fixture-only',network:'affiliati',network_offer_id:'1',network_account_ref:'1'};
  f.db.prepare("INSERT INTO affiliate_click_map (click_token,event_id,page_slug,link_position,program_id,merchant,network,network_offer_id,variant,yyyymm,created_at,ivt_status,ua_class,referrer_class,analytics_consent,ga4_status,is_test,network_account_ref,probe_ref) VALUES (?,?, 'test','hero',? ,?, ?,?,'a','202609',?,'valid','human','direct','denied','configuration-held',1,?,?)").run(binding.click_token,binding.click_token,binding.program_id,binding.program_id,binding.network,binding.network_offer_id,new Date().toISOString(),binding.network_account_ref,f.p.probe_ref);
  const go_path='/go/fixture-only?s=test.hero&v=a&cs_click_id='+binding.click_token;
  assert.equal(typeof f.issuer.registerProbe,'function','missing registered TEST probe issuer');
  await f.issuer.registerProbe(f.request(),{binding,go_path,operator_authorization_ref:'TEST_A17_ASSIGNED_PROBE'});
  return {...f,binding,go_path};
}
test('registered TEST handoff persists once and reaches existing CAS consumer without a global permission pointer',async t=>{
  const f=await registered(t);
  const body={csrf:f.csrf,go_path:f.go_path,identifiers:{fbclid:'TEST_A17_OBSERVED'}};
  const response=await createHandoff(f.request('/api/platform-click-handoff','POST',body),f.env);
  assert.equal(response.status,201);const hc=response.headers.get('set-cookie').split(';')[0];
  const h=f.db.prepare('SELECT * FROM a6_platform_click_handoffs').get();assert.equal(JSON.parse(h.context_json).is_test,true);
  const req=new Request(f.origin+f.go_path,{headers:{origin:f.origin,cookie:f.cookies+'; '+hc}});
  const captured=await loadPlatformContext(req,f.env,f.binding);
  assert.equal(captured?.is_test,true,'issuer-issued context not accepted by actual consumer');
  assert.equal(captured.identifiers.fbclid,body.identifiers.fbclid);
  assert.equal(f.db.prepare('SELECT is_test FROM affiliate_click_map').get().is_test,1);
  const replay=await createHandoff(f.request('/api/platform-click-handoff','POST',body,{cookie:f.cookies+'; '+hc}),f.env);assert.equal(replay.status,200);
  assert.equal((await createHandoff(f.request('/api/platform-click-handoff','POST',{...body,identifiers:{fbclid:'TEST_CHANGED'}},{cookie:f.cookies+'; '+hc}),f.env)).status,409);
});
test('public Pages consent and revoke routes delegate to the real issuer, absent issuer 503',async()=>{
  for(const file of ['../functions/api/advertising-consent.js','../functions/api/advertising-consent/revoke.js']){
    const route=await import(file).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
    assert.equal(typeof route.onRequest,'function','missing Pages route '+file);
    assert.equal((await route.onRequest({request:new Request('https://a17-meta.invalid/api/advertising-consent',{method:'POST'}),env:{}})).status,503);
  }
});
for(const platform of ['meta','microsoft','google'])test('full issuer schema rejects each missing permission field '+platform,async t=>{
  const f=fixture(t,platform),issuer=api.createAdvertisingIssuer(f.env);f.review();
  for(const field of Object.keys(f.p)){const p={...f.p};delete p[field];assert.equal(api.validIssuerRecord(p,'permission'),false,field);await assert.rejects(()=>issuer.issuePermission(p,f.scope),field);}
  assert.equal(f.db.prepare('SELECT count(*) n FROM a6_platform_event_permissions').get().n,0);
});
for(const kind of ['no-review','review-hash','false-test','wrong-transport','wrong-origin','unknown-purpose','consumer-source','wrong-target','unhealthy-purge','unknown-retention','expired'])test('permission fail-closed '+kind,async t=>{
  const f=fixture(t,'microsoft','microsoft_uet'),issuer=api.createAdvertisingIssuer(f.env);
  if(kind==='false-test')f.p.is_test=false;
  if(kind==='wrong-transport')f.scope.transport='microsoft_offline';
  if(kind==='wrong-origin')f.p.origin='https://glpclinicscout.com';
  if(kind==='unknown-purpose')f.p.purpose='analytics';
  if(kind==='consumer-source')f.p.source_type='quiz_complete';
  if(kind==='wrong-target')f.p.target_id='160554000';
  if(kind==='unhealthy-purge')f.scope.purge_healthy_until_ms=0;
  if(kind==='unknown-retention')f.scope.retention_approved=null;
  if(kind==='expired')f.p.expires_at_ms=f.now-1;
  if(kind!=='no-review')f.review();
  if(kind==='review-hash')f.p.notice_sha256='a'.repeat(64);
  await assert.rejects(()=>issuer.issuePermission(f.p,f.scope));
  assert.equal(f.db.prepare('SELECT count(*) n FROM a6_platform_event_permissions').get().n,0);
});
for(const [label,headers] of [['cross-origin',{origin:'https://evil.invalid'}],['no-origin',{origin:''}],['GPC',{'Sec-GPC':'1'}],['no-cookie',{cookie:''}],['legacy',{cookie:'gcs_ads_receipt=fake'}],['wrong-type',{'content-type':'text/plain'}]])test('consent HTTP rejects '+label,async t=>{
  const f=await grant(t),before=f.db.prepare('SELECT count(*) n FROM a6_advertising_consent_receipts').get().n;
  const r=await api.advertisingConsent(f.request(undefined,'POST',{scope_id:f.scope.id,choice:'explicit_opt_in',csrf:f.csrf},headers),f.env);
  assert.ok([403,503].includes(r.status));assert.equal(r.headers.get('set-cookie'),null);assert.equal(f.db.prepare('SELECT count(*) n FROM a6_advertising_consent_receipts').get().n,before);
});
for(const field of ['is_test','probe_ref','permission_ref','issuer_id','reviewer_id','account_id','target_id','expires_at_ms','ad_user_data'])test('client authority field refused '+field,async t=>{
  const f=await grant(t);
  assert.equal((await api.advertisingConsent(f.request(undefined,'POST',{scope_id:f.scope.id,choice:'explicit_opt_in',csrf:f.csrf,[field]:'FORGED'}),f.env)).status,503);
});
test('duplicate client JSON keys are rejected instead of last-value normalization',async t=>{
  const f=fixture(t),issuer=api.createAdvertisingIssuer(f.env);f.review();await issuer.issuePermission(f.p,f.scope);
  const s=await issuer.registerSession({scope_id:f.scope.id,subject_ref:'TEST_A17_SUBJECT',jurisdiction:'TEST_SUPPORTED',age_policy:'TEST_ADULT',gpc:false});
  const request=body=>new Request(f.origin+'/api/advertising-consent',{method:body?'POST':'GET',headers:{origin:f.origin,cookie:s.cookie.split(';')[0],'content-type':'application/json'},...(body?{body}:{})});
  const v=await(await api.advertisingConsent(request(),f.env)).json();
  const body=JSON.stringify({scope_id:f.scope.id,choice:'explicit_opt_in',csrf:v.csrf}).replace('{','{"choice":"denied",');
  assert.equal((await api.advertisingConsent(request(body),f.env)).status,503);
  assert.equal(f.db.prepare('SELECT count(*) n FROM a6_advertising_consent_receipts').get().n,0);
});
for(const mutation of ['no-probe','not-test','wrong-probe','wrong-tuple','withdrawn','expired','wrong-identifiers','client-test','body-too-large','csrf','missing-cookie','duplicate-cookie','missing-db','production-mode'])test('handoff hostile control '+mutation,async t=>{
  const f=await registered(t),body={csrf:f.csrf,go_path:f.go_path,identifiers:{fbclid:'TEST_A17_OBSERVED'}},headers={};
  if(mutation==='no-probe')f.db.exec('DELETE FROM a17_issuer_probes');
  if(mutation==='not-test')f.db.exec('UPDATE affiliate_click_map SET is_test=0');
  if(mutation==='wrong-probe')f.db.exec("UPDATE affiliate_click_map SET probe_ref='TEST_OTHER'");
  if(mutation==='wrong-tuple')f.db.exec("UPDATE affiliate_click_map SET network_account_ref='2'");
  if(mutation==='withdrawn')await api.revokeAdvertisingConsent(f.request('/api/advertising-consent/revoke','POST',{csrf:f.csrf}),f.env);
  if(mutation==='expired'){const c=JSON.parse(f.db.prepare('SELECT consent_json FROM a6_advertising_consent_receipts').get().consent_json);c.expires_at_ms=1;f.db.prepare('UPDATE a6_advertising_consent_receipts SET consent_json=?').run(canonical(c));}
  if(mutation==='wrong-identifiers')body.identifiers={email:'TEST_A17_email'};
  if(mutation==='client-test')body.is_test=true;
  if(mutation==='body-too-large')body.identifiers.fbclid='TEST_'+'x'.repeat(5000);
  if(mutation==='csrf')body.csrf='invalid';
  if(mutation==='missing-cookie')headers.cookie='';
  if(mutation==='duplicate-cookie')headers.cookie=f.cookies+'; '+f.cookies;
  if(mutation==='missing-db')delete f.env.GLP_DB;
  if(mutation==='production-mode')f.env.A6_PLATFORM_CAPTURE_MODE='live';
  const response=await createHandoff(f.request('/api/platform-click-handoff','POST',body,headers),f.env);
  assert.ok([409,503].includes(response.status));assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM a6_platform_click_handoffs').get().n,0);
  assert.equal(f.db.prepare('SELECT platform_context_json FROM affiliate_click_map').get().platform_context_json,null);
});
test('withdrawal during reserved handoff prevents write and regrant cannot replay old capture',async t=>{
  const f=await registered(t);f.beforeBatch(()=>f.db.exec('UPDATE a17_issuer_revocations SET epoch=epoch+1'));
  const response=await createHandoff(f.request('/api/platform-click-handoff','POST',{csrf:f.csrf,go_path:f.go_path,identifiers:{fbclid:'TEST_A17_OBSERVED'}}),f.env);
  assert.equal(response.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM a6_platform_click_handoffs').get().n,0);
});
test('committed handoff timeout reconciles one exact key; lost cookie never silently reissues',async t=>{
  const f=await registered(t);f.ambiguous();const body={csrf:f.csrf,go_path:f.go_path,identifiers:{fbclid:'TEST_A17_OBSERVED'}};
  const response=await createHandoff(f.request('/api/platform-click-handoff','POST',body),f.env);assert.equal(response.status,201);
  assert.equal(f.db.prepare('SELECT count(*) n FROM a6_platform_click_handoffs').get().n,1);
  assert.equal((await createHandoff(f.request('/api/platform-click-handoff','POST',body),f.env)).status,409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM a6_platform_click_handoffs').get().n,1);
});
test('revocation purges context and restored old handoff cannot defeat authoritative epoch',async t=>{
  const f=await registered(t),response=await createHandoff(f.request('/api/platform-click-handoff','POST',{csrf:f.csrf,go_path:f.go_path,identifiers:{fbclid:'TEST_A17_OBSERVED'}}),f.env);
  const h=f.db.prepare('SELECT * FROM a6_platform_click_handoffs').get(),cookies=f.cookies+'; '+response.headers.get('set-cookie').split(';')[0];
  const req=new Request(f.origin+f.go_path,{headers:{origin:f.origin,cookie:cookies}});
  assert.ok(await loadPlatformContext(req,f.env,f.binding));
  assert.equal((await api.revokeAdvertisingConsent(f.request('/api/advertising-consent/revoke','POST',{csrf:f.csrf}),f.env)).status,200);
  assert.equal(f.db.prepare('SELECT platform_context_json FROM affiliate_click_map').get().platform_context_json,null);
  f.db.prepare('INSERT INTO a6_platform_click_handoffs VALUES (?,?,?,?,?,?)').run(h.handoff_token,h.click_token,h.origin,h.consent_receipt_id,h.permission_ref,h.context_json);
  assert.equal(await loadPlatformContext(req,f.env,f.binding),null);
});
test('retention worker expiry cannot prevent a previously authenticated withdrawal',async t=>{
  const f=await grant(t);const s={...f.scope,purge_healthy_until_ms:0};f.db.prepare('UPDATE a17_issuer_scopes SET scope_json=?').run(canonical(s));
  assert.equal((await api.advertisingConsent(f.request(),f.env)).status,503);
  assert.equal((await api.revokeAdvertisingConsent(f.request('/api/advertising-consent/revoke','POST',{csrf:f.csrf}),f.env)).status,200);
});
test('notice bytes must match the reviewed notice digest before issuance',async t=>{
  const f=fixture(t);f.scope.notice+=' unreviewed alteration';f.review();
  await assert.rejects(()=>api.createAdvertisingIssuer(f.env).issuePermission(f.p,f.scope));
});
test('revocation cannot acknowledge a missing authoritative epoch readback',async t=>{
  const f=await grant(t);f.beforeBatch(()=>f.db.exec('DELETE FROM a17_issuer_revocations'));
  const response=await api.revokeAdvertisingConsent(f.request('/api/advertising-consent/revoke','POST',{csrf:f.csrf}),f.env);
  assert.equal(response.status,503);assert.equal((await response.json()).acknowledged,false);
});
test('regrant requires a fresh reviewed permission and session; old receipt stays revoked',async t=>{
  const f=await grant(t),oldRef=f.p.evidence_ref;
  await api.revokeAdvertisingConsent(f.request('/api/advertising-consent/revoke','POST',{csrf:f.csrf}),f.env);
  f.p.evidence_ref+='v2';f.p.review_ref+='v2';f.p.probe_ref+='v2';f.p.revision=2;
  f.scope.id+='v2';f.scope.permission_ref=f.p.evidence_ref;f.scope.review_ref=f.p.review_ref;f.review();
  await f.issuer.issuePermission(f.p,f.scope);
  const session=await f.issuer.registerSession({scope_id:f.scope.id,subject_ref:'TEST_A17_SUBJECT',jurisdiction:'TEST_SUPPORTED',age_policy:'TEST_ADULT',gpc:false});
  const headers={cookie:session.cookie.split(';')[0]};
  const view=await(await api.advertisingConsent(f.request(undefined,'GET',null,headers),f.env)).json();
  const response=await api.advertisingConsent(f.request(undefined,'POST',{scope_id:f.scope.id,choice:'explicit_opt_in',csrf:view.csrf},headers),f.env);
  assert.equal(response.status,201);headers.cookie+='; '+response.headers.get('set-cookie').split(';')[0];
  assert.equal((await(await api.advertisingConsent(f.request(undefined,'GET',null,headers),f.env)).json()).receipt.scope_revision,2);
  assert.equal((await api.advertisingConsent(f.request(),f.env)).status,503);
  assert.equal(f.db.prepare('SELECT epoch FROM a17_issuer_revocations WHERE permission_ref=?').get(oldRef).epoch,1);
});
