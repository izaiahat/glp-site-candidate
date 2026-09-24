import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {typedPriceText,renderTypedPrice} from '../src/typed-price-labels.mjs';
import {isTallyGatedRoute,assertTalliesDerived} from '../src/surface-tallies.mjs';
import {readDeclaredRoutes,resolveMaterialDate} from '../scripts/postbuild-aeo-surface.mjs';
import {stampDateline,newState} from '../scripts/codemod-aeo-citation-schema.mjs';
const read = p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const matrix=JSON.parse(read('data/provider-pricing-matrix.json'));
const derived={LIVE_PROVIDER_COUNT:58,COMPARISON_PAGE_COUNT:13,RESEARCH_GUIDE_COUNT:69};
test('D2p all typed rows preserve facts while rendering reader-language unknowns',()=>{
  const rows=Object.values(matrix.providers).flatMap(p=>p.medications).filter(r=>'price_kind' in r);
  assert.ok(rows.length);
  for(const row of rows){
    const before=JSON.stringify(row);
    assert.doesNotMatch(typedPriceText(row),/\bUNKNOWN\b|not stated not stated/);
    renderTypedPrice(row);
    assert.equal(JSON.stringify(row),before);
  }
  const found=rows.find(r=>r.row_id==='found-health:0:brand-ozempic');
  assert.match(typedPriceText(found),/Membership: not stated \+ medication: \$1,100/);
  const broken=structuredClone(found);broken.facts.medication_usd.value=-1;
  assert.throws(()=>typedPriceText(broken),/amount_invalid/);
});
test('D2p four routes are tally gated and category twins deduplicate; wrong denominator fails',()=>{
  for(const route of ['semaglutide/index.html','tirzepatide/index.html','providers/index.html','lp/quiz/index.html']) assert.equal(isTallyGatedRoute(route),true);
  const html='<p>2 program profiles</p><tr data-g08-provider-id="one"></tr><tr data-g08-provider-id="two"></tr><article data-g08-provider-id="one"></article><article data-g08-provider-id="two"></article>';
  assertTalliesDerived('semaglutide/index.html',html,derived);
  for(const n of [1,3,4,58]) assert.throws(()=>assertTalliesDerived('semaglutide/index.html',html.replace('2 program',n+' program'),derived),/surface_tally_not_derived/);
});
test('D2p reveal count is checked independently and cannot legitimize wrong prose counts',()=>{
 const html='<section data-initial-visible="4">'+Array.from({length:20},(_,i)=>`<article data-program="p-${i}"></article>`).join('')+'<button data-provider-load-more>Show 12 more providers</button></section>';
 assertTalliesDerived('providers/index.html',html,derived);
 assert.throws(()=>assertTalliesDerived('providers/index.html',html.replace('Show 12','Show 11'),derived),/reveal_count_mismatch/);
 assert.throws(()=>assertTalliesDerived('providers/index.html',html+'<p>12 providers</p>',derived),/surface_tally_not_derived/);
});
test('D2p editorial date declaration is separate from material sitemap dates',async()=>{
 const d={schema:'glp.lastmod_declared_routes.v1',routes:['/guides/mounjaro-coupon/'],material_dates:{'/guides/mounjaro-coupon/':'2026-09-09'},editorial_dates:{'/guides/mounjaro-coupon/':'2026-08-29'}};
 const parsed=await readDeclaredRoutes({GLP_LASTMOD_DECLARED_ROUTES_FILE:'fixture'},async()=>JSON.stringify(d));
 assert.equal(parsed.editorialDates.get(d.routes[0]),'2026-08-29');
 assert.equal(resolveMaterialDate(d.routes[0],parsed.materialDates.get(d.routes[0]),{lastmod:'2026-08-29'},'2026-09-09').lastmod,'2026-09-09');
 const html=stampDateline('<p class="guide-byline">By Editors · Updated <time datetime="2026-09-09">September 9, 2026</time></p>','2026-08-29',newState());
 assert.match(html,/datetime="2026-08-29"/);
 for(const bad of [null,[],{'/unlisted/':'2026-08-29'},{'/guides/mounjaro-coupon/':'2026-02-30'}])await assert.rejects(()=>readDeclaredRoutes({GLP_LASTMOD_DECLARED_ROUTES_FILE:'fixture'},async()=>JSON.stringify({...d,editorial_dates:bad})));
});