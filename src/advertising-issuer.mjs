// A17 is staging-only. Configuration cannot activate REAL capture or live issuance.
import { canonicalPermissionJSON as canonical, validA12bVocabulary } from './a12-permission-contract.mjs';
import { issuerSchema } from './a17-issuer-schema.mjs';
import { registerTestProbe, createRegisteredHandoff, captureAuthority } from './advertising-issuer-probe.mjs';
export { canonical };
export async function digest(value) {
  const input = typeof value === 'string' ? value : canonical(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function parseCanonical(bytes) {
  if(typeof bytes !== 'string' || bytes.length > 32768) throw Error('invalid_record');
  const value=JSON.parse(bytes);
  if(canonical(value)!==bytes) throw Error('noncanonical_or_duplicate_json');
  return value;
}
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const text=x=>typeof x==='string'&&x.length>0;
const token=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const cookie=(name,value,max=900)=>`${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${max}`;
export function hostCookie(request,name) {
  const found={};
  for(const part of (request.headers.get('Cookie')||'').split(';')){
    const at=part.indexOf('='),key=(at<0?part:part.slice(0,at)).trim();
    if(['gcs_ads_receipt','a6_click_handoff'].includes(key))throw Error('legacy_cookie');
    if(!key.startsWith('__Host-gcs_'))continue;
    if(Object.hasOwn(found,key)||at<0)throw Error('ambiguous_cookie');
    const value=part.slice(at+1).trim();
    if(!/^[A-Za-z0-9_-]{43}$/.test(value))throw Error('invalid_cookie');
    const decoded=atob(value.replaceAll('-','+').replaceAll('_','/')+'=');
    if(decoded.length!==32||btoa(decoded).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')!==value)throw Error('invalid_cookie');
    found[key]=value;
  }
  return found[name]||null;
}
export function issuerReply(status,body=null,setCookie=null) {
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
  if(setCookie)headers['Set-Cookie']=setCookie;
  return new Response(body===null?null:JSON.stringify(body),{status,headers});
}
export async function boundedBody(request) {
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('content_type');
  if(Number(request.headers.get('content-length'))>4096)throw Error('body_too_large');
  const reader=request.body?.getReader();if(!reader)throw Error('body_required');
  let size=0,chunks=[];
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error('body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
  const parts=text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)||[],stack=[];
  for(let i=0;i<parts.length;i++){
    const p=parts[i];
    if(p==='{')stack.push(new Set());else if(p==='[')stack.push(null);else if(p==='}'||p===']')stack.pop();
    else if(p.startsWith('"')&&parts[i+1]===':'){
      const key=JSON.parse(p),seen=stack.at(-1);if(!seen||seen.has(key))throw Error('duplicate_json_key');seen.add(key);
    }
  }
  return value;
}
function shape(value, rule) {
  if(rule.$ref) return shape(value,issuerSchema.$defs[rule.$ref.split('/').at(-1)]);
  if(rule.not && shape(value,rule.not)) return false;
  if(rule.allOf && !rule.allOf.every(r=>shape(value,r))) return false;
  if(rule.if && !shape(value,shape(value,rule.if)?(rule.then||{}):(rule.else||{})))return false;
  if(Object.hasOwn(rule,'const') && canonical(value)!==canonical(rule.const))return false;
  if(rule.enum && !rule.enum.some(v=>canonical(value)===canonical(v)))return false;
  if(rule.type && ![rule.type].flat().some(t=>t==='null'?value===null:t==='object'?object(value):t==='array'?Array.isArray(value):t==='integer'?Number.isSafeInteger(value):typeof value===t))return false;
  if(typeof value==='number'&&rule.minimum!==undefined&&value<rule.minimum)return false;
  if(typeof value==='string'){
    if(rule.minLength!==undefined&&Array.from(value).length<rule.minLength)return false;
    if(rule.pattern&&!new RegExp(rule.pattern).test(value))return false;
    if(rule.format==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))return false;
  }
  if(Array.isArray(value)){
    if(rule.minItems!==undefined&&value.length<rule.minItems)return false;
    if(rule.uniqueItems&&new Set(value.map(canonical)).size!==value.length)return false;
    if(rule.items&&!value.every(v=>shape(v,rule.items)))return false;
  }
  if(object(value)){
    if(rule.required?.some(k=>!Object.hasOwn(value,k)))return false;
    if(rule.additionalProperties===false&&Object.keys(value).some(k=>!Object.hasOwn(rule.properties||{},k)))return false;
    if(Object.entries(rule.properties||{}).some(([k,r])=>Object.hasOwn(value,k)&&!shape(value[k],r)))return false;
  }
  return true;
}
export function validIssuerRecord(value, kind) {
  try { return ['permission','consent'].includes(kind)&&shape(value,issuerSchema.$defs[kind]); }catch{return false;}
}
const SCOPE_KEYS='id permission_ref transport notice source_path source_title source_ref source_revision origin platform target_id containment notice_approved retention_approved purge_healthy_until_ms expires_at_ms allowed_referrer review_ref'.split(' ');
function validScope(s,p,now) {
  return exact(s,SCOPE_KEYS)&&SCOPE_KEYS.filter(k=>!['containment','notice_approved','retention_approved','purge_healthy_until_ms','expires_at_ms','allowed_referrer'].includes(k)).every(k=>text(s[k]))&&
    s.permission_ref===p.evidence_ref&&['platform','origin','source_ref','source_revision','target_id','review_ref'].every(k=>s[k]===p[k])&&
    s.containment===true&&s.notice_approved===true&&s.retention_approved===true&&s.allowed_referrer===''&&
    Number.isSafeInteger(s.purge_healthy_until_ms)&&s.purge_healthy_until_ms>now&&Number.isSafeInteger(s.expires_at_ms)&&s.expires_at_ms>now&&s.expires_at_ms<=p.expires_at_ms&&
    /^\/test\/[a-z0-9/-]+\/$/.test(s.source_path)&&
    (s.transport==='capture'?p.source_type==='synthetic_go_probe'&&p.event_class==='synthetic_transport_probe'&&p.event_name.endsWith('_CaptureProbe'):
      p.source_type==='owned_b2b_inquiry'&&p.event_class==='non_sensitive_b2b'&&p.event_name.endsWith('_B2BInquiry')&&
      (s.transport==='meta_pixel'?p.platform==='meta'&&p.target_id==='586886932687286':s.transport==='microsoft_uet'?p.platform==='microsoft'&&p.target_id==='187271853':['meta_capi','microsoft_offline','google_offline'].includes(s.transport)&&s.transport.startsWith(p.platform)&&p.target_id.startsWith('TEST_')));
}
export function createAdvertisingIssuer(env = {}) {
  if (env.A17_ISSUER_STAGE !== 'staging' || env.A6_PLATFORM_CAPTURE_MODE !== 'test_only' ||
      env.A6_PLATFORM_CAPTURE_ENVIRONMENT !== 'server_registered_test' ||
      !/^https:\/\/[a-z0-9-]+\.invalid$/.test(env.A17_ISSUER_ORIGIN || '') ||
      !env.GLP_DB?.prepare || !env.GLP_DB?.batch ||
      !env.A6_PERMISSION_ISSUER_ID || !env.A6_CONSENT_ISSUER_ID) return null;
  const db=env.GLP_DB;
  const read=async(sql,...args)=>db.prepare(sql).bind(...args).first();
  async function currentScope(id) {
    const row=await read('SELECT p.permission_json,s.scope_json,r.review_json FROM a17_issuer_scopes s JOIN a6_platform_event_permissions p ON p.evidence_ref=s.permission_ref JOIN a17_issuer_reviews r ON r.review_ref=json_extract(s.scope_json,\'$.review_ref\') WHERE s.scope_id=?',id);
    const p=parseCanonical(row?.permission_json),s=parseCanonical(row?.scope_json),r=parseCanonical(row?.review_json),now=Date.now();
    if(await digest(s.notice)!==p.notice_sha256)throw Error('notice_digest_mismatch');
    if(!validIssuerRecord(p,'permission')||!validA12bVocabulary(p)||p.status!=='ELIGIBLE'||p.is_test!==true||p.origin!==env.A17_ISSUER_ORIGIN||p.issuer_id!==env.A6_PERMISSION_ISSUER_ID||p.issued_at_ms>now||p.expires_at_ms<=now||!validScope(s,p,now)||r.status!=='STAGING_FIXTURE_ONLY'||r.is_test!==true||r.permission_sha256!==await digest(p)||r.scope_sha256!==await digest(s)||r.reviewer_id!==p.reviewer_id||r.expires_at_ms<=now)throw Error('scope_unavailable');
    return {p,s,row};
  }
  // Server-only registrar. There is no public route for review, permission or session registration.
  async function registerSession(input) {
    if(!exact(input,['scope_id','subject_ref','jurisdiction','age_policy','gpc'])||!/^TEST_[A-Za-z0-9_-]+$/.test(input.subject_ref)||input.jurisdiction!=='TEST_SUPPORTED'||input.age_policy!=='TEST_ADULT'||input.gpc!==false)throw Error('session_policy_denied');
    const {p,s,row}=await currentScope(input.scope_id),raw=token(),sessionId=await digest(raw),now=Date.now();
    const session={...input,session_id:sessionId,origin:p.origin,permission_ref:p.evidence_ref,issued_at_ms:now,expires_at_ms:Math.min(now+900000,s.expires_at_ms),epoch:p.revocation_epoch};
    const bytes=canonical(session);
    await db.batch([
      db.prepare('INSERT INTO a17_issuer_revocations VALUES (?,?,?) ON CONFLICT(subject_ref,permission_ref) DO NOTHING').bind(input.subject_ref,p.evidence_ref,p.revocation_epoch),
      db.prepare('INSERT INTO a17_issuer_sessions SELECT ?,? WHERE EXISTS (SELECT 1 FROM a17_issuer_revocations WHERE subject_ref=? AND permission_ref=? AND epoch=?) AND EXISTS (SELECT 1 FROM a17_issuer_scopes WHERE scope_id=? AND scope_json=?)').bind(sessionId,bytes,input.subject_ref,p.evidence_ref,p.revocation_epoch,s.id,row.scope_json)
    ]);
    if((await read('SELECT session_json FROM a17_issuer_sessions WHERE session_id=?',sessionId))?.session_json!==bytes)throw Error('session_reconcile');
    return {cookie:cookie('__Host-gcs_ads_session',raw),session_id:sessionId};
  }
  async function authenticate(request,{allowRevoked=false,allowSearch=false}={}) {
    const url=new URL(request.url);
    if(url.origin!==env.A17_ISSUER_ORIGIN||!allowSearch&&url.search||url.hash||request.headers.get('Sec-GPC')==='1'&&!allowRevoked||request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin||request.method!=='GET'&&request.headers.get('Origin')!==url.origin||request.headers.has('Sec-Fetch-Site')&&!['same-origin','none'].includes(request.headers.get('Sec-Fetch-Site')))throw Error('origin_or_gpc_denied');
    const raw=hostCookie(request,'__Host-gcs_ads_session');if(!raw)throw Error('session_missing');
    const id=await digest(raw),sessionRow=await read('SELECT session_json FROM a17_issuer_sessions WHERE session_id=?',id),session=parseCanonical(sessionRow?.session_json),now=Date.now();
    if(session.session_id!==id||session.origin!==url.origin||!allowRevoked&&session.expires_at_ms<=now||session.issued_at_ms>now||session.gpc!==false||session.jurisdiction!=='TEST_SUPPORTED'||session.age_policy!=='TEST_ADULT')throw Error('session_invalid');
    let scope;
    if(allowRevoked){
      const row=await read('SELECT p.permission_json,s.scope_json FROM a17_issuer_scopes s JOIN a6_platform_event_permissions p ON p.evidence_ref=s.permission_ref WHERE s.scope_id=? AND s.permission_ref=?',session.scope_id,session.permission_ref);
      scope={p:parseCanonical(row?.permission_json),s:parseCanonical(row?.scope_json),row};
    }else scope=await currentScope(session.scope_id);
    const rev=await read('SELECT epoch FROM a17_issuer_revocations WHERE subject_ref=? AND permission_ref=?',session.subject_ref,scope.p.evidence_ref);
    if(!Number.isSafeInteger(rev?.epoch)||!allowRevoked&&(rev.epoch!==session.epoch||rev.epoch!==scope.p.revocation_epoch))throw Error('revoked');
    return {...scope,session,sessionRow,epoch:rev.epoch,csrf:await digest('a17-csrf|'+raw)};
  }
  async function currentConsent(request,a) {
    const raw=hostCookie(request,'__Host-gcs_ads_receipt');if(!raw)return null;
    const id=await digest(raw),row=await read('SELECT consent_json FROM a6_advertising_consent_receipts WHERE receipt_id=?',id);if(!row)return null;
    const c=parseCanonical(row.consent_json),p=a.p,now=Date.now();
    if(!validIssuerRecord(c,'consent')||c.receipt_id!==id||c.permission_ref!==p.evidence_ref||c.permission_revision!==p.revision||c.permission_sha256!==await digest(p)||c.subject_ref!==a.session.subject_ref||c.issuer_id!==env.A6_CONSENT_ISSUER_ID||c.revocation_epoch!==a.epoch||c.is_test!==true||c.probe_ref!==p.probe_ref||['platform','account_id','target_id','origin','source_ref','source_revision','purpose','notice_version','notice_sha256'].some(k=>c[k]!==p[k])||canonical(c.event_names)!==canonical([p.event_name])||c.issued_at_ms>now||c.expires_at_ms<=now||c.ad_storage!=='granted'||c.ad_user_data!=='granted'||c.ad_personalization!=='denied'||c.withdrawn!==false||c.gpc!==false)return null;
    return {c,row};
  }
  async function view(request) {
    const a=await authenticate(request),consent=await currentConsent(request,a),p=a.p,s=a.s;
    return {csrf:a.csrf,scope:{...s,eligible:true,purpose:p.purpose,revision:p.revision,notice_version:p.notice_version,permission_sha256:await digest(p),expires_at_ms:Math.min(p.expires_at_ms,s.expires_at_ms,a.session.expires_at_ms)},receipt:consent?{scope_id:s.id,scope_revision:p.revision,notice_version:p.notice_version,choice:consent.c.choice,ad_storage:consent.c.ad_storage,ad_user_data:consent.c.ad_user_data,ad_personalization:consent.c.ad_personalization,gpc:false,withdrawn:false,expires_at_ms:consent.c.expires_at_ms}:null};
  }
  async function choose(request,input) {
    const a=await authenticate(request),p=a.p;
    if(!exact(input,['scope_id','choice','csrf'])||input.scope_id!==a.s.id||input.choice!=='explicit_opt_in'||input.csrf!==a.csrf)throw Error('choice_or_csrf_denied');
    const opKey=await digest({session_id:a.session.session_id,scope_id:a.s.id,epoch:a.epoch});
    const old=await read('SELECT receipt_id FROM a17_issuer_operations WHERE op_key=?',opKey);
    if(old){const c=await currentConsent(request,a);if(c?.c.receipt_id!==old.receipt_id)return issuerReply(409,{state:'RECONCILE',retry:false});return issuerReply(200,await view(request));}
    const raw=token(),receiptId=await digest(raw),now=Date.now();
    const c={schema:'a12-advertising-consent-v1',receipt_id:receiptId,version:'a12-advertising-consent-v1',subject_ref:a.session.subject_ref,permission_ref:p.evidence_ref,permission_revision:p.revision,permission_sha256:await digest(p),platform:p.platform,account_id:p.account_id,target_id:p.target_id,origin:p.origin,source_ref:p.source_ref,source_revision:p.source_revision,purpose:p.purpose,is_test:true,probe_ref:p.probe_ref,issued_at_ms:now,expires_at_ms:Math.min(now+900000,p.expires_at_ms,a.s.expires_at_ms,a.session.expires_at_ms),revocation_epoch:a.epoch,event_names:[p.event_name],notice_version:p.notice_version,notice_sha256:p.notice_sha256,choice:'explicit_opt_in',choice_at_ms:now,ad_storage:'granted',ad_user_data:'granted',ad_personalization:'denied',gpc:false,withdrawn:false,issuer_id:env.A6_CONSENT_ISSUER_ID};
    if(!validIssuerRecord(c,'consent'))throw Error('consent_shape');
    const cb=canonical(c);
    try{await db.batch([
      db.prepare(`INSERT INTO a6_advertising_consent_receipts SELECT ?,? WHERE EXISTS (SELECT 1 FROM a17_issuer_sessions WHERE session_id=? AND session_json=?) AND EXISTS (SELECT 1 FROM a6_platform_event_permissions WHERE evidence_ref=? AND permission_json=?) AND EXISTS (SELECT 1 FROM a17_issuer_revocations WHERE subject_ref=? AND permission_ref=? AND epoch=?) AND EXISTS (SELECT 1 FROM a17_issuer_scopes WHERE scope_id=? AND scope_json=?) AND EXISTS (SELECT 1 FROM a17_issuer_reviews WHERE review_ref=? AND review_json=?) AND ? > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND NOT EXISTS (SELECT 1 FROM a17_issuer_operations WHERE op_key=?)`).bind(receiptId,cb,a.session.session_id,a.sessionRow.session_json,p.evidence_ref,a.row.permission_json,c.subject_ref,p.evidence_ref,a.epoch,a.s.id,a.row.scope_json,p.review_ref,a.row.review_json,c.expires_at_ms,opKey),
      db.prepare('INSERT INTO a17_issuer_operations SELECT ?,? WHERE EXISTS (SELECT 1 FROM a6_advertising_consent_receipts WHERE receipt_id=? AND consent_json=?)').bind(opKey,receiptId,receiptId,cb)
    ]);}catch{/* One exact readback resolves committed/unknown; never rerun the batch. */}
    const stored=await read('SELECT c.consent_json FROM a17_issuer_operations o JOIN a6_advertising_consent_receipts c ON c.receipt_id=o.receipt_id WHERE o.op_key=?',opKey);
    if(stored?.consent_json!==cb)return issuerReply(409,{state:'RECONCILE',retry:false});
    await authenticate(request); // A withdrawal after commit cannot yield a current grant.
    return issuerReply(201,{state:'ISSUED',is_test:true},cookie('__Host-gcs_ads_receipt',raw,Math.max(0,Math.floor((c.expires_at_ms-Date.now())/1000))));
  }
  async function revoke(request,input) {
    const a=await authenticate(request,{allowRevoked:true});
    if(!exact(input,['csrf'])||input.csrf!==a.csrf)throw Error('revoke_csrf_denied');
    const subject=a.session.subject_ref,permission=a.p.evidence_ref,epoch=Math.max(a.epoch,a.session.epoch+1);
    try{await db.batch([
      db.prepare('UPDATE a17_issuer_revocations SET epoch=MAX(epoch,?) WHERE subject_ref=? AND permission_ref=?').bind(epoch,subject,permission),
      db.prepare("UPDATE affiliate_click_map SET platform_context_json=NULL WHERE json_extract(platform_context_json,'$.subject_ref')=? AND json_extract(platform_context_json,'$.permission_ref')=?").bind(subject,permission),
      db.prepare("DELETE FROM a6_platform_click_handoffs WHERE permission_ref=? AND consent_receipt_id IN (SELECT receipt_id FROM a6_advertising_consent_receipts WHERE json_extract(consent_json,'$.subject_ref')=?)").bind(permission,subject)
    ]);}catch{/* No blind write retry; acknowledge only exact purge readback. */}
    const rev=await read('SELECT epoch FROM a17_issuer_revocations WHERE subject_ref=? AND permission_ref=?',subject,permission);
    const residual=await read("SELECT (SELECT count(*) FROM affiliate_click_map WHERE json_extract(platform_context_json,'$.subject_ref')=? AND json_extract(platform_context_json,'$.permission_ref')=?) + (SELECT count(*) FROM a6_platform_click_handoffs WHERE permission_ref=? AND consent_receipt_id IN (SELECT receipt_id FROM a6_advertising_consent_receipts WHERE json_extract(consent_json,'$.subject_ref')=?)) AS n",subject,permission,permission,subject);
    if(!Number.isSafeInteger(rev?.epoch)||rev.epoch<epoch||residual?.n!==0)return issuerReply(503,{acknowledged:false,state:'RECONCILE',retry:false});
    return issuerReply(200,{acknowledged:true,state:'LOCAL_PURGED',vendor_erasure:'NOT_SENT_UNVERIFIED'},cookie('__Host-gcs_ads_receipt','',0));
  }
  async function issuePermission(p,s) {
    const now=Date.now();
    if(await digest(s?.notice)!==p?.notice_sha256)throw Error('notice_digest_mismatch');
    if(!validIssuerRecord(p,'permission')||!validA12bVocabulary(p)||p.origin!==env.A17_ISSUER_ORIGIN||p.status!=='ELIGIBLE'||p.is_test!==true||!p.probe_ref.startsWith('TEST_')||p.issuer_id!==env.A6_PERMISSION_ISSUER_ID||p.reviewer_id===p.issuer_id||p.issued_at_ms>now||p.expires_at_ms<=now||p.expires_at_ms-p.issued_at_ms>3600000||p.tos_refs.some(r=>r.reviewed_at_ms>p.issued_at_ms)||p.payload_schema_sha256!==await digest(p.allowed_payload_fields)||!validScope(s,p,now))throw Error('permission_scope_denied');
    const pd=await digest(p), sd=await digest(s);
    const reviewRow=await read('SELECT review_json FROM a17_issuer_reviews WHERE review_ref=?',p.review_ref);
    const r=parseCanonical(reviewRow?.review_json);
    if(r.status!=='STAGING_FIXTURE_ONLY'||r.is_test!==true||r.review_ref!==p.review_ref||r.reviewer_id!==p.reviewer_id||r.permission_sha256!==pd||r.scope_sha256!==sd||r.expires_at_ms<p.expires_at_ms)throw Error('review_not_bound');
    const pb=canonical(p),sb=canonical(s);
    try { await db.batch([
      db.prepare('INSERT INTO a6_platform_event_permissions SELECT ?,? WHERE EXISTS (SELECT 1 FROM a17_issuer_reviews WHERE review_ref=? AND review_json=?) ON CONFLICT(evidence_ref) DO NOTHING').bind(p.evidence_ref,pb,p.review_ref,reviewRow.review_json),
      db.prepare('INSERT INTO a17_issuer_scopes SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM a6_platform_event_permissions WHERE evidence_ref=? AND permission_json=?) ON CONFLICT(scope_id) DO NOTHING').bind(s.id,p.evidence_ref,sb,p.evidence_ref,pb)
    ]); }catch{ /* Read exact keys once; never blind retry an ambiguous write. */ }
    const stored=await read('SELECT p.permission_json,s.scope_json FROM a6_platform_event_permissions p JOIN a17_issuer_scopes s ON s.permission_ref=p.evidence_ref WHERE p.evidence_ref=? AND s.scope_id=?',p.evidence_ref,s.id);
    if(stored?.permission_json!==pb||stored?.scope_json!==sb)throw Error('permission_conflict_or_reconcile');
    return {permission_ref:p.evidence_ref,permission_sha256:pd,scope_id:s.id,is_test:true};
  }
  const issuer={issuePermission,registerSession,authenticate,currentConsent,view,choose,revoke};
  issuer.registerProbe=(request,input)=>registerTestProbe(env,issuer,request,input);
  issuer.createHandoff=(request,input)=>createRegisteredHandoff(env,issuer,request,input);
  issuer.captureAuthority=(request,binding)=>captureAuthority(env,issuer,request,binding);
  return Object.freeze(issuer);
}
export async function advertisingConsent(request,env) {
  if(!['GET','POST'].includes(request.method))return issuerReply(405);
  if(request.headers.get('Sec-GPC')==='1')return issuerReply(403);
  const issuer=createAdvertisingIssuer(env);if(!issuer)return issuerReply(503);
  try{return request.method==='GET'?issuerReply(200,await issuer.view(request)):await issuer.choose(request,await boundedBody(request));}
  catch{return issuerReply(503,{state:'DENIED_OR_RECONCILE',retry:false});}
}
export async function revokeAdvertisingConsent(request,env) {
  if(request.method!=='POST')return issuerReply(405);
  const issuer=createAdvertisingIssuer(env);if(!issuer)return issuerReply(503);
  try{return await issuer.revoke(request,await boundedBody(request));}catch{return issuerReply(503,{acknowledged:false,state:'RECONCILE',retry:false});}
}
