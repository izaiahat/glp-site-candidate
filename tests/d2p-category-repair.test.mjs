import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {renderCompoundedCategoryBody} from '../src/compounded-category.mjs';
import {deriveIdentityGroups} from '../src/provider-identity.mjs';
import {categoryPrograms} from './helpers/d2w-s9-contracts.mjs';

const read=p=>JSON.parse(readFileSync(new URL('../data/'+p,import.meta.url)));
const registry=read('program-registry.json'),ledger=read('program-content-ledger.json');
const {aliasIds}=deriveIdentityGroups(registry,'glp-clinic-scout',ledger.programs);
const programs=registry.programs.filter(p=>!aliasIds.has(p.program_id));
const render=medication=>renderCompoundedCategoryBody({medication,programs,registry,pricingMatrix:read('provider-pricing-matrix.json')});
for(const medication of ['semaglutide','tirzepatide'])test(medication+': train 4 each row/card keeps identity and one receipt-bound primary with pure citations',()=>{
 const html=render(medication),parts=[...html.matchAll(/<(tr|article) data-g08-provider-id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)];
 const expected=categoryPrograms(registry,medication);
 assert.ok(expected.length>0);
 assert.equal(parts.length,expected.length*2);
 const document=JSDOM.fragment(html);
 for(const mode of ['desktop','mobile']){
  const views=document.querySelectorAll(`[data-g08-${mode}]`);
  assert.equal(views.length,1,mode+' view');
  assert.deepEqual([...views[0].querySelectorAll('[data-g08-provider-id]')].map(p=>p.getAttribute('data-g08-provider-id')).sort(),expected.map(p=>p.program_id).sort(),mode+' exact membership');
 }

 for(const [,tag,id,part] of parts){
  const primary=[...part.matchAll(/<a [^>]*data-g08-primary[^>]*>/g)];assert.equal(primary.length,1,id+' '+tag);
  const href=primary[0][0].match(/href="([^"]+)"/)[1];
  const program=programs.find(p=>p.program_id===id);
  const selection=loadGoSelection().programs[id];
  if(selection?.status==='VERIFIED' && loadGoPromotionAuthority().programs[id]?.status==='VERIFIED'){
   const url=new URL(href.replaceAll('&amp;','&'),'https://site.invalid');
   assert.equal(url.pathname,selection.route);assert.match(primary[0][0],/data-funnel-v2-go/);
   const runtime=GO_RUNTIME_MANIFEST.programs[selection.render_id];assert.equal(runtime.tracking.base_url,selection.issued_link);assert.equal(runtime.live_link_allowed,true);
  }else assert.equal(href,program.review_path);
 }
 const tracked=[...html.matchAll(/<a\b[^>]*data-funnel-v2-go[^>]*>/g)];
 assert.equal(tracked.length,expected.filter(p=>loadGoSelection().programs[p.program_id]?.status==='VERIFIED' && loadGoPromotionAuthority().programs[p.program_id]?.status==='VERIFIED').length*2);
 const citations=[...html.matchAll(/<a\b[^>]*data-citation=[^>]*>/g)];assert(citations.length>0);
 for(const [anchor] of citations){assert.doesNotMatch(anchor,/href="\/go\/|data-analytics-event="affiliate_click"|data-funnel-v2-go/);}
});
test('category CSS gives citations minimum target, nonhyphenating price column and full-width heading',()=>{
 const html=render('tirzepatide');
 assert.match(html,/a\[data-citation\][^{]*\{display:inline-block;min-height:24px;line-height:24px\}/);
 assert.match(html,/td\[data-label="Reported prices & plan terms"\][^{]*\{hyphens:none\}/);
 assert.match(html,/\.g08-directory-head\{max-width:none;width:100%;margin:0 0 24px\}/);
 assert.match(html,/thead th:first-child\{width:20%\}/);assert.match(html,/thead th:nth-child\(2\)\{width:45%\}/);
 const css=readFileSync(new URL('../assets/site.css',import.meta.url),'utf8');assert.match(css,/a\[data-citation\],\s*\.typed-price ul\[aria-label="Dated price evidence"\] a\s*\{\s*display:\s*inline-block;\s*min-height:\s*24px;\s*line-height:\s*24px;/);
});
test('adjacent FDA sources name different subjects and retain direct citations',()=>{
 const html=render('tirzepatide');assert.match(html,/FDA compounding questions and answers, checked/);assert.match(html,/FDA concerns about unapproved GLP-1 drugs, checked/);assert.doesNotMatch(html,/>FDA guidance, checked/);
});
