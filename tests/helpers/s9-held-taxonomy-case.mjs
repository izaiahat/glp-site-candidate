// Original S9-2 oracle shared by its owning suite and portable exact-head CI.
// Keep private price-fixture initialization out of this source-only case.
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTherapeuticSurfaces} from '../../src/therapeutic-taxonomy.mjs';
import {historicalRetatrutideInputs} from '../fixtures/historical-retatrutide-inputs.mjs';
const profile='glp-clinic-scout';
// Rebuild 1 ruling (S9-2): the receipted hold stays a DARK ROW in the raw money
// source. The installed held-aware census requires the row to be present and
// projects it off; a missing held row is itself a fail-closed sensor failure.
// The taxonomy expectation is therefore surface-scoped, exactly like the quiz
// pool, and only for a row the registry proves is held, unwired and scoped off.
test('S9-2 held money rows stay dark in source and the required taxonomy stays fail-closed',()=>{
 // Historical positive: one authenticated September generation, not the later
 // pre-append registry whose seal now outlives the immutable capture. Current
 // sealed/runtime expiry refusal stays in therapeutic-wire-in-propagation-build6.
 const {registry,money,quiz}=historicalRetatrutideInputs();
 const asOf=[registry.provider_dynamic_profiles.sealed_as_of,registry.therapeutic_taxonomy.sealed_as_of].sort().at(-1)+'T12:00:00Z';
 const required=money.pages.filter(p=>registry.therapeutic_taxonomy.required_surface_paths.includes(p.path));
 assert.equal(required.length,3);
 for(const p of required){
  const held=p.rows.find(r=>r.program_id==='telos-rx');
  assert.ok(held,p.path+': the receipted hold must remain a source row');
  assert.equal(held.live_link_allowed,false);assert.equal(held.promotion_authorized,false);
  assert.equal(held.affiliate_href??null,null);
 }
 const projected=projectTherapeuticSurfaces({registry,profileId:profile,pages:money.pages,quizConfig:quiz,asOf});
 assert.equal(projected.includeProgramIds.length,57);
 assert.ok(!projected.includeProgramIds.includes('telos-rx'));
 // an id the registry does not prove scoped-off still fails closed
 const forged=structuredClone(money.pages);
 forged.find(p=>registry.therapeutic_taxonomy.required_surface_paths.includes(p.path)).rows.push({program_id:'not-a-program',live_link_allowed:false,promotion_authorized:false});
 assert.throws(()=>projectTherapeuticSurfaces({registry,profileId:profile,pages:forged,quizConfig:quiz,asOf}),/surface_membership_mismatch/);
 // and a held row promoted onto a conversion surface stops being scoped-off
 const promoted=structuredClone(registry);
 promoted.programs.find(p=>p.program_id==='telos-rx').profiles[profile].surfaces.compare=true;
 assert.throws(()=>projectTherapeuticSurfaces({registry:promoted,profileId:profile,pages:money.pages,quizConfig:quiz,asOf}),/surface_membership_mismatch|dynamic_profile|taxonomy/);
});
