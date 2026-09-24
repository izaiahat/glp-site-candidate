import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { noJSSurfaceProbe } from './glp34-listing-handler.mjs';

test('no-JS readability measures an offscreen content-visibility card after scrolling', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.setContent('<style>article{content-visibility:auto;contain-intrinsic-size:200px;margin-top:50000px}</style><main><article data-phase3-provider data-program="fixture"><a href="/reviews/fixture/">Readable fixture</a></article></main>');
    const result = await noJSSurfaceProbe(page);
    assert.equal(result.cards.length, 1);
    assert.equal(result.cards[0].text.trim(), 'Readable fixture');
    assert.ok(result.cards[0].readingTrace.scrollY > 0);
    assert.equal(result.cards[0].readingTrace.inViewport, true);
  } finally {
    await browser.close();
  }
});
