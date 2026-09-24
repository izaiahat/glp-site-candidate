import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const root=process.env.D2I_S10_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const {buildPhase3PageGraph}=await import(pathToFileURL(path.join(root,'src/phase3-page-graph.mjs')));
// Same route classification as build-staging's articleVertical; real corpus.
const articles=['data/blog/content-batch.json','data/blog/content-national-wow-additions.json'].flatMap(p=>read(p).articles).filter(a=>a.canonical_path.startsWith('/guides/')&&!/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed|peptide|bpc-157|cjc-1295|ipamorelin|hair-loss|minoxidil|finasteride|trt|testosterone|metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(a.canonical_path));
const built=buildPhase3PageGraph({graph:read('data/phase3-page-graph.json'),pharmacyInput:read('data/phase3-pharmacy-render-input.json'),pricingMatrix:read('data/provider-pricing-matrix.json'),programRegistry:read('data/program-registry.json'),homeSpec:{rows:[]},articles,couponOffersByProgram:{}});
const page=built.pages.find(x=>x.route==='/providers/').html;
const payloadText=page.match(/<script\b[^>]*data-provider-card-payloads[^>]*>([\s\S]*?)<\/script>/)?.[1];
const payloads=payloadText?JSON.parse(payloadText):[];
const cards=[...page.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/g,'').matchAll(/<article class="p3-provider-card\b([^>]*)>([\s\S]*?)<\/article>/g)].map(m=>{const i=m[1].match(/data-provider-lazy-index="(\d+)"/)?.[1];return i===undefined||typeof payloads[Number(i)]!=='string'?m[0]:m[0].replace(m[2],payloads[Number(i)]);});
// S11 added source-supported product identities after S10; the S10 evidence
// contract remains field-scoped. Price kinds must not manufacture cash values.
const pricing=read('data/provider-pricing-matrix.json');
const expectedMaps={'shedrx':'','found-health':'','enhance-md':'','try-ageless':'SEMAGLUTIDE:279','wellorithm':'','gala-health':''};
for(const [id,tokens] of Object.entries({'shedrx':['SEMAGLUTIDE','WEGOVY'],'found-health':['SEMAGLUTIDE','TIRZEPATIDE'],'enhance-md':['SEMAGLUTIDE','TIRZEPATIDE'],'try-ageless':['SEMAGLUTIDE','TIRZEPATIDE'],'wellorithm':['SEMAGLUTIDE','TIRZEPATIDE'],'gala-health':['SEMAGLUTIDE','TIRZEPATIDE']})){
 test('S10 real rendered medication facts and field-scoped dates: '+id,()=>{
  const card=cards.find(x=>x.includes('data-program="'+id+'"'));assert.ok(card,'provider card');
  const priceRows=Object.values(pricing.providers).filter(p=>p.program_id===id).flatMap(p=>p.medications);
  const productTokens=priceRows.map(r=>['wegovy-pill','wegovy','ozempic','mounjaro','zepbound','tirzepatide','semaglutide'].find(name=>r.medication_id.includes(name))).filter(Boolean).map(name=>name.toUpperCase().replaceAll('-','_'));
  assert.deepEqual(card.match(/data-drugs="([^"]*)"/)?.[1].split(' ').sort(),[...new Set([...(id==='gala-health'?[]:tokens),...productTokens])].sort());
  const ledger=read('data/program-content-ledger.json').programs.find(x=>x.program_id===id),e=ledger.meds_offered_evidence;assert.equal(e?.schema,'s10-field-evidence-v1');
  const fact=card.split('<dt>Medications offered</dt>')[1].split('</dd>')[0];assert.ok(fact.includes(id==='gala-health'?'Reported starting $179/month':'Reported options include'));
  assert.equal((fact.match(/<time /g)||[]).length,e.sources.length);
  for(const s of e.sources){assert.ok(fact.includes('datetime="'+s.checked_date+'"'));assert.ok(fact.includes(s.source_url));}
  const priceMap=card.match(/data-price-map="([^"]*)"/)?.[1];
  assert.equal(priceMap,expectedMaps[id]);
  assert.doesNotMatch(priceMap,/undefined|null|NaN/);
 });
}
