import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {applyPriceRefreshEvidence} from '../src/price-refresh-evidence.mjs';
import {validatePriceRow} from '../src/pricing-evidence-v2.mjs';
import {provePriceSurfaces} from './helpers/price-refresh-surfaces.mjs';

// Confined synthetic captures, never live observations or adoption authority.
function fixture(fn, raw='Compounded semaglutide injection Standard plan starts from $21/month.', medication='compounded-semaglutide-injection') {
  const root=mkdtempSync(path.join(process.env.TMPDIR || process.cwd(),'price-refresh-'));
  for(const dir of ['price-refresh-captures','pricing-evidence']) mkdirSync(path.join(root,'data',dir),{recursive:true});
  const sha=createHash('sha256').update(raw).digest('hex');
  const captured='2026-10-07T22:00:00Z', source='https://clinic.example/pricing';
  const oldRaw=raw.replace('$21','$12'), oldSha=createHash('sha256').update(oldRaw).digest('hex');
  const witness=(digest,quote,stamp=captured)=>({source_url:source,capture_sha256:digest,capture_path:`data/pricing-evidence/${digest}.md`,captured_at_utc:stamp,quote});
  const oldWitness=witness(oldSha,oldRaw,'2026-10-06T22:00:00Z');
  const fact=value=>({value,evidence:[oldWitness],artifact_needed:null});
  const period=raw.includes('/mo.')?'/mo':'/month';
  const before={row_id:'clinic:s32-0:'+medication,medication_id:medication,label:'Compounded semaglutide',plan_label:'Standard plan',price_kind:'floor_from',calculator_eligibility:'display_only',qualifiers:[],unknown_components:['Eligibility requires clinical review'],evidence:[oldWitness],identity_evidence:[oldWitness],facts:{amount_usd:fact(12),period:fact(period)}};
  const after=structuredClone(before);
  after.facts.amount_usd={value:21,artifact_needed:null,evidence:[witness(sha,raw)]};
  const entry={program_id:'clinic',row_id:before.row_id,before,after,source_url:source,captured_at_utc:captured,reviewed_at_utc:'2026-10-07T22:01:00Z',markdown_path:`data/price-refresh-captures/${sha}.md`,markdown_sha256:sha,
    extraction:{row_id:before.row_id,medication_id:before.medication_id,price_kind:before.price_kind,source_url:source,identity_quote:raw,plan_label:before.plan_label,plan_quote:raw,qualifiers:[],conditions_quote:raw,fields:[{field:'amount_usd',value:21,quote:raw},{field:'period',value:period,quote:raw}]}};
  const registry={programs:[{program_id:'clinic',commercial_state:'live'}],provider_dynamic_profiles:{profiles:{clinic:{source_urls:[source]}}}};
  const ledger={schema:'glp-price-refresh-ledger-v1',entries:[entry]};
  const expected={clinic:{medications:[structuredClone(before)]}};
  const save=()=>{
    writeFileSync(path.join(root,'data/program-registry.json'),JSON.stringify(registry));
    writeFileSync(path.join(root,'data/affiliate-activation-selection.json'),JSON.stringify({}));
    writeFileSync(path.join(root,'data/price-refresh-ledger.json'),JSON.stringify(ledger));
    writeFileSync(path.join(root,entry.markdown_path),raw);
    writeFileSync(path.join(root,`data/pricing-evidence/${sha}.md`),raw);
    writeFileSync(path.join(root,oldWitness.capture_path),oldRaw);
  };
  try {save();fn({root,entry,ledger,registry,expected,save,witness,fact,raw,sha});}
  finally {rmSync(root,{recursive:true});}
}

test('monthly lexical alias is supported at its own amount',()=>fixture(({root,expected})=>{
  assert.equal(applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')).clinic.medications[0].facts.amount_usd.value,21);
},'Compounded semaglutide injection Standard plan starts from $21/mo.'));

test('weekly injection identity and its mixed paragraph price stay injection-bound',()=>fixture(({root,expected})=>{
  assert.equal(applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')).clinic.medications[0].facts.amount_usd.value,21);
},'Compounded semaglutide weekly injection Standard plan from $21/month or daily oral tablets.'));

test('unpriced oral alternative never borrows injection price',()=>fixture(({root,expected})=>{
  assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/amount_quote/);
},'Compounded semaglutide weekly injection Standard plan from $21/month or daily oral tablets.','compounded-semaglutide-oral'));

test('native dollar successor admits $12 to $21 and preserves original oracle',()=>fixture(({root,expected})=>{
  const result=applyPriceRefreshEvidence(root,expected,new Date('2026-10-08'));
  assert.equal(result.clinic.medications[0].facts.amount_usd.value,21);
  assert.deepEqual(validatePriceRow(result.clinic.medications[0],{root,now:+new Date('2026-10-08')}),[]);
  assert.equal(expected.clinic.medications[0].facts.amount_usd.value,12);
  assert.deepEqual(applyPriceRefreshEvidence(root,result,new Date('2026-10-08')),result);
}));

for (const [name, mutate] of [
  ['null',e=>{e.extraction.fields[0].value=null;}],
  ['zero',e=>{e.extraction.fields[0].value=0;}],
  ['wrong medication quote',e=>{e.extraction.fields[0].quote='$21/month.';}],
  ['lost full field',e=>{e.extraction.fields.pop();}],
  ['changed term',e=>{e.extraction.fields[1].value='/year';}],
  ['identity',e=>{e.after.medication_id='brand-wegovy';}],
  ['preimage',e=>{e.before.facts.amount_usd.value=13;}],
  ['other row fields',e=>{e.after.unreviewed='changed';}],
  ['provenance',e=>{e.after.facts.amount_usd.evidence[0].source_url='https://other.example/';}],
  ['legacy witness shape',e=>{const w=e.after.facts.amount_usd.evidence[0];w.content_sha256=w.capture_sha256;delete w.capture_sha256;}],
  ['absent artifact_needed',e=>{delete e.after.facts.amount_usd.artifact_needed;}],
  ['missing plan contract',e=>{delete e.extraction.plan_label;}],
  ['changed qualifiers',e=>{e.extraction.qualifiers=['new patients only'];}],
  ['truncated conditions',e=>{e.extraction.conditions_quote='$21/month.';}],
  ['future',e=>{e.reviewed_at_utc='2030-01-01';}],
]) test('refuses '+name,()=>fixture(({root,entry,expected,save})=>{
  mutate(entry);save();assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/price_refresh_evidence:/);
}));

// These rows all pass the native structural gate; receiver semantics must refuse.
test('swapped intro and renewal amounts refuse even with complete plan contract',()=>fixture(({root,entry,expected,save,witness})=>{
  const old='Compounded semaglutide injection Standard plan first month $79/month, then $229/month ongoing.';
  const oldSha=createHash('sha256').update(old).digest('hex');
  writeFileSync(path.join(root,`data/pricing-evidence/${oldSha}.md`),old);
  entry.before.price_kind=entry.after.price_kind=entry.extraction.price_kind='intro_then_ongoing';
  entry.before.facts={};entry.after.facts={};entry.extraction.fields=[];
  for(const [field,prev,next] of [['intro_usd',79,249],['intro_period','month','month'],['ongoing_usd',229,99],['ongoing_period','month','month']]){
    entry.before.facts[field]={value:prev,artifact_needed:null,evidence:[witness(oldSha,old,'2026-10-06T22:00:00Z')]};
    entry.after.facts[field]=typeof next==='number'?{value:next,artifact_needed:null,evidence:[witness(entry.markdown_sha256,entry.extraction.conditions_quote)]}:structuredClone(entry.before.facts[field]);
    entry.extraction.fields.push({field,value:next,quote:entry.extraction.conditions_quote});
  }
  entry.before.evidence=entry.before.identity_evidence=entry.after.evidence=entry.after.identity_evidence=[witness(oldSha,old,'2026-10-06T22:00:00Z')];
  expected.clinic.medications[0]=structuredClone(entry.before);save();
  assert.deepEqual(validatePriceRow(entry.after,{root,now:+new Date('2026-10-08')}),[]);
  assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/plan_phase_or_basis/);
},'Compounded semaglutide injection Standard plan first month $99/month, then $249/month ongoing.'));

for(const [name,raw] of [
  ['prepaid alternative','Compounded semaglutide injection Standard plan $249/month; Annual prepaid plan $1188 upfront, equivalent $21/month.'],
  ['new intro condition','Compounded semaglutide injection Standard plan starts from $21/month for first month only, then $249/month ongoing.'],
  ['new restriction','Compounded semaglutide injection Standard plan starts from $21/month for qualifying doses.'],
]) test('refuses '+name+' with complete contract',()=>fixture(({root,entry,expected,save,witness})=>{
  const old='Compounded semaglutide injection Standard plan starts from $12/month.';
  const oldSha=createHash('sha256').update(old).digest('hex');
  writeFileSync(path.join(root,`data/pricing-evidence/${oldSha}.md`),old);
  const w=witness(oldSha,old,'2026-10-06T22:00:00Z');
  entry.before.evidence=entry.before.identity_evidence=entry.after.evidence=entry.after.identity_evidence=[w];
  entry.before.facts.amount_usd.evidence=entry.before.facts.period.evidence=entry.after.facts.period.evidence=[w];
  expected.clinic.medications[0]=structuredClone(entry.before);save();
  if(name!=='prepaid alternative') assert.deepEqual(validatePriceRow(entry.after,{root,now:+new Date('2026-10-08')}),[]);
  assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/conditions|plan_phase_or_basis/);
},raw));

test('native receiver successor reaches all maintained price surfaces without cash promotion',()=>fixture(({root,expected})=>{
  const row=applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')).clinic.medications[0];
  const proof=provePriceSurfaces(row);
  assert.equal(Object.keys(proof.surfaces).length,10);
  assert.equal(proof.numeric_projection,'NOT_PROMOTED');
  assert.deepEqual(proof.structured_data,{offers:0,products:0,source:'actual provider-detail renderer'});
}));

test('held provider remains denied',()=>fixture(({root,registry,expected,save})=>{
  registry.programs[0].commercial_state='held';save();assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/held/);
}));

test('tampered raw source cannot stand in for same-source validation',()=>fixture(({root,entry,expected})=>{
  writeFileSync(path.join(root,entry.markdown_path),'Compounded semaglutide injection starts from $12/month.');
  assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/capture_hash/);
}));
