import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '@playwright/test';
import {navigateListingMapping, surfaceProbe} from './glp34-listing-handler.mjs';

test('mapping geometry starts at rest, not a previous route pointer hover', async () => {
  const root=path.resolve('public');
  const server=http.createServer((q,s)=>{
    let p=path.resolve(root,'.'+new URL(q.url,'http://localhost').pathname);
    if(!p.startsWith(root+path.sep)){s.writeHead(403).end();return;}
    if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');
    if(!fs.existsSync(p)){s.writeHead(404).end();return;}
    s.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');
    s.end(fs.readFileSync(p));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`, browser=await chromium.launch();
  try {
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      const context=await browser.newContext({viewport,serviceWorkers:'block'});
      await context.route('**/*',r=>new URL(r.request().url()).origin===origin&&r.request().method()==='GET'&&!new URL(r.request().url()).pathname.startsWith('/go/')?r.continue():r.abort());
      try {
        const page=await context.newPage();
        await page.goto(origin+'/pharmacies/',{waitUntil:'load'});
        const card=page.locator('[data-pharmacy-card]').first();
        await card.hover({timeout:1500});
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-pharmacy-card]')).transform!=='none',{},{timeout:1500});
        await navigateListingMapping(page,origin+'/pharmacies/');
        await page.evaluate(()=>document.fonts.ready);
        await page.waitForLoadState('load');
        // Observe the real settled CSS transition, without removing transforms.
        await page.waitForFunction(()=>document.querySelector('[data-pharmacy-card]').getAnimations().every(a=>a.playState==='finished'),{},{timeout:1500});
        const observed=await surfaceProbe(page),expected=viewport.width<760?358:309.333;
        assert.ok(Math.abs(observed.first.box.width-expected)<=2,JSON.stringify({viewport,width:observed.first.box.width,expected}));
      } finally {await context.close();}
    }
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
