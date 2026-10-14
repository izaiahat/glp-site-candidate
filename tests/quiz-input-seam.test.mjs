import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {effectiveAffiliateBuildInputs, effectiveAffiliateRegistry} from '../src/affiliate-relationship-sync.mjs';
import {quizInputSeam} from './helpers/quiz-input-seam.mjs';

// Synthetic dependency-binding regression, NOT a historical health/price/quiz
// oracle. The original real-catalog assertions remain in the native test.
test('GLP-361 build-to-quiz seam keeps raw scoring and quiz input separate from denial/display copies', async () => {
  const build = readFileSync(new URL('../scripts/build-staging.mjs', import.meta.url), 'utf8');
  const execute = quizInputSeam(build);
  const profileId = 'fixture-profile';
  const rawRegistry = {programs: [{program_id:'fixture-ended', commercial_state:'live',
    profiles:{[profileId]:{vertical_fit:true,wired:true,surfaces:{review:true,quiz:true}}},
    affiliate_relationship_snapshot:{lifecycle:'ended',promotion_denied:true,editorial_retained:true}}]};
  const registry = effectiveAffiliateRegistry(rawRegistry);
  registry.provider_dynamic_profiles = {sealed_as_of:'2026-10-01'};
  const rawLedger = {programs:[{program_id:'fixture-ended',live_link_allowed:true,promotion_authorized:true,raw_fact:'fixture-raw'}]};
  const eligibility = {program_count:1,live_program_count:1,programs:[{program_id:'fixture-ended'}]};
  const activation = {live_program_count:1};
  const quiz = {fixture_only:true};
  const before = structuredClone({rawRegistry,registry,rawLedger,eligibility,activation,quiz});
  let projections=0,scorings=0,quizzes=0;
  const read = name => name==='program-content-ledger.json' ? rawLedger
    : name==='program-page-eligibility.json' ? eligibility
    : name==='affiliate-activation-selection.json' ? activation
    : name==='quiz-config.json' ? quiz : {fixture_only:true};
  const display = row => {
    projections++;assert.equal(row.live_link_allowed,false);assert.equal(row.promotion_authorized,false);
    return {...row,display_fact:'fixture-display'};
  };
  const comparable = (value,id,options) => {
    assert.equal(value,registry);assert.equal(id,profileId);
    assert.equal(options.asOf.toISOString(),'2026-10-01T12:00:00.000Z');
    return new Set(['fixture-ended']);
  };
  const score = (rows,options) => {
    scorings++;assert.deepEqual(rows,rawLedger.programs);assert.notEqual(rows,rawLedger.programs);
    assert.deepEqual(options.comparablePriceIds,new Set(['fixture-ended']));
    Object.assign(rows[0],{criteria_scores:{fixture_only:37},score_basis:'fixture-raw-score',score_evidence_earned:true});
  };
  const merit = row => {assert.equal(row.criteria_scores.fixture_only,37);return 37;};
  const project = (value,id,config,ledger) => {
    quizzes++;assert.equal(value,registry);assert.equal(id,profileId);assert.equal(config,quiz);
    assert.equal(ledger,rawLedger);assert.deepEqual(ledger,before.rawLedger);
    return {fixture_only:true,raw_input:true};
  };
  const output = await execute(read,display,project,registry,profileId,comparable,score,merit,effectiveAffiliateBuildInputs,rawRegistry);
  assert.deepEqual(output.canonicalQuiz,{fixture_only:true,raw_input:true});
  assert.deepEqual(output.contentLedger.programs,[{...rawLedger.programs[0],live_link_allowed:false,promotion_authorized:false,
    display_fact:'fixture-display',criteria_scores:{fixture_only:37},score_basis:'fixture-raw-score',score_evidence_earned:true,score:37}]);
  assert.equal(projections,1);assert.equal(scorings,1);assert.equal(quizzes,1);
  assert.deepEqual({rawRegistry,registry,rawLedger,eligibility,activation,quiz},before);
  const wrong = {...eligibility,live_program_count:0};
  await assert.rejects(execute(name=>name==='program-page-eligibility.json'?wrong:read(name),display,project,registry,profileId,comparable,score,merit,effectiveAffiliateBuildInputs,rawRegistry),{message:'relationship_build_raw_count'});
  assert.equal(projections,1);assert.equal(scorings,1);assert.equal(quizzes,1);
  assert.deepEqual({rawRegistry,registry,rawLedger,eligibility,activation,quiz},before);
});
