import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizePriceIndexUrls as normalize, PRICE_INDEX_URL_CONTRACT as contract } from "../src/price-index-url-normalization.mjs";
import { resolveRetiredComparisonIntent } from "../functions/best/online-glp-1-providers/index.js";
const A='aaaaaaaaaaaaaaaa',B='bbbbbbbbbbbbbbbb';
for(const origin of ['',contract.origin])for(const quote of ['"',"'"])for(const resource of contract.scripts)test(`runtime quoted ${origin||'relative'} ${quote} ${resource}`,()=>{
 const a=`<ScRiPt data-preserve='unchanged' SrC = ${quote}${origin}${resource}?v=${A}&amp;x=1#part${quote} defer></ScRiPt>`;
 const expected=a.replace(`v=${A}`,'v=ASSET_VERSION');
 assert.equal(normalize(a),expected);assert.equal(normalize(a.replace(A,B)),expected);assert.equal(normalize(expected),expected);
});
const strict=[
 `<!-- <script src="/assets/site.js?v=${A}"></script> -->`,
 `<!-- <script src="/assets/site.js?v=${A}"></script>`,
 `<script>const example='<script src="/assets/site.js?v=${A}">';</script>`,
 `<script type="application/json">{"example":"<a href='/guides/'>"}</script>`,
 `<template><script src="/assets/site.js?v=${A}"></script></template>`,
 `<noscript><script src="/assets/site.js?v=${A}"></script></noscript>`,
 `<a href="/assets/site.js?v=${A}">source</a>`,
 `<script data-src="/assets/site.js?v=${A}"></script>`,
 `<script src="/assets/site.js?v=${A}" src="/assets/site.js?v=${B}"></script>`,
 `<script src=/assets/site.js?v=${A}></script>`,
 `<script src="/assets/site.js?v=${A}x"></script>`,
 `<script src="/assets/site.js?v=${A}&v=${B}"></script>`,
 `<script src="/assets/site.js?%76=${A}"></script>`,
 `<script src="/assets/site.js?V=${A}"></script>`,
 `<script src="/assets/site.js?v=AAAAAAAAAAAAAAAA"></script>`,
 `<script src="/assets/site.js?v=${A}&x=%ZZ"></script>`,
 `<script src="/assets/x/../site.js?v=${A}"></script>`,
 `<script src="//glpclinicscout.com/assets/site.js?v=${A}"></script>`,
 `<script src="https://glpclinicscout.com:443/assets/site.js?v=${A}"></script>`,
 `<script src="https://other.invalid/assets/site.js?v=${A}"></script>`,
 `<base href="https://other.invalid/"><script src="/assets/site.js?v=${A}"></script>`,
 `<script type="application/json" src="/assets/site.js?v=${A}"></script>`,
];
for(const [i,html]of strict.entries())test(`unsupported context/token untouched ${i}`,()=>assert.equal(normalize(html),html));
for(const [before,after]of Object.entries(contract.migrations))test(`reviewed exact migration ${before}`,()=>{
 for(const origin of ['',contract.origin]){
  const a=`<a class='proof' href='${origin}${before}?x=1&amp;y=2#part'>Research</a>`;
  assert.equal(normalize(a),a.replace(before,after));
 }
});
test('all contract child migrations and runtime resources are bound to current producer declarations',()=>{
 const build=readFileSync(new URL('../scripts/build-staging.mjs',import.meta.url),'utf8');
 const redirects=readFileSync(new URL('../public/_redirects',import.meta.url),'utf8');
 for(const [from,to]of Object.entries(contract.migrations)){
  if(from==='/best/online-glp-1-providers/')assert.equal(resolveRetiredComparisonIntent(contract.origin+from),to);
  else assert.ok(redirects.split('\n').some(l=>l.split(/\s+/)[0]===from&&l.split(/\s+/)[1]===to),from);
 }
 const frozen=build.slice(build.indexOf('function addByteFrozenSharedRuntime'),build.indexOf('function addSharedRuntime'));
 for(const resource of ['/assets/site.js','/assets/consent.js','/assets/site.css'])assert.ok(frozen.includes(resource));
 assert.ok(build.includes('assets/content-capture-resilient.js'));
});
test('unrelated query values/order, fragment and entity spelling remain strict',()=>{
 const doc=url=>`<script src="${url}"></script>`;
 const base=`/assets/site.js?v=${A}&amp;x=1#part`;
 for(const changed of [base.replace('x=1','x=2'),base.replace('#part','#else'),base.replace('&amp;','&'),`/assets/site.js?x=1&amp;v=${A}#part`])assert.notEqual(normalize(doc(base)),normalize(doc(changed)));
});
