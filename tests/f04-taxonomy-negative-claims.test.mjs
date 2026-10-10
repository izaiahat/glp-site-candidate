import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readHistoricalPriceFixture} from './helpers/provider-append-predecessor.mjs';
import {historicalPriceIndexRegistry} from '../src/price-index-historical-registry.mjs';

// Real current input; compose only the exact two negative factual corrections.
// Historical source quotes, calculator clocks and every other leaf stay intact.
function correctedRegistry() {
  const r=JSON.parse(readHistoricalPriceFixture(new URL('../data/program-registry.json',import.meta.url)));
  r.programs.find(p=>p.program_id==='refills').research_dynamic_profile.taxonomy.molecule_tags=['semaglutide'];
  r.programs.find(p=>p.program_id==='tmates-xentraffic-offer-3154').research_dynamic_profile.taxonomy.brand_name_tags=[];
  return r;
}

test('exact Refills/TMates negative claims preserve the original price-only body on first and repeated reads',()=>{
  const r=correctedRegistry(),before=structuredClone(r);
  const historical=historicalPriceIndexRegistry(r);
  assert.deepEqual(historicalPriceIndexRegistry(historical),historical);
  assert.deepEqual(r,before);
  assert.deepEqual(historical.programs.find(p=>p.program_id==='refills').research_dynamic_profile.taxonomy.molecule_tags,['semaglutide','tirzepatide']);
  assert.deepEqual(historical.programs.find(p=>p.program_id==='tmates-xentraffic-offer-3154').research_dynamic_profile.taxonomy.brand_name_tags,['wegovy','zepbound']);
});

test('negative-claim price projection refuses unrelated row or restored-preimage drift',()=>{
  for(const pid of ['refills','tmates-xentraffic-offer-3154']) {
    for(const projected of [false,true]) {
      const r=projected?historicalPriceIndexRegistry(correctedRegistry()):correctedRegistry();
      r.programs.find(p=>p.program_id===pid).research_dynamic_profile.calculator.price_context+=' changed';
      assert.throws(()=>historicalPriceIndexRegistry(r),/price_index_historical_(negative_claim|registry)_drift/);
    }
  }
});
