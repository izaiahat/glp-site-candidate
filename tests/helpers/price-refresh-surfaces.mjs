// Confined fixture proof through maintained consumers, not handwritten HTML.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {renderCompareCard,headlinePrice} from '../../src/provider-compare-card.mjs';
import {renderDirectoryFinal,renderPricePair} from '../../src/directory-detail-finals.mjs';
import {renderCategoryPrice} from '../../src/compounded-category.mjs';
import {comparisonCardBody} from '../../src/comparison-presets.mjs';
import {quizTypedPriceEvidence} from '../../src/quiz.mjs';
import {renderAdsLandingPage} from '../../src/ads-landing.mjs';
import {attachPricingMatrix,renderCostCalculator} from '../../src/cost-calculator.mjs';
import {renderComparisonTable} from '../../src/money-page.mjs';
import {renderProviderDetailComplete,directoryPriceMap} from '../../src/phase3-page-graph.mjs';

const read=relative=>JSON.parse(readFileSync(new URL('../../'+relative,import.meta.url)));
const fragment=html=>JSDOM.fragment(html);
export function provePriceSurfaces(row, out=null) {
  const pid=row.row_id.split(':')[0];
  const entry={program_id:pid,provider:'Synthetic clinic fixture',medications:[row]};
  const matrix={schema:'glp-provider-pricing-matrix-v2',providers:{[pid]:entry}};
  const provider={program_id:pid,provider:entry.provider,mode:'manual',source_url:row.facts.amount_usd.evidence[0].source_url,medications:[]};
  attachPricingMatrix([provider],matrix);
  assert.equal(provider.medications[0].display_only,true);
  assert.equal(provider.medications[0].ongoing_usd,undefined);
  assert.equal(headlinePrice(entry),null);
  assert.equal(directoryPriceMap([row]),'');
  const tableRows=Array.from({length:4},(_,i)=>({...provider,program_id:i?`fixture-${i}`:pid,starting_price:'Not attested',meds_offered:'Reported information',insurance:'Not attested',average_wait:'Not attested'}));
  const surfaces={
    compare_card:renderCompareCard({row:provider,entry,rank:1}),
    directory_desktop_mobile:renderDirectoryFinal([{id:row.row_id,provider:entry.provider,price:row,review:`/reviews/${pid}/`}],()=>{throw Error('typed row used legacy source callback');}),
    detail_price_pair:renderPricePair(row,()=>{throw Error('typed row used legacy source callback');}),
    category_price:renderCategoryPrice(row),
    comparison_preset:comparisonCardBody({slug:'starter'},entry,()=>{throw Error('typed row used legacy renderer');}),
    quiz_price_evidence:quizTypedPriceEvidence(entry,'SEMAGLUTIDE'),
    paid_landing:renderAdsLandingPage({provider:{slug:pid,name:entry.provider,score:null,reviewPath:`/reviews/${pid}/`},price:row,bullets:['Fixture only','Reported information','No clinical claim','No publication'],cta:'<a href="/quiz/">Compare</a>',stickyEnabled:false,headlines:{},defaultHeadline:'Synthetic price fixture',checkedThrough:'2026-10-07',disclosure:'Independent comparison publisher; affiliate relationships may apply'}),
    money_comparison_table:renderComparisonTable({rows:tableRows,pricing_matrix:matrix}),
    calculator:renderCostCalculator({providers:[provider],pricing_coverage:{providers:1,with_evidenced_pricing:1,pricing_unavailable:0,medication_rows:1,rows_with_intro_month_1:0},path:'/tools/glp-1-cost-calculator/',related_comparison_path:'/providers/',title:'Fixture calculator',description:'Synthetic fixture'})
  };
  // Exercise the complete provider renderer without unrelated private funnels.
  const registry=read('data/program-registry.json');
  assert(!registry.programs.some(p=>p.program_id===pid),'fixture provider collided with a live provider');
  const program=structuredClone(registry.programs.find(p=>p.program_id==='enhance-md'));
  Object.assign(program,{program_id:pid,display_name:entry.provider,review_path:`/reviews/${pid}/`});
  delete program.go; delete program.affiliate_relationship_snapshot;
  registry.programs.push(program);
  surfaces.actual_provider_detail=renderProviderDetailComplete(program,matrix,registry,{}, {providers:{}},read('assets/provider-logos/manifest.json'),[]);
  const proof={synthetic:true,publication:false,writer_row_id:row.row_id,surfaces:{},numeric_projection:'NOT_PROMOTED'};
  for(const [name,html] of Object.entries(surfaces)) {
    const doc=fragment(html),lines=[...doc.querySelectorAll('.typed-price-line,[data-g08-price-line]')];
    assert(lines.length>0,name+' missing rendered price');
    for(const line of lines){assert.match(line.textContent,/\$21/);assert.doesNotMatch(line.textContent,/\$12/);}
    assert.match(doc.textContent,/Standard plan/);
    assert(doc.querySelector('a[data-citation="first_party_price_evidence"]'),name+' lost source');
    assert.doesNotMatch(html,/"@type"\s*:\s*"Offer"/);
    proof.surfaces[name]={price_lines:lines.map(l=>l.textContent),plan_retained:true,source_retained:true};
    if(out){mkdirSync(out,{recursive:true});writeFileSync(path.join(out,name+'.html'),html);}
  }
  const detail=fragment(surfaces.actual_provider_detail);
  const schemas=[...detail.querySelectorAll('script[type="application/ld+json"]')].map(s=>JSON.parse(s.textContent));
  const nodes=schemas.flatMap(s=>s['@graph'] || [s]);
  assert(!nodes.some(n=>n['@type']==='Product'),'typed floor must not mint Product with empty Offers');
  proof.structured_data={offers:0,products:0,source:'actual provider-detail renderer'};
  return proof;
}
