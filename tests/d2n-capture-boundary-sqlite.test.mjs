import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { handleGoRequest } from '../src/worker.mjs';
import { createHandoff } from '../src/platform-click-handoff.mjs';
import { loadPlatformContext, buildPlatformContext, platformCaptureDisposition } from '../src/platform-click-context.mjs';

// Negative boundary tests only. These legacy-shaped rows are deliberately NOT
// A12 permissions/probe registrations. Never label them a positive capture proof.
const output = mkdtempSync(tmpdir() + '/d2n-sqlite-');
const receipts = [];
let sequence = 0, fetchAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { fetchAttempts++; throw Error('NETWORK_FORBIDDEN'); };
const origin = 'https://example.invalid', receiptId = 'a'.repeat(64), handoffToken = 'b'.repeat(64);
const migrations = ['001_click_map.sql','003_request_rate_limits.sql','006_affiliati_attribution_join.sql','007_postback_scoped_identity.sql','008_platform_click_context.sql'];
function fixture(t, mode, isTest = true) {
  const token = `01992fee-0000-7000-8000-${String(++sequence).padStart(12,'0')}`;
  const file = output + '/' + sequence + '.sqlite';
  const sql = new DatabaseSync(file);
  sql.exec('PRAGMA foreign_keys=ON');
  for (const m of migrations) sql.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  const now = Date.now();
  const binding = { click_token:token,program_id:'fixture-only',network:'affiliati',network_offer_id:'1',network_account_ref:'1' };
  const consent = { origin,receipt_id:receiptId,version:'TEST',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'denied',withdrawn:false,expires_at_ms:now+600000 };
  const permission = { origin,evidence_ref:'TEST-NOT-PERMISSION',program_id:'fixture-only',event_class:'non_sensitive_b2b',allowed_platforms:['microsoft'],expires_at_ms:now+600000,is_test:isTest };
  const context = { ...binding,origin,observed_at_ms:now,expires_at_ms:now+600000,is_test:isTest,probe_ref:'TEST-SPOOF-NOT-REGISTERED',provenance:'observed_browser',identifiers:{msclkid:'TEST_UNREGISTERED'},consent,permission };
  sql.prepare('INSERT INTO a6_advertising_consent_receipts VALUES (?,?)').run(receiptId,JSON.stringify(consent));
  sql.prepare('INSERT INTO a6_platform_event_permissions VALUES (?,?)').run(permission.evidence_ref,JSON.stringify(permission));
  sql.prepare('INSERT INTO a6_platform_click_handoffs VALUES (?,?,?,?,?,?)').run(handoffToken,token,origin,receiptId,permission.evidence_ref,JSON.stringify(context));
  const journal=[];
  const GLP_DB={prepare(statement){return {bind(...args){return {
    async first(){journal.push({statement,operation:'first'});return sql.prepare(statement).get(...args)||null;},
    async run(){journal.push({statement,operation:'run'});const r=sql.prepare(statement).run(...args);return {success:true,meta:{changes:r.changes}};}
  };}};}};
  const program={ program_id:'fixture-only',network:'affiliati',network_offer_id:'1',link_mode:'server_redirect',go_route_wired:true,live_link_allowed:true,promotion_authorized:true,status:'live_operator_approved',operator_selection_receipt_sha256:'TEST-NOT-APPROVAL',allowed_page_roles:['test'],allowed_positions:['hero'],allowed_variants:['a'],constructor_verified:true,advertiser_permission_verified:true,encoding_verified:true,privacy_qa_passed:true,redirector_tos_verified:true,redirector_tos_source_url:origin+'/TEST-terms',redirector_tos_verified_as_of:'2026-09-09',tracking:{base_url:origin+'/?a=1&c=1',allowed_tracking_hosts:['example.invalid'],generated_link_readback_verified:true} };
  const env={GLP_DB,A6_PLATFORM_CAPTURE_MODE:mode,A6_PERMISSION_REF:permission.evidence_ref,AFFILIATE_RUNTIME_MODE:'production',AFFILIATE_LIVE_GATE:'operator-approved:TEST-NOT-APPROVAL',PROGRAM_MANIFEST:{internal_fallback:origin+'/held',programs:[program]}};
  const goPath=`/go/fixture-only?s=test.hero&v=a&cs_click_id=${token}`;
  const request=(headers={})=>new Request(origin+goPath,{headers:{'user-agent':'Mozilla/5.0',cookie:`a6_click_handoff=${handoffToken}`,...headers}});
  t.after(()=>{
    const clicks=sql.prepare('SELECT click_token,is_test,probe_ref,platform_context_json FROM affiliate_click_map').all();
    assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    sql.close();
    receipts.push({mode:mode??null,is_test:isTest??null,clicks,journal,db_path:file,db_sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
  });
  return {sql,env,context,binding,now,journal,request,token,goPath};
}
for (const mode of [undefined,'off','enabled','test_only','TEST_ONLY','test_only ','true',true,1,'real']) {
  test(`no issuer substrate: mode ${String(mode)} never loads legacy context`,async t=>{
    const f=fixture(t,mode);
    assert.equal(await loadPlatformContext(f.request(),f.env,f.binding,f.now),null);
    assert.equal(f.journal.length,0,'no ID-bearing grant/handoff reads before eligibility');
  });
  test(`mode ${String(mode)} preserves ordinary redirect and NULL context`,async t=>{
    const f=fixture(t,mode);const r=await handleGoRequest(f.request(),f.env,'fixture-only');
    assert.equal(r.status,307);assert.equal(r.headers.get('X-Redirect-Reason'),'affiliate-live');
    const url=new URL(r.headers.get('location'));assert.equal(url.searchParams.get('s2'),f.token);
    for(const id of ['gclid','gbraid','wbraid','msclkid','fbclid','fbp','fbc'])assert.equal(url.searchParams.has(id),false);
    const row=f.sql.prepare('SELECT * FROM affiliate_click_map WHERE click_token=?').get(f.token);
    assert.equal(row.platform_context_json,null);assert.equal(row.is_test,null);assert.equal(row.probe_ref,null);
  });
}
for (const isTest of [false,'true',1,null,true]) test(`unregistered ${JSON.stringify(isTest)} cannot manufacture TEST context`,t=>{
  const f=fixture(t,'test_only',isTest);
  assert.equal(buildPlatformContext(f.context,f.binding,origin,f.now),null);
});
for (const mode of ['enabled','test_only']) test(`handoff ${mode}: no body/ID consumption or new receipt`,async t=>{
  const f=fixture(t,mode);f.sql.prepare('DELETE FROM a6_platform_click_handoffs').run();
  const request=new Request(origin+'/api/platform-click-handoff',{method:'POST',headers:{origin,'content-type':'application/json',cookie:`gcs_ads_receipt=${receiptId}`},body:JSON.stringify({go_path:f.goPath,identifiers:{msclkid:'TEST_NEVER_PERSIST'}})});
  const r=await createHandoff(request,f.env);
  assert.equal(r.status,503);assert.equal(request.bodyUsed,false);assert.equal(r.headers.get('set-cookie'),null);
  assert.equal(f.journal.length,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM a6_platform_click_handoffs').get().n,0);
});
test('GPC and non-POST retain explicit refusals',async t=>{
 const f=fixture(t,'test_only');
 assert.equal((await createHandoff(new Request(origin,{method:'POST',headers:{'Sec-GPC':'1'}}),f.env)).status,403);
 assert.equal((await createHandoff(new Request(origin),f.env)).status,405);
});
test('exact mode enum: test_only is recognized but not permission',()=>{
 assert.equal(platformCaptureDisposition({}),'capture_off');
 assert.equal(platformCaptureDisposition({A6_PLATFORM_CAPTURE_MODE:'off'}),'capture_off');
 assert.equal(platformCaptureDisposition({A6_PLATFORM_CAPTURE_MODE:'test_only'}),'capture_environment_denied');
 for(const value of ['enabled','real','TEST_ONLY','test_only ',true,1,null,''])assert.equal(platformCaptureDisposition({A6_PLATFORM_CAPTURE_MODE:value}),'capture_mode_invalid');
});
test.after(()=>{
 globalThis.fetch=originalFetch;assert.equal(fetchAttempts,0);
 writeFileSync(output+'/RECEIPT.json',JSON.stringify({scope:'D2n legacy fail-closed boundary; positive proof in d2n-registered-test-consumer',network_fetch_attempts:fetchAttempts,migrations,fixture_count:receipts.length,receipts},null,2)+'\n');
 console.log('D2N_SQLITE_RECEIPT '+output+'/RECEIPT.json');
});
