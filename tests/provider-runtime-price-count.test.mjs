import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {providerReviewRuntimePredecessorRegistry} from '../src/provider-price-append.mjs';
import {effectiveAffiliateRegistry} from '../src/affiliate-relationship-sync.mjs';
import {assertDeclaredIdentityGroups} from '../src/provider-identity.mjs';
test('price runtime predecessor removes only four new reviews; frozen price basis stays separate',()=>{
 const r=JSON.parse(fs.readFileSync(new URL('../data/program-registry.json',import.meta.url)));
 const ledger=JSON.parse(fs.readFileSync(new URL('../data/program-content-ledger.json',import.meta.url))).programs;
 const p=providerReviewRuntimePredecessorRegistry(r);
 const four=new Set(['tyde-wellness-review','feelgood-review','instarx-review','retaclinic-review']);
 assert.deepEqual(p.programs,r.programs.filter(p=>!four.has(p.program_id)));
 const effective=effectiveAffiliateRegistry(p),identities=assertDeclaredIdentityGroups(effective,'glp-clinic-scout',ledger);
 const count=effective.programs.filter(p=>p.commercial_state==='live'&&p.profiles?.['glp-clinic-scout']?.vertical_fit===true&&p.profiles['glp-clinic-scout'].wired===true&&p.profiles['glp-clinic-scout'].surfaces?.review===true&&!identities.aliasIds.has(p.program_id)).length;
 assert.equal(count,59);
 const bad=structuredClone(r);bad.programs[0].display_name+=' tamper';
 assert.throws(()=>providerReviewRuntimePredecessorRegistry(bad),/append_current_drift/);
 assert.match(fs.readFileSync(new URL('../scripts/build-staging.mjs',import.meta.url),'utf8'),/effectiveAffiliateRegistry\(providerReviewRuntimePredecessorRegistry\(rawProgramRegistry\)\)/);
});
