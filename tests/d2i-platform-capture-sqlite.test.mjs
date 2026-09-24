// D2i replacement contract: the old enabled/JSON-grant/permission-derived TEST
// positives are prohibited by final A12. Their actual positive successor, full
// SQL CAS/races and original /go gates live in d2n-registered-test-consumer.test.mjs.
// This file preserves executable legacy rejection and deployed-schema evidence;
// no skips or alternate permissive capture implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHandoff } from '../src/platform-click-handoff.mjs';
import { loadPlatformContext } from '../src/platform-click-context.mjs';
for(const mode of ['enabled','test_only'])test(`D2i legacy ${mode} cannot issue a handoff or trust client TEST`,async()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of ['001_click_map.sql','003_request_rate_limits.sql','006_affiliati_attribution_join.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 db.exec('ALTER TABLE affiliate_click_map ADD COLUMN is_test INTEGER; ALTER TABLE affiliate_click_map ADD COLUMN network_account_ref TEXT; ALTER TABLE affiliate_click_map ADD COLUMN probe_ref TEXT;');
 db.exec(readFileSync(new URL('../migrations/008_platform_click_context.sql',import.meta.url),'utf8'));
 let operations=0;
 const env={A6_PLATFORM_CAPTURE_MODE:mode,GLP_DB:{prepare(){operations++;throw Error('unexpected database access');}}};
 const request=new Request('https://example.invalid/api/platform-click-handoff',{method:'POST',headers:{cookie:'gcs_ads_receipt='+'a'.repeat(64),'content-type':'application/json'},body:JSON.stringify({is_test:true,probe_ref:'TEST_SPOOF',identifiers:{msclkid:'TEST_OLD'}})});
 assert.equal((await createHandoff(request,env)).status,503);assert.equal(request.bodyUsed,false);assert.equal(operations,0);
 assert.equal(await loadPlatformContext(new Request('https://example.invalid/go/fixture-only'),env,{is_test:true,probe_ref:'TEST_SPOOF'}),null);
 assert.equal(db.prepare('SELECT count(*) n FROM a6_platform_click_handoffs').get().n,0);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
});
test('D2i fake prefix click cannot replace candidate 001 UUID/c1 grammar',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/001_click_map.sql',import.meta.url),'utf8'));
 assert.throws(()=>db.prepare("INSERT INTO affiliate_click_map (click_token,event_id,page_slug,link_position,program_id,merchant,variant,yyyymm,created_at,ivt_status,ua_class,referrer_class,analytics_consent,ga4_status) VALUES ('TEST_A12_CLICK','TEST','test','hero','fixture','fixture','a','202609','TEST','valid','human','direct','denied','configuration-held')").run(),/CHECK constraint failed/);db.close();
});
