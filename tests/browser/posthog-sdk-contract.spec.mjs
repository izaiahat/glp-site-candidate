import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const ROOT=path.resolve('.'),PUBLIC=process.env.GLP_REVIEW_PUBLIC_ROOT||path.join(ROOT,'public');
const sha=b=>createHash('sha256').update(b).digest('hex');
const sdk=readFileSync(path.join(ROOT,'tests/fixtures/posthog/array.js'),'utf8');
const SDK_SHA='7b7e12b4a9459669f311e0b8e63f44e905eba385401f70dcabfe9b011e3dcd86';
const consent=readFileSync(path.join(PUBLIC,'assets/consent.js'),'utf8');
const home=readFileSync(path.join(PUBLIC,'index.html'),'utf8');
const asset=home.match(/src="(\/assets\/analytics(?:\.[a-f0-9]+)?\.js(?:\?[^\"]*)?)"/)[1];
const analytics=readFileSync(path.join(PUBLIC,new URL(asset,'https://glpclinicscout.com').pathname),'utf8');
const oldHook="function beforeSend(event) { if (!consented() || !reviewed(event?.event)) return null; return {event: event.event, properties: cleanProperties(event.event, {})}; }\n\n  ";
const origin='https://glpclinicscout.com',host='https://posthog-fixture.invalid';
const route='/guides/semaglutide/';
const key='TEST_PUBLIC_PROJECT_TOKEN_NOT_A_CREDENTIAL';

// Actual SDK, locally fulfilled bytes; no live ingestion or external forwarding.
// Only batching/compression change to expose deterministic readable POSTs. Consent,
// pageview, profile, sanitizer and persistence options remain emitted-source owned.
test('D1 real PostHog SDK preserves protocol and pageviews without sensitive payloads',async({browser},info)=>{
 expect(sha(sdk)).toBe(SDK_SHA);
 const receipts=[];
 for(const variant of ['unchanged-sanitizer','fixed']) {
  const context=await browser.newContext({serviceWorkers:'block',userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'});
  // The real SDK also rejects Chromium's HeadlessChrome UA-data brand.
  // Test-only ordinary-browser branch; all requests remain locally intercepted.
  await context.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});Object.defineProperty(navigator,'userAgentData',{get:()=>undefined});});
  const attempts=[],unknown=[];
  const source=variant==='fixed'?analytics:analytics.replace(/function beforeSend\(event\) \{[\s\S]*?\n  function emit/,oldHook+'function emit');
  expect(source===analytics).toBe(variant==='fixed');
  const fixture=`<!doctype html><meta name="referrer" content="no-referrer"><script>
window.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};
window.GCS_ANALYTICS={enabled:true,measurement_id:'G-LOCAL-FIXTURE',gtm_container_id:'GTM-LOCAL-FIXTURE'};window.GCS_POSTHOG={enabled:true,api_key:'${key}',host:'${host}'};
</script><script defer src="/consent.js"></script><script defer src="/analytics.js"></script><h1>Local SDK contract</h1><form><input name="health_condition" value="CANARY_FORM"></form><footer><a href="/privacy/cookies/">Cookie choices</a></footer>`;
  const inspectSdk=`\n;(()=>{const init=window.posthog.init.bind(window.posthog);window.__sdkEvents=[];window.posthog.init=(key,o)=>{window.__sdkOptions={capture_pageview:o.capture_pageview,person_profiles:o.person_profiles,persistence:o.persistence,disable_persistence:o.disable_persistence};const before=o.before_send;return init(key,{...o,request_batching:false,disable_compression:true,before_send:e=>{const result=before(e);window.__sdkEvents.push({input:e,result});return result;}});};})();`;
  await context.route('**/*',async r=>{
   const request=r.request(),url=new URL(request.url());
   if(url.origin===origin&&url.pathname===route)return r.fulfill({contentType:'text/html',body:fixture});
   if(url.origin===origin&&url.pathname==='/consent.js')return r.fulfill({contentType:'text/javascript',body:consent});
   if(url.origin===origin&&url.pathname==='/analytics.js')return r.fulfill({contentType:'text/javascript',body:source});
   if(url.origin===host&&url.pathname==='/static/array.js')return r.fulfill({contentType:'text/javascript',body:sdk+inspectSdk});
   if(url.origin===host&&request.method()==='POST'){
    attempts.push({url:request.url(),method:request.method(),body:request.postData(),referrer:request.headers().referer||'',forwarded:false});
    return r.fulfill({status:200,contentType:'application/json',body:'{"status":1}',headers:{'access-control-allow-origin':'*'}});
   }
   unknown.push({url:request.url(),method:request.method()});return r.abort();
  });
  const page=await context.newPage();
  try {
   await page.goto(origin+route+'?quiz_answers=CANARY_QUERY#CANARY_FRAGMENT');
   await page.waitForFunction(()=>window.posthog?.__loaded&&window.__sdkOptions);
   await page.waitForTimeout(600);
   await info.attach('sdk-diagnostic-'+variant,{contentType:'application/json',body:JSON.stringify({attempts,unknown,state:await page.evaluate(()=>({events:window.__sdkEvents,options:window.__sdkOptions,consent:window.GCSConsent.purposes(),exports:window.GCSConsent.allowsExports(),optedOut:window.posthog.has_opted_out_capturing(),ua:navigator.userAgent,id:window.posthog.get_distinct_id()}))})});
   expect(await page.evaluate(()=>window.__sdkOptions)).toEqual({capture_pageview:true,person_profiles:'never',persistence:'memory',disable_persistence:true});
   expect(attempts.length).toBe(variant==='fixed'?1:0);
   const initialAttempts=attempts.length;
   if(variant==='fixed'){
    function decode(row){let v;try{v=JSON.parse(row.body)}catch{v=JSON.parse(Buffer.from(new URLSearchParams(row.body).get('data'),'base64').toString())}return Array.isArray(v)?v:(Array.isArray(v.batch)?v.batch:[v]);}
    const events=decode(attempts[0]);expect(events).toHaveLength(1);
    const event=events[0];expect(event.event).toBe('$pageview');expect(event.uuid).toBeTruthy();expect(event.timestamp).toBeTruthy();
    const id=await page.evaluate(()=>window.posthog.get_distinct_id());expect(id).toBeTruthy();
    expect(event.properties).toEqual({token:key,distinct_id:id,$process_person_profile:false,$current_url:origin+route,$host:'glpclinicscout.com',$pathname:route});
    expect(attempts[0].referrer).toBe('');
    expect(await page.evaluate(()=>window.GCSAnalytics.event('quiz_complete',{quiz_answers:'CANARY_ANSWER',health_condition:'CANARY_CONDITION',form_contents:'CANARY_FORM',email:'CANARY_EMAIL'}))).toBe(true);
    await expect.poll(()=>attempts.length).toBe(2);
    const manual=decode(attempts[1])[0];expect(manual.event).toBe('quiz_complete');expect(manual.properties).toEqual(event.properties);
    expect(JSON.stringify(attempts.map(decode))).not.toMatch(/CANARY|quiz_answers|health_condition|form_contents|\$set|\$identify|\$referrer/);
    await page.getByRole('button',{name:'Got it',exact:true}).click();
    expect(await page.evaluate(()=>window.GCSConsent.purposes())).toEqual({analytics:'granted',advertising:'granted'});
    await page.waitForTimeout(100);expect(attempts).toHaveLength(2);
    expect(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}))).toEqual({local:['gcs_tracking_consent_v1'],session:[]});
    await page.getByRole('link',{name:'Cookie choices',exact:true}).click();await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();
    expect(await page.evaluate(()=>window.GCSAnalytics.event('$pageview'))).toBe(false);
    await page.waitForTimeout(300);expect(attempts).toHaveLength(2);
    const stored=await page.evaluate(()=>({local:{...localStorage},session:Object.keys(sessionStorage)}));
    expect(Object.keys(stored.local).sort()).toEqual(['__ph_opt_in_out_'+key,'gcs_tracking_consent_v1'].sort());
    expect(stored.local['__ph_opt_in_out_'+key]).toBe('0'); // SDK opt-out preference, not an identity.
    expect(JSON.parse(stored.local.gcs_tracking_consent_v1)).toMatchObject({analytics:'denied',advertising:'denied'});expect(stored.session).toEqual([]);
   }
   expect(unknown).toEqual([]);
   receipts.push({variant,initial_post_attempts:initialAttempts,total_post_attempts:attempts.length,all_locally_fulfilled:true,analytics_sha256:sha(analytics),executed_analytics_sha256:sha(source),consent_sha256:sha(consent),sdk_sha256:SDK_SHA,attempts});
  }finally{await context.close();}
 }
 await info.attach('posthog-real-sdk-contract',{body:JSON.stringify({scope:'intercepted actual SDK transport, not production ingestion',receipts}),contentType:'application/json'});
});
