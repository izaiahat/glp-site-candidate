// TEST SUPPORT ONLY. Real staged issuer functions; zero vendor or HTTP egress.
import { fixture, canonical, sha } from '../../tests/helpers/a17-issuer-fixture.mjs';
import { createAdvertisingIssuer, advertisingConsent } from '../../src/advertising-issuer.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns';
const denyNetwork=()=>{throw Error('A17_NETWORK_FORBIDDEN');};
globalThis.fetch=denyNetwork;net.Socket.prototype.connect=denyNetwork;dns.lookup=denyNetwork;
const [platform,input,database,output] = process.argv.slice(2);
assert(['meta','microsoft'].includes(platform));
const row=JSON.parse(readFileSync(input,'utf8'));
const transport=platform==='meta'?'meta_capi':'microsoft_offline';
const f=fixture(null,platform,transport);
try {
  // Define synthetic native codec scope BEFORE review/issuance, never mutate an
  // issued permission to manufacture legacy compatibility.
  f.p.account_id=platform==='meta'?'OFFLINE_ACCOUNT':'189346863';
  f.p.target_id=platform==='meta'?'TEST_A17_META_DATASET':'TEST_GOAL_NOT_PLATFORM_ID';
  f.scope.target_id=f.p.target_id;
  if(platform==='meta')f.p.allowed_payload_fields=f.p.allowed_payload_fields.filter(x=>x!=='event_source_url');
  f.p.payload_schema_sha256=sha(f.p.allowed_payload_fields);
  f.review();
  const issuer=createAdvertisingIssuer(f.env);assert(issuer);
  await issuer.issuePermission(f.p,f.scope);
  const session=await issuer.registerSession({scope_id:f.scope.id,subject_ref:'TEST_A17_UPLOADER_SUBJECT',jurisdiction:'TEST_SUPPORTED',age_policy:'TEST_ADULT',gpc:false});
  const headers={Cookie:session.cookie.split(';')[0],Origin:f.origin};
  let response=await advertisingConsent(new Request(f.origin+'/api/advertising-consent',{headers}),f.env);
  assert.equal(response.status,200);const view=await response.json();
  response=await advertisingConsent(new Request(f.origin+'/api/advertising-consent',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({scope_id:f.scope.id,choice:'explicit_opt_in',csrf:view.csrf})}),f.env);
  assert.equal(response.status,201);
  headers.Cookie+='; '+response.headers.get('set-cookie').split(';')[0];
  const request=new Request(f.origin+'/api/advertising-consent',{headers});
  const a=await issuer.authenticate(request),current=await issuer.currentConsent(request,a);assert(current);
  const p=JSON.parse(f.db.prepare('SELECT permission_json FROM a6_platform_event_permissions WHERE evidence_ref=?').get(f.p.evidence_ref).permission_json);
  const c=current.c; await new Promise(resolve=>setTimeout(resolve,10));
  const now=Date.now(),seconds=Math.floor(now/1000);
  for(const field of ['proof','probe_ref','permission_sha256'])delete row[field];
  if(platform==='meta') {
    row.event_time=seconds;
    row.identifiers={fbc:`fb.1.${seconds*1000}.TEST_A17_SYNTHETIC`,fbp:`fb.1.${seconds*1000}.1234567890`};
    row.identity_receipt.captured_at=seconds;
    Object.assign(row.consent,{granted_at:Math.floor(c.issued_at_ms/1000),checked_at:seconds,expires_at:seconds+120});
  } else {
    row.occurred_at=new Date(now).toISOString();
    row.click.captured_at=new Date(c.issued_at_ms).toISOString();
    row.click.capture_source='synthetic_owned_b2b_inquiry_fixture';
    row.consent.expires_at=new Date(now+120000).toISOString();
    row.commission_minor=0;row.goal_name='TEST_A12_Microsoft_B2BInquiry';
  }
  const scope=Object.fromEntries(['platform','account_id','target_id','origin','source_ref','source_revision','purpose','is_test'].map(k=>[k,p[k]]));
  const source=structuredClone(row);delete source.event_permission;if(source.consent)delete source.consent.checked_at;
  const b={...scope,subject_ref:c.subject_ref,event_name:p.event_name,event_class:p.event_class,probe_ref:p.probe_ref,permission_sha256:sha(p),consent_receipt_id:c.receipt_id,consent_sha256:sha(c),issued_at_ms:now,expires_at_ms:Math.min(c.expires_at_ms,now+120000),revocation_epoch:c.revocation_epoch,status:'REGISTERED',source_sha256:sha(source),source_kind:'TEST_SERVER_OWNED_ADMINISTRATIVE_INQUIRY'};
  // Separate typed wrapper: capture probe wrappers can never be consumed here.
  const wrapper={kind:'a17-uploader-source-v1',probe:b,session_id:session.session_id,permission_ref:p.evidence_ref};
  f.db.prepare('INSERT INTO a17_issuer_probes VALUES (?,?)').run(p.probe_ref,canonical(wrapper));
  assert.equal(f.db.prepare('SELECT probe_json FROM a17_issuer_probes WHERE probe_ref=?').get(p.probe_ref).probe_json,canonical(wrapper));
  row.probe_ref=p.probe_ref;row.permission_sha256=sha(p);
  row.proof={...scope,subject_ref:c.subject_ref,event_name:p.event_name,event_class:p.event_class,permission_ref:p.evidence_ref,consent_receipt_id:c.receipt_id};
  if(platform==='microsoft')row.event_permission=sha(p);
  f.db.prepare('VACUUM INTO ?').run(database);
  writeFileSync(output,JSON.stringify({row,now,records:{permission:p,consent:c,probe:b},issuer_evidence:{permission_issued:true,consent_http_status:201,authoritative_sqlite_export:true,probe_registration:'SERVER_ONLY_TYPED_SYNTHETIC_UPLOADER_FIXTURE',external_requests:0}},null,2));
} finally {f.db.close();}
