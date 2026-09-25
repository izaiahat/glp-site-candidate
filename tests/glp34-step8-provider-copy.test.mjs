import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test, {before, after} from 'node:test';
import {chromium} from '@playwright/test';
import {buildPhase3PageGraph} from '../src/phase3-page-graph.mjs';
import {javascriptProviderMarkup} from './helpers/d2p-noscript.mjs';
import {deriveIdentityGroups} from '../src/provider-identity.mjs';
import {projectProviderDisplayFacts, projectProviderDisplayLedger} from '../src/provider-display-evidence.mjs';
import {priceStateText} from '../src/price-state.mjs';
import {isTypedPrice} from '../src/typed-price-labels.mjs';
const read = name => JSON.parse(readFileSync(new URL('../data/'+name, import.meta.url)));
const registry=read('program-registry.json'), matrix=read('provider-pricing-matrix.json');
const ledger=read('program-content-ledger.json').programs.map(p=>projectProviderDisplayLedger(p));
const facts=read('provider-facts-backfill-20260830.json').programs.map(p=>projectProviderDisplayFacts(p));
const aliases=deriveIdentityGroups(registry,'glp-clinic-scout',ledger).aliasIds;
const live=registry.programs.filter(p=>{const x=p.profiles?.['glp-clinic-scout'];return p.commercial_state==='live'&&x?.vertical_fit&&x.wired&&x.surfaces?.review&&!aliases.has(p.program_id);});
const qualified=f=>f?.status==='SOURCE_REPORTED'&&!!f.value&&!!f.source_url&&!!f.capture_date;
const expected=live.flatMap(p=>{
 for(const id of [...new Set([p.review_slug,p.program_id].filter(Boolean))]){
  const f=facts.find(x=>x.program_id===id),l=ledger.find(x=>x.program_id===id);
  if(f?.display_name&&l?.meds_offered&&l.source_url&&qualified(f.facts.total_monthly_cost)&&qualified(f.facts.cancellation))return [{id,f,l,p}];
 }
 return [];
});
const expectedIds=new Set(expected.map(x=>x.id));
const otherVertical=/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/;
const articles=['content-batch.json','content-national-wow-additions.json'].flatMap(n=>read('blog/'+n).articles).filter(a=>a.canonical_path?.startsWith('/guides/')&&!otherVertical.test(a.canonical_path));
const built=buildPhase3PageGraph({graph:read('phase3-page-graph.json'),pharmacyInput:read('phase3-pharmacy-render-input.json'),pricingMatrix:matrix,programRegistry:registry,homeSpec:{rows:[]},articles,couponOffersByProgram:{}});
const html=process.env.GLP34_VERIFY_PUBLIC==='1'?readFileSync(new URL('../public/providers/index.html',import.meta.url),'utf8'):built.pages.find(p=>p.route==='/providers/').html;
// Public builds may store deferred card bodies in a versioned local JSON asset;
// require every no-JS twin to match its JS shell before hydrating either path.
const projectedHtml=javascriptProviderMarkup(html);
const payloadPath=html.match(/<script\b[^>]*data-provider-card-payloads[^>]*data-src="([^"]+)"/)?.[1];
const externalPayload=payloadPath?JSON.parse(readFileSync(new URL(`../public${payloadPath}`,import.meta.url),'utf8')):null;
let browser,view;
before(async()=>{
 browser=await chromium.launch();const page=await browser.newPage();await page.route('**/*',r=>r.abort());
 view=await page.evaluate(({html,externalPayload})=>{
  const d=new DOMParser().parseFromString(html,'text/html');
  const payload=externalPayload||JSON.parse(d.querySelector('[data-provider-card-payloads]')?.textContent||'[]');
  const slots=[...d.querySelectorAll('[data-provider-lazy-index]')];
  for(const n of slots){const body=payload[Number(n.dataset.providerLazyIndex)];if(typeof body!=='string')throw Error('missing deferred provider payload');n.innerHTML=body;}
  d.querySelectorAll('noscript,script,style').forEach(n=>n.remove());
  return {text:d.body.textContent.replace(/\s+/g,' ').trim(),count:d.querySelector('[data-live-provider-count]')?.textContent,links:[...d.querySelectorAll('a[href]')].map(n=>n.getAttribute('href')),cards:[...d.querySelectorAll('[data-phase3-provider-grid] [data-phase3-provider]')].map(n=>({id:n.dataset.program,facts:[...n.querySelectorAll('dl[data-provider-card-contract]>div')].map(c=>({name:c.querySelector('dt')?.textContent,value:c.querySelector('dd>span')?.textContent,dates:[...c.querySelectorAll('time')].map(t=>t.getAttribute('datetime')),sources:[...c.querySelectorAll('small a')].map(a=>a.getAttribute('href'))}))}))};
 },{html:projectedHtml,externalPayload});await page.close();
});
after(async()=>{await browser?.close();});
test('RN-01867: registry token and confirmed-card eligibility retain every other provider destination',()=>{
 assert(live.length>0&&expected.length>0&&expected.length<live.length,'real positive and ineligible source cohorts required');
 const total=process.env.GLP34_VERIFY_PUBLIC==='1'?String(live.length):'{{LIVE_PROVIDER_COUNT}}';
 assert.equal(view.count,total);
 assert(view.text.includes(`We track ${total} providers in total. ${expected.length} meet the comparison-card evidence rules; ${live.length-expected.length} additional provider profiles have their own first-party pages outside this comparison.`));
 assert.equal(expected.length + (live.length-expected.length), live.length);
 assert.equal(new Set(view.cards.map(c=>c.id)).size, expected.length);
 assert.deepEqual(view.cards.map(c=>c.id).sort(),[...expectedIds].sort());
 for(const p of live.filter(p=>!expectedIds.has(p.review_slug||p.program_id)))assert(view.links.includes(p.review_path||`/providers/${p.program_id}/`),'missing unconfirmed identity destination: '+p.program_id);
});
test('RN-01878: first-party attribution and exact fact/source/date joins on every confirmed card',()=>{
 assert(view.text.includes("Where this comes from. Provider names, prices and program details are taken from each provider's own published pages, with the date we checked shown next to every fact. We don't estimate availability, guess whether a program suits you, or invent ratings or review counts."));
 assert.deepEqual(view.cards.map(c=>c.id).sort(),[...expectedIds].sort());
 for(const {id,f,l} of expected){
  const card=view.cards.find(c=>c.id===id);assert(card,'missing card '+id);
  const medicationSources=l.meds_offered_evidence?.schema==='s10-field-evidence-v1'?l.meds_offered_evidence.sources.map(s=>({source_url:s.source_url,capture_date:s.checked_date})):[{source_url:l.source_url,capture_date:f.capture_date}];
  const rawEntry=Object.values(matrix.providers).find(p=>p.program_id===id);
  const entry={...rawEntry,medications:(rawEntry?.medications||[]).filter(row=>isTypedPrice(row)||Number.isFinite(row.ongoing_usd))};
  const rows=[['Medications offered',l.meds_offered,medicationSources],['Total monthly cost',priceStateText(entry)||f.facts.total_monthly_cost.value,[f.facts.total_monthly_cost]],['Cancellation',f.facts.cancellation.value,[f.facts.cancellation]]];
  for(const [name,value,sources] of rows){
   const cell=card.facts.find(x=>x.name===name);assert(cell,id+': missing '+name);assert.equal(cell.value,value,id+': '+name);
   assert(sources.length>0&&sources.every(s=>/^https?:\/\//.test(s.source_url)&&/^\d{4}-\d{2}-\d{2}$/.test(s.capture_date)),id+': source/date qualification');
   assert.deepEqual(cell.dates,sources.map(s=>s.capture_date),id+': '+name+' dates');
   assert.deepEqual(cell.sources,sources.map(s=>s.source_url),id+': '+name+' sources');
  }
 }
});
