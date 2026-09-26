import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {boot} from './d2o-consent-lifecycle.test.mjs';
import {renderPaidQuiz} from '../src/paid-landing.mjs';
import {renderQuiz} from '../src/quiz.mjs';
import {candidateSharedRuntime,policyMarkup,releaseExportPolicy} from '../src/candidate-export-policy.mjs';
const organic=renderQuiz(JSON.parse(fs.readFileSync(new URL('../data/quiz-config.json',import.meta.url))));
// Explicit fake IDs: runtime shape only, never real activation authority.
const config=`<script>window.GCS_ANALYTICS={enabled:true,consent:'granted',measurement_id:'G-TEST',operator_gate:'held'};window.GCS_CLARITY={enabled:false};window.GCS_POSTHOG={enabled:true,api_key:'TEST-ONLY',host:'https://vendor.invalid'};</script><script>const boundGtm='GTM-TEST';</script><script src="/assets/consent.js?v=fixture" defer></script><script src="/assets/analytics.0123456789abcdef.js" defer></script>`;
for(const stage of ['candidate','production-seal'])test(`D2m LP inherits exact consent bindings, stage and local analytics asset (${stage})`,()=>{
 const shared=candidateSharedRuntime(config,{stage});const input=organic.replace('</head>',shared+'</head>');const out=renderPaidQuiz(input,'fixture').html;
 const bound=shared.match(/<script>window.GCS_ANALYTICS=[\s\S]*?<\/script>/)[0];assert(out.includes(bound));
 assert(out.includes(policyMarkup(releaseExportPolicy(stage))));assert.equal((out.match(/data-candidate-export-policy/g)||[]).length,1);
 assert.equal((out.match(/src="\/assets\/consent\.js/g)||[]).length,1);assert.equal((out.match(/src="\/assets\/analytics\.0123456789abcdef\.js"/g)||[]).length,1);
 assert.doesNotMatch(out,/<script[^>]*src="https?:|gtm\.js\?id|static\/array\.js/);
 assert.doesNotMatch(out,/data-quiz-input|data-phase4-quiz/);
});
test('D2m a policy-bound organic document with missing analytics binding fails closed',()=>{
 const input=organic.replace('</head>',policyMarkup(releaseExportPolicy('production-seal'))+'</head>');assert.throws(()=>renderPaidQuiz(input,'fixture'),/paid_consent_runtime/);
});
test('D2m raw component fixture remains candidate-held, never invents IDs',()=>{
 const out=renderPaidQuiz(organic,'fixture').html;assert(out.includes(policyMarkup(releaseExportPolicy('candidate'))));assert.doesNotMatch(out,/window.GCS_POSTHOG=|GTM-/);
});
for(const stage of ['candidate','production-seal'])for(const gpc of [false,true])test('P27 paid entrance default, stage and GPC '+stage+'/'+gpc,()=>{
 const f=boot({stage,gpc,url:'https://glpclinicscout.com/lp/quiz/'});assert.equal(f.c.read().analytics,gpc?'denied':'granted');assert.equal(f.c.read().advertising,gpc?'denied':'granted');assert.equal(f.c.read().record_type,'preference_only');assert.equal(f.c.allowsExports(),stage==='production-seal'&&!gpc);assert.equal(f.scripts.filter(s=>s.src?.includes('array.js')).length,stage==='production-seal'&&!gpc?1:0);f.c.apply('denied');assert.equal(f.window.GCSAnalytics.event('affiliate_click',{quiz_answers:'CANARY'}),false);
});
