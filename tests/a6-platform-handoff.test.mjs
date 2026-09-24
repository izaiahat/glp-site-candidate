import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/platform-click-handoff.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const token='01992fee-0000-7000-8000-000000000001';
const program={program_id:'fixture-only',network:'affiliati',network_offer_id:'1',tracking:{base_url:'https://example.invalid/?a=1&c=1'}};
function setup(){
 const receipt='a'.repeat(64),now=Date.now(),writes=[];
 const consent={origin:'https://example.invalid',receipt_id:receipt,version:'1',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'denied',withdrawn:false,expires_at_ms:now+60000};
 const permission={origin:'https://example.invalid',evidence_ref:'FIXTURE',program_id:program.program_id,event_class:'non_sensitive_b2b',allowed_platforms:['microsoft','meta','google'],expires_at_ms:now+60000,is_test:true};
 const env={A6_PLATFORM_CAPTURE_MODE:'enabled',A6_PERMISSION_REF:'FIXTURE',PROGRAM_MANIFEST:{programs:[program]},GLP_DB:{prepare(sql){return {bind(...args){return {first:async()=>({consent_json:JSON.stringify(consent),permission_json:JSON.stringify(permission)}),run:async()=>{writes.push({sql,args});return {success:true};}}}}}}};
 const request=()=>new Request('https://example.invalid/api/platform-click-handoff',{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json',cookie:`gcs_ads_receipt=${receipt}`},body:JSON.stringify({go_path:`/go/fixture-only?s=test.hero&v=a&cs_click_id=${token}`,identifiers:{fbclid:'FAKE_FbAbC',msclkid:'FAKE_MS_ONLY'}})});
 return {env,request,writes,consent,permission};
}
test('legacy HTTP handoff cannot mint a grant or cookie; registered read path is tested in D2n',async()=>{
 assert.equal(typeof api.createHandoff,'function','handoff endpoint not implemented');
 const {env,request,writes,consent}=setup();
 const result=await api.createHandoff(request(),env);
 assert.equal(result.status,503);assert.equal(writes.length,0);
 assert.equal(result.headers.get('set-cookie'),null);
 consent.withdrawn=true;assert.equal((await api.createHandoff(request(),env)).status,503);assert.equal(writes.length,0);
});

test('browser handoff never runs for unknown advertising consent or health context',async()=>{
 const client=await import('../assets/platform-click-handoff.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof client.handoffNavigation,'function','browser handoff missing');
 const calls=[];const send=async(...args)=>{calls.push(args);return {status:201}};
 const args={landingUrl:'https://example.invalid/for-clinics/?msclkid=FAKE_CaseAbC&email=NOPE&fbclid=FAKE_FB',goUrl:`https://example.invalid/go/fixture-only?s=test.hero&v=a&cs_click_id=${token}`,consent:{ad_storage:'denied',ad_user_data:'denied'},healthContext:false,send};
 assert.equal((await client.handoffNavigation(args)).state,'HELD');assert.equal(calls.length,0);
 args.consent={ad_storage:'granted',ad_user_data:'granted'};args.healthContext=true;
 assert.equal((await client.handoffNavigation(args)).state,'HELD');assert.equal(calls.length,0);
 args.healthContext=false;assert.equal((await client.handoffNavigation(args)).state,'HANDOFF_STORED');assert.equal(calls.length,1);
 const payload=JSON.parse(calls[0][1].body);assert.deepEqual(payload.identifiers,{msclkid:'FAKE_CaseAbC',fbclid:'FAKE_FB'});assert.equal('email' in payload,false);
 args.goUrl='https://elsewhere.invalid/go/fixture-only';assert.equal((await client.handoffNavigation(args)).state,'HELD');assert.equal(calls.length,1);
});

test('Pages route is default-disabled using the existing runtime manifest',async()=>{
 const route=await import('../functions/api/platform-click-handoff.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof route.onRequest,'function','Pages wrapper missing');
 const response=await route.onRequest({request:new Request('https://example.invalid/api/platform-click-handoff',{method:'POST'}),env:{}});
 assert.equal(response.status,503);
});

test('legacy allowed_platforms JSON cannot activate the unimplemented issuer endpoint',async()=>{
 const {env,request,writes,permission}=setup();permission.allowed_platforms=['microsoft'];
 assert.equal((await api.createHandoff(request(),env)).status,503);
 assert.equal(writes.length,0,'multi-platform JSON permission cannot enable issuer');
});

test('GPC request suppresses first-party platform-ID persistence even with a stored grant',async()=>{
 const {env,request,writes}=setup(); const r=request();r.headers.set('Sec-GPC','1');
 assert.equal((await api.createHandoff(r,env)).status,403);assert.equal(writes.length,0);
});
