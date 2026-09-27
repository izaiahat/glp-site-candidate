import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { loadGoSelection } from '../../src/go-runtime-selection.mjs';
import {bindEmittedConsent} from '../../scripts/consent-emitted-binding.mjs';
import {assertEmittedLoaderSemantics} from '../helpers/ga4-semantic-contract.mjs';
const semanticReceipts = new Map();

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = process.env.GLP_REVIEW_PUBLIC_ROOT || path.join(ROOT, 'public');
const BUILD_STAGE = JSON.parse(readFileSync(path.join(ROOT, 'artifacts/ops/build-report.json'), 'utf8')).release_stage;
if (!['candidate','production-seal'].includes(BUILD_STAGE) || (process.env.GCS_RELEASE_STAGE && process.env.GCS_RELEASE_STAGE !== BUILD_STAGE)) throw new Error('release_consent_build_stage_mismatch');
const PRODUCTION_SEAL = BUILD_STAGE === 'production-seal';
const ROUTES = ['/', '/providers/', '/tools/glp-1-cost-calculator/', '/lp/quiz/', '/quiz/provider-fit/', '/reviews/nu-image-medical-review/', '/reviews/mydrhank/'];
const sha = value => createHash('sha256').update(value).digest('hex');
const read = relative => readFileSync(path.join(PUBLIC, relative));
const SETTLE_MS = 300; // Bounded observation window, not a retry or a latency claim.
const ALLOW = {
  local: ['gcs_tracking_consent_v1', 'gcs.visit.v1', 'gcs.state.v1'],
  session: ['gcs.visit.session.v1'],
  cookie: ['gcs_analytics_consent'],
};
// These are preferences/local UI functionality, not analytics identifiers:
// consent-runtime.mjs; site.js returning welcome/state and visit-session owners.
// No prefix/wildcard exception, including cs_click_id, is permitted here.
const tracking = JSON.parse(readFileSync(path.join(ROOT, 'data/tracking-allowed-hosts.json'))).programs;
const selections = Object.values(loadGoSelection().programs);
const affiliateHosts = new Set(Object.values(tracking).flatMap(row => row.allowed_hosts || []));

function sourceInventory(route) {
  const bytes = read(route.slice(1) + 'index.html');
  const html = bytes.toString();
  const configMatch = html.match(/window\.GCS_POSTHOG=(\{[^;]+\});/);
  expect(configMatch, `${route}: source-bound PostHog config`).toBeTruthy();
  const config = JSON.parse(configMatch[1]);
  expect(config.host).toBe('https://us.i.posthog.com');
  expect(config.enabled).toBe(PRODUCTION_SEAL);
  const scripts = [], affiliates = [];
  function walk(node) {
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    if (node.tagName === 'script' && attrs.src) scripts.push(attrs.src);
    if (node.tagName === 'a' && attrs['data-analytics-event'] === 'affiliate_click') {
      const url = new URL(attrs.href, 'https://glpclinicscout.com');
      const selected = selections.find(row => row.route === url.pathname);
      const host = url.pathname.startsWith('/go/') ? new URL(selected.issued_link).hostname : url.hostname;
      expect(tracking[attrs['data-program']]?.allowed_hosts, 'actual affiliate host belongs to named program').toContain(host);
      affiliates.push({ program: attrs['data-program'], mode: attrs['data-link-mode'], destination_host: host, href_sha256: sha(attrs.href) });
    }
    for (const child of node.childNodes || []) walk(child);
    if (node.content) walk(node.content);
  }
  walk(parse(html));
  const consent = scripts.find(src => /^\/assets\/consent\.js(?:\?|$)/.test(src));
  const analytics = scripts.find(src => /^\/assets\/analytics(?:\.[a-f0-9]+)?\.js(?:\?|$)/.test(src));
  expect(consent).toBeTruthy(); expect(analytics).toBeTruthy();
  const bound = src => ({src, sha256: sha(read(new URL(src, 'https://glpclinicscout.com').pathname.slice(1)))});
  expect(read('meta-pixel.js').toString()).toContain('disabled pending governed release integration');
  const emittedConsent=read(new URL(consent, 'https://glpclinicscout.com').pathname.slice(1)).toString();
  const digest=sha(emittedConsent);
  if(!semanticReceipts.has(digest)){
    const binding=bindEmittedConsent(ROOT,PUBLIC,emittedConsent);
    semanticReceipts.set(digest,{...assertEmittedLoaderSemantics(emittedConsent),binding});
  }
  expect(scripts.filter(src=>new URL(src,'https://glpclinicscout.com').hostname==='www.googletagmanager.com')).toEqual([]);
  return {route, html_sha256:sha(bytes), posthog_host:config.host, posthog_enabled:config.enabled,
    google:semanticReceipts.get(digest), meta:'disabled shipped compatibility stub',
    consent:bound(consent), analytics:bound(analytics), affiliates};
}

function classify(request, origin, fixture) {
  const url = new URL(request.url()), method = request.method();
  if (url.origin !== origin) return affiliateHosts.has(url.hostname) ? 'affiliate-navigation' :
    /(?:posthog|google-analytics|googletagmanager|clarity|facebook)\./.test(url.hostname) ? 'vendor-tracking' : 'external-unclassified';
  if (fixture && url.pathname === '/__d1_sink/capture' && method === 'POST' && !url.search) return 'analytics-sink';
  if (fixture && url.pathname === '/__d1_sink/static/array.js' && method === 'GET' && !url.search) return 'analytics-sdk';
  if (!['GET','HEAD'].includes(method)) return 'first-party-nonessential';
  if (url.pathname === '/api/geo-state' && ['', '?purpose=consent'].includes(url.search)) return 'essential-region';
  if (fixture && url.pathname === '/__d1_enabled_fixture__/' && !url.search) return 'essential-document';
  const normalizedListing = url.pathname === '/providers/' && url.search === '?plan=both&sort=cheapest';
  if ([...ROUTES, '/privacy/', '/privacy/cookies/'].includes(url.pathname) && (!url.search || normalizedListing) && request.resourceType() === 'document') return 'essential-document';
  // Only real emitted static resources, not arbitrary same-origin GET/HEADs.
  const file = path.resolve(PUBLIC, '.' + url.pathname);
  const queryOkay = !url.search || /^\?v=[a-f0-9]{8,64}$/.test(url.search);
  if (file.startsWith(path.resolve(PUBLIC)+path.sep) && existsSync(file) && statSync(file).isFile()
      && queryOkay && !['document','fetch','xhr','ping'].includes(request.resourceType())) return 'essential-resource';
  // Lazy provider payloads are emitted JSON, fetched by the listing renderer.
  if (/^\/assets\/provider-card-payloads\.[a-f0-9]+\.json$/.test(url.pathname) && !url.search && existsSync(file)) return 'essential-resource';
  return 'first-party-nonessential';
}

async function observe(context, origin, {fixture=false, fulfill=null}={}) {
  let phase='initial';
  const attempts=[], writes=[], snapshots=[], seen=new Map();
  const record = request => {
    if (seen.has(request)) return seen.get(request);
    const url=new URL(request.url()), headers=request.headers(), referrer=headers.referer || '';
    const ref = referrer ? new URL(referrer) : null;
    const safeReferrer = !ref || (ref.origin === origin && (!ref.search || /^\?v=[a-f0-9]{8,64}$/.test(ref.search)
      || (ref.pathname === '/providers/' && ref.search === '?plan=both&sort=cheapest')));
    const row={phase, method:request.method(), type:request.resourceType(), category:classify(request,origin,fixture),
      host:url.hostname, path:url.pathname, query_keys:[...url.searchParams.keys()], query_sha256:sha(url.search),
      target_sha256:sha(request.url()), referrer_sha256:sha(referrer), referrer_present:!!referrer,
      referrer_category:safeReferrer?'absent-or-approved-same-origin':'unapproved-origin-or-query',
      body_sha256:sha(request.postData() || ''), disposition:'pending'};
    attempts.push(row); seen.set(request,row); return row;
  };
  context.on('request', record); // Context scope includes new pages and popups.
  // WebKit can deliver speculative local font requests without a route callback.
  // Account for real response bytes, never waive a pending request by URL alone.
  context.on('response', async response => {
    const request=response.request(), row=record(request), url=new URL(request.url());
    if(!fixture && row.disposition==='pending' && url.origin===origin && row.category==='essential-resource') {
      try { if(response.status()===200 && (await response.body()).equals(read(url.pathname.slice(1))) && row.disposition==='pending') row.disposition='verified-local-response'; } catch { /* unreadable remains unverified */ }
    }
  });
  context.on('requestfailed', request => {const row=record(request);if(row.disposition==='pending')row.disposition='failed-before-route';});
  await context.exposeBinding('__d1StorageWrite', (_, value) => {
    writes.push({phase, area:value.area, key:value.key, operation:value.operation, value_sha256:sha(value.value || '')});
  });
  await context.addInitScript(() => {
    const notify = value => { void window.__d1StorageWrite(value); };
    const localTarget=window.localStorage, sessionTarget=window.sessionStorage;
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(key,value) {
      notify({area:this===localTarget?'local':'session',operation:'set',key:String(key),value:String(value)});
      return set.call(this,key,value);
    };
    Storage.prototype.removeItem = function(key) {
      notify({area:this===localTarget?'local':'session',operation:'remove',key:String(key)});
      return remove.call(this,key);
    };
    // Delegating proxies observe named-property writes too, including transient
    // assign/delete pairs. Reads, enumeration and mutations use the real stores.
    for(const [name,target,area] of [['localStorage',localTarget,'local'],['sessionStorage',sessionTarget,'session']]) {
      const proxy=new Proxy(target,{
        get(object,key){const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;},
        set(object,key,value){notify({area,operation:'set',key:String(key),value:String(value)});return Reflect.set(object,key,value,object);},
        defineProperty(object,key,descriptor){notify({area,operation:'set',key:String(key),value:String(descriptor.value)});return Reflect.defineProperty(object,key,descriptor);}
      });
      Object.defineProperty(window,name,{configurable:true,get:()=>proxy});
    }
    let proto=document, descriptor;
    while (proto && !(descriptor=Object.getOwnPropertyDescriptor(proto,'cookie'))) proto=Object.getPrototypeOf(proto);
    Object.defineProperty(document,'cookie',{configurable:true,get(){return descriptor.get.call(document);},set(value){
      notify({area:'cookie',operation:'set',key:String(value).split('=',1)[0].trim(),value:String(value)});
      return descriptor.set.call(document,value);
    }});
  });
  await context.route('**/*', async interception => {
    const request=interception.request(), row=record(request);
    if (fulfill && await fulfill(interception,row)) { row.disposition='fulfilled-local'; return; }
    if (row.category.startsWith('essential-') && !fixture) {
      row.disposition='continued-loopback'; return interception.continue();
    }
    row.disposition='aborted-before-network'; return interception.abort('blockedbyclient');
  });
  async function snapshot(page) {
    await page.waitForTimeout(SETTLE_MS);
    const storage=await page.evaluate(() => ({local:{...localStorage}, session:{...sessionStorage}}));
    const cookies=await context.cookies(); // Real jar, including HttpOnly cookies.
    const state={phase, local:Object.keys(storage.local), session:Object.keys(storage.session),
      values:{local:Object.fromEntries(Object.entries(storage.local).map(([k,v])=>[k,sha(v)])),session:Object.fromEntries(Object.entries(storage.session).map(([k,v])=>[k,sha(v)]))},
      cookies:cookies.map(c=>({name:c.name,domain:c.domain,path:c.path,httpOnly:c.httpOnly,secure:c.secure,sameSite:c.sameSite,value_sha256:sha(c.value)}))};
    snapshots.push(state); return {state,storage,cookies};
  }
  function violations() {
    return [
      ...attempts.filter(r=>r.referrer_category==='unapproved-origin-or-query').map(r=>'referrer:'+r.path),
      ...attempts.filter(r => !r.category.startsWith('essential-') && !(fixture && ['default-granted','analytics-granted'].includes(r.phase) && ['analytics-sdk','analytics-sink'].includes(r.category))).map(r=>'request:'+r.category+':'+r.path),
      ...writes.filter(r=>r.operation==='set' && !ALLOW[r.area].includes(r.key)).map(r=>'write:'+r.area+':'+r.key),
      ...snapshots.flatMap(s=>[...s.local.filter(k=>!ALLOW.local.includes(k)).map(k=>'stored:local:'+k),...s.session.filter(k=>!ALLOW.session.includes(k)).map(k=>'stored:session:'+k),...s.cookies.filter(c=>!ALLOW.cookie.includes(c.name)).map(c=>'cookie:'+c.name)]),
    ];
  }
  function assertClean() { const errors=violations(); if(errors.length) throw new Error('D1 privacy oracle: '+errors.join('; ')); }
  return {attempts,writes,snapshots,snapshot,violations,assertClean,setPhase(value){phase=value;},
    receipt:()=>({scope:fixture?'isolated enabled-consumer fixture, not live acceptance':'candidate UI no-egress and preferences only',allowlist:ALLOW,observation_window_ms:SETTLE_MS,attempts,writes,snapshots})};
}

async function openChoices(page) {
  const manage=page.locator('#gcs-consent [data-consent-open]');
  if(await manage.isVisible()) await manage.click();
  else {
    const cookie=page.locator('a[href^="/privacy/cookies/"]:visible').first();
    if(await cookie.count()) await cookie.click();
    else {
      // The focused quiz hides the global footer. Follow its real, visible
      // Privacy link to the legal page and then Cookie choices, not a fake open().
      await page.locator('a[href="/privacy/"]:visible').first().click({timeout:8000});
      await page.evaluate(()=>window.GCSConsentReady);
      await page.locator('a[href^="/privacy/cookies/"]:visible').first().click();
    }
    if(new URL(page.url()).pathname==='/privacy/cookies/') {
      await page.evaluate(()=>window.GCSConsentReady);
      await page.locator('[data-consent-open]').first().click();
    }
  }
  await expect(page.locator('[data-consent="denied"]')).toBeVisible();
}

// No policy/config/SDK/geography/synthetic overrides. The emitted stage is bound
// to the build receipt; local/synthetic execution stays no-egress in both stages.
// A positive grant proof is separate and runs the emitted production policy.
for (const route of ROUTES) {
  test(`D1 candidate UI no-egress and preference transitions ${route}`, async ({page,context,baseURL},info) => {
    const inventory=sourceInventory(route), audit=await observe(context,new URL(baseURL).origin);
    const phases=[];
    const check=async choice => {
      await expect.poll(()=>page.evaluate(()=>window.GCSConsent.effective())).toBe(choice);
      const sample=await audit.snapshot(page);
      const state=await page.evaluate(()=>({effective:window.GCSConsent.effective(),purposes:window.GCSConsent.purposes(),exports:window.GCSConsent.allowsExports(),policy:window.GCS_EXPORT_POLICY}));
      expect(JSON.parse(sample.storage.local.gcs_tracking_consent_v1)).toMatchObject({analytics:choice,advertising:choice,record_type:'preference_only'});
      expect(state.purposes).toEqual({analytics:choice,advertising:choice});
      expect(state.exports).toBe(false);
      expect(state.policy).toMatchObject({stage:BUILD_STAGE,third_party_exports:PRODUCTION_SEAL});
      for(const cookie of sample.cookies.filter(c=>c.name==='gcs_analytics_consent')) expect(cookie.value).toBe(choice);
      phases.push(state); audit.assertClean();
    };
    try {
      const response=await page.goto(route,{waitUntil:'networkidle'});
      expect(response.status()).toBe(200); expect(sha(await response.body())).toBe(inventory.html_sha256);
      await page.evaluate(()=>window.GCSConsentReady); await audit.snapshot(page); audit.assertClean();
      await check('granted');
      await expect(page.locator('#gcs-consent button')).toHaveCount(1);
      await expect(page.locator('#gcs-consent input')).toHaveCount(0);
      await page.getByRole('button',{name:'Got it',exact:true}).click();await check('granted');
      await openChoices(page); audit.setPhase('denied');
      await page.getByRole('button',{name:'Turn off tracking',exact:true}).click(); await check('denied');
      audit.setPhase('denied-reload'); await page.reload({waitUntil:'networkidle'}); await page.evaluate(()=>window.GCSConsentReady); await check('denied');
      expect(await page.evaluate(()=>window.GCSAnalytics.event('comparison_sort_change',{quiz_answers:'D1_SYNTHETIC_CANARY',email:'d1@example.invalid'}))).toBe(false);
      if(route === '/reviews/nu-image-medical-review/') {
        const held = selections.find(row => row.program_id === 'nu-image-medical-review');
        expect(held.disposition).toBe('HOLD');
        expect(held.promotion_authorized).toBe(false);
        await expect(page.locator('a[data-analytics-event="affiliate_click"], a[rel~="sponsored"], a[href^="/go/"]')).toHaveCount(0);
      } else if(route.startsWith('/reviews/')) {
        const anchor=page.locator('a[data-analytics-event="affiliate_click"]').first();
        const before=await anchor.getAttribute('href');
        await page.evaluate(()=>{window.__d1Cta=[];document.addEventListener('click',event=>{const link=event.target.closest('a[data-analytics-event="affiliate_click"]');if(link){event.preventDefault();window.__d1Cta.push({trusted:event.isTrusted,program:link.dataset.program});}},true);});
        await anchor.click(); expect(await page.evaluate(()=>window.__d1Cta)).toEqual([{trusted:true,program:await anchor.getAttribute('data-program')}]);
        expect(await anchor.getAttribute('href')).toBe(before); await check('denied');
      }
      await openChoices(page); audit.setPhase('regranted');
      await page.getByRole('button',{name:'Turn on tracking',exact:true}).click();
      if(new URL(page.url()).pathname!==route) {await page.goto(route,{waitUntil:'networkidle'});await page.evaluate(()=>window.GCSConsentReady);}
      await check('granted');
      audit.setPhase('regranted-reload'); await page.goto(route,{waitUntil:'networkidle'}); await page.evaluate(()=>window.GCSConsentReady); await check('granted');
      await openChoices(page); audit.setPhase('revoked');
      await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();
      if(new URL(page.url()).pathname!==route) {await page.goto(route,{waitUntil:'networkidle'});await page.evaluate(()=>window.GCSConsentReady);}
      expect(await page.evaluate(()=>window.GCSAnalytics.event('comparison_sort_change',{}))).toBe(false); await check('denied');
      expect(audit.attempts.every(r=>r.disposition!=='pending')).toBe(true);
    } finally { await info.attach('D1-candidate-privacy-observation',{body:JSON.stringify({inventory,phases,...audit.receipt()}),contentType:'application/json'}); }
  });
}

// Deliberately ungated transport adapter: it always attempts capture when called.
// Thus a shipped emit() consent bug cannot be hidden by a second mock SDK gate.
// Preserve a pre-runtime fetch reference only in this isolated fixture: the
// new production transport barrier must not mask an emitter regression here.
// Real-SDK transport containment is independently exercised in the strict suite.
const LOCAL_SDK = `window.posthog={init(key,options){window.__d1SdkOptions=options;},opt_in_capturing(){},opt_out_capturing(){window.__d1OptOuts=(window.__d1OptOuts||0)+1;},capture(event,properties){window.__d1UngatedFetch('/__d1_sink/capture',{method:'POST',body:JSON.stringify({event,properties}),referrerPolicy:'no-referrer'});}};`;

test('D1 isolated enabled consumer permits analytics grant and blocks fresh post-revoke attempts',async({page,context},info)=>{
  const origin='https://glpclinicscout.com', inventory=sourceInventory('/');
  const captures=[];
  // Explicit TEST authority only. No candidate HTML is rewritten, and no live
  // production-origin request is continued. The actual shipped runtimes follow.
  const fixture=`<!doctype html><html><head><meta name="referrer" content="no-referrer"><script>
window.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true,reason:'D1 isolated test fixture only'};
window.GCS_ANALYTICS={enabled:true,consent:'unknown',measurement_id:'G-D1-FIXTURE',gtm_container_id:'GTM-D1-FIXTURE'};
window.GCS_POSTHOG={enabled:true,api_key:'D1_LOCAL_NON_CREDENTIAL',host:'${origin}/__d1_sink'};
</script><script defer src="${inventory.consent.src}"></script><script defer src="${inventory.analytics.src}"></script><script defer src="/meta-pixel.js"></script></head><body><h1>Isolated consent consumer fixture</h1><footer><a href="/privacy/cookies/">Cookie choices</a></footer></body></html>`;
  await context.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{configurable:true,get:()=>false});window.__d1UngatedFetch=window.fetch.bind(window);});
  const audit=await observe(context,origin,{fixture:true,fulfill:async(interception,row)=>{
    const url=new URL(interception.request().url());
    if(url.origin!==origin)return false;
    if(url.pathname==='/__d1_enabled_fixture__/') {await interception.fulfill({status:200,contentType:'text/html',body:fixture});return true;}
    if(row.category==='essential-region') {await interception.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'glp-consent-region-v1',model:'prior-opt-in'})});return true;}
    if(row.category==='essential-resource') {await interception.fulfill({status:200,contentType:'text/javascript',body:read(url.pathname.slice(1))});return true;}
    if(row.category==='analytics-sdk') {await interception.fulfill({status:200,contentType:'text/javascript',body:LOCAL_SDK});return true;}
    if(row.category==='analytics-sink') {captures.push({phase:row.phase,...JSON.parse(interception.request().postData())});await interception.fulfill({status:204,body:''});return true;}
    return false;
  }});
  const check=async choice=>{
    const sample=await audit.snapshot(page);
    expect(JSON.parse(sample.storage.local.gcs_tracking_consent_v1)).toMatchObject({analytics:choice,advertising:choice});
    expect(sample.cookies.map(c=>[c.name,c.value])).toEqual([['gcs_analytics_consent',choice]]);
    expect(await page.evaluate(()=>window.GCSConsent.purposes())).toEqual({analytics:choice,advertising:choice});
    expect(await page.evaluate(()=>window.GCSConsent.allowsExports('advertising'))).toBe(choice==='granted');
    audit.assertClean();
  };
  try {
    audit.setPhase('default-granted');
    await page.goto(origin+'/__d1_enabled_fixture__/');await page.evaluate(()=>window.GCSConsentReady);
    await page.waitForFunction(()=>!!window.__d1SdkOptions);
    await check('granted');
    await expect(page.locator('#gcs-consent button')).toHaveCount(1);
    await expect(page.locator('#gcs-consent input')).toHaveCount(0);
    expect(await page.evaluate(()=>window.GCSAnalytics.event('comparison_sort_change',{quiz_answers:'D1_DEFAULT_CANARY',health_condition:'D1_DEFAULT_CANARY',page_url:'/guides/diabetes/?D1_DEFAULT_CANARY'}))).toBe(true);
    await expect.poll(()=>captures.length).toBe(1);
    expect(captures).toEqual([{phase:'default-granted',event:'comparison_sort_change',properties:{}}]);
    await page.getByRole('button',{name:'Got it',exact:true}).click();await check('granted');
    await expect(page.locator('#gcs-consent')).toHaveCount(0);
    await openChoices(page);audit.setPhase('denied');await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();
    expect(await page.evaluate(()=>window.GCSAnalytics.event('comparison_sort_change',{}))).toBe(false); await check('denied'); expect(captures.length).toBe(1);
    await openChoices(page); audit.setPhase('analytics-granted');await page.getByRole('button',{name:'Turn on tracking',exact:true}).click();
    await page.waitForFunction(()=>!!window.__d1SdkOptions);
    expect(await page.evaluate(()=>window.GCSConsent.allowsExports('analytics'))).toBe(true);
    expect(await page.evaluate(()=>window.GCSAnalytics.event('comparison_sort_change',{email:'D1_CANARY',quiz_answers:'D1_CANARY',health_condition:'D1_CANARY',page_url:'/guides/diabetes/?D1_CANARY'}))).toBe(true);
    await expect.poll(()=>captures.length).toBe(2);expect(captures).toEqual([{phase:'default-granted',event:'comparison_sort_change',properties:{}},{phase:'analytics-granted',event:'comparison_sort_change',properties:{}}]);await check('granted');
    expect(await page.evaluate(()=>({advertising:window.GCSConsent.allowsExports('ad_measurement'),meta:window.glpMetaTrackLead({quiz_answers:'D1_AD_CANARY',health_condition:'D1_AD_CANARY',page_url:'/guides/diabetes/?D1_AD_CANARY'}),googleHeld:window.GCS_GTM_HELD}))).toEqual({advertising:true,meta:'',googleHeld:'A11 containment unbound'});
    expect(await page.evaluate(()=>JSON.stringify(window.dataLayer))).not.toMatch(/D1_.*CANARY|quiz_answers|health_condition|\/guides\/diabetes/);
    await openChoices(page); audit.setPhase('revoked');await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();
    const before=captures.length;
    expect(await page.evaluate(()=>window.GCSAnalytics.event('comparison_sort_change',{email:'D1_NEW_POST_REVOKE_CANARY'}))).toBe(false);
    await check('denied');expect(captures.length).toBe(before);
    expect(audit.attempts.filter(r=>r.phase==='revoked' && r.category.startsWith('analytics'))).toEqual([]);
    expect(await page.evaluate(()=>window.__d1OptOuts)).toBeGreaterThan(0);
    audit.setPhase('gpc');
    await context.addInitScript(()=>Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,get:()=>true}));
    await page.evaluate(()=>localStorage.removeItem('gcs_tracking_consent_v1'));
    await page.reload();await page.evaluate(()=>window.GCSConsentReady);
    await check('denied');
    await page.getByRole('button',{name:'Got it',exact:true}).click();await check('denied');
    expect(await page.evaluate(()=>window.GCSAnalytics.event('comparison_sort_change',{}))).toBe(false);
    expect(captures.length).toBe(before);
    expect(audit.attempts.filter(r=>r.phase==='gpc'&&r.category.startsWith('analytics'))).toEqual([]);
    expect(audit.attempts.every(r=>r.disposition==='fulfilled-local')).toBe(true);
  } finally {await info.attach('D1-enabled-consumer-fixture',{body:JSON.stringify({inventory,captures,fixture_sha256:sha(fixture),adapter_sha256:sha(LOCAL_SDK),synthetic_override:'webdriver false in isolated fixture only',...audit.receipt()}),contentType:'application/json'});}
});

test('D1 privacy oracle rejects injected first-party tracking and transient storage writes',async({page,context,baseURL},info)=>{
  const audit=await observe(context,new URL(baseURL).origin);
  try {
    await page.goto('/');await page.evaluate(()=>window.GCSConsentReady);await openChoices(page);audit.setPhase('denied');await page.getByRole('button',{name:'Turn off tracking',exact:true}).click();await audit.snapshot(page);audit.assertClean();
    await page.evaluate(()=>{
      void fetch('/__d1_tracking.gif?canary=D1_NEGATIVE',{method:'HEAD'}).catch(()=>{});
      navigator.sendBeacon('/__d1_beacon?canary=D1_NEGATIVE','D1_NEGATIVE');
      const script=document.createElement('script');script.src='/__d1_tracking.js?canary=D1_NEGATIVE';document.head.append(script);
      window.open('/__d1_popup?canary=D1_NEGATIVE','_blank');
      localStorage.setItem('__d1_tracker','D1_NEGATIVE');localStorage.removeItem('__d1_tracker');
      sessionStorage.setItem('__d1_tracker','D1_NEGATIVE');sessionStorage.removeItem('__d1_tracker');
      localStorage.__d1_named='D1_NEGATIVE';delete localStorage.__d1_named;
      sessionStorage.__d1_named='D1_NEGATIVE';delete sessionStorage.__d1_named;
      document.cookie='__d1_tracker=D1_NEGATIVE; Path=/';document.cookie='__d1_tracker=; Max-Age=0; Path=/';
    });
    await context.addCookies([{name:'__d1_http_only',value:'D1_NEGATIVE',url:baseURL,httpOnly:true,sameSite:'Lax'}]);
    await audit.snapshot(page);
    expect(audit.violations()).toContain('cookie:__d1_http_only');
    for(const area of ['local','session'])expect(audit.violations()).toContain(`write:${area}:__d1_named`);
    expect(audit.attempts.filter(r=>r.path.startsWith('/__d1_')).length).toBeGreaterThanOrEqual(4);
    expect(audit.attempts.filter(r=>r.path.startsWith('/__d1_')).every(r=>r.disposition==='aborted-before-network' && r.query_keys.includes('canary'))).toBe(true);
    expect(audit.violations().some(v=>v.startsWith('request:'))).toBe(true);
    for(const area of ['local','session','cookie'])expect(audit.violations()).toContain(`write:${area}:__d1_tracker`);
    expect(()=>audit.assertClean()).toThrow(/D1 privacy oracle/);
    // Removal cannot erase the observed attempted write.
    expect(await page.evaluate(()=>[localStorage.getItem('__d1_tracker'),sessionStorage.getItem('__d1_tracker')])).toEqual([null,null]);
  } finally {await info.attach('D1-privacy-oracle-negative',{body:JSON.stringify({...audit.receipt(),detected_violations:audit.violations()}),contentType:'application/json'});}
});
