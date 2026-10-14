import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleNewsletterSubscribeRequest } from '../src/newsletter-subscribe.mjs';
import { runDripScheduler, ingestResendWebhook } from '../src/resend-email-machine.mjs';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/unsubscribe.js';
import { handleContentUpgradeRequest } from '../src/content-upgrade.mjs';
const config=JSON.parse(readFileSync(new URL('../data/resend-email-machine.json',import.meta.url)));
const version='glp47-comparison-guides-v1-20261013';
const sha='e600463c7f9c19da67dd38f6ea7b76b2f3a46db3bacfd2e761e38a87684d0580';
function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['002_email_machine.sql','005_canonical_contact_capture.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {async run(){const x=stmt.run(...args);return {success:true,meta:{changes:Number(x.changes)}}},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}}}}}},async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 return {sqlite,db};
}
const payload=(email='safe@example.invalid',changes={})=>({email,email_consent:true,consent_version:version,consent_source:'/subscribe-bottom-sheet/',source_surface:'sitewide-price-watch',company:'',...changes});
const request=p=>new Request('https://glpclinicscout.com/api/newsletter-subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});
const environment=db=>({EMAIL_DB:db,NEWSLETTER_CAPTURE_MODE:'local_test',ONBOARDING_ENABLED:'true',ONBOARDING_B01_READY:'true',ONBOARDING_COPY_SHA256:sha,EMAIL_WARMUP_STATUS:'PASS',RESEND_API_KEY:'synthetic',RESEND_ENABLED:'true'});
function signedAdverse(type,id) {
 const key=Buffer.from('GLP47-offline-only-webhook-key');
 const svixId='offline-'+type;const timestamp=String(Math.floor(Date.now()/1000));
 const body=JSON.stringify({type,created_at:new Date().toISOString(),data:{email_id:id,from:'GLP Clinic Scout <partners@glpclinicscout.com>'}});
 const signature=createHmac('sha256',key).update(`${svixId}.${timestamp}.${body}`).digest('base64');
 return {secret:'whsec_'+key.toString('base64'),request:()=>new Request('https://glpclinicscout.com/api/resend-webhook',{method:'POST',headers:{'svix-id':svixId,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature},body})};
}
test('GLP47 early signed bounce at provider receipt binding prohibits follow-up',async()=>{
 const {sqlite,db}=database();const env=environment(db);let sends=0;
 try {
  assert.equal((await handleNewsletterSubscribeRequest(request(payload()),env)).status,201);
  const now=new Date(Date.parse(sqlite.prepare('SELECT consent_at FROM subscribers').get().consent_at)+1);
  const event=signedAdverse('email.bounced','offline-early');
  const transport=async(url)=>{
   if(url.endsWith('/contacts'))return new Response(JSON.stringify({id:'offline-contact'}));
   sends++;assert.equal((await ingestResendWebhook(event.request(),{...env,RESEND_WEBHOOK_SECRET:event.secret})).status,200);
   assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM resend_webhook_events').get().n,1);
   assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM suppression_log').get().n,0,'webhook arrived before ID binding');
   return new Response(JSON.stringify({id:'offline-early'}));
  };
  await runDripScheduler(env,config,now,transport);
  assert.equal((await runDripScheduler(env,config,new Date(now.getTime()+2*86400000),transport)).sent,0,'early adverse event must block day two');
  assert.equal(sends,1);
  const row=sqlite.prepare('SELECT status,consent_status,next_send_at FROM subscribers').get();
  assert.deepEqual({...row},{status:'bounced',consent_status:'suppressed',next_send_at:null});
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM suppression_log').get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM contact_capture_events WHERE purpose='suppression'").get().n,1);
 } finally {sqlite.close();}
});
test('GLP47 all adverse types stay terminal in early and ordinary receipt order, including duplicate webhook',async()=>{
 for(const type of ['email.bounced','email.complained','email.suppressed'])for(const early of [true,false]) {
  const {sqlite,db}=database();const env=environment(db);let sends=0;
  try {
   await handleNewsletterSubscribeRequest(request(payload()),env);
   const now=new Date(Date.parse(sqlite.prepare('SELECT consent_at FROM subscribers').get().consent_at)+1);
   const event=signedAdverse(type,'offline-order-message');
   const ingest=()=>ingestResendWebhook(event.request(),{...env,RESEND_WEBHOOK_SECRET:event.secret});
   const transport=async(url)=>{
    if(url.endsWith('/contacts'))return new Response(JSON.stringify({id:'offline-contact'}));
    sends++;if(early)assert.equal((await ingest()).status,200);
    return new Response(JSON.stringify({id:'offline-order-message'}));
   };
   const result=await runDripScheduler(env,config,now,transport);
   assert.equal(result.sent,1);assert.equal(result.receipts[0].resend_email_id,'offline-order-message');
   if(!early)assert.equal((await ingest()).status,200);
   assert.equal(sqlite.prepare('SELECT status FROM email_deliveries').get().status,type.slice(6));
   assert.equal((await ingest()).status,200);
   assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM resend_webhook_events').get().n,1);
   assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM contact_capture_events WHERE purpose='suppression'").get().n,1);
   assert.equal((await handleNewsletterSubscribeRequest(request(payload()),env)).status,409);
   assert.equal((await runDripScheduler(env,config,new Date(now.getTime()+2*86400000),transport)).sent,0);
   assert.equal((await runDripScheduler(env,config,now,transport)).sent,0);assert.equal(sends,1);
   const row=sqlite.prepare('SELECT status,consent_status,next_send_at FROM subscribers').get();
   assert.deepEqual({...row},{status:type.slice(6),consent_status:'suppressed',next_send_at:null});
  } finally {sqlite.close();}
 }
});
test('GLP47 uncertain adverse reconciliation rolls back ID binding and retains no-replay claim',async()=>{
 const {sqlite,db}=database();const env=environment(db);let sends=0;
 try {
  await handleNewsletterSubscribeRequest(request(payload()),env);
  const now=new Date(Date.parse(sqlite.prepare('SELECT consent_at FROM subscribers').get().consent_at)+1);
  sqlite.exec("CREATE TRIGGER offline_reconcile_fail BEFORE INSERT ON suppression_log BEGIN SELECT RAISE(FAIL,'offline reconciliation failure'); END");
  const event=signedAdverse('email.complained','offline-failed-reconcile');
  const transport=async(url)=>{
   if(url.endsWith('/contacts'))return new Response(JSON.stringify({id:'offline-contact'}));
   sends++;assert.equal((await ingestResendWebhook(event.request(),{...env,RESEND_WEBHOOK_SECRET:event.secret})).status,200);
   return new Response(JSON.stringify({id:'offline-failed-reconcile'}));
  };
  await assert.rejects(runDripScheduler(env,config,now,transport),/offline reconciliation failure/);
  assert.deepEqual({...sqlite.prepare('SELECT status,resend_email_id FROM email_deliveries').get()},{status:'sending',resend_email_id:null});
  assert.equal(sqlite.prepare('SELECT next_drip_step FROM subscribers').get().next_drip_step,1);
  sqlite.exec('DROP TRIGGER offline_reconcile_fail');
  const later=await runDripScheduler(env,config,new Date(now.getTime()+2*86400000),transport);
  assert.equal(later.status,'HELD');assert.equal(later.unresolved,1);assert.equal(later.sent,0);assert.equal(sends,1);
 } finally {sqlite.close();}
});
test('GLP47 missing atomic receipt adapter is held before DB or provider effects',async()=>{
 const env=environment({prepare(){assert.fail('missing batch must refuse before DB')}});
 const out=await runDripScheduler(env,config,new Date(),()=>assert.fail('missing batch must refuse before provider'));
 assert.equal(out.status,'HELD');assert.equal(out.sent,0);
});
test('GLP47 durable approved-purpose capture enrolls once; scheduler delivers exact welcome and refuses replay/withdrawal',async()=>{
 const {sqlite,db}=database();const env=environment(db);const calls=[];
 const transport=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify({id:url.endsWith('/contacts')?'synthetic-contact':'synthetic-message'}),{status:200})};
 try{
  assert.equal((await handleNewsletterSubscribeRequest(request(payload('unconsented@example.invalid',{email_consent:false})),env,transport)).status,400);
  assert.equal((await handleNewsletterSubscribeRequest(request(payload('field@example.invalid',{first_name:'private health context'})),env,transport)).status,400);
  assert.equal((await handleNewsletterSubscribeRequest(request(payload('quiz@example.invalid',{source_surface:'quiz-provider-fit'})),env,transport)).status,400);
  sqlite.prepare("INSERT INTO suppression_log VALUES (?,'glp-clinic-scout','unsubscribed','fixture',?)").run('suppressed@example.invalid',new Date().toISOString());
  assert.equal((await handleNewsletterSubscribeRequest(request(payload('suppressed@example.invalid')),env,transport)).status,409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n,0);
  const first=await handleNewsletterSubscribeRequest(request(payload()),env,transport);assert.equal(first.status,201,JSON.stringify(await first.clone().json()));
  assert.equal(calls.length,0,'capture must never send a different confirmation');
  let row=sqlite.prepare('SELECT * FROM subscribers').get();assert.equal(row.next_drip_step,1);assert.ok(row.next_send_at);
  const token=row.unsubscribe_token;
  const duplicate=await handleNewsletterSubscribeRequest(request(payload()),env,transport);assert.equal(duplicate.status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM contact_capture_events').get().n,1);
  assert.equal(sqlite.prepare('SELECT unsubscribe_token FROM subscribers').get().unsubscribe_token,token);
  await handleNewsletterSubscribeRequest(request(payload('safe@example.invalid',{consent_version:'glp-newsletter-v1-20260822'})),{...env,RESEND_ENABLED:'false'},transport);
  assert.equal(sqlite.prepare('SELECT consent_version FROM subscribers').get().consent_version,version);
  assert.equal(sqlite.prepare('SELECT next_drip_step FROM subscribers').get().next_drip_step,1);
  const now=new Date(Date.parse(row.consent_at)+1000);
  const result=await runDripScheduler(env,config,now,transport);assert.equal(result.sent,1);assert.equal(result.receipts[0].resend_email_id,'synthetic-message');
  assert.equal(calls.length,2);const message=calls[1].body;
  assert.equal(message.from,'GLP Clinic Scout <partners@glpclinicscout.com>');assert.equal(message.reply_to,'partners@glpclinicscout.com');assert.equal(message.text,config.welcome_sequence[0].body_text+'\n\n'+config.welcome_footer.replace('{{unsubscribe_url}}','https://glpclinicscout.com/unsubscribe?token='+token));
  assert.equal((await runDripScheduler(env,config,now,transport)).sent,0);assert.equal(calls.length,2);
  row=sqlite.prepare('SELECT * FROM subscribers').get();assert.equal(Date.parse(row.next_send_at)-now.getTime(),2*86400000);
  const withdrawal=await onRequestPost({request:new Request('https://glpclinicscout.com/unsubscribe',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})}),env:{...env,RESEND_ENABLED:'false'}});assert.equal(withdrawal.status,200);
  assert.equal((await handleNewsletterSubscribeRequest(request(payload()),env,transport)).status,409);
  const legacyRepeat=await handleNewsletterSubscribeRequest(request(payload('safe@example.invalid',{consent_version:'glp-newsletter-v1-20260822'})),env,transport);
  assert.equal(legacyRepeat.status,409);assert.equal(calls.length,2,'held legacy upsert must not revive contact or send confirmation');
  const legacyResource=new Request('https://glpclinicscout.com/api/content-upgrade',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source_page:'insights',lead_magnet_key:'insights-terms-checklist',consent_version:'glp-content-upgrade-v2-20260801',email:'safe@example.invalid',email_consent:'true',company:''})});
  const resourceRepeat=await handleContentUpgradeRequest(legacyResource,{...env,GLP_DB:db,CONTENT_UPGRADE_CAPTURE_MODE:'local_test'},transport);
  assert.equal(resourceRepeat.status,409);assert.equal(calls.length,2,'held marketing-resource upsert must not revive contacts or send');
  assert.equal((await runDripScheduler(env,config,new Date(Date.parse(row.consent_at)+3*86400000),transport)).sent,0);assert.equal(calls.length,2);
  assert.equal(sqlite.prepare('SELECT status FROM subscribers').get().status,'unsubscribed');
 }finally{sqlite.close()}
});

test('GLP47 renderer binds a separate guide purpose, not historic resource or quiz intent',()=>{
 const source=readFileSync(new URL('../scripts/build-staging.mjs',import.meta.url),'utf8');
 const sheet=source.split('const subscribeSheet = `')[1].split('`;')[0];
 assert.ok(sheet.includes('${ONBOARDING_CONSENT_VERSION}'));
 assert.ok(sheet.includes('${ONBOARDING_CONSENT_TEXT}'));
 assert.ok(!sheet.includes('glp-newsletter-v1-20260822'));
});

test('GLP47 scheduled day-two sends once; unknown effects are held without replay; historic grants are excluded',async()=>{
 const {sqlite,db}=database(); const env=environment(db); let contactCalls=0; let sends=0;
 const transport=async(url,init)=>{
   if(url.endsWith('/contacts')) {contactCalls++;return new Response(JSON.stringify({id:'fixture-contact'}),{status:200});}
   sends++;return new Response(JSON.stringify({id:`fixture-message-${sends}`}),{status:200});
 };
 try {
   await handleNewsletterSubscribeRequest(request(payload()),env,transport);
   const row=sqlite.prepare('SELECT * FROM subscribers').get();
   const day0=new Date(Date.parse(row.consent_at)+1);
   assert.equal((await runDripScheduler(env,config,day0,transport)).sent,1);
   const day2=new Date(day0.getTime()+2*86400000);
   assert.equal((await runDripScheduler(env,config,new Date(day2.getTime()-1),transport)).sent,0);
   assert.equal((await runDripScheduler(env,config,day2,transport)).sent,1);
   assert.equal(contactCalls,1); assert.equal(sends,2);
   assert.equal((await runDripScheduler(env,config,day2,transport)).sent,0);
   sqlite.exec("UPDATE subscribers SET consent_version='glp-content-upgrade-v2-20260801',next_drip_step=1,next_send_at=consent_at");
   assert.equal((await runDripScheduler(env,config,day2,transport)).sent,0);
   assert.equal(sqlite.prepare('SELECT consent_version FROM subscribers').get().consent_version,'glp-content-upgrade-v2-20260801');
   assert.equal((await handleNewsletterSubscribeRequest(request(payload()),env,transport)).status,409);
   const second=payload('unknown@example.invalid');
   await handleNewsletterSubscribeRequest(request(second),env,transport);
   const uncertain=async(url)=>{if(url.endsWith('/contacts'))return new Response(JSON.stringify({id:'fixture-contact-2'}),{status:200});throw new Error('fixture-timeout');};
   const unknown=await runDripScheduler(env,config,new Date(day2.getTime()+1000),uncertain);
   assert.equal(unknown.status,'HELD');assert.equal(unknown.unresolved,1);
   const replay=await runDripScheduler(env,config,new Date(day2.getTime()+2000),transport);
   assert.equal(replay.status,'HELD');assert.equal(replay.sent,0);assert.equal(sends,2);
 } finally {sqlite.close();}
});

test('GLP47 actual approved bytes cannot be changed under unchanged approval metadata',async()=>{
 for(const mutate of [c=>{c.welcome_sequence[0].body_text+=' changed';},c=>{c.welcome_footer+=' changed';}]) {
  const changed=structuredClone(config);mutate(changed);let touched=false;
  const env=environment({prepare(){touched=true;throw new Error('must not touch DB');}});
  const result=await runDripScheduler(env,changed);
  assert.equal(result.status,'HELD');assert.equal(touched,false);
 }
});
