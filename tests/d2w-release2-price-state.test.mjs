import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveDeployedPricingBaseline,pricingCoverageFloor,sha256} from '../src/pricing-coverage-floor.mjs';
import {validateAttestedRetention,isComparableCashRow,priceStateText} from '../src/price-state.mjs';
import {allInCostByPreference} from '../src/quiz-ranking.mjs';
import {buildCostCalculatorData,costCalculatorDropdownProviders} from '../src/cost-calculator.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8'),json=p=>JSON.parse(read(p));
const matrix=json('data/provider-pricing-matrix.json'),registry=json('data/program-registry.json'),baseline=resolveDeployedPricingBaseline();
const contract=json('data/price-state-retention.json');
const successor=json('data/price-state-retention-v3.json');
const removedId=contract.bindings.find(b=>matrix.providers[b.program_id].medications.length===0).program_id;
const derive=m=>({providers_with_evidenced_pricing:Object.values(m.providers).filter(p=>p.medications.length).length,medication_rows:Object.values(m.providers).reduce((n,p)=>n+p.medications.length,0)});
const validate=m=>validateAttestedRetention(root,m,baseline);
test('R2 exact source-attested retention accounts for every removed historical row without rewriting baseline',()=>{
 const receipt=validate(matrix);assert.deepEqual(receipt.removed_rows,contract.removed_rows);
 assert.deepEqual(receipt.baseline_coverage,{providers_with_evidenced_pricing:35,medication_rows:89});
 assert.deepEqual(derive(matrix),{providers_with_evidenced_pricing:33,medication_rows:82});
 assert.equal(receipt.removed_rows.length,receipt.baseline_coverage.medication_rows+Object.values(successor.additions).reduce((n,rows)=>n+rows.length,0)-derive(matrix).medication_rows);
 assert.deepEqual(pricingCoverageFloor(derive(matrix),baseline,sha256(read('data/provider-pricing-matrix.json')),null,{root,matrix}),[]);
});
for(const [name,mutate] of [
 ['missing attested row',m=>Object.values(m.providers).find(p=>p.medications.length).medications.pop()],
 ['fabricated zero',m=>Object.values(m.providers).find(p=>p.medications.length).medications[0].ongoing_usd=0],
 ['forged missing-price reason',m=>m.providers[removedId].unavailable_reason='Free treatment'],
 ['false claim provider publishes no prices',m=>m.providers[removedId].pricing_state='not_published'],
 ['forged snapshot hash',m=>m.providers[removedId].price_state_evidence.packet_sha256='0'.repeat(64)],
 ['stale source identity',m=>m.providers[removedId].price_state_evidence.program_id='another-provider'],
 ['arbitrary identity drop',m=>delete m.providers[removedId]],
])test('R2 rejects '+name,()=>{const m=structuredClone(matrix);mutate(m);assert.throws(()=>validate(m),/attested_price_retention:/);});
test('R2 rejects arbitrary denominator drop and stale deployed identity',()=>{
 assert.ok(pricingCoverageFloor({...derive(matrix),medication_rows:1},baseline,'0'.repeat(64),null,{root,matrix}).length);
 assert.throws(()=>validateAttestedRetention(root,matrix,{...baseline,matrix_sha256:'0'.repeat(64)}),{message:'attested_price_retention:baseline_hash'});
});
test('R2 altered evidence snapshot fails its pinned source hash',()=>{
 const work=path.join(root,'artifacts/test-work');fs.mkdirSync(work,{recursive:true});
 const workspace=fs.mkdtempSync(path.join(work,'r2-price-state-'));
 const temp=path.join(workspace,'candidates/fixture');try{
  fs.mkdirSync(temp,{recursive:true});
  // P1.1 portable custody: preserve the historical bytes and every hash check.
  const historical=path.join(temp,'data/predecessors/glp-price-index-weekly-20260910t190246z/provider-pricing-matrix.json');
  fs.mkdirSync(path.dirname(historical),{recursive:true});
  fs.copyFileSync(validate(matrix).baseline_matrix_path,historical);
  fs.mkdirSync(path.join(temp,'data'),{recursive:true});fs.copyFileSync(path.join(root,'data/price-state-retention.json'),path.join(temp,'data/price-state-retention.json'));
  fs.copyFileSync(path.join(root,'data/price-state-retention-v3.json'),path.join(temp,'data/price-state-retention-v3.json'));
  fs.cpSync(path.join(root,'data/price-state-evidence'),path.join(temp,'data/price-state-evidence'),{recursive:true});
  // Replay the authentic current manual-profile and reattestation inputs.
  // These are read-only fixture dependencies; only copied S30 packets below
  // may be mutated. Links avoid duplicating the multi-megabyte registry/ledger.
  for (const relative of ['data/program-registry.json','data/price-refresh-ledger.json','data/affiliate-activation-selection.json','data/pricing-evidence']) {
   fs.symlinkSync(path.join(root,relative),path.join(temp,relative));
  }
  assert.doesNotThrow(()=>validateAttestedRetention(temp,matrix,baseline));
  fs.writeFileSync(path.join(temp,contract.bindings[0].packet_path),'{}');
  assert.throws(()=>validateAttestedRetention(temp,matrix,baseline),/source_hash/);
 }finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
test('R2 unknown and typed offers cannot become zero-cost or exact cash arithmetic',()=>{
 for(const p of Object.values(matrix.providers)){
  if(!p.medications.length){assert.deepEqual(allInCostByPreference(p),{});assert.match(priceStateText(p),/[Pp]rice not published/);assert.ok(p.unavailable_reason);}
  for(const row of p.medications.filter(r=>Object.hasOwn(r,'price_kind'))){assert.equal(isComparableCashRow(row),false);assert.deepEqual(allInCostByPreference({medications:[row]}),{});}
 }
});
test('R2 unpriced eligible identities remain in directory, review and compare with state wording',()=>{
 const directory=read('public/providers/index.html'),compare=read('public/compare/index.html');
 const live=registry.programs.filter(p=>p.commercial_state==='live' && p.profiles?.['glp-clinic-scout']?.wired===true);
 let checked=0;
 for(const p of live){const id=p.review_slug||p.program_id,entry=matrix.providers[id];if(!entry||entry.medications.length)continue;
  assert.ok(directory.includes(`data-program="${id}"`)||directory.includes(`data-program="${p.program_id}"`)||directory.includes(`data-price-state-provider="${id}"`),id+' directory');
  const review=read('public'+(p.review_path||`/reviews/${id}/`)+'index.html');assert.match(review,/data-current-price-state/);assert.match(review,/[Pp]rice not published/);
  assert.ok(compare.includes(id),id+' compare');checked++;
 }
 assert.ok(checked>0);assert.match(compare,/[Pp]rice not published/);
});
test('R2 calculator selects exactly the independently derived comparable cash subset',()=>{
 const data=buildCostCalculatorData(json('data/cost-calculator.json'),json('data/money-page-specs.json').pages,json('data/provider-page-contracts.json'),json('data/provider-fastpath-contract.json'),registry,'glp-clinic-scout',new Set(),matrix);
 const expected=data.providers.filter(p=>matrix.providers[p.program_id]?.medications.some(isComparableCashRow)).map(p=>p.program_id).sort();
 assert.deepEqual(costCalculatorDropdownProviders(data).eligible.map(p=>p.program_id).sort(),expected);
 assert.ok(expected.length>0 && expected.length<data.providers.length);
});
test('R2 quiz unpriced matches have rationale, retain non-price goals and never enter price lane',()=>{
 const html=read('public/quiz/provider-fit/index.html');const candidates=JSON.parse(html.match(/id="candidate-data">([\s\S]*?)<\/script>/)[1]);
 let checked=0;for(const c of candidates){if(Object.keys(c.all_in_6mo_usd||{}).length)continue;
  assert.ok(c.pricing_reason);assert.ok(c.rules.goal.length);assert.equal(c.rules.goal.includes('price'),false);assert.deepEqual(c.all_in_6mo_usd,{});checked++;
 }assert.ok(checked>0);
});
test('R2 served denominator disclosures separate retained history and current cash subset',()=>{
 for(const p of ['public/tools/glp-1-cost-calculator/index.html','public/glp-1-price-index/index.html']){const html=read(p);assert.match(html,/89→82/);assert.match(html,/35→33/);assert.match(html,/not current offers/);assert.doesNotMatch(html,/\{\{(?:LIVE|PRICED|CALCULATOR|BASELINE|CURRENT|MATRIX)_/);}
});
