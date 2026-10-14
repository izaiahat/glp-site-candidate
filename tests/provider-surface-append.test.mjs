import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendManualPricing, appendGoldenVectors, retainedManualPricingBasis} from '../src/provider-surface-append.mjs';
test('manual pricing append retains all evidenced rows and never invents a price',()=>{
 const matrix={providers:{old:{medications:[{price:1}]}},coverage:{providers_total:1,providers_with_evidenced_pricing:1,providers_pricing_unavailable:0,medication_rows:1}};
 const registry={programs:[{program_id:'new',display_name:'New'}],provider_dynamic_profiles:{profiles:{new:{calculator:{mode:'manual',first_month_base_usd:null,recurring_month_base_usd:null,one_time_fee_usd:null,evidence_gap_copy:'Confirm the selected treatment and complete renewal charge.'}}}}};
 const next=appendManualPricing(matrix,registry,['new']);
 assert.deepEqual(next.providers.old,matrix.providers.old); assert.deepEqual(next.providers.new.medications,[]);
 assert.equal(next.coverage.providers_total,2); assert.equal(next.coverage.medication_rows,1);
 assert.equal(Object.keys(matrix.providers).length,1);
 assert.deepEqual(retainedManualPricingBasis(next,registry,['new']).providers,matrix.providers);
 const forged=structuredClone(next); forged.providers.new.medications=[{price:1}];
 assert.throws(()=>retainedManualPricingBasis(forged,registry,['new']),/manual_projection_drift/);
 const reasonDrift=structuredClone(next); reasonDrift.providers.new.unavailable_reason='free';
 assert.throws(()=>retainedManualPricingBasis(reasonDrift,registry,['new']),/manual_projection_drift/);
 registry.provider_dynamic_profiles.profiles.new.calculator.first_month_base_usd=1;
 assert.throws(()=>appendManualPricing(matrix,registry,['new']),/manual_scope/);
});
test('golden insertion preserves retained order and denial placeholders',()=>{
 const config={golden_vectors:[{vector_id:'v',expected_program_ids:['old','held','last']}]};
 const audit={findings:[],golden_vectors:[{vector_id:'v',expected:['old','last'],actual:['old','new','last']}]};
 const result=appendGoldenVectors(config,audit,['new'],['held']);
 assert.deepEqual(result.golden_vectors[0].expected_program_ids,['old','held','new','last']);
 audit.golden_vectors[0].actual=['last','new','old'];
 assert.throws(()=>appendGoldenVectors(config,audit,['new'],['held']),/golden_retained_drift/);
 audit.golden_vectors[0].actual=['old','unexpected','last'];
 assert.throws(()=>appendGoldenVectors(config,audit,['new'],['held']),/golden_retained_drift/);
});
