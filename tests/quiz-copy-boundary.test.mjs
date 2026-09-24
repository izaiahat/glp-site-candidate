import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { quizCopySurface, quizVisibleCopyViolations, readQuizFragmentHashes } from "../src/quiz-copy-boundary.mjs";
const sha = x => createHash("sha256").update(x).digest("hex");
const id = "candidate-data", route = `lp/quiz/data/${id}/index.html`;
const island = '<script type="application/json" id="candidate-data">{"source":"Checked 2026-08-06"}</script>';
const hashes = {[id]:sha(island)};
test("only exact bound data route is projected; original JSON facts stay unchanged",()=>{
 assert.equal(quizCopySurface(island,route,hashes),"");
 for(const other of ["index.html","lp/quiz/index.html","lp/quiz/data/unknown/index.html"])assert.equal(quizCopySurface(island,other,hashes),island);
 assert.ok(quizVisibleCopyViolations(island).length);
});
for(const label of ["Checked 2026-08-06","Related coverage","the fine print","Q<12","Position 7’s disclosed fields"])test(`visible bad prose still fails: ${label}`,()=>{
 const html=island+`<p>${label}</p>`;
 assert.ok(quizVisibleCopyViolations(quizCopySurface(html,route,{[id]:sha(html)})).length);
});
for(const broken of [island+"corruption",island.replace("08-06","08-07"),island.replace("candidate-data","other-data")])test(`fragment corruption rejected: ${sha(broken).slice(0,8)}`,()=>assert.throws(()=>quizCopySurface(broken,route,hashes),/digest/));
test("a matching digest does not excuse malformed JSON or wrong tag",()=>{
 for(const html of [island.replace('{"source":','{"source"'),island.replace('application/json','text/javascript'),island+island])assert.throws(()=>quizCopySurface(html,route,{[id]:sha(html)}));
});
test("unknown JSON remains checked even next to a valid known island",()=>{
 const html=island+'<script type="application/json" id="other">{"label":"Checked 2026-08-06"}</script>';
 assert.ok(quizVisibleCopyViolations(quizCopySurface(html,route,{[id]:sha(html)})).length);
});
test("current ordinary-link entrance has no stale data exception; legacy fragments still fail without a digest",()=>{
 const root=new URL('../public/',import.meta.url).pathname;
 const actual=readQuizFragmentHashes(root);
 assert.deepEqual(actual,{});
 assert.throws(()=>quizCopySurface(island,route,actual),/digest/);
 assert.match(readFileSync(root+'lp/quiz/index.html','utf8'),/data-paid-funnel="route-quiz-entrance"/);
});
