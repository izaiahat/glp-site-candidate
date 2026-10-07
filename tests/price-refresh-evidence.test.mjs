import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {applyPriceRefreshEvidence} from '../src/price-refresh-evidence.mjs';

function fixture(fn, raw='Compounded semaglutide injection starts at $21/month.', medication='compounded-semaglutide-injection') {
  const root=mkdtempSync(path.join(process.env.TMPDIR || process.cwd(),'price-refresh-'));
  mkdirSync(path.join(root,'data/price-refresh-captures'),{recursive:true});

  const sha=createHash('sha256').update(raw).digest('hex');
  const before={row_id:'a:sema',medication_id:medication,price_kind:'floor_from',facts:{amount_usd:{value:12,evidence:[]},period:{value:'/month',evidence:[]}}};
  const after=structuredClone(before);
  const captured='2026-10-07T22:00:00Z', source='https://clinic.example/pricing';
  after.facts.amount_usd={value:21,evidence:[{source_url:source,content_sha256:sha,captured_at_utc:captured,quote:raw,capture_key:'pricing'}]};
  const entry={program_id:'a',row_id:before.row_id,before,after,source_url:source,captured_at_utc:captured,reviewed_at_utc:'2026-10-07T22:01:00Z',markdown_path:`data/price-refresh-captures/${sha}.md`,markdown_sha256:sha,
    extraction:{row_id:before.row_id,medication_id:before.medication_id,price_kind:before.price_kind,source_url:source,identity_quote:raw,fields:[{field:'amount_usd',value:21,quote:raw},{field:'period',value:'/month',quote:raw}]}};
  const registry={programs:[{program_id:'a',commercial_state:'live'}],provider_dynamic_profiles:{profiles:{a:{source_urls:[source]}}}};
  const ledger={schema:'glp-price-refresh-ledger-v1',entries:[entry]};
  const expected={a:{medications:[structuredClone(before)]}};
  const save=()=>{
    writeFileSync(path.join(root,'data/program-registry.json'),JSON.stringify(registry));
    writeFileSync(path.join(root,'data/affiliate-activation-selection.json'),JSON.stringify({}));
    writeFileSync(path.join(root,'data/price-refresh-ledger.json'),JSON.stringify(ledger));
    writeFileSync(path.join(root,entry.markdown_path),raw);
  };
  try {save();fn({root,entry,ledger,registry,expected,save});}
  finally {rmSync(root,{recursive:true});}
}

test('monthly lexical alias is supported at its own amount',()=>fixture(({root,expected})=>{
  assert.equal(applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')).a.medications[0].facts.amount_usd.value,21);
},'Compounded semaglutide injection starts at $21/mo.'));

test('weekly injection identity and its mixed paragraph price stay injection-bound',()=>fixture(({root,expected})=>{
  assert.equal(applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')).a.medications[0].facts.amount_usd.value,21);
},'Compounded semaglutide weekly injection from $21/month or daily oral tablets.'));

test('unpriced oral alternative never borrows injection price',()=>fixture(({root,expected})=>{
  assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/amount_quote/);
},'Compounded semaglutide weekly injection from $21/month or daily oral tablets.','compounded-semaglutide-oral'));

test('whole dollar-field successor admits $12 to $21 and preserves original oracle',()=>fixture(({root,expected})=>{
  const result=applyPriceRefreshEvidence(root,expected,new Date('2026-10-08'));
  assert.equal(result.a.medications[0].facts.amount_usd.value,21);
  assert.equal(expected.a.medications[0].facts.amount_usd.value,12);
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
  ['future',e=>{e.reviewed_at_utc='2030-01-01';}],
]) test('refuses '+name,()=>fixture(({root,entry,expected,save})=>{
  mutate(entry);save();assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/price_refresh_evidence:/);
}));

test('held provider remains denied',()=>fixture(({root,registry,expected,save})=>{
  registry.programs[0].commercial_state='held';save();assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/held/);
}));

test('tampered raw source cannot stand in for same-source validation',()=>fixture(({root,entry,expected})=>{
  writeFileSync(path.join(root,entry.markdown_path),'Compounded semaglutide injection starts at $12/month.');
  assert.throws(()=>applyPriceRefreshEvidence(root,expected,new Date('2026-10-08')),/capture_hash/);
}));
