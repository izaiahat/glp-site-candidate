import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './d2o-consent-lifecycle.test.mjs';
import {fixtureAdapter} from './d2o-server-consent.test.mjs';
import {leanLegalPages} from '../src/legal-pages.mjs';
const press=(root,choice)=>{const button=root.querySelector('[data-consent="'+choice+'"]');assert.ok(button,'rendered consent action '+choice);root.click({target:{closest:()=>button}})};
const noAdvertising=root=>{for(const id of ['#gcs-advertising-purpose','#gcs-advertising-reason','#gcs-consent-advertising'])assert.equal(root.querySelector(id),null);assert.doesNotMatch(root.innerHTML,/<input|type="checkbox"| checked|gcs-advertising-purpose|gcs-advertising-reason|gcs-consent-advertising/)};
for(const analytics of ['denied','granted'])for(const advertising of ['denied','granted'])test('US notice omits advertising controls and denies requested advertising '+analytics+'/'+advertising,()=>{
 const f=boot();f.ready();let root=f.document.querySelector('#gcs-consent');
 noAdvertising(root);assert.equal((root.innerHTML.match(/<button /g)||[]).length,1);assert.match(root.innerHTML,/data-consent="acknowledge">Got it/);
 assert.match(root.querySelector('#gcs-consent-copy').textContent,/Health quiz answers are never sent to analytics; advertising stays off\./);
 assert.equal(f.c.read().analytics,'granted');assert.equal(f.c.read().analytics_basis,'us_default');assert.equal(f.c.read().notice_acknowledged,false);
 press(root,'acknowledge');assert.equal(f.document.querySelector('#gcs-consent'),null);assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'us_default');assert.equal(f.c.read().notice_acknowledged,true);
 f.c.apply({analytics,advertising});assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.c.read().advertising,'denied');
 assert.equal(f.c.purposes().analytics,analytics);assert.equal(f.c.allowsExports('advertising'),false);assert.equal(f.c.allowsExports('ad_measurement'),false);
 f.c.open();root=f.document.querySelector('#gcs-consent');noAdvertising(root);assert.ok(root.querySelector('[data-consent="granted"]'));
 press(root,'denied');assert.equal(f.c.effective(),'denied');assert.equal(f.c.read().analytics,'denied');assert.equal(f.c.read().advertising,'denied');assert.equal(f.c.allowsExports(),false);
});
test('GPC and failed confirmation use reader-language reasons without an unavailable choice',async()=>{
 const g=boot({gpc:true,adapter:fixtureAdapter()});g.ready();
 assert.equal(g.c.advertisingStatus().reason,"Your browser's Global Privacy Control is on, so advertising measurement stays off.");
 const notice=g.document.querySelector('#gcs-consent');noAdvertising(notice);assert.match(notice.querySelector('#gcs-consent-copy').textContent,/Global Privacy Control keeps analytics and advertising off/);
 press(notice,'acknowledge');assert.equal(g.c.effective(),'denied');assert.equal(g.c.read().analytics,'denied');assert.equal(g.c.read().advertising,'denied');assert.equal(g.c.allowsExports(),false);
 g.c.open();const managed=g.document.querySelector('#gcs-consent');assert.equal(managed.querySelector('[data-consent="granted"]').disabled,true);press(managed,'granted');assert.equal(g.c.effective(),'denied');
 const adapter=fixtureAdapter();adapter.choose=async()=>{throw Error('TEST failure')};const f=boot({adapter});f.ready();
 const root=f.document.querySelector('#gcs-consent');f.c.apply({analytics:'denied',advertising:'granted'});await f.c.whenSettled();
 assert.equal(root.querySelector('#gcs-consent-status').textContent,"We couldn't confirm that choice, so advertising measurement stays off.");
 noAdvertising(root);assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.c.advertisingStatus().available,false);assert.equal(f.c.allowsExports('ad_measurement'),false);
});
// RETIRED original: real banner save handler preserves independent TEST choice and labels server recipient notice.
// Advertising checkbox/save/recipient-label UI grant contract retired per
// ops/linear/approvals/OPERATOR-DECISION-20260918-analytics-default-on-posthog-ship.json.
// The active replacement forbids that UI. Isolated TEST independence and revocation remain below.
test('real notice handlers deny advertising; isolated TEST choice remains independent and revocable',async()=>{
 const adapter=fixtureAdapter(),f=boot({adapter});f.ready();const root=f.document.querySelector('#gcs-consent');
 noAdvertising(root);assert.match(root.querySelector('#gcs-consent-copy').textContent,/Analytics is on to improve comparisons/);
 assert.match(root.querySelector('#gcs-consent-copy').textContent,/advertising stays off\./);assert.match(root.innerHTML,/id="gcs-consent-status" role="status"/);
 press(root,'acknowledge');assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'us_default');assert.equal(f.c.purposes().advertising,'denied');assert.deepEqual(adapter.calls,[]);
 f.c.open();f.c.apply({analytics:'denied',advertising:'granted'});await f.c.whenSettled();assert.equal(f.c.purposes().advertising,'granted');assert.equal(f.c.effective(),'denied');assert.equal(f.c.allowsExports('ad_measurement'),false);
 f.c.open();const reopened=f.document.querySelector('#gcs-consent');noAdvertising(reopened);assert.equal(f.c.read().advertising,'granted');
 press(reopened,'denied');assert.equal(f.c.purposes().advertising,'denied');await f.c.whenSettled();assert.equal(f.c.advertisingStatus().server_revocation,'acknowledged');assert.equal(f.c.read().advertising,'denied');
});
test('pending TEST server choice has visible status; clearance and styles survive reopening',async()=>{
 const adapter=fixtureAdapter(),original=adapter.choose;let finish;adapter.choose=async x=>{await new Promise(r=>finish=r);await original(x)};
 const f=boot({adapter});f.window.innerWidth=390;f.ready();const root=f.document.querySelector('#gcs-consent');f.c.apply({analytics:'denied',advertising:'granted'});await Promise.resolve();
 assert.ok(f.document.querySelector('#gcs-consent'));assert.match(root.querySelector('#gcs-consent-status').textContent,/confirm/i);noAdvertising(root);
 assert.ok(f.order.some(x=>x[0]==='style-set'&&x[1]==='--consent-clearance'&&x[2]==='320px'));
 assert.equal(typeof finish,'function');finish();await f.c.whenSettled();assert.equal(f.document.querySelector('#gcs-consent'),null);
 f.c.open();assert.equal(f.scripts.filter(s=>s.tag==='style').length,1);noAdvertising(f.document.querySelector('#gcs-consent'));
});
test('footer link reopens without navigation and returns keyboard focus after a choice',()=>{
 const f=boot();f.c.apply('denied');let focused=0,prevented=0;const link={isConnected:true,focus(){focused++;f.document.activeElement=this}};
 f.document.activeElement=link;
 f.documentEvent('click',{target:{closest:s=>s.includes('footer')?link:null},preventDefault(){prevented++}});
 assert.equal(prevented,1);const root=f.document.querySelector('#gcs-consent');assert.ok(root);assert.equal(f.document.activeElement,root.querySelector('[data-consent="denied"]'));
 press(root,'granted');assert.equal(focused,1);assert.equal(f.document.activeElement,link);assert.equal(f.document.querySelector('#gcs-consent'),null);assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'explicit');assert.equal(f.c.read().advertising,'denied');
});
test('generated privacy and cookie copy states US default-on analytics without granting advertising or answer export',()=>{
 const pages=leanLegalPages((title,body)=>body);
 for(const route of ['privacy/index.html','privacy/cookies/index.html']){
  const html=pages[route];
  assert.match(html,/First-party analytics for general site usage is on by default in the US, with a notice and a way to opt out\./);
  assert.match(html,/Global Privacy Control keeps it off\./);
  assert.match(html,/If your region requires opt-in or cannot be determined, analytics stays off until you choose it\./);
  assert.match(html,/Advertising measurement stays off\.|Advertising is unavailable without an independently eligible server permission and consent service;/);
  assert.match(html,/quiz answers, health details, email, phone,? and form entries are not analytics properties\./i);
  assert.doesNotMatch(html,/optional analytics and advertising (?:are )?off by default|analytics requires (?:an )?explicit choice/i);
  assert.doesNotMatch(html,/run by default|honored on every later visit|clear this site's storage/i);
 }
 assert.match(pages['privacy/index.html'],/href="\/privacy\/cookies\/"/);
 assert.doesNotMatch(pages['privacy/index.html'],/agree before those questions appear/i);
 const cookies=pages['privacy/cookies/index.html'];
 assert.match(cookies,/data-consent-open/);assert.match(cookies,/no eligible server permission/i);
 assert.match(cookies,/<noscript>/);assert.match(cookies,/id="do-not-sell-or-share"/);
});
