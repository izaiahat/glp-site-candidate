import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { READY6_KEYS, READY6_REL, READY6_ROUTES, buildReady6ReviewModels, loadReady6EditorialInputs, renderReady6ReviewPage } from "../src/ready6-editorial.mjs";
const root=new URL("../",import.meta.url);
const clone=(inputs)=>({...inputs,contract:structuredClone(inputs.contract),approvedRegistry:structuredClone(inputs.approvedRegistry),sourceBytes:inputs.sourceBytes});
const visibleWords=(html)=>html.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&(?:[a-z]+|#\d+);/gi," ").toLowerCase().match(/[a-z0-9$]+(?:-[a-z0-9]+)*/g)||[];
const editorialWords=(html)=>{const body=html.match(/<main\b[^>]*\bid="main"[^>]*>([\s\S]*?)<\/main>/i);assert.ok(body,"READY6 review must expose a main editorial body");return visibleWords(body[1]);};
const jaccard=(left,right)=>{const a=new Set(left),b=new Set(right),intersection=[...a].filter((word)=>b.has(word)).length;return intersection/new Set([...a,...b]).size;};

test("controlling final readjudication yields the exact six indexable route models",async()=>{
 const models=buildReady6ReviewModels(await loadReady6EditorialInputs(root));
 assert.deepEqual(models.map(x=>x.program_key),READY6_KEYS); assert.deepEqual(models.map(x=>x.route),READY6_ROUTES); assert.equal(new Set(models.map(x=>x.registry_id)).size,6);
 assert.equal(models.every(x=>x.candidate_state==="READY6_PRODUCTION_REVIEW_INDEXABLE"&&x.bridge_review_state==="PENDING"&&x.deployed===false&&x.indexable===true&&x.sitemap_included===true&&x.tracking_clicked===false),true);
});

test("each final model has one exact direct CTA after disclosure and safety evidence",async()=>{
 for(const model of buildReady6ReviewModels(await loadReady6EditorialInputs(root))){
  assert.equal(model.cta.active,true); assert.equal(model.cta.mode,"transparent_direct"); assert.deepEqual(model.cta.rel,READY6_REL); assert.equal(model.cta.href_sha256.length,64); assert.equal(new URL(model.cta.href).protocol,"https:");
  assert.equal(model.ordered_blocks.filter(x=>x==="affiliate_cta").length,1); const at=model.ordered_blocks.indexOf("affiliate_cta");
  for(const before of ["affiliate_disclosure","pricing","clinician_boundary","regulatory","score_rubric","price_volatility_warning"]) assert.ok(model.ordered_blocks.indexOf(before)<at,`${model.registry_id}:${before}`);
 }
});

test("all six preserve pricing uncertainty, regulator citation, and unscored evidence gaps",async()=>{
 const byId=new Map(buildReady6ReviewModels(await loadReady6EditorialInputs(root)).map(x=>[x.registry_id,x]));
 assert.match(byId.get("awin-128761").page.pricing,/billed \$357 for the first 3 months/);assert.match(byId.get("awin-128761").page.pricing,/not a \$119 first checkout charge/);assert.match(byId.get("awin-128761").page.pricing,/Monthly equivalents are not monthly billing/);
 assert.match(byId.get("katalys-1286").page.pricing,/not proof of a \$110 first payment/);assert.match(byId.get("katalys-1286").page.pricing,/compounded semaglutide \$149, compounded tirzepatide \$199/); assert.match(byId.get("katalys-647").page.pricing,/^MangoRx weight-loss pricing is unknown/);
 assert.match(byId.get("katalys-1304").page.pricing,/\$147 starting amount but does not bind/);assert.match(byId.get("katalys-1304").page.pricing,/\$297 for Semaglutide and \$399 for Tirzepatide/);assert.match(byId.get("katalys-1516").page.pricing,/UNKNOWN exact first charge/);assert.match(byId.get("katalys-1516").page.pricing,/not proof of the first checkout charge or universal all-in cost/); assert.match(byId.get("katalys-1518").page.pricing,/\$299 for oral semaglutide/);
 for(const model of byId.values()){ assert.equal(model.score_rubric.overall_score,null); assert.equal(model.score_rubric.criteria.every(x=>x.result==="Pending evidence"),true); assert.match(model.page.regulatory,/Compounded drugs are not FDA approved/); assert.equal(model.sources[1].publisher,"U.S. Food and Drug Administration"); }
});

test("same-count substitution, duplication, fabrication, and nonzero effects fail closed",async()=>{
 const inputs=await loadReady6EditorialInputs(root); const substitution=clone(inputs); substitution.contract.programs[0].program_key="Awin:128575"; assert.throws(()=>buildReady6ReviewModels(substitution),/ready6_exact_target_set_invalid/);
 const duplicate=clone(inputs); duplicate.contract.programs[5]=structuredClone(duplicate.contract.programs[4]); assert.throws(()=>buildReady6ReviewModels(duplicate),/ready6_exact_target_set_invalid/);
 const effects=clone(inputs); effects.contract.effects.deployments=1; assert.throws(()=>buildReady6ReviewModels(effects),/ready6_effects_not_zero/);
 const fabricated=clone(inputs); const row=fabricated.approvedRegistry.programs.find(x=>x.program_key==="Awin:128761"); row.tracking.provider_issued_url="https://example.com/not-provider-issued"; row.tracking.tracking_host="example.com"; assert.throws(()=>buildReady6ReviewModels(fabricated),/ready6_provider_url_host_invalid/);
});

test("silent deindexing, sitemap omission, missing FDA caution, or false deployment fails closed",async()=>{
 const inputs=await loadReady6EditorialInputs(root);
 for(const field of ["indexable","sitemap_included"]){ const drift=clone(inputs); drift.contract.publication_policy[field]=false; assert.throws(()=>buildReady6ReviewModels(drift),/ready6_publication_policy_invalid/); }
 const caution=clone(inputs); caution.contract.programs[1].page.regulatory="Compounded and branded products differ."; assert.throws(()=>buildReady6ReviewModels(caution),/ready6_editorial_page_contract_invalid/);
 const deploy=clone(inputs); deploy.contract.publication_policy.deployed=true; assert.throws(()=>buildReady6ReviewModels(deploy),/ready6_publication_policy_invalid/);
});

test("rendered visitor bytes are indexable, attributable, and contain no governance-only candidate semantics",async()=>{
 for(const model of buildReady6ReviewModels(await loadReady6EditorialInputs(root))){ const html=renderReady6ReviewPage(model); assert.match(html,/<meta name="robots" content="index,follow,max-image-preview:large">/); assert.equal((html.match(/data-affiliate-state="active"/g)||[]).length,1); assert.match(html,/data-analytics-event="affiliate_click"/); assert.match(html,/data-page-type="review"/); assert.match(html,/data-link-position="conclusion"/); assert.match(html,/data-sub1="1R"/); assert.match(html,/data-sub2="review-[^"]+"/); const selected=loadGoSelection(root).programs[model.registry_id]; if(selected?.status==='VERIFIED'){assert.match(html,/data-funnel-v2-go/);assert.ok(html.includes(selected.route+'?s=reviews.rv2&amp;v=a'));assert.equal(GO_RUNTIME_MANIFEST.programs[selected.render_id].tracking.base_url,selected.issued_link);}else assert.match(html,/data-subid="review-[^"]+-conclusion-202608"/); for(const phrase of ["offline candidate","bridge review pending","not deployed","noindex","review-only"]) assert.equal(html.toLowerCase().includes(phrase),false,`${model.registry_id}:${phrase}`); }
});

test("indexable READY6 reviews are substantive and not doorway-band near-duplicates",async()=>{
 const pages=buildReady6ReviewModels(await loadReady6EditorialInputs(root)).map((model)=>({id:model.registry_id,words:editorialWords(renderReady6ReviewPage(model))}));
 for(const page of pages) assert.ok(page.words.length>=950,`${page.id}:thin:${page.words.length}`);
 for(let left=0;left<pages.length;left+=1) for(let right=left+1;right<pages.length;right+=1){const overlap=jaccard(pages[left].words,pages[right].words);assert.ok(overlap<0.5,`${pages[left].id}:${pages[right].id}:jaccard:${overlap.toFixed(3)}`);}
});

test("built brand routes are canonical, sitemap-exact, and protected by permanent redirects",async()=>{
 // SHED-301 (2026-08-06): katalys-1516 is a declared alias of shedrx, so its id
 // route goes STRAIGHT to the canonical record (never chaining through
 // /reviews/shed/), and the /reviews/shed/ brand route itself is a permanent
 // redirect. The alias's editorial page stays built and byte-asserted; only its
 // route and sitemap presence consolidate onto the canonical review.
 // 2026-08-17: Katalys paused offer 1518 (Breeze Meds). Its brand route is no
 // longer built, so the network-id route resolves straight to the retirement
 // target instead of chaining through a page that is itself a redirect.
 const pairs=[
  ["/reviews/awin-128761/","/reviews/coivas/"],
  ["/reviews/katalys-1286/","/reviews/sprout-health/"],
  ["/reviews/katalys-647/","/reviews/mangorx/"],
  ["/reviews/katalys-1304/","/reviews/direct-meds/"],
  ["/reviews/katalys-1516/","/reviews/shedrx/"],
 ];
 const retiredPairs=[
  ["/reviews/katalys-1518/","/providers/"],
  ["/reviews/synergy-rx/","/providers/"],
  ["/reviews/care-bare-rx-glp1/","/providers/"],
  ["/reviews/breezemeds/","/providers/"],
  ["/compare/synergy-rx-vs-carebarerx/","/providers/"],
  // 2026-08-18 niche-fit removal (operator ruling): Paternity Lab, Advanced
  // Trichology and LyfeFuel left this site for their own verticals. Their review
  // routes 301 instead of 404 — a 404 lets Cloudflare Always Online serve an
  // archived copy of the page we removed, which a live check caught after the
  // first deploy of this change.
  ["/reviews/paternity-lab/","/providers/"],
  ["/reviews/advanced-trichology/","/providers/"],
  ["/reviews/lyfefuel-us/","/providers/"],
 ];
 const aliasPairs=[["/reviews/shed/","/reviews/shedrx/"]];
 // Consolidation 2026-08-15 (strategy rule R1): duplicate-intent guide URLs
 // 301 to their single canonical, part of the frozen redirect contract.
 const consolidationPairs=[
  ["/guides/healthrx-vs-agelessrx/","/providers/"],
  ["/guides/wellorithm-vs-enhance-md/","/providers/"],
  ["/guides/cheapest-glp1/","/providers/"],
  ["/guides/compare-online-glp-1-provider-fees/","/providers/"],
  ["/guides/glp-1-program-total-cost-comparison/","/providers/"],
 ];
 const redirects=await readFile(new URL("../public/_redirects",import.meta.url),"utf8");
 const legacyFrom=new Set(pairs.map(([from])=>from));
 const retiredExtras=retiredPairs.filter(([from])=>!legacyFrom.has(from));
 // Design pass 2026-08-20 (Fable edit 1): additive short nav aliases. The memorable
 // route a reader types or a partner links ("/quiz/") 301s to the canonical route
 // instead of hitting the 404. Held separately from the frozen contract above, and
 // mirrored in build-staging.mjs / validate-g9-retirement.mjs / validate-ready6-static.py.
 const shortNavAliases=[["/quiz/","/quiz/provider-fit/"]];
 const phase3=JSON.parse(await readFile(new URL("../data/phase3-page-graph.json",import.meta.url),"utf8"));
 const phase3Pairs=[...phase3.retired_evidence_wall_redirects,...phase3.legacy_redirects].filter(([from])=>from!=="/best/online-glp-1-providers/");
 const pass2RouteAliases=[
  ["/cost/","/providers/"],
 ];
 const providerDetailAliases=[
  ["/providers/coivas/","/reviews/coivas/"],
  ["/providers/sprout-health/","/reviews/sprout-health/"],
  ["/providers/direct-meds/","/reviews/direct-meds/"],
  ["/providers/mangorx/","/reviews/mangorx/"],
 ];
 const pass5SupportAliases=[["/support/","/privacy/lead-capture/"]];
 const heldIdentityAliases=[["/reviews/telos-rx-review/","/reviews/telos-rx/"]];
 const expectedPairs=[...pairs,...retiredExtras,...consolidationPairs,...aliasPairs,...heldIdentityAliases,...shortNavAliases,...phase3Pairs,...pass2RouteAliases,...providerDetailAliases,...pass5SupportAliases];
 assert.equal(new Set(expectedPairs.map(([from])=>from)).size,expectedPairs.length,"redirect sources must be unique");
 assert.deepEqual(redirects.trim().split("\n"),expectedPairs.map(([from,to])=>`${from} ${to} 301`));
 for(const [,to] of expectedPairs) assert.equal(expectedPairs.some(([from])=>from===to),false,`redirect chain target: ${to}`);
 for(const [from] of consolidationPairs){
  assert.equal((await readFile(new URL("../public/sitemap.xml",import.meta.url),"utf8")).includes(`https://glpclinicscout.com${from}`),false,from);
 }
 const sitemap=await readFile(new URL("../public/sitemap.xml",import.meta.url),"utf8");
 // A retired route must be out of the sitemap, unbuilt, and 301'd - the target is
 // a live comparison page, so it is not asserted to be a provider review.
 for(const [from,to] of retiredPairs){
  assert.equal(sitemap.includes(`https://glpclinicscout.com${from}`),false,from);
  await assert.rejects(access(new URL(`../public${from}index.html`,import.meta.url)),/ENOENT/);
  assert.equal(redirects.includes(`${from} ${to} 301`),true,from);
 }
 for(const [from,to] of pairs){
  assert.equal(sitemap.includes(`https://glpclinicscout.com${from}`),false,from);
  assert.equal(sitemap.split(`https://glpclinicscout.com${to}`).length-1,1,to);
  await assert.rejects(access(new URL(`../public${from}index.html`,import.meta.url)),/ENOENT/);
  const html=await readFile(new URL(`../public${to}index.html`,import.meta.url),"utf8");
  assert.equal((html.match(new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${to}">`,"g"))||[]).length,1,to);
 }
 for(const [from,to] of aliasPairs){
  assert.equal(sitemap.includes(`<loc>https://glpclinicscout.com${from}</loc>`),false,from);
  assert.equal(sitemap.split(`https://glpclinicscout.com${to}`).length-1,1,to);
  // Redirect aliases are transport-only: no generated index file may shadow the 301.
  await assert.rejects(access(new URL(`../public${from}index.html`,import.meta.url)),/ENOENT/);
 }
});
