import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { renderPaidQuiz } from "../src/paid-quiz.mjs";
import { renderQuiz } from "../src/quiz.mjs";
// Exercise the builder's pre-finalization seam, not post-finalized public HTML.
const organic = renderQuiz(JSON.parse(await readFile(new URL("../data/quiz-config.json", import.meta.url), "utf8")));
const source = await readFile(new URL("../assets/quiz-page.js", import.meta.url), "utf8");
const slice = source.slice(source.indexOf("async function captureNewsletter()"), source.indexOf("async function finish()"));
const sha = x => createHash("sha256").update(x).digest("hex");
test("final link-through receipt binds all four organic islands without duplicate LP fragments",async()=>{
 const receipt=JSON.parse(await readFile(new URL("../artifacts/ops/paid-quiz-build.json",import.meta.url),"utf8"));
 assert.equal(receipt.architecture,"fable-r2-link-to-unchanged-organic-quiz");
 assert.deepEqual(receipt.fragment_sha256,{});
 assert.equal(Object.keys(receipt.organic_data_sha256).length,4);
 const built=await readFile(new URL('../public/quiz/provider-fit/index.html',import.meta.url),'utf8');
 for(const [id,expected]of Object.entries(receipt.organic_data_sha256)){
  const text=built.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`))[1];
  assert.equal(sha(text),expected,id);
  assert.notEqual(sha(text+'corruption'),expected);
 }
});
test("paid entrance has no hidden quiz/contact mount; organic questionnaire and optional contact remain intact",()=>{
 const rendered = renderPaidQuiz(organic,"fixture");
 assert.match(organic,/data-quiz-input="email"/);
 assert.doesNotMatch(rendered.html,/data-quiz-input="(?:email|first_name)"/);
 assert.doesNotMatch(rendered.html,/data-phase4-quiz|data-quiz-position|data-quiz-finish|\/assets\/paid-quiz\.js/);
 assert.match(rendered.html,/<a[^>]*href="\/quiz\/provider-fit\/"[^>]*data-lp-quiz-start/);
 assert.equal((organic.match(/data-quiz-position="/g)||[]).length,7);
});
test("four organic data islands are unchanged and bound; no hidden LP copy",()=>{
 const rendered=renderPaidQuiz(organic,"fixture");assert.equal(rendered.fragments.length,0);
 assert.equal(Object.keys(rendered.organicDataHashes).length,4);
 assert.match(rendered.html,/<meta name="robots" content="noindex, follow">/);
 for(const [id,expected] of Object.entries(rendered.organicDataHashes)){
  const pattern=new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`);
  assert.equal(sha(organic.match(pattern)[1]),expected);
  assert.doesNotMatch(rendered.html,new RegExp(`id="${id}"`));
 }
});
for(const paid of [true,false])test(`newsletter capture paid=${paid} runtime boundary and organic positive control`,async()=>{
 const calls=[];const status={textContent:""};
 const context=vm.createContext({paid,root:{querySelectorAll:()=>[status]},answers:{email:"w4-positive@example.invalid",first_name:"TEST",state:"OR",intents:["SEMAGLUTIDE"]},flow:{contact:{newsletter_endpoint:"/api/fixture",newsletter_consent_source:"fixture",newsletter_consent_version:"fixture"}},fetch:async(...args)=>{calls.push(args);return {ok:true};}});
 await vm.runInContext(`(${slice.trim()})()`,context);
 assert.equal(calls.length,paid?0:1);
});
