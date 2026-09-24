import test from 'node:test';import assert from 'node:assert/strict';
import {phase3Registry} from '../src/phase3-page-graph.mjs';
const profile='glp-clinic-scout';
const canonical={program_id:'canonical',commercial_state:'held',profiles:{[profile]:{canonical_identity:{role:'canonical',canonical_program_id:'canonical'},surfaces:{review:true,sitemap:true}}}};
const alias={program_id:'identity-alias',commercial_state:'held',profiles:{[profile]:{canonical_identity:{role:'alias',canonical_program_id:'canonical'},surfaces:{review:false,sitemap:false,go:false,compare:false,quiz:false,calculator:false}}}};
test('phase3 suppresses an explicitly identity-only alias, not the held canonical review',()=>{assert.deepEqual(phase3Registry({}, {programs:[canonical,alias]}).programs,[canonical]);});
test('phase3 retains aliases with an existing public review surface',()=>{const publicAlias=structuredClone(alias);publicAlias.profiles[profile].surfaces.review=true;assert.deepEqual(phase3Registry({}, {programs:[canonical,publicAlias]}).programs,[canonical,publicAlias]);});
test('a work-order addition cannot resurrect an explicit identity-only alias',()=>{const graph={provider_work_order_additions:[{program_id:alias.program_id,display_name:'Alias',governance_source:'fixture',commercial_facts_status:'unbound'}]};assert.deepEqual(phase3Registry(graph,{programs:[canonical,alias]}).programs,[canonical]);});
test('unrelated governed work-order addition remains included',()=>{const item={program_id:'unrelated',display_name:'Unrelated',governance_source:'fixture',commercial_facts_status:'unbound'};assert.deepEqual(phase3Registry({provider_work_order_additions:[item]},{programs:[canonical,alias]}).programs,[canonical,item]);});
