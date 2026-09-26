import {expect} from '@playwright/test';
import {test,harness,snapshot} from '../a17-loader-browser-helper.mjs';
// Trust only this suite's self-signed loopback TEST transport; external
// requests are still fulfilled synthetically or aborted by the harness.
test.use({ignoreHTTPSErrors:true});
const negatives=['fresh','decline','analytics-only','gpc','stale','malformed','mismatched','withdrawn','missing-issuer','missing-scope','absent-cmp','unknown-jurisdiction','unknown-age','partial-ad-storage','partial-ad-user-data','personalization-enabled'];
for(const platform of ['meta','microsoft'])test(`${platform}: negative no-JS has zero scoped SDK/pageview/beacon/storage/collector`,async({browser,proxy},info)=>{
 const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',ignoreHTTPSErrors:true,proxy});
 try{
  const h=await harness(context,{platform,state:'granted',noJS:true});await h.page.waitForTimeout(100);const e=await snapshot(h);
  expect(e.sdk).toBe(0);expect(e.pageview).toBe(0);expect(e.beacon).toBe(0);expect(e.collector).toBe(0);expect(e.storage.advertisingCookies).toEqual([]);expect(e.storage.advertisingKeys).toEqual([]);expect(e.storage.successfulSandboxWrites).toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
  expect(await h.page.locator('iframe').count()).toBe(0);await info.attach('network-storage',{body:JSON.stringify({platform,state:'no-JS',...e},null,2),contentType:'application/json'});
 }finally{await context.close()}
});
for(const platform of ['meta','microsoft'])for(const state of negatives)test(`${platform}: negative ${state} has zero scoped SDK/pageview/beacon/storage/collector`,async({context},info)=>{
 const h=await harness(context,{platform,state});await h.page.waitForTimeout(120);
 const e=await snapshot(h);
 expect(e.sdk,'SDK fetches').toBe(0);expect(e.pageview,'automatic pageview requests').toBe(0);expect(e.beacon,'beacons').toBe(0);expect(e.collector,'collector requests').toBe(0);
 expect(e.storage.advertisingCookies,'vendor cookies').toEqual([]);expect(e.storage.advertisingKeys,'vendor storage').toEqual([]);expect(e.storage.successfulSandboxWrites,'sandbox writes').toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 expect(await h.page.locator('iframe').count()).toBe(0);
 await info.attach('network-storage',{body:JSON.stringify({platform,state,...e},null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])test(`${platform}: regrant requires fresh server permission revision and explicit choice`,async({context},info)=>{
 const h=await harness(context,{platform,state:'granted'});await expect.poll(()=>h.page.locator('iframe').count()).toBe(1);
 await h.page.getByRole('button',{name:'Cookie choices',exact:true}).click();await h.page.getByRole('button',{name:'Turn off tracking'}).click();await h.page.evaluate(()=>window.GCSConsent.whenSettled());
 const boundary=h.requests.length;await h.page.reload();await h.page.waitForFunction(()=>window.harnessReady);
 expect(await h.page.locator('iframe').count()).toBe(0);expect(h.requests.slice(boundary).filter(r=>r.category!=='local')).toEqual([]);
 await h.freshScope();await h.page.reload();await h.page.waitForFunction(()=>window.harnessReady);await h.page.getByRole('button',{name:'Cookie choices',exact:true}).click();
 await h.page.evaluate(async()=>{window.GCSConsent.apply({analytics:'denied',advertising:'granted'});await window.GCSConsent.whenSettled()});await expect.poll(()=>h.page.locator('iframe').count()).toBe(1);
 const e=await snapshot(h);expect(e.sdk).toBe(2);expect(e.pageview).toBe(0);expect(e.beacon).toBe(0);expect(e.collector).toBe(0);expect(e.storage.successfulSandboxWrites).toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify({...e,effective_deny_request_index:boundary,fresh_reviewed_revision:h.fixture.p.revision},null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])test(`${platform}: issuer DB failure after slow SDK fetch blocks evaluation`,async({context},info)=>{
 const h=await harness(context,{platform,state:'granted',slowSDK:true});await expect.poll(async()=>(await snapshot(h)).sdk).toBe(1);
 h.fixture.failReads(true);const boundary=h.requests.length;h.release();await h.page.waitForTimeout(160);
 expect(await h.page.locator('iframe').count()).toBe(0);const e=await snapshot(h);expect(e.requests.slice(boundary).filter(r=>r.category!=='local')).toEqual([]);expect(e.pageview).toBe(0);expect(e.beacon).toBe(0);expect(e.collector).toBe(0);expect(e.storage.successfulSandboxWrites).toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify({...e,effective_deny_request_index:boundary},null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])test(`${platform}: expiry tears down and never reuses the old grant`,async({context},info)=>{
 const h=await harness(context,{platform,state:'expiry'});await expect.poll(()=>h.page.locator('iframe').count()).toBe(1);
 await expect.poll(()=>h.page.locator('iframe').count(),{timeout:5000}).toBe(0);
 const boundary=h.requests.length;await h.page.evaluate(()=>window.GCSConsent.refresh());await h.page.waitForTimeout(100);
 const e=await snapshot(h);expect(e.requests.slice(boundary).filter(r=>r.category!=='local')).toEqual([]);
 expect(e.pageview).toBe(0);expect(e.beacon).toBe(0);expect(e.collector).toBe(0);expect(e.storage.successfulSandboxWrites).toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify({...e,effective_deny_request_index:boundary},null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])test(`${platform}: cross-tab withdrawal and reload cannot restore prior permission`,async({context},info)=>{
 const h=await harness(context,{platform,state:'granted'});await expect.poll(()=>h.page.locator('iframe').count()).toBe(1);
 const second=await context.newPage();await second.goto(h.origin+'/test/administrative/');await second.waitForFunction(()=>window.harnessReady);await expect.poll(()=>second.locator('iframe').count()).toBe(1);
 await second.getByRole('button',{name:'Cookie choices',exact:true}).click();await second.getByRole('button',{name:'Turn off tracking'}).click();
 await expect.poll(()=>h.page.locator('iframe').count()).toBe(0);const boundary=h.requests.length;
 await h.page.reload();await h.page.waitForFunction(()=>window.harnessReady);await h.page.waitForTimeout(120);
 expect(await h.page.locator('iframe').count()).toBe(0);
 const e=await snapshot(h);expect(e.requests.slice(boundary).filter(r=>r.category!=='local')).toEqual([]);expect(e.pageview).toBe(0);expect(e.beacon).toBe(0);expect(e.collector).toBe(0);expect(e.storage.successfulSandboxWrites).toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify({...e,effective_deny_request_index:boundary},null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])test(`${platform}: SPA navigation invalidates the classified source`,async({context},info)=>{
 const h=await harness(context,{platform,state:'granted'});await expect.poll(()=>h.page.locator('iframe').count()).toBe(1);
 await h.page.evaluate(()=>history.pushState({},'', '/lp/quiz/?answer=TEST'));await h.page.waitForTimeout(180);
 expect(await h.page.locator('iframe').count()).toBe(0);
 const e=await snapshot(h);expect(e.sdk).toBe(1);expect(e.pageview).toBe(0);expect(e.beacon).toBe(0);expect(e.collector).toBe(0);expect(e.storage.successfulSandboxWrites).toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify(e,null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])for(const delayed of [false,true])test(`${platform}: withdrawal destroys context and cancels ${delayed?'slow':'loaded'} SDK work`,async({context},info)=>{
 const h=await harness(context,{platform,state:'granted',slowSDK:delayed});
 await expect.poll(async()=>(await snapshot(h)).sdk).toBe(1);
 if(!delayed)await expect.poll(()=>h.page.locator('iframe').count()).toBe(1);
 await h.page.getByRole('button',{name:'Cookie choices',exact:true}).click();await h.page.getByRole('button',{name:'Turn off tracking'}).click();
 const boundary=h.requests.length;h.release();await h.page.waitForTimeout(160);
 expect(await h.page.locator('iframe').count()).toBe(0);
 expect(await h.page.evaluate(()=>window.GCSConsent.purposes().advertising)).toBe('denied');
 const evidence=await snapshot(h);expect(evidence.requests.slice(boundary).filter(r=>r.category!=='local')).toEqual([]);
 expect(evidence.pageview).toBe(0);expect(evidence.beacon).toBe(0);expect(evidence.collector).toBe(0);expect(evidence.storage.successfulSandboxWrites).toEqual([]);expect(evidence.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify({...evidence,effective_deny_request_index:boundary},null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])test(`${platform}: first grant after install and repeated consent updates are idempotent`,async({context},info)=>{
 const h=await harness(context,{platform});
 await h.page.evaluate(async()=>{window.GCSConsent.apply({analytics:'denied',advertising:'granted'});await window.GCSConsent.whenSettled()});
 await expect.poll(async()=>(await snapshot(h)).sdk).toBe(1);
 await h.page.evaluate(()=>{window.GCSConsent.refresh();window.GCSConsent.refresh()});
 await h.page.getByRole('button',{name:'Cookie choices',exact:true}).click();await h.page.getByRole('button',{name:'Install loader'}).click();
 await h.page.waitForTimeout(120);const e=await snapshot(h);expect(e.sdk).toBe(1);expect(e.storage.successfulSandboxWrites).toEqual([]);expect(e.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify(await snapshot(h),null,2),contentType:'application/json'});
});
for(const platform of ['meta','microsoft'])test(`${platform}: issuer grant before lazy install fetches and executes contained SDK once`,async({context},info)=>{
 const h=await harness(context,{platform,state:'granted',lateInstall:true});
 expect((await snapshot(h)).sdk).toBe(0);
 await h.page.getByRole('button',{name:'Install loader'}).click();
 await expect.poll(()=>h.page.locator('iframe').count()).toBe(1);
 await expect.poll(async()=>(await snapshot(h)).sdk).toBe(1);
 await expect.poll(()=>h.page.evaluate(()=>window.fixtureMessages.filter(m=>m.kind==='sdk-command').length)).toBeGreaterThan(0);
 await expect.poll(()=>h.page.evaluate(()=>window.fixtureMessages.filter(m=>m.kind==='csp-blocked').length)).toBeGreaterThan(0);
 const evidence=await snapshot(h);
 const inherited=evidence.messages.find(m=>m.kind==='inherited-consent').queue;
 expect(inherited).toContainEqual(platform==='meta'?['consent','grant']:['consent','default',{ad_storage:'granted'}]);
 expect(evidence.pageview).toBe(0);expect(evidence.beacon).toBe(0);expect(evidence.collector).toBe(0);expect(evidence.storage.successfulSandboxWrites).toEqual([]);expect(evidence.storage.unresolvedSandboxWrites,'unresolved sandbox effects').toEqual([]);
 await info.attach('network-storage',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
});
