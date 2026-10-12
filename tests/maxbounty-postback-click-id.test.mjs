import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {consentRuntimeSource} from '../src/consent-runtime.mjs';
const source=readFileSync(new URL('../assets/analytics.js',import.meta.url),'utf8');
const offers=['31359','32122','29207','32639','32854','32662'];
function fixture({advertising='granted',analytics='denied',offer='32122',account='803003',host='afflat3e3.com',extra=''}={}) {
 const original=`https://${host}/trk/lnk/issued/?o=${offer}&c=918277&a=${account}&k=0&l=38072${extra}`;
 const dom=new JSDOM(`<a id="link" href="${original}" data-network="MaxBounty" data-subid-codec="direct" data-program="TEST" data-sub1="1R" data-sub2="review-page" data-analytics-event="affiliate_click">Provider</a>`,{url:'https://glpclinicscout.com/providers/',runScripts:'outside-only'});
 const w=dom.window;
 w.GCS_EXPORT_POLICY={schema:'glp-release-export-policy-v2',stage:'production-seal',third_party_exports:true};w.GCS_ANALYTICS={enabled:false};
 w.localStorage.setItem('gcs_tracking_consent_v1',JSON.stringify({version:'gcs-cookie-v4-distinct-purposes',record_type:'preference_only',analytics,advertising}));
 w.document.addEventListener('click',e=>e.preventDefault(),true);
 w.eval(consentRuntimeSource);w.eval(source);
 return {dom,w,a:w.document.querySelector('#link'),original};
}
for(const offer of offers)test(`MaxBounty ${offer}: native consented click identity uses S2 only`,()=>{
 const f=fixture({offer});try{
  assert.equal(f.a.getAttribute('href'),f.original);
  f.a.click();
  const q=new URL(f.a.href).searchParams;
  const id=JSON.parse(f.w.localStorage.getItem('cs_click_id:last:TEST')).clickId;
  assert.equal(q.get('s2'),id);
  const expected=new URL(f.original);expected.searchParams.set('s2',id);
  assert.equal(f.a.href,expected.toString());
  assert.equal(q.has('sub3'),false);assert.equal(q.has('sub1'),false);assert.equal(q.has('sub2'),false);
 }finally{f.dom.window.close()}
});
for(const analytics of ['granted','denied'])for(const advertising of ['granted','denied'])test(`MaxBounty consent: analytics=${analytics} advertising=${advertising}`,()=>{
 const f=fixture({analytics,advertising});try{
  f.a.click();assert.equal(new URL(f.a.href).searchParams.has('s2'),advertising==='granted');
  if(advertising==='denied')assert.equal(f.a.getAttribute('href'),f.original);
 }finally{f.dom.window.close()}
});
for(const options of [{account:'999'},{offer:'999'},{host:'affiliate-fixture.invalid'},{extra:'&a=999'},{extra:'&o=999'},{extra:'&s2=issuer-owned'},{extra:'&s2=x&s2=y'}])test(`MaxBounty refuses unowned target: ${JSON.stringify(options)}`,()=>{
 const f=fixture(options);try{f.a.click();assert.equal(f.a.getAttribute('href'),f.original)}finally{f.dom.window.close()}
});
for(const mode of ['withdraw','gpc'])test(`MaxBounty restores exact issued bytes after ${mode}`,()=>{
 const f=fixture();try{
  f.a.click();assert.notEqual(f.a.href,f.original);
  if(mode==='gpc'){Object.defineProperty(f.w.navigator,'globalPrivacyControl',{value:true});f.w.dispatchEvent(new f.w.Event('focus'))}
  else f.w.GCSConsent.apply({analytics:'granted',advertising:'denied'});
  assert.equal(f.a.getAttribute('href'),f.original);
  assert.equal(f.w.localStorage.getItem('cs_click_id:last:TEST'),null);
  f.a.click();assert.equal(f.a.getAttribute('href'),f.original);
 }finally{f.dom.window.close()}
});
