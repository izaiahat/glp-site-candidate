import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Deliberately narrow solid-paint oracle, shared by the report-only emitted test.
// Unsupported paint is an explicit failure, NEVER a backgroundColor-only PASS.
// This is not a screenshot sampler or a general CSS compositing implementation.
export function observeW17Paint(e, styleOf = globalThis.getComputedStyle) {
  const unsupported = [];
  const reject = reason => unsupported.push(reason);
  const parse = value => {
    let match = value.match(/^rgba?\(([^)]+)\)$/), scale = 255;
    if (!match) { match = value.match(/^color\(srgb\s+([^)]+)\)$/); scale = 1; }
    if (!match) { reject(`color syntax: ${value}`); return [0, 0, 0, 0]; }
    const tokens = match[1].trim().split(/[\s,\/]+/);
    const c = tokens.map((v, i) => v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v) / (i < 3 ? scale : 1));
    if (c.length === 3) c.push(1);
    if (c.length !== 4 || c.some(v => !Number.isFinite(v) || v < 0 || v > 1)) reject(`color range: ${value}`);
    return c;
  };
  const over = (front, back) => {
    const alpha = front[3] + back[3] * (1 - front[3]);
    return [...front.slice(0, 3).map((v, i) => alpha ? (v * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0), alpha];
  };
  const label = x => `${x.tagName}${x.id ? '#' + x.id : ''}`;
  const ancestors = [];
  for (let x = e; x; x = x.parentElement) ancestors.unshift(x);
  const rect = e.getBoundingClientRect();
  if (!rect.width || !rect.height) reject('empty target geometry');
  let bg = [0, 0, 0, 0];
  for (const x of ancestors) {
    const s = styleOf(x), name = label(x);
    for (const key of ['backgroundImage', 'filter', 'backdropFilter', 'maskImage', 'webkitMaskImage', 'textShadow', 'boxShadow']) {
      if (s[key] && s[key] !== 'none') reject(`${name} ${key}: ${s[key]}`);
    }
    for (const key of ['mixBlendMode', 'backgroundBlendMode']) {
      if (s[key] && s[key] !== 'normal') reject(`${name} ${key}: ${s[key]}`);
    }
    if (Number(s.opacity) !== 1) reject(`${name} opacity: ${s.opacity}`);
    if (s.visibility !== 'visible' || s.display === 'none') reject(`${name} not visible`);
    if (s.backgroundClip && !['border-box', 'padding-box'].includes(s.backgroundClip)) reject(`${name} backgroundClip: ${s.backgroundClip}`);
    if (s.clipPath && s.clipPath !== 'none') reject(`${name} clipPath: ${s.clipPath}`);
    if (x.getAnimations().some(a => a.playState === 'running' || a.playState === 'pending')) reject(`${name} active animation`);
    bg = over(parse(s.backgroundColor), bg);
  }
  if (bg[3] !== 1) reject('unresolved translucent canvas');
  // A pseudo can extend beyond its owner's box. Refuse generated pseudos across
  // this document instead of claiming their paint bounds from the owner rect.
  // Likewise overlapping non-ancestors and nested text paints need a richer
  // compositor; conservative refusal is intentional for this bounded oracle.
  for (const x of e.ownerDocument.querySelectorAll('*')) {
    const s = styleOf(x);
    if (s.display === 'none' || s.visibility !== 'visible') continue;
    if (x.shadowRoot) reject(`${label(x)} shadow paint`);
    for (const pseudo of ['::before', '::after']) {
      const p = styleOf(x, pseudo);
      if (p.display !== 'none' && p.content && p.content !== 'none' && p.content !== 'normal') reject(`${label(x)} ${pseudo} generated paint`);
    }
    if (ancestors.includes(x)) continue;
    const r = x.getBoundingClientRect();
    if (r.width && r.height && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) reject(`${label(x)} overlapping/nested paint`);
  }
  const s = styleOf(e), color = s.color;
  if (s.webkitTextFillColor && s.webkitTextFillColor !== color) reject(`text fill differs: ${s.webkitTextFillColor}`);
  if (s.webkitTextStrokeWidth && parseFloat(s.webkitTextStrokeWidth) !== 0) reject(`text stroke: ${s.webkitTextStrokeWidth}`);
  const fg = over(parse(color), bg);
  const lum = c => c.slice(0, 3).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  const a = lum(fg), b = lum(bg);
  return { text: e.textContent.trim(), color, status: unsupported.length ? 'unsupported-paint' : 'measured-solid-paint', unsupported, ratio: unsupported.length ? null : (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
}

function paintFixture({ foreground = 'rgb(255, 255, 255)', background = 'rgb(0, 0, 0)', extra = {}, pseudo = false, overlap = false } = {}) {
  const rect = { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
  const node = { tagName: 'A', textContent: 'Start a provider search', parentElement: null, getBoundingClientRect: () => rect, getAnimations: () => [] };
  node.ownerDocument = { querySelectorAll: () => overlap ? [node, { ...node, tagName: 'OVERLAY' }] : [node] };
  const base = { color: foreground, backgroundColor: background, opacity: '1', visibility: 'visible', display: 'block', ...extra };
  return observeW17Paint(node, (_, p) => p ? { display: 'block', content: pseudo ? '""' : 'none' } : base);
}

test('W17 paint helper: solid positive and low-contrast negative', () => {
  assert.equal(paintFixture().ratio, 21);
  assert.ok(paintFixture({ foreground: 'rgb(180, 180, 180)', background: 'rgb(255, 255, 255)' }).ratio < 4.5);
});
test('W17 paint helper: composite foreground alpha and normalize sRGB', () => {
  const transparent = paintFixture({ foreground: 'rgba(255, 255, 255, 0)' });
  assert.equal(transparent.ratio, 1);
  assert.ok(paintFixture({ foreground: 'rgb(255 255 255 / 30%)' }).ratio < 4.5);
  assert.equal(paintFixture({ foreground: 'color(srgb 1 1 1)' }).ratio, 21);
});
test('W17 paint helper: gradient faces, layers and effects fail closed', () => {
  for (const extra of [
    { backgroundImage: 'linear-gradient(white, white)' },
    { backgroundImage: 'linear-gradient(white, white), conic-gradient(black, white)' },
    { filter: 'brightness(2)' }, { backdropFilter: 'blur(2px)' },
    { opacity: '.5' }, { mixBlendMode: 'screen' }, { maskImage: 'url(mask.svg)' },
    { boxShadow: 'inset 0 0 100px white' }, { webkitTextFillColor: 'rgb(0, 0, 0)' },
  ]) {
    const result = paintFixture({ extra });
    assert.equal(result.status, 'unsupported-paint', JSON.stringify(extra));
    assert.equal(result.ratio, null);
    assert.ok(result.unsupported.length);
  }
});
test('W17 paint helper: pseudo/overlap and unknown colors/canvas fail closed', () => {
  for (const options of [{ pseudo: true }, { overlap: true }, { foreground: 'oklch(.7 .2 20)' }, { background: 'rgba(0, 0, 0, .5)' }]) {
    assert.equal(paintFixture(options).status, 'unsupported-paint');
    assert.equal(paintFixture(options).ratio, null);
  }
});

test('W17 paint helper: ancestor alpha compositing and inherited paint refusal', () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
  const parent = { tagName: 'DIV', parentElement: null, getBoundingClientRect: () => rect, getAnimations: () => [] };
  const child = { ...parent, tagName: 'A', textContent: 'label', parentElement: parent };
  child.ownerDocument = { querySelectorAll: () => [parent, child] };
  const style = (x, pseudo) => pseudo ? { content: 'none' } : {
    color: 'white', opacity: '1', visibility: 'visible', display: 'block',
    backgroundColor: x === parent ? 'rgb(0, 0, 0)' : 'rgba(255, 255, 255, .5)',
    // Match normalized computed syntax, not authored CSS color names.
    ...(x === child ? { color: 'rgb(0, 0, 0)' } : {}),
  };
  const result = observeW17Paint(child, style);
  assert.equal(result.status, 'measured-solid-paint');
  assert.ok(Math.abs(result.ratio - 5.280822809644651) < 1e-10);
  const gradient = observeW17Paint(child, (x, pseudo) => ({ ...style(x, pseudo), ...(!pseudo && x === parent ? { backgroundImage: 'linear-gradient(white, white)' } : {}) }));
  assert.equal(gradient.status, 'unsupported-paint');
  assert.equal(gradient.ratio, null);
  parent.getAnimations = () => [{ playState: 'running' }];
  assert.equal(observeW17Paint(child, style).status, 'unsupported-paint');
});

export async function runW17(t, { sourceCss }) {
  const root = process.cwd(), css = new Map();
  if (sourceCss) {
    // Registered assembler, with writes captured in memory; never emitted proof.
    const assembler = fs.readFileSync('artifacts/ultracode/tools/assemble-css.mjs', 'utf8').replace(/^import .*;$/gm, '');
    new Function('readFileSync', 'readdirSync', 'writeFileSync', 'path', 'process', 'console', assembler)(fs.readFileSync, fs.readdirSync, (file, body) => css.set(path.basename(file), body), path, { cwd: () => root }, { log: () => {} });
  }
  const routes = JSON.parse(fs.readFileSync('integration/route-graph.json')).nodes.map(x => x.route).filter(x => x.startsWith('/pharmacies/'));
  assert.equal(new Set(routes).size, 93);
  const records = [], browser = await chromium.launch();
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (u.origin !== 'http://127.0.0.1:4188' || req.method() !== 'GET' || /^\/(api|go|out|track)\//.test(u.pathname)) return route.abort();
        if (sourceCss && css.has(path.basename(u.pathname))) return route.fulfill({ status: 200, contentType: 'text/css', body: css.get(path.basename(u.pathname)) });
        return route.continue();
      });
      const page = await context.newPage();
      for (const route of routes) {
        const rec = { route, mobile, taps: [], contrast: [] };
        await page.goto('http://127.0.0.1:4188' + route, { waitUntil: 'networkidle' });
        const reject = page.getByRole('button', { name: 'Reject optional', exact: true });
        if (await reject.isVisible()) await reject.click();
        const targets = page.locator('.p3-unknowns h2,.p3-provider-search-shelf a');
        for (let i = 0; i < await targets.count(); i++) {
          const target = targets.nth(i), isCta = await target.evaluate(e => e.matches('.p3-provider-search-shelf a'));
          await target.scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0);
          await target.evaluate(e => e.blur());
          for (const state of isCta ? ['rest', 'hover', 'focus-visible'] : ['rest']) {
            if (state === 'hover') await target.hover();
            if (state === 'focus-visible') {
              await page.mouse.move(0, 0);
              await page.keyboard.press('Tab');
              await target.focus();
            }
            // Sample settled states, not arbitrary transition interpolation.
            // Infinite animations remain unsupported in the observation itself.
            await target.evaluate(async e => {
              const animations = [];
              for (let x = e; x; x = x.parentElement) animations.push(...x.getAnimations());
              await Promise.all(animations.filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
            });
            const observation = await target.evaluate(observeW17Paint);
            const stateMatches = await target.evaluate((e, state) => state === 'rest' ? !e.matches(':hover,:focus') : e.matches(':' + state), state);
            if (!stateMatches) { observation.status = 'unsupported-paint'; observation.ratio = null; observation.unsupported.push(`requested state not established: ${state}`); }
            rec.contrast.push({ ...observation, state, kind: isCta ? 'cta' : 'heading' });
          }
        }
        const crumbs = await page.locator('main nav[aria-label="Breadcrumb"] a').evaluateAll(es => es.map(e => e.getAttribute('href')));
        for (const href of crumbs) {
          if (new URL(page.url()).pathname !== route) await page.goto('http://127.0.0.1:4188' + route, { waitUntil: 'domcontentloaded' });
          const link = page.locator('main nav[aria-label="Breadcrumb"] a[href="' + href + '"]').first();
          try {
            await (mobile ? link.tap({ timeout: 800 }) : link.click({ timeout: 800 }));
            await page.waitForURL(new URL(href, 'http://127.0.0.1:4188').href, { timeout: 3000 });
            rec.taps.push({ href, ok: true });
          } catch (e) { rec.taps.push({ href, ok: false, error: e.message }); }
        }
        records.push(rec);
      }
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ source_css_fixture: sourceCss, emitted_assets: !sourceCss, cases: records.length, records }));
  await t.test('W17 every pharmacy breadcrumb works at desktop and mobile', () => {
    assert.equal(records.length, 186);
    assert.equal(records.reduce((n, r) => n + r.taps.length, 0), 372);
    assert.deepEqual(records.flatMap(r => r.taps.filter(t => !t.ok).map(t => ({ route: r.route, mobile: r.mobile, href: t.href }))), []);
  });
  const check = (kind, text, states) => {
    for (const state of states) {
      const samples = records.flatMap(r => r.contrast.filter(x => x.kind === kind && x.text === text && x.state === state).map(x => ({ route: r.route, mobile: r.mobile, ...x })));
      assert.equal(samples.length, 180, `${kind}/${state} denominator`);
      const failures = samples.filter(x => x.status !== 'measured-solid-paint' || !(x.ratio >= 4.5));
      assert.deepEqual(failures, [], `${kind}/${state}: ${JSON.stringify(failures)}`);
    }
  };
  await t.test('W17 unverified headings are legible in all detail viewports', () => check('heading', 'What remains unverified', ['rest']));
  await t.test('W17 provider-search labels are legible at rest, hover and focus-visible in all detail viewports', () => check('cta', 'Start a provider search', ['rest', 'hover', 'focus-visible']));
}

// Test-name filtering executes helpers without assembler, graph, server or browser.
// Importing from the emitted report registers helpers but never the source run.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  test('W17 source-CSS runtime', t => runW17(t, { sourceCss: true }));
}
