import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { canonicalPermissionJSON as canonical, A12B_PLATFORMS } from '../../src/a12-permission-contract.mjs';
export { canonical };
export const sha = x => createHash('sha256').update(typeof x === 'string' ? x : canonical(x)).digest('hex');
export function fixture(t, platform='meta', transport='capture') {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../fixtures/a17-q48.sql',import.meta.url),'utf8'));
  const migration = new URL('../../migrations/009_a17_staging_issuer.sql',import.meta.url);
  if(existsSync(migration)) db.exec(readFileSync(migration,'utf8'));
  let beforeBatch=null, failRead=false, ambiguous=false;
  const journal=[];
  const GLP_DB = { prepare(sql) { const make = args => ({
    sql,args, bind(...params){ return make(params); },
    async first(){ if(failRead)throw Error('TEST_DB_UNAVAILABLE'); journal.push({op:'read',sql}); return db.prepare(sql).get(...args)||null; },
    async all(){ if(failRead)throw Error('TEST_DB_UNAVAILABLE'); return {results:db.prepare(sql).all(...args)}; },
    async run(){ journal.push({op:'write',sql}); const r=db.prepare(sql).run(...args); return {success:true,meta:{changes:r.changes}}; }
  }); return make([]); }, async batch(statements){
    if(beforeBatch){const hook=beforeBatch;beforeBatch=null;hook();}
    db.exec('BEGIN IMMEDIATE');
    try {const out=[];for(const s of statements) out.push(await s.run());db.exec('COMMIT');if(ambiguous){ambiguous=false;throw Error('TEST_COMMITTED_TIMEOUT');}return out;}
    catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
  }};
  const now=Date.now(), origin=`https://a17-${platform}.invalid`;
  const fields=A12B_PLATFORMS[platform];
  const p={schema:'a12-platform-permission-v1',evidence_ref:`TEST_A17_${platform}_${transport}_v1`,revision:1,status:'ELIGIBLE',issuer_id:'TEST_A17_PERMISSION_ISSUER',review_ref:'TEST_A17_REVIEW',reviewer_id:'TEST_A17_INDEPENDENT_REVIEW_FIXTURE',platform,account_id:`TEST_A17_${platform}_ACCOUNT`,target_id:transport==='meta_pixel'?'586886932687286':transport==='microsoft_uet'?'187271853':`TEST_A17_${platform}_TARGET`,origin,source_ref:`TEST_A17_${transport}_SOURCE`,source_revision:'TEST_A17_REV1',purpose:'ad_measurement',is_test:true,probe_ref:`TEST_A17_${platform}_${transport}_PROBE`,issued_at_ms:now-1000,expires_at_ms:now+600000,revocation_epoch:0,source_type:transport==='capture'?'synthetic_go_probe':'owned_b2b_inquiry',event_class:transport==='capture'?'synthetic_transport_probe':'non_sensitive_b2b',event_definition:'TEST_A17_SYNTHETIC_SOURCE_NOT_REAL_APPROVAL',event_name:`TEST_A12_${platform==='meta'?'Meta':platform==='microsoft'?'Microsoft':'Google'}_${transport==='capture'?'CaptureProbe':'B2BInquiry'}`,allowed_identifiers:structuredClone(fields.identifiers),allowed_payload_fields:[...fields.payload],ownership_evidence_ref:'TEST_A17_OWNERSHIP',lawful_basis_review_ref:'TEST_A17_BASIS',tos_refs:[{source_id:'TEST_A17_SOURCE',requested_url:'https://source.invalid/',final_url:'https://source.invalid/',retrieved_on:'2026-09-09',effective_date:null,version_label:'NOT_OBSERVED',captured_sha256:sha('TEST_A17_SOURCE'),scope_review_ref:'TEST_A17_SCOPE_REVIEW',account_acceptance_ref:'TEST_A17_FICTIONAL_ACCEPTANCE_NOT_REAL',reviewed_at_ms:now-1000}],notice_version:'TEST_A17_NOTICE_V1',notice_sha256:sha('TEST_A17_NOTICE'),retention_policy_ref:'TEST_A17_RETENTION',erasure_owner:'TEST_A17_ERASURE',transport_contract_ref:`TEST_A17_${transport}`,payload_schema_sha256:sha(fields.payload)};
  const scope={id:`TEST_A17_SCOPE_${platform}_${transport}`,permission_ref:p.evidence_ref,transport,notice:'TEST fixture only. Optional advertising measurement with '+platform+'. No audience creation. Expires in fifteen minutes; withdraw using cookie choices. Not a real approval.',source_path:'/test/administrative/',source_title:'TEST administrative fixture',source_ref:p.source_ref,source_revision:p.source_revision,origin,platform,target_id:p.target_id,containment:true,notice_approved:true,retention_approved:true,purge_healthy_until_ms:now+600000,expires_at_ms:p.expires_at_ms,allowed_referrer:'',review_ref:p.review_ref};
  p.notice_sha256=sha(scope.notice);
  const env={GLP_DB,A17_ISSUER_STAGE:'staging',A17_ISSUER_ORIGIN:origin,A6_PLATFORM_CAPTURE_MODE:'test_only',A6_PLATFORM_CAPTURE_ENVIRONMENT:'server_registered_test',A6_PERMISSION_ISSUER_ID:p.issuer_id,A6_CONSENT_ISSUER_ID:'TEST_A17_CONSENT_ISSUER'};
  const review=()=>db.prepare('INSERT OR REPLACE INTO a17_issuer_reviews VALUES (?,?)').run(p.review_ref,canonical({review_ref:p.review_ref,reviewer_id:p.reviewer_id,permission_sha256:sha(p),scope_sha256:sha(scope),is_test:true,status:'STAGING_FIXTURE_ONLY',expires_at_ms:p.expires_at_ms}));
  t?.after(()=>db.close());
  return {db,env,p,scope,review,journal,now,origin,beforeBatch:f=>beforeBatch=f,failReads:v=>failRead=v,ambiguous:()=>ambiguous=true};
}
