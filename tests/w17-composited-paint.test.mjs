import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { observeW17Paint } from './w17-source-css.test.mjs';
import { observeW17CompositedPaint } from './w17-composited-paint.mjs';

// Explicitly synthetic TEST fixtures. They exercise the real browser/oracle;
// they are never candidate HTML, approval receipts, or emitted-site evidence.
test('W17 native compositing TEST controls retain original refusal and reject hostile paint', async t => {
  const browser = await chromium.launch();
  const records = [];
  const cases = [
    { name: 'known-solid', css: '', pass: true, minimum: 20 },
    { name: 'known-low-contrast', css: '#target{color:#aaa;background:white}', pass: false, measured: true },
    { name: 'actual-gradient', css: '#target{background:linear-gradient(100deg,#07100d,#152d21)}', pass: true, legacyRefuses: true },
    { name: 'actual-gradient-low-band', css: '#target{background:linear-gradient(90deg,black 30%,white 32%,white 40%,black 42%)}', pass: false, legacyRefuses: true },
    { name: 'retained-radial-and-halo', css: 'main{background:radial-gradient(circle at 8% 2%,rgba(63,217,164,.1),transparent 480px),#07100d}#target{background:rgba(15,34,28,.86)}#target::before{content:"";position:absolute;inset:-8px;z-index:-1;background:radial-gradient(closest-side,rgba(70,214,162,.5),transparent 78%);filter:blur(6px);opacity:.85;pointer-events:none}', pass: true, legacyRefuses: true },
    { name: 'white-pseudo-behind-glyphs', css: '#target::before{content:"";position:absolute;inset:0;background:white;z-index:-1}', pass: false, legacyRefuses: true },
    { name: 'white-overlap-pointer-none', css: '#overlap{position:absolute;left:0;top:0;width:500px;height:200px;background:white;pointer-events:none;z-index:2}', tail: '<div id="overlap"></div>', pass: false, legacyRefuses: true },
    { name: 'partial-white-overlap', css: '#overlap{position:absolute;left:110px;top:0;width:16px;height:200px;background:white;pointer-events:none;z-index:2}', tail: '<div id="overlap"></div>', pass: false, legacyRefuses: true },
    { name: 'partial-black-occlusion', css: '#overlap{position:absolute;left:110px;top:0;width:16px;height:200px;background:black;pointer-events:none;z-index:2}', tail: '<div id="overlap"></div>', pass: false, legacyRefuses: true },
    { name: 'translucent-overlap', css: '#overlap{position:absolute;left:0;top:0;width:500px;height:200px;background:rgba(0,0,0,.8);pointer-events:none;z-index:2}', tail: '<div id="overlap"></div>', pass: false, legacyRefuses: true },
    { name: 'out-of-owner-pseudo', css: '#overlap{position:absolute;left:600px;top:0;width:1px;height:1px}#overlap::before{content:"";position:absolute;left:-600px;top:0;width:500px;height:200px;background:white;pointer-events:none;z-index:2}', tail: '<div id="overlap"></div>', pass: false, legacyRefuses: true },
    { name: 'out-of-owner-shadow', css: '#overlap{position:absolute;left:600px;top:0;width:500px;height:200px;box-shadow:-600px 0 white;pointer-events:none;z-index:2}', tail: '<div id="overlap"></div>', pass: false },
    { name: 'glyph-suppression-coupling', css: '#target::before{content:"";position:absolute;inset:0;background:currentColor;z-index:-1}#target[style]::before{display:none}', pass: false, legacyRefuses: true },
    { name: 'unsupported-blend', css: '#target{mix-blend-mode:screen}', pass: false, unknown: true },
    { name: 'unsupported-filter', css: '#target{filter:blur(1px)}', pass: false, unknown: true },
    { name: 'different-first-letter', css: '#target::first-letter{color:black}', pass: false, unknown: true },
    { name: 'unstable-paint', css: '#target{animation:flash .1s infinite alternate}@keyframes flash{to{background:white}}', pass: false, unknown: true },
  ];
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 400 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.route('**/*', r => r.abort());
    for (const fixture of cases) await t.test(fixture.name, async () => {
      const page = await context.newPage();
      try {
        await page.setContent(`<style>body{margin:0}main{position:relative;padding:30px;background:black}#target{position:relative;isolation:isolate;display:block;width:300px;padding:15px;color:white;background:black;font:700 24px/1.3 Arial;text-decoration:none}${fixture.css}</style><main><a id="target">Start a provider search</a>${fixture.tail || ''}</main>`);
        const target = page.locator('#target'), before = await page.content();
        const legacy = await target.evaluate(observeW17Paint);
        if (fixture.legacyRefuses) assert.equal(legacy.ratio, null, 'the genuine original solid-only refusal is preserved');
        const directory = process.env.W17_TEST_ARTIFACT_DIR && path.resolve(process.env.W17_TEST_ARTIFACT_DIR, fixture.name);
        if (directory) await mkdir(directory, { recursive: true });
        const observed = await observeW17CompositedPaint(target, {
          capture: directory ? (label, png) => writeFile(path.join(directory, `${label}.png`), png) : undefined,
        });
        records.push({ fixture: fixture.name, synthetic_test_fixture: true, legacy_status: legacy.status, ...observed });
        assert.equal(await page.content(), before, 'probe must restore exact DOM');
        assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
        assert.equal(await page.evaluate(() => document.adoptedStyleSheets.length), 0);
        const passes = observed.status === 'measured-composited-paint' && observed.ratio >= 4.5;
        assert.equal(passes, fixture.pass, JSON.stringify(observed));
        if (fixture.pass || fixture.measured) {
          assert.equal(observed.status, 'measured-composited-paint', JSON.stringify(observed));
          assert.ok(observed.pixels > 0 && observed.glyphPixels > 0 && observed.solidGlyphPixels > 0);
        }
        if (fixture.minimum) assert.ok(observed.ratio >= fixture.minimum);
        if (fixture.unknown) assert.equal(observed.ratio, null);
      } finally { await page.close(); }
    });
    await context.close();
  } finally {
    console.log(JSON.stringify({ synthetic_test_fixtures: true, controls: records.length, records }));
    await browser.close();
  }
});
