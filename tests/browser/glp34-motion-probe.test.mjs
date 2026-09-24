import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {probeAuroraCard,measureMotion,scrollMotionTarget} from './glp34-motion-handler.mjs';
const asset=name=>fileURLToPath(new URL('../../assets/'+name,import.meta.url));

test('a card hidden after visibility inspection records failure without blocking later checks', async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(250);
  await page.setContent('<article data-program="race-fixture" style="width:100px;height:100px"><span class="p3-card-aurora">Fixture</span></article>');
  const card=page.locator('article');let stabilityWaits=0;
  const racingCard={
   async isVisible(){const visible=await card.isVisible();await card.evaluate(n=>n.hidden=true);return visible;},
   evaluate: (...args)=>card.evaluate(...args),
   scrollIntoViewIfNeeded(){stabilityWaits++;throw Error('must not poll stability');},
  };
  const result=await probeAuroraCard(racingCard,page);
  assert.equal(result.status,'FAIL');
  assert.equal(result.id,'race-fixture');
  assert.match(result.error,/Motion target is not rendered/);
  assert.equal(stabilityWaits,0);
  assert.equal(await page.locator('article').count(),1);
 }finally{await browser.close();}
});

test('a continuously moving card is measured without a stable-box wait',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(250);
  await page.setContent(`<style>
   article{position:relative;width:200px;height:150px;animation:move 1s linear infinite alternate}
   .p3-card-aurora{display:block;animation:pulse 2s linear infinite}
   article:hover .p3-card-aurora{animation-duration:.5s}
   @keyframes move{from{transform:translateX(0)}to{transform:translateX(20px)}}
   @keyframes pulse{from{opacity:.3}to{opacity:1}}
  </style><article data-program="moving"><span class="p3-card-aurora">Fixture</span></article>`);
  const result=await probeAuroraCard(page.locator('article'),page);
  assert.equal(result.status,'PASS',result.error);
  assert.notEqual(result.hover.transform,result.idle.transform);
  assert.ok(parseFloat(result.hover.duration)<parseFloat(result.idle.duration));
  for(const phase of [result.idleMotion,result.hoverMotion]){
   assert.ok(phase.length>=2);
   assert.ok(phase.every(a=>a.endTime-a.currentTime>=100&&a.startTime!==null));
  }
 }finally{await browser.close();}
});

test('actual risk CSS finishes via WAAPI and actual motion.js via GSAP completion',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setContent('<button class="cs-riskcard" aria-pressed="false"><span class="cs-riskcard__front">Front</span><span class="cs-riskcard__back"><span>Back</span></span></button><section data-motion="rise" data-motion-dur=".6">Entrance</section>');
  await page.addStyleTag({path:asset('site-home.css')});
  const card=page.locator('button');
  await card.evaluate(n=>{getComputedStyle(n.querySelector('.cs-riskcard__back')).opacity;n.setAttribute('aria-pressed','true');});
  const motion=await measureMotion(card);
  assert.ok(motion.some(a=>a.kind==='finite'&&a.completed&&a.duration===300),JSON.stringify(motion));
  assert.equal(await card.locator('.cs-riskcard__back').evaluate(n=>getComputedStyle(n).opacity),'1');
  await page.addScriptTag({path:asset('vendor/gsap/gsap.min.js')});
  await page.addScriptTag({path:asset('vendor/gsap/ScrollTrigger.min.js')});
  await page.addScriptTag({path:asset('motion.js')});
  const section=page.locator('section');await scrollMotionTarget(section);
  const entrance=await measureMotion(section);
  assert.ok(entrance.some(a=>a.kind==='gsap'&&a.completed&&a.endTime===a.duration),JSON.stringify(entrance));
  assert.equal(await section.evaluate(n=>n.style.transform),'');
 }finally{await browser.close();}
});

test('unfinished finite animation fails at the existing 1500ms bound',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<div>Unfinished</div>');
  await page.locator('div').evaluate(n=>n.animate([{opacity:0},{opacity:1}],{duration:10000}));
  await assert.rejects(measureMotion(page.locator('div')),/Motion lifecycle timeout/);
 }finally{await browser.close();}
});
