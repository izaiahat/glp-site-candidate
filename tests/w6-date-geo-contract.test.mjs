import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveRouteLastmod,resolveCatalogDate} from '../scripts/postbuild-aeo-surface.mjs';
import {onRequestGet} from '../functions/api/geo-state.js';
const route='/guides/mounjaro-coupon/';
const row=JSON.parse(await readFile(new URL('../data/blog/content-batch.json',import.meta.url),'utf8')).articles.find(a=>a.canonical_path===route);
test('catalog owner beats a runtime-only recorded release date without modifying source dates',()=>{
 const resolved=resolveRouteLastmod({route,hash:'same',recorded:{content_sha256:'same',lastmod:'2026-09-05'},releaseDate:'2099-01-01'});
 assert.equal(resolveCatalogDate(route,row,row.updated_at,resolved).lastmod,row.updated_at);
});
test('catalog date cannot bypass a stale undeclared hash',()=>assert.throws(()=>resolveRouteLastmod({route,hash:'changed',recorded:{content_sha256:'old',lastmod:row.updated_at},releaseDate:'2099-01-01'}),/stale/));
test('catalog route mismatch and fabricated rendered date are rejected',()=>{
 assert.throws(()=>resolveCatalogDate(route,{...row,canonical_path:'/wrong/'},row.updated_at,{}),/invalid/);
 assert.throws(()=>resolveCatalogDate(route,row,'2099-01-01',{}),/mismatch/);
 assert.throws(()=>resolveCatalogDate(route,{...row,updated_at:'today'},'today',{}),/invalid/);
});
test('non-catalog and frozen date decisions are not replaced',()=>{
 const resolved={lastmod:'2026-08-01',action:'frozen'};assert.equal(resolveCatalogDate('/other/',null,null,resolved),resolved);
});
test('LP transport confinement keeps real Chromium paint and all unchanged budgets',async()=>{
 const source=await readFile(new URL('../scripts/validate-lp-speed.mjs',import.meta.url),'utf8');
 assert.match(source,/requests: 15, transferBytes: 300 \* 1024, lcpMs: 1000/);
 assert.match(source,/CPU_THROTTLE = 4/);
 assert.match(source,/PerformanceObserver/);
 assert.match(source,/lp_lcp_unmeasured/);
 assert.match(source,/production_network_lcp_proven: false/);
 assert.match(source,/route\.fulfill\(\{ status: 200, body: await readFile\(file\)/);
 assert.doesNotMatch(source,/route\.continue\(/);
});
for(const [name,cf,headers,expected] of [
 ['absent metadata',undefined,{},null],
 ['US Oregon fixture',{country:'US',regionCode:'OR'},{},'OR'],
 ['non-US fixture',{country:'CA',regionCode:'BC'},{},null],
 ['header fallback fixture',undefined,{'cf-ipcountry':'US','cf-region-code':'CA'},'CA'],
 ['malformed region fixture',{country:'US',regionCode:'Oregon'},{},null],
])test('geo actual handler local response contract: '+name,async()=>{
 const request=new Request('https://glpclinicscout.com/api/geo-state',{headers});if(cf)Object.defineProperty(request,'cf',{value:cf});
 const response=await onRequestGet({request});assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await response.json(),{schema:'glp-geo-state-v1',available:Boolean(expected),state:expected});
});
