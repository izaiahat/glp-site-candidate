import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './d2o-consent-lifecycle.test.mjs';

const config={measurement_id:'G-2WQ42JY0WK',gtm_container_id:'GTM-PWR49VVK'};
const google=f=>f.scripts.filter(s=>s.src?.includes('googletagmanager.com'));
const commands=f=>Array.from(f.window.gcsGa4Layer||[],args=>Array.from(args));
const open=opts=>boot({model:'prior-opt-in',analyticsConfig:config,...opts});

test('prior opt-in denial and US default-on record do not load Google',()=>{
  const denied=open();assert.equal(google(denied).length,0);
  const us=boot({analyticsConfig:config});assert.equal(us.c.effective(),'granted');assert.equal(google(us).length,0);
  assert.equal(us.window['ga-disable-G-2WQ42JY0WK'],true);
});

test('explicit root grant loads only private GA4 layer; minimized page event after SDK load',()=>{
  const f=open();f.c.apply('granted');
  assert.equal(google(f).length,1);assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);
  const script=google(f)[0];assert.equal(script.referrerPolicy,'no-referrer');
  assert.equal(script.src,'https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer');
  assert.deepEqual(commands(f).map(c=>c[0]),['consent','config','js','consent']);
  assert.equal(commands(f)[0][2].analytics_storage,'denied');assert.equal(commands(f)[3][2].analytics_storage,'granted');
  assert.equal(commands(f)[1][2].send_page_view,false);
  assert.equal(f.order.filter(c=>c[0]==='event'&&c[1]==='page_view').length,0);
  f.document.title='A medication and email@example.org';
  script.load();script.load();f.c.refresh();
  const items=commands(f),views=items.filter(c=>c[0]==='event');assert.equal(views.length,1);
  assert.equal(views[0][1],'page_view');
  for(const command of items.filter(c=>c[0]==='config'||c[0]==='event')){
    const fields=command.at(-1);assert.equal(fields.page_location,'https://glpclinicscout.com/');
    assert.equal(fields.page_title,'Clinic Scout');assert.equal(fields.page_referrer,'');
    assert.equal(fields.allow_google_signals,false);assert.equal(fields.allow_ad_personalization_signals,false);
    assert.equal(fields.allow_enhanced_conversions,false);assert.doesNotMatch(JSON.stringify(fields),/medication|email@|user_id|quiz/);
  }
  assert.equal(items.find(c=>c[0]==='config')[2].send_page_view,false);
  assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],false);
});

test('revocation before SDK callback kills queue and never replays on same document',()=>{
  const f=open();f.c.apply('granted');const script=google(f)[0];
  f.c.apply('denied');assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);
  assert.deepEqual(commands(f).map(c=>c[0]+':'+c[1]),['consent:update']);
  assert.equal(commands(f)[0][2].analytics_storage,'denied');script.load();
  assert.equal(commands(f).filter(c=>c[0]==='config'||c[0]==='event').length,0);
  f.c.apply('granted');assert.equal(google(f).length,1,'no second SDK load/replay until reload');
});

test('revocation after page event disables transport; GPC and storage withdrawal deny',()=>{
  for(const withdraw of [f=>f.c.apply('denied'),f=>{f.navigator.globalPrivacyControl=true;f.event('focus')},f=>{f.storage.delete('gcs_tracking_consent_v1');f.event('storage',{key:'gcs_tracking_consent_v1'})}]){
    const f=open();f.c.apply('granted');const script=google(f)[0];script.load();withdraw(f);
    assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);
    assert.equal(commands(f).filter(c=>c[0]==='event').length,0);
    assert.equal(commands(f)[0][2].analytics_storage,'denied');script.load();
    assert.equal(commands(f).filter(c=>c[0]==='event').length,0);
  }
});

test('history change disables loaded SDK before sensitive URL is visible and clears cookies',()=>{
  for(const method of ['pushState','replaceState']){
    const f=open();f.c.apply('granted');google(f)[0].load();
    f.window.history[method]({},'', '/quiz/provider-fit/?email=canary%40example.invalid#dose');
    assert.equal(f.order.findLast(x=>x[0]==='history')[1],true,'disabled before native history mutation');
    assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);
    assert.equal(commands(f).filter(x=>x[0]==='event').length,0);
    assert.ok(f.order.some(x=>x[0]==='cookie'&&x[1].startsWith('_ga=; Max-Age=0')));
    assert.ok(f.order.some(x=>x[0]==='cookie'&&x[1].startsWith('_ga_2WQ42JY0WK=; Max-Age=0')));
  }
});

test('sensitive routes, query, fragment, referrer, wrong host, ID, GPC, stage and webdriver stay held',()=>{
  const cases=[{url:'https://glpclinicscout.com/guides/mounjaro-coupon/'},{url:'https://glpclinicscout.com/lp/quiz/'},
    {url:'https://glpclinicscout.com/?email=person@example.org'},{url:'https://glpclinicscout.com/#condition'},
    {referrer:'https://glpclinicscout.com/reviews/ozempic/'},{referrer:'https://outside.invalid/'},
    {url:'https://partners.glpclinicscout.com/'},{analyticsConfig:{...config,measurement_id:'G-OTHER'}},
    {analyticsConfig:{...config,gtm_container_id:'GTM-OTHER'}},{gpc:true},{stage:'candidate'},{webdriver:true}];
  for(const opts of cases){const f=open(opts);f.c.apply('granted');assert.equal(google(f).length,0,JSON.stringify(opts));
    assert.equal((f.window.gcsGa4Layer||[]).length,0,JSON.stringify(opts));}
});
