// Server-only TEST probe registration and the bounded HTTP handoff consumer.
import { canonical, digest, parseCanonical, hostCookie, issuerReply } from './advertising-issuer.mjs';
const TUPLE='click_token program_id network network_offer_id network_account_ref'.split(' ');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const nonce=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const read=(env,sql,...args)=>env.GLP_DB.prepare(sql).bind(...args).first();
export function authorityGuard(a) {
  return {sql:`EXISTS (SELECT 1 FROM a17_issuer_revocations WHERE subject_ref=? AND permission_ref=? AND epoch=?) AND EXISTS (SELECT 1 FROM a17_issuer_sessions WHERE session_id=? AND session_json=?) AND EXISTS (SELECT 1 FROM a17_issuer_scopes WHERE scope_id=? AND scope_json=?) AND EXISTS (SELECT 1 FROM a17_issuer_reviews WHERE review_ref=? AND review_json=?) AND EXISTS (SELECT 1 FROM a6_platform_event_permissions WHERE evidence_ref=? AND permission_json=?) AND EXISTS (SELECT 1 FROM a6_advertising_consent_receipts WHERE receipt_id=? AND consent_json=?) AND ? > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)`,args:[a.c.subject_ref,a.p.evidence_ref,a.epoch,a.session.session_id,a.sessionRow.session_json,a.s.id,a.row.scope_json,a.p.review_ref,a.row.review_json,a.p.evidence_ref,a.row.permission_json,a.c.receipt_id,a.consentRow.consent_json,Math.min(a.p.expires_at_ms,a.c.expires_at_ms,a.s.expires_at_ms,a.s.purge_healthy_until_ms,a.session.expires_at_ms)]};
}
async function auth(issuer,request,allowSearch=false) {
  const a=await issuer.authenticate(request,{allowSearch}),c=await issuer.currentConsent(request,a);
  if(!c||a.s.transport!=='capture'||a.p.source_type!=='synthetic_go_probe'||a.p.event_class!=='synthetic_transport_probe')throw Error('capture_scope_denied');
  return {...a,c:c.c,consentRow:c.row};
}
function validGo(path,binding,origin) {
  if(typeof path!=='string'||!path.startsWith('/go/'))return false;
  const u=new URL(path,origin);
  return u.origin===origin&&u.pathname==='/go/'+binding.program_id&&!u.hash&&
    [...u.searchParams.keys()].sort().join(',')==='cs_click_id,s,v'&&u.searchParams.get('cs_click_id')===binding.click_token&&u.searchParams.get('s')==='test.hero'&&u.searchParams.get('v')==='a';
}
export async function registerTestProbe(env,issuer,request,input) {
  const a=await auth(issuer,request),p=a.p,c=a.c,now=Date.now();
  if(!exact(input,['binding','go_path','operator_authorization_ref'])||!exact(input.binding,TUPLE)||TUPLE.some(k=>typeof input.binding[k]!=='string'||!input.binding[k])||!/^TEST_[A-Za-z0-9_-]+$/.test(input.operator_authorization_ref)||!validGo(input.go_path,input.binding,p.origin))throw Error('probe_registration_denied');
  const click=await read(env,'SELECT * FROM affiliate_click_map WHERE click_token=?',input.binding.click_token);
  if(!click||click.is_test!==1||click.probe_ref!==p.probe_ref||click.event_id!==input.binding.click_token||click.page_slug!=='test'||click.link_position!=='hero'||click.variant!=='a'||click.platform_context_json!==null||TUPLE.some(k=>click[k]!==input.binding[k]))throw Error('independent_test_click_required');
  const q={schema:'a12-registered-test-probe-v1',probe_ref:p.probe_ref,authority:'SERVER_REGISTERED_TEST',origin:p.origin,subject_ref:c.subject_ref,platform:p.platform,account_id:p.account_id,target_id:p.target_id,source_ref:p.source_ref,source_revision:p.source_revision,event_name:p.event_name,permission_sha256:await digest(p),consent_receipt_id:c.receipt_id,consent_sha256:await digest(c),binding:input.binding,is_test:true,issued_at_ms:now,expires_at_ms:Math.min(now+900000,p.expires_at_ms,c.expires_at_ms),capture_limit:1,revocation_epoch:a.epoch,operator_authorization_ref:input.operator_authorization_ref,environment:'server_registered_test',mode:'TEST',provenance:'server_registered_test'};
  const wrapper={probe:q,session_id:a.session.session_id,permission_ref:p.evidence_ref,go_path:input.go_path},bytes=canonical(wrapper),g=authorityGuard(a);
  try{await env.GLP_DB.batch([env.GLP_DB.prepare(`INSERT INTO a17_issuer_probes SELECT ?,? WHERE ${g.sql} AND EXISTS (SELECT 1 FROM affiliate_click_map WHERE click_token=? AND is_test=1 AND probe_ref=? AND platform_context_json IS NULL AND program_id=? AND network=? AND network_offer_id=? AND network_account_ref=? AND page_slug='test' AND link_position='hero' AND variant='a')`).bind(p.probe_ref,bytes,...g.args,...[input.binding.click_token,p.probe_ref,...TUPLE.slice(1).map(k=>input.binding[k])])]);}catch{}
  if((await read(env,'SELECT probe_json FROM a17_issuer_probes WHERE probe_ref=?',p.probe_ref))?.probe_json!==bytes)throw Error('probe_conflict_or_reconcile');
  return {probe_ref:p.probe_ref,is_test:true};
}
async function probeAuthority(env,issuer,request,allowSearch=false) {
  const a=await auth(issuer,request,allowSearch),stored=await read(env,'SELECT probe_json FROM a17_issuer_probes WHERE probe_ref=?',a.p.probe_ref),w=parseCanonical(stored?.probe_json),q=w.probe,now=Date.now();
  if(!exact(w,['probe','session_id','permission_ref','go_path'])||w.session_id!==a.session.session_id||w.permission_ref!==a.p.evidence_ref||q.is_test!==true||q.probe_ref!==a.p.probe_ref||q.consent_receipt_id!==a.c.receipt_id||q.consent_sha256!==await digest(a.c)||q.permission_sha256!==await digest(a.p)||q.subject_ref!==a.c.subject_ref||q.revocation_epoch!==a.epoch||q.issued_at_ms<a.c.issued_at_ms||q.issued_at_ms>now||q.expires_at_ms<=now||q.capture_limit!==1||q.mode!=='TEST'||q.environment!=='server_registered_test'||!validGo(w.go_path,q.binding,a.p.origin))throw Error('registered_probe_denied');
  return {...a,w,q,stored};
}
export async function createRegisteredHandoff(env,issuer,request,input) {
  const a=await probeAuthority(env,issuer,request),p=a.p,c=a.c,q=a.q;
  if(!exact(input,['csrf','go_path','identifiers'])||input.csrf!==a.csrf||input.go_path!==a.w.go_path||!input.identifiers||typeof input.identifiers!=='object'||Array.isArray(input.identifiers)||!Object.keys(input.identifiers).length||Object.keys(input.identifiers).some(k=>!p.allowed_identifiers.capture.includes(k))||Object.values(input.identifiers).some(v=>typeof v!=='string'||!/^TEST_[A-Za-z0-9._~-]{1,500}$/.test(v)))throw Error('handoff_input_denied');
  const old=await read(env,'SELECT * FROM a6_platform_click_handoffs WHERE click_token=?',q.binding.click_token);
  if(old){const presented=hostCookie(request,'__Host-gcs_click_handoff'),h=parseCanonical(old.context_json);return issuerReply(presented&&await digest(presented)===old.handoff_token&&canonical(h.event.identifiers)===canonical(input.identifiers)&&h.expires_at_ms>Date.now()?200:409,{state:'EXISTING_OR_CONFLICT',retry:false});}
  const raw=nonce(),id=await digest(raw),now=Date.now(),expires=Math.min(now+120000,q.expires_at_ms,c.expires_at_ms,p.expires_at_ms,a.s.purge_healthy_until_ms);
  const v={schema:'a12-synthetic-go-event-v1',origin:p.origin,subject_ref:c.subject_ref,platform:p.platform,account_id:p.account_id,target_id:p.target_id,source_type:p.source_type,source_ref:p.source_ref,source_revision:p.source_revision,event_name:p.event_name,purpose:p.purpose,probe_ref:p.probe_ref,binding:q.binding,is_test:true,provenance:'server_registered_test',identifiers:input.identifiers,observed_at_ms:now,expires_at_ms:expires};
  const h={schema:'a12-platform-click-handoff-v1',environment:'server_registered_test',mode:'TEST',is_test:true,probe_ref:p.probe_ref,permission_sha256:await digest(p),issued_at_ms:now,expires_at_ms:expires,probe:q,event:v},bytes=canonical(h),g=authorityGuard(a);
  try{await env.GLP_DB.batch([env.GLP_DB.prepare(`INSERT INTO a6_platform_click_handoffs SELECT ?,?,?,?,?,? WHERE ${g.sql} AND EXISTS (SELECT 1 FROM a17_issuer_probes WHERE probe_ref=? AND probe_json=?) AND EXISTS (SELECT 1 FROM affiliate_click_map WHERE click_token=? AND event_id=? AND is_test=1 AND probe_ref=? AND platform_context_json IS NULL AND program_id=? AND network=? AND network_offer_id=? AND network_account_ref=? AND page_slug='test' AND link_position='hero' AND variant='a') AND ? > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)`).bind(id,q.binding.click_token,p.origin,c.receipt_id,p.evidence_ref,bytes,...g.args,p.probe_ref,a.stored.probe_json,q.binding.click_token,q.binding.click_token,p.probe_ref,...TUPLE.slice(1).map(k=>q.binding[k]),expires)]);}catch{}
  const check=await read(env,'SELECT context_json FROM a6_platform_click_handoffs WHERE handoff_token=?',id);
  if(check?.context_json!==bytes)return issuerReply(409,{state:'RECONCILE',retry:false});
  await probeAuthority(env,issuer,request);
  return issuerReply(201,{state:'HANDOFF_STORED',is_test:true},`__Host-gcs_click_handoff=${raw}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.max(0,Math.floor((expires-Date.now())/1000))}`);
}
export async function captureAuthority(env,issuer,request,binding) {
  const a=await probeAuthority(env,issuer,request,true);
  if(TUPLE.some(k=>binding[k]!==a.q.binding[k])||new URL(request.url).pathname+new URL(request.url).search!==a.w.go_path)throw Error('capture_binding_denied');
  const g=authorityGuard(a);
  return {permission_ref:a.p.evidence_ref,sql:g.sql+` AND EXISTS (SELECT 1 FROM a17_issuer_probes WHERE probe_ref=? AND probe_json=?)`,args:[...g.args,a.p.probe_ref,a.stored.probe_json]};
}
