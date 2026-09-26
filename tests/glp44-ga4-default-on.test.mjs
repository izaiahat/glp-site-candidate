import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ga4Transport} from '../src/ga4-runtime.mjs';
function boot({url='https://glpclinicscout.com/about/?email=PRIVATE#dose',allowed=true}={}){
 const handlers={},scripts=[],cookies=[],window={GCS_ANALYTICS:{enabled:true,measurement_id:'G-2WQ42JY0WK'},innerHeight:500,scrollY:500,history:{pushState(){},replaceState(){}},addEventListener(n,f){handlers[n]=f}};
 const document={querySelector:()=>({href:'https://glpclinicscout.com/about/'}),documentElement:{scrollHeight:1000},addEventListener(n,f){handlers[n]=f},createElement(){return {addEventListener(n,f){this[n]=f},remove(){this.removed=true}}},head:{appendChild(s){scripts.push(s)}},set cookie(v){cookies.push(v)}};
 const runtime=vm.runInNewContext(`(${ga4Transport.toString()})(()=>permitted.value)`,{window,document,location:new URL(url),URL,permitted:{get value(){return allowed}}});
 const commands=()=>Array.from(window.gcsGa4Layer||[],a=>Array.from(a));
 return {window,document,runtime,scripts,cookies,handlers,commands,deny(){allowed=false;runtime.load()},click(href,{form=false,download=false,kind=/\.pdf/.test(href)?'download':'outbound'}={}){handlers.click({target:{closest:()=>({href,closest:()=>form,hasAttribute:()=>download,getAttribute:()=>kind})}})}};
}
test('GA4 default-on private layer queues safe config before SDK and exactly one page_view after load',()=>{
 const f=boot();f.runtime.load();assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].referrerPolicy,'no-referrer');assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);
 assert.deepEqual(f.commands().map(c=>c[0]),['consent','set','config','js','consent']);
 f.scripts[0].load();f.scripts[0].load();f.runtime.load();const events=f.commands().filter(c=>c[0]==='event');assert.equal(events.length,1);assert.equal(events[0][1],'page_view');assert.equal(events[0][2].page_location,'https://glpclinicscout.com/about/');assert.doesNotMatch(JSON.stringify(f.commands()),/PRIVATE|email=/);
 for(const command of f.commands().filter(c=>c[0]==='consent'))for(const key of ['ad_storage','ad_user_data','ad_personalization'])assert.equal(command[2][key],'denied');
});
test('GA4 sensitive route projection excludes nested selections and enhanced events',()=>{
 for(const path of ['/quiz/provider-fit/','/lp/quiz/','/matches/ozempic/','/intake/email@example.invalid/','/tools/glp-1-cost-calculator/']){
  const f=boot({url:'https://glpclinicscout.com'+path+'?q=PRIVATE#PRIVATE'});f.runtime.load();f.handlers.scroll();f.click('https://external.invalid/PRIVATE.pdf');assert.equal(f.scripts.length,0);assert.equal(f.commands().filter(c=>c[0]==='event').length,0);
 }
});
test('GA4 enhanced events never read link text, form values, filenames or destination parameters',()=>{
 const f=boot();f.runtime.load();f.scripts[0].load();f.handlers.scroll();f.handlers.scroll();f.click('https://external.invalid/PRIVATE?email=PRIVATE');f.click('https://external.invalid/PRIVATE.pdf?condition=PRIVATE');f.click('https://external.invalid/PRIVATE',{form:true});
 assert.deepEqual(f.commands().filter(c=>c[0]==='event').map(c=>c[1]),['page_view','scroll','click','file_download']);assert.doesNotMatch(JSON.stringify(f.commands()),/PRIVATE|condition|link_url|file_name|form_start|form_submit|search_term/);
});
test('GA4 denied gate refuses loads; withdrawal invalidates pending SDK callback and regrant',()=>{
 const denied=boot({allowed:false});denied.runtime.load();assert.equal(denied.scripts.length,0);assert.equal(denied.window['ga-disable-G-2WQ42JY0WK'],true);
 const f=boot();f.runtime.load();f.deny();f.scripts[0].load();f.handlers.scroll();f.click('https://external.invalid/');assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);assert.deepEqual(f.commands().map(c=>c[0]+':'+c[1]),['consent:update']);assert.equal(f.commands()[0][2].analytics_storage,'denied');assert.ok(f.cookies.some(c=>c.startsWith('_ga=; Max-Age=0')));
});
test('GA4 history barrier disables before native URL mutation and cannot restart SDK',()=>{
 const f=boot();f.runtime.load();f.scripts[0].load();f.window.history.pushState({},'','/quiz/private/');assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);f.runtime.load();assert.equal(f.scripts.length,1);assert.equal(f.commands().filter(c=>c[0]==='event').length,0);
});
test('GA4 unknown origins, routes and components are held pending exact-context review',()=>{
 for(const url of ['https://preview.invalid/','https://glpclinicscout.com/providers/','https://glpclinicscout.com/guides/semaglutide/','https://glpclinicscout.com/person%40example.invalid/','https://glpclinicscout.com/mary-smith/']){const f=boot({url});f.runtime.load();assert.equal(f.scripts.length,0);}
 const fromQuiz=boot();fromQuiz.document.referrer='https://glpclinicscout.com/matches/?email=PRIVATE';fromQuiz.runtime.load();assert.equal(fromQuiz.scripts.length,0);
 const f=boot();f.runtime.load();f.scripts[0].load();f.click('https://provider.invalid/',{kind:null});f.click('https://provider.invalid/',{kind:'affiliate'});assert.equal(f.commands().filter(c=>c[0]==='event').length,1);
 f.handlers.input();f.handlers.scroll();assert.equal(f.window['ga-disable-G-2WQ42JY0WK'],true);assert.equal(f.commands().filter(c=>c[0]==='event').length,0);
});
