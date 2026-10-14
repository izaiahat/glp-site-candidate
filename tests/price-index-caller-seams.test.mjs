import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {historicalAffiliateRegistry} from '../src/affiliate-relationship-sync.mjs';
import {priceIndexCallerSeams} from './helpers/price-index-caller-seams.mjs';

// Portable dependency-binding regression only. Synthetic readers do NOT stand
// in for the original test's authenticated price oracle or full-build acceptance.
test('GLP-361 maintained price caller seams bind the real historical adapter and raw registry',()=>{
 const build=readFileSync(new URL('../scripts/build-staging.mjs',import.meta.url),'utf8');
 const {preflight,buildCall}=priceIndexCallerSeams(build);
 const raw={programs:[{program_id:'synthetic',affiliate_relationship_snapshot:{fixture_only:true,lifecycle:'ended'}}],therapeutic_taxonomy:{price_index_registry_frozen_source_sha256:'synthetic-source'}};
 const current={...structuredClone(raw),current_surface_only:true};
 const expected={programs:[{program_id:'synthetic'}],therapeutic_taxonomy:{price_index_registry_frozen_source_sha256:'synthetic-source'}};
 const before=structuredClone({raw,current});
 const tracker={price_index:{observations:[{source_files:{program_registry_sha256:'synthetic-source'}}]}};
 let reads=0;
 const syntheticHistoricalReader=r=>{
  reads++;assert.deepEqual(r,expected);
  return {...structuredClone(r),therapeutic_taxonomy:{...r.therapeutic_taxonomy,price_index_registry_programs_semantic_basis_sha256:'synthetic-body'}};
 };
 const stable=r=>{assert.deepEqual(r,{programs:[{program_id:'synthetic'}]});return 'synthetic-body';};
 const restore=(r,root)=>{assert.equal(root,'synthetic-root');return r;};
 const hash=preflight(current,Buffer.from('synthetic-registry-bytes'),tracker,createHash,stable,restore,'synthetic-root',syntheticHistoricalReader,historicalAffiliateRegistry,raw);
 assert.equal(hash,'synthetic-source');assert.equal(reads,1);
 const wrong=structuredClone(tracker);wrong.price_index.observations[0].source_files.program_registry_sha256='wrong';
 assert.throws(()=>preflight(current,Buffer.from('synthetic-registry-bytes'),wrong,createHash,stable,restore,'synthetic-root',syntheticHistoricalReader,historicalAffiliateRegistry,raw),{message:'price_index_registry_frozen_source_lineage_mismatch'});
 const ledger={ledger:{fixture_only:true},bytes:Buffer.from('synthetic-ledger')};
 const study={fixture_only:true},studyBytes=Buffer.from('synthetic-study');
 const sha=b=>createHash('sha256').update(b).digest('hex');
 let consumers=0;
 const consume=(input,options)=>{
  consumers++;
  assert.deepEqual(input,{tracker,study,programRegistry:expected,contentLedger:ledger.ledger,sourceHashes:{original_data_study_sha256:sha(studyBytes),program_content_ledger_sha256:sha(ledger.bytes),program_registry_sha256:hash}});
  assert.equal(typeof options.decorate,'function');
  return {fixture_only:true,html:'synthetic-output'};
 };
 const unused=()=>{throw Error('decoration must not run');};
 const output=buildCall(tracker,study,raw,ledger,studyBytes,hash,createHash,consume,unused,unused,unused,'synthetic-route',historicalAffiliateRegistry);
 assert.deepEqual(output,{fixture_only:true,html:'synthetic-output'});
 assert.equal(consumers,1);assert.deepEqual({raw,current},before);
});
