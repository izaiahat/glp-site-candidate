import test from 'node:test';
import assert from 'node:assert/strict';
import {consentRuntimeSource as source} from '../src/consent-runtime.mjs';
import {integrated,assertPrivateLoader,assertHeld,assertEmittedLoaderSemantics,ORIGIN,ID,ORDINARY} from './helpers/ga4-semantic-contract.mjs';
const saved=(changes={})=>JSON.stringify({version:'gcs-cookie-v4-distinct-purposes',record_type:'preference_only',analytics:'granted',advertising:'granted',...changes});
for(const route of ORDINARY)test('R1 integrated exact ordinary route '+route,()=>assertPrivateLoader(integrated(source,{url:ORIGIN+route+'?PRIVATE_CANARY#PRIVATE_CANARY'}),route));
test('R1 each nonredundant eligibility guard independently refuses an otherwise eligible lane',()=>{
 const cases=[
  ['ID',{config:{measurement_id:'G-D1-FIXTURE'}}],['enabled',{config:{enabled:false}}],['enabled strict boolean',{config:{enabled:1}}],
  ['origin',{url:'https://preview.invalid/about/'}],['path',{url:ORIGIN+'/__d1_enabled_fixture__/'}],
  ['schema',{policy:{schema:'wrong'}}],['stage',{policy:{stage:'candidate'}}],['export',{policy:{third_party_exports:false}}],['export strict boolean',{policy:{third_party_exports:1}}],
  ['webdriver',{webdriver:true}],...['HeadlessChrome','Headless','Playwright','Puppeteer','Lighthouse','Google-InspectionTool','synthetic','bot','crawler','spider'].map(ua=>['ua '+ua,{ua}]),
  ['referrer malformed',{referrer:'not a URL'}],['referrer excluded',{referrer:ORIGIN+'/matches/'}],
  ['analytics denied',{raw:saved({analytics:'denied'})}],['GPC',{gpc:true}],['invalid JSON',{raw:'{'}],['invalid version',{raw:saved({version:'bad'})}],['invalid record',{raw:saved({record_type:'bad'})}],['invalid analytics',{raw:saved({analytics:'bad'})}],['invalid advertising',{raw:saved({advertising:'bad'})}],['invalid basis',{raw:saved({analytics_basis:'bad'})}],['unreadable',{unreadable:true}],['blocked',{unwritable:true}],
 ];
 for(const [label,options] of cases)assertHeld(integrated(source,options),label);
 // Each permitted referrer alternative still pins blank exported referrer.
 for(const referrer of ['', 'https://outside.invalid/PRIVATE_CANARY',...ORDINARY.map(p=>ORIGIN+p+'?PRIVATE_CANARY')])assertPrivateLoader(integrated(source,{referrer}),'/about/');
 assertPrivateLoader(integrated(source,{raw:saved({advertising:'denied'})}),'/about/');
 assertEmittedLoaderSemantics(source);
 // Shared purpose decision isolates redundant current/latched GPC and blocked
 // storage predicates while keeping a valid granted stored preference.
 const current=integrated(source);current.navigator.globalPrivacyControl=true;assert.equal(current.window.GCSConsent.purposes().analytics,'denied');
 const latch=integrated(source,{gpc:true});latch.navigator.globalPrivacyControl=false;latch.setRaw(saved());assert.equal(latch.window.GCSConsent.purposes().analytics,'denied');
 const options={raw:saved()},blocked=integrated(source,options);options.unwritable=true;blocked.window.GCSConsent.apply('denied');assert.equal(blocked.window.GCSConsent.read().analytics,'granted');assert.equal(blocked.window.GCSConsent.effective(),'denied');
});
test('R1 redundant local exclusions are proved at shared export decision, not called wire proof',()=>{
 for(const url of ['http://localhost/about/','http://127.0.0.1/about/','http://0.0.0.0/about/','http://[::1]/about/','https://a.localhost/about/','https://a.local/about/','https://a.test/about/','https://a.internal/about/','file:///about/','file://ordinary.invalid/about/']){
  const f=integrated(source,{url});assert.equal(f.window.GCSConsent.effective(),'granted',url);assert.equal(f.window.GCSConsent.allowsExports(),false,url);assertHeld(f,url);
 }
});
test('R1 integrated lifecycle, public-layer canary, cold cookie and owned cleanup contracts',()=>{
 for(const event of ['input','change','submit','popstate','hashchange']){
  const f=integrated(source);assertPrivateLoader(f,'/about/');f.fire(event);assert.equal(f.window['ga-disable-'+ID],true,event);assert.equal(f.commands().filter(c=>c[0]==='event').length,0,event);f.window.GCSConsent.refresh();f.scripts[0].load();assert.equal(f.scripts.length,1,event);assert.equal(f.commands().filter(c=>c[0]==='event').length,0,event);
 }
 for(const method of ['pushState','replaceState']){const f=integrated(source);f.window.history[method]({},'', '/matches/');f.scripts[0].load();assert.equal(f.commands().filter(c=>c[0]==='event').length,0,method);}
 const f=integrated(source);f.window.GCSConsent.apply('denied');f.scripts[0].load();f.window.GCSConsent.apply('granted');assert.equal(f.scripts.length,1);assert.equal(f.commands().filter(c=>c[0]==='event').length,0);
 const g=integrated(source);g.navigator.globalPrivacyControl=true;assert.equal(g.window.GCSConsent.allowsExports(),false);g.navigator.globalPrivacyControl=false;g.fire('focus');assert.equal(g.window.GCSConsent.effective(),'denied');g.scripts[0].load();assert.equal(g.commands().filter(c=>c[0]==='event').length,0);
 const residual=integrated(source,{raw:saved({analytics:'denied'}),cookie:'_ga=old; _ga_2WQ42JY0WK=old; unrelated=retained'});
 const writes=residual.cookies.filter(c=>c.startsWith('_ga'));
 assert.equal(writes.length,6);assert.deepEqual([...new Set(writes.map(c=>c.split('=')[0]))].sort(),['_ga','_ga_2WQ42JY0WK']);assert.ok(writes.every(c=>c.includes('=; Max-Age=0; Path=/; SameSite=Lax; Secure')));
});
