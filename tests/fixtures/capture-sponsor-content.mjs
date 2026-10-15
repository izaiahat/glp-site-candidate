// Local browser readback of explicit Node-test artifacts. Never paid inventory.
// node tests/fixtures/capture-sponsor-content.mjs <fixture-html-dir> <evidence-dir>
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {chromium} from 'playwright';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import {sponsorContentFixture} from './sponsor-content.mjs';
const expectedOrder=sponsorContentFixture().orders[0];
const root=resolve(new URL('../..',import.meta.url).pathname);
const [inputArg,outArg]=process.argv.slice(2);
if(!inputArg||!outArg) throw Error('Two explicit local fixture directories required');
const input=resolve(inputArg),out=resolve(outArg);
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=pathname==='/promo.html'||pathname==='/directory.html'?join(input,pathname.slice(1)):resolve(root,'.'+pathname);
  if(!file.startsWith(input+sep)&&!(file.startsWith(join(root,'assets')+sep))) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
 } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const checks=[];
try {
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
  for(const surface of ['promo','directory']) {
   // Fresh context per native surface, as in the registered neutral capture;
   // avoid manufacturing a cross-page return-visit toast in isolated fixtures.
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce'});
   await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
   const page=await context.newPage();await page.goto(`${origin}/${surface}.html`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
   await page.addScriptTag({content:axe.source});
   const target=page.locator(surface==='directory'?'[data-sponsored-placement]':'[data-sponsor-layout="promo"]');
   await target.waitFor();
   const text=await target.innerText();
   for(const fact of [expectedOrder.provider,...Object.values(expectedOrder.facts).map(f=>f.text),`Paid for by ${expectedOrder.provider}.`,'Sponsored']) assert.ok(text.includes(fact),fact);
   assert.equal(await page.locator('[data-sponsored-link]').count(),1);
   assert.equal(await page.locator('[data-sponsored-link]').getAttribute('rel'),'sponsored nofollow noopener');
   const dom=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,unresolvedTokens:document.body.innerText.includes('{{LIVE_PROVIDER_COUNT}}')}));
   assert.ok(dom.scrollWidth<=width+1);assert.equal(dom.unresolvedTokens,false);
   const a11y=await page.evaluate(async()=>{const r=await axe.run();return r.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});
   assert.deepEqual(a11y,[]);
   await page.screenshot({path:join(out,`SYNTHETIC-${surface}-${name}-viewport.png`)});
   await target.screenshot({path:join(out,`SYNTHETIC-${surface}-${name}-native-content.png`)});
   checks.push({surface,viewport:name,width,height,dom,a11y,reportedFactsVisible:true,realPayment:false});
   await context.close();
  }
 }
 await writeFile(join(out,'SYNTHETIC-CAPTURE.json'),JSON.stringify({status:'PASS',scope:'Isolated fictional test artifact only. Module-mocked payment; no live/payment/creative acceptance.',checks},null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',frames:checks.length,out}));
} finally {await browser.close();await new Promise(r=>server.close(r));}
