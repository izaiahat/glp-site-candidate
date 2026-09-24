import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildReady6EditorialPages, READY6_REL } from "../../src/ready6-editorial.mjs";
import { applyMeritScores } from "../../src/merit-ranking.mjs";
import { deriveIdentityGroups } from "../../src/provider-identity.mjs";
import { comparablePriceProviderIds } from "../../src/provider-dynamic-profiles.mjs";
import { selectedGoOutbound } from "../../src/go-render-selection.mjs";

const root=new URL("../../",import.meta.url);
const registry=JSON.parse(readFileSync(new URL("data/program-registry.json",root),"utf8"));
const ledger=JSON.parse(readFileSync(new URL("data/program-content-ledger.json",root),"utf8")).programs;
applyMeritScores(ledger,{comparablePriceIds:comparablePriceProviderIds(registry,"glp-clinic-scout",{asOf:new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`)})});
const identity=deriveIdentityGroups(registry,"glp-clinic-scout",ledger);
const {models}=await buildReady6EditorialPages(root,{
 activeRegistryIds:registry.programs.map(program=>program.program_id),
 ledgerPrograms:ledger,
 aliases:Object.fromEntries([...identity.aliasIds].map(aliasId=>{const canonical=registry.programs.find(program=>program.program_id===identity.canonicalOf.get(aliasId));return [aliasId,{brand:canonical.display_name,route:canonical.review_path}];})),
});
const publishedModels=models.filter((model)=>!model.alias_of);

test("ready6 final bytes stay indexable and provider-free without CTA navigation",async({page,context,baseURL})=>{
 const baseHost=new URL(baseURL).host; const externalRequests=[]; const externalNavigations=[];
 await context.route("**/*",async route=>{ const url=new URL(route.request().url()); if(url.host===baseHost) await route.continue(); else { externalRequests.push({host:url.host,resourceType:route.request().resourceType()}); await route.abort("blockedbyclient"); } });
 page.on("framenavigated",frame=>{ const url=new URL(frame.url()); if(url.host&&url.host!==baseHost) externalNavigations.push(url.host); });
 expect(publishedModels).toHaveLength(4);
 for(const model of publishedModels){
  const response=await page.goto(model.route,{waitUntil:"domcontentloaded"}); expect(response.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content","index,follow,max-image-preview:large"); await expect(page.locator("h1")).toHaveCount(1);
  for(const id of ["affiliate-disclosure","pricing","clinician-boundary","regulatory-status","score-rubric","evidence-gaps","price-warning"]) await expect(page.locator(`#${id}`)).toBeVisible();
  const cta=page.locator('a[data-affiliate-state="active"]'); await expect(cta).toHaveCount(1); await expect(cta).toBeVisible();
  const mode=await cta.getAttribute("data-link-mode"); expect(["server-redirect","transparent_direct"]).toContain(mode);
  const selected=selectedGoOutbound({program_id:model.registry_id},"reviews.rv2");
  if(mode==="server-redirect"){
   expect(selected).not.toBeNull(); expect(selected.held).not.toBe(true);
   await expect(cta).toHaveAttribute("href",selected.href);
   await expect(cta).toHaveAttribute("data-subid",selected.surfaceCode);
   await expect(cta).toHaveAttribute("data-affiliate-network",selected.network);
  }else{
   expect(selected).toBeNull(); expect(new URL(model.cta.href).protocol).toBe("https:");
   await expect(cta).toHaveAttribute("href",model.cta.href);
   await expect(cta).toHaveAttribute("data-affiliate-network",model.network);
  }
  await expect(cta).toHaveAttribute("data-program",model.registry_id); await expect(cta).toHaveAttribute("data-analytics-event","affiliate_click"); await expect(cta).toHaveAttribute("data-page-type","review"); await expect(cta).toHaveAttribute("data-sub1","1R"); await expect(cta).toHaveAttribute("data-sub2",/^review-/); await expect(cta).not.toHaveAttribute("target",/.+/);
  expect(new Set((await cta.getAttribute("rel")).split(/\s+/))).toEqual(new Set(READY6_REL));
  const ordered=await page.evaluate(()=>{ const cta=document.querySelector('a[data-affiliate-state="active"]'); return ["affiliate-disclosure","pricing","clinician-boundary","regulatory-status","score-rubric","evidence-gaps","price-warning"].map(id=>document.getElementById(id)).every(section=>Boolean(section.compareDocumentPosition(cta)&Node.DOCUMENT_POSITION_FOLLOWING)); }); expect(ordered).toBe(true);
  expect(await page.locator("#sources a[href^='https://']").evaluateAll(anchors=>anchors.map(a=>a.href))).toEqual(model.sources.map(source=>source.url));
  const scoreStatus=page.locator(".score-status");
  if(model.merit) await expect(scoreStatus).toHaveText(`${(model.merit.overall/10).toFixed(1)}/10 on our published evidence rubric`);
  else if(model.alias_of) await expect(scoreStatus).toHaveText(`Scored on our main ${model.alias_of.brand} record`);
  else await expect(scoreStatus).toHaveText("Not scored — evidence gaps remain");
  const visitorText=(await page.locator("html").innerText()).toLowerCase(); for(const phrase of ["offline candidate","bridge review pending","not deployed","noindex","review-only"]) expect(visitorText).not.toContain(phrase);
 }
 expect(externalRequests).toEqual([]); expect(externalNavigations).toEqual([]);
});
