import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { waitW17Readiness } from './w17-readiness.mjs';
const gsap = readFileSync(new URL('../public/assets/vendor/gsap/gsap.min.js', import.meta.url), 'utf8');
test('W17 readiness observes real GSAP completion and rejects persistent unsettled state', async () => {
  const browser = await chromium.launch();
  try {
    for (const mode of ['entrance', 'delayed', 'perpetual', 'opacity']) {
      const page = await browser.newPage();
      try {
        await page.setContent('<section><h2>Actual entrance control</h2></section>');
        await page.addScriptTag({ content: gsap });
        await page.evaluate(mode => {
          window.completed = false;
          if (mode === 'opacity') { document.querySelector('section').style.opacity = '.5'; return; }
          window.gsap.fromTo('section', { opacity: .36, y: 34 }, { opacity: 1, y: 0, duration: .25, delay: mode === 'delayed' ? .2 : 0, repeat: mode === 'perpetual' ? -1 : 0, yoyo: mode === 'perpetual', clearProps: 'opacity,transform', onComplete: () => { window.completed = true; } });
        }, mode);
        const target = page.locator('h2');
        assert.equal(await target.evaluate(e => [e,e.parentElement].flatMap(n => n.getAnimations()).length), 0, 'old readiness predicate falsely appears ready');
        assert.equal(await page.evaluate(() => window.completed), false);
        const readiness = await waitW17Readiness(target, { timeout: ['perpetual','opacity'].includes(mode) ? 400 : 3000 });
        if (['entrance','delayed'].includes(mode)) {
          assert.equal(readiness.ready, true);
          assert.equal(await page.evaluate(() => window.completed), true, 'no-op readiness would sample before source completion');
          assert.equal(readiness.pendingTweens, 0);
          assert.equal(readiness.pendingReveal, false);
        } else assert.equal(readiness.ready, false, 'unsettled negative control must stay unresolved');
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
