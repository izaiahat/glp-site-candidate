import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './d2o-consent-lifecycle.test.mjs';
import {fixtureAdapter} from './d2o-server-consent.test.mjs';
import {leanLegalPages} from '../src/legal-pages.mjs';
import {ga4Transport} from '../src/ga4-runtime.mjs';
const press=(root,choice)=>{const button=root.querySelector('[data-consent="'+choice+'"]');assert.ok(button,'rendered consent action '+choice);root.click({target:{closest:()=>button}})};
const noCheckbox=root=>{for(const id of ['#gcs-advertising-purpose','#gcs-advertising-reason','#gcs-consent-advertising'])assert.equal(root.querySelector(id),null);assert.doesNotMatch(root.innerHTML,/<input|type="checkbox"| checked|gcs-advertising-purpose|gcs-advertising-reason|gcs-consent-advertising/)};
for(const analytics of ['denied','granted'])for(const advertising of ['denied','granted'])test('worldwide notice acknowledges both defaults; manage preserves purposes '+analytics+'/'+advertising,()=>{
 const f=boot();f.ready();let root=f.document.querySelector('#gcs-consent');
 noCheckbox(root);assert.equal((root.innerHTML.match(/<button /g)||[]).length,1);assert.match(root.innerHTML,/data-consent="acknowledge">Got it/);assert.doesNotMatch(root.innerHTML,/data-consent="(?:denied|granted)"/);
 assert.match(root.querySelector('#gcs-consent-copy').textContent,/Health quiz answers, health conditions and health-page URLs are never shared/);
 assert.equal(f.c.read().analytics,'granted');assert.equal(f.c.read().analytics_basis,'global_default');assert.equal(f.c.read().notice_acknowledged,false);assert.equal(f.c.purposes().advertising,'granted');
 press(root,'acknowledge');assert.equal(f.document.querySelector('#gcs-consent'),null);assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'global_default');assert.equal(f.c.read().notice_acknowledged,true);assert.equal(f.c.purposes().advertising,'granted');
 f.c.apply({analytics,advertising});assert.equal(f.c.purposes().advertising,advertising);assert.equal(f.c.read().advertising,advertising);
 assert.equal(f.c.purposes().analytics,analytics);assert.equal(f.c.allowsExports('advertising'),advertising==='granted');assert.equal(f.c.allowsExports('ad_measurement'),advertising==='granted');
 f.c.open();root=f.document.querySelector('#gcs-consent');noCheckbox(root);assert.ok(root.querySelector('[data-consent="granted"]'));
 press(root,'denied');assert.equal(f.c.effective(),'denied');assert.equal(f.c.read().analytics,'denied');assert.equal(f.c.read().advertising,'denied');assert.equal(f.c.allowsExports(),false);assert.equal(f.c.allowsExports('advertising'),false);
});
test('GPC and failed confirmation use reader-language reasons without an unavailable choice',async()=>{
 const g=boot({gpc:true,adapter:fixtureAdapter()});g.ready();
 assert.equal(g.c.advertisingStatus().reason,"Your browser's Global Privacy Control is on, so advertising measurement stays off.");
 const notice=g.document.querySelector('#gcs-consent');noCheckbox(notice);assert.match(notice.querySelector('#gcs-consent-copy').textContent,/Global Privacy Control keeps analytics and advertising off/);
 press(notice,'acknowledge');assert.equal(g.c.effective(),'denied');assert.equal(g.c.read().analytics,'denied');assert.equal(g.c.read().advertising,'denied');assert.equal(g.c.allowsExports(),false);
 g.c.open();const managed=g.document.querySelector('#gcs-consent');assert.equal(managed.querySelector('[data-consent="granted"]').disabled,true);press(managed,'granted');assert.equal(g.c.effective(),'denied');
 const adapter=fixtureAdapter();adapter.choose=async()=>{throw Error('TEST failure')};const f=boot({adapter});f.ready();
 const root=f.document.querySelector('#gcs-consent');f.c.apply({analytics:'denied',advertising:'granted'});await f.c.whenSettled();
 assert.equal(root.querySelector('#gcs-consent-status').textContent,"We couldn't confirm that choice, so advertising measurement stays off.");
 noCheckbox(root);assert.equal(f.c.purposes().advertising,'denied');assert.equal(f.c.advertisingStatus().available,false);assert.equal(f.c.allowsExports('ad_measurement'),false);
});
// The lexical TEST adapter remains a separately gated server contract, not the
// served browser and not authority to issue production server consent records.
test('notice is not server opt-in; isolated TEST receipt remains independent and revocable',async()=>{
 const adapter=fixtureAdapter(),f=boot({adapter});f.ready();const root=f.document.querySelector('#gcs-consent');
 noCheckbox(root);assert.match(root.querySelector('#gcs-consent-copy').textContent,/Analytics is on/);
 assert.match(root.querySelector('#gcs-consent-copy').textContent,/advertising\/conversion measurement is off/);assert.match(root.innerHTML,/id="gcs-consent-status" role="status"/);
 press(root,'acknowledge');assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'global_default');assert.equal(f.c.purposes().advertising,'denied');assert.deepEqual(adapter.calls,[]);
 f.c.open();f.c.apply({analytics:'denied',advertising:'granted'});await f.c.whenSettled();assert.equal(f.c.purposes().advertising,'granted');assert.equal(f.c.effective(),'denied');assert.equal(f.c.allowsExports('ad_measurement'),true);
 f.c.open();const reopened=f.document.querySelector('#gcs-consent');noCheckbox(reopened);assert.equal(f.c.read().advertising,'granted');
 press(reopened,'denied');assert.equal(f.c.purposes().advertising,'denied');await f.c.whenSettled();assert.equal(f.c.advertisingStatus().server_revocation,'acknowledged');assert.equal(f.c.read().advertising,'denied');
});
test('pending TEST server choice has visible status; clearance and styles survive reopening',async()=>{
 const adapter=fixtureAdapter(),original=adapter.choose;let finish;adapter.choose=async x=>{await new Promise(r=>finish=r);await original(x)};
 const f=boot({adapter});f.window.innerWidth=390;f.ready();const root=f.document.querySelector('#gcs-consent');f.c.apply({analytics:'denied',advertising:'granted'});await Promise.resolve();
 assert.ok(f.document.querySelector('#gcs-consent'));assert.match(root.querySelector('#gcs-consent-status').textContent,/confirm/i);noCheckbox(root);
 assert.ok(f.order.some(x=>x[0]==='style-set'&&x[1]==='--consent-clearance'&&x[2]==='320px'));
 assert.equal(typeof finish,'function');finish();await f.c.whenSettled();assert.equal(f.document.querySelector('#gcs-consent'),null);
 f.c.open();assert.equal(f.scripts.filter(s=>s.tag==='style').length,1);noCheckbox(f.document.querySelector('#gcs-consent'));
});
test('footer link reopens without navigation and returns keyboard focus after a choice',()=>{
 const f=boot();f.c.apply('denied');let focused=0,prevented=0;const link={isConnected:true,focus(){focused++;f.document.activeElement=this}};
 f.document.activeElement=link;
 f.documentEvent('click',{target:{closest:s=>s.includes('footer')?link:null},preventDefault(){prevented++}});
 assert.equal(prevented,1);const root=f.document.querySelector('#gcs-consent');assert.ok(root);assert.equal(f.document.activeElement,root.querySelector('[data-consent="denied"]'));
 press(root,'granted');assert.equal(focused,1);assert.equal(f.document.activeElement,link);assert.equal(f.document.querySelector('#gcs-consent'),null);assert.equal(f.c.effective(),'granted');assert.equal(f.c.read().analytics_basis,'explicit');assert.equal(f.c.read().advertising,'granted');
});
test('generated privacy and cookie copy matches worldwide defaults, controls and health exclusion',()=>{
 const pages=leanLegalPages((title,body)=>body);
 for(const route of ['privacy/index.html','privacy/cookies/index.html']){
  const html=pages[route];
  assert.match(html,/Analytics and advertising\/conversion measurement are on by default for visitors in every region, including when location is unknown\./);
  assert.match(html,/Global Privacy Control and opting out turn tracking off\./);
  assert.match(html,/Got it acknowledgment and a Manage \/ opt out link; acknowledging it does not change your settings/);
  assert.match(html,/Health quiz answers, health conditions and health-page URLs are never advertising or conversion payloads/);
  assert.match(html,/quiz answers, health details, email, phone,? and form entries are not analytics properties\./i);
  assert.doesNotMatch(html,/advertising measurement stays off|region requires opt-in|region is unknown, it stays off|control remains disabled/i);
  assert.doesNotMatch(html,/run by default|honored on every later visit|clear this site's storage/i);
  assert.match(html,/PostHog/);assert.match(html,/Google Analytics 4 \(GA4\)/);
  assert.match(html,/anonymous in-memory identifier/);assert.match(html,/_ga and _ga_2WQ42JY0WK cookies/);
  assert.match(html,/\/, \/about\/, \/privacy\/, \/privacy\/cookies\/ and \/terms\//);
  assert.match(html,/already-started permitted (?:GA4 )?request may complete or retry/);
  assert.doesNotMatch(html,/Google Analytics, Google Tag Manager|Withdrawal stops new analytics requests and retries/i);
 }
 // Keep the public GA route disclosure tied to the maintained allowlist.
 const runtimeRoutes=ga4Transport.toString().match(/const ordinaryPaths=(\[[^;]+\]);/);
 assert.ok(runtimeRoutes,'GA4 ordinary-route allowlist');
 assert.deepEqual(JSON.parse(runtimeRoutes[1].replaceAll("'",'"')),['/','/about/','/privacy/','/privacy/cookies/','/terms/']);
 assert.match(ga4Transport.toString(),/const ID='G-2WQ42JY0WK'/);
 assert.match(pages['privacy/index.html'],/href="\/privacy\/cookies\/"/);
 assert.doesNotMatch(pages['privacy/index.html'],/agree before those questions appear/i);
 const cookies=pages['privacy/cookies/index.html'];
 assert.match(cookies,/data-consent-open/);assert.match(cookies,/do not lift existing Google Tag Manager container or Clarity configuration holds/);
 assert.match(cookies,/Withdrawal stops new PostHog requests and retries from this page and aborts its pending PostHog analytics fetches/);
 assert.match(cookies,/For GA4, opting out stops new loads and events and later-page collection/);
 assert.match(cookies,/<noscript>/);assert.match(cookies,/id="do-not-sell-or-share"/);
});
