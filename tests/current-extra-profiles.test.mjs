import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveIdentityGroups} from '../src/provider-identity.mjs';
import {optionCProgramIds} from './helpers/d2w-s9-contracts.mjs';
import {currentComparisonPrograms} from './helpers/current-comparison-cohort.mjs';
import {assertExtraProfileMembership} from './helpers/current-extra-profiles.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const owner=readFileSync(new URL('./pass5-brave-crawl.test.mjs',import.meta.url),'utf8');
const baseline=new Function(owner.match(/const EXTRA_PROFILE_BASELINE = [\s\S]*?\.sort\(\);/)[0]+'return EXTRA_PROFILE_BASELINE;')();
async function run(change=()=>{}) {
  const registry=JSON.parse(read('data/program-registry.json'));
  const ledger=JSON.parse(read('data/program-content-ledger.json'));
  const cards=new Set(optionCProgramIds(registry));
  const {aliasIds}=deriveIdentityGroups(registry,'glp-clinic-scout',ledger.programs);
  const extras=currentComparisonPrograms(registry).filter(p=>{const s=p.profiles['glp-clinic-scout'];return p.commercial_state==='live'&&s?.vertical_fit&&s.wired&&s.surfaces.review&&!aliasIds.has(p.program_id)&&!cards.has(p.review_slug||p.program_id);});
  await assertExtraProfileMembership(extras,baseline,path=>{
    const bytes=read(path),data=JSON.parse(bytes),before=JSON.stringify(data);
    change(path,data);return JSON.stringify(data)===before?bytes:JSON.stringify(data);
  });
}
test('source-only directory membership keeps historical seven, source append and recommendation holds distinct',async()=>{
  assert.ok(owner.includes('await assertExtraProfileMembership(extraProfiles, EXTRA_PROFILE_BASELINE, read);'));
  await run();
  for(const edit of [
    d=>{d.programs=d.programs.filter(p=>p.program_id!=='willow-review');},
    d=>{d.programs.find(p=>p.program_id==='retaclinic-review').profiles['glp-clinic-scout'].surfaces.compare=true;},
  ]) await assert.rejects(run((path,data)=>{if(path==='data/program-registry.json')edit(data);}),/append_current_drift/);
  await assert.rejects(run((path,data)=>{if(path==='data/provider-price-append.json')data.registry.predecessor_sha256='0'.repeat(64);}),/append_predecessor_drift/);
  await assert.rejects(run((path,data)=>{if(path==='data/provider-page-contracts.json')data.providers.find(p=>p.program_id==='retaclinic-review').row_contract.promotion_authorized=true;}),{name:'AssertionError'});
});
