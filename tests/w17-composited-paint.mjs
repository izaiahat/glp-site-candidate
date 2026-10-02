import { randomUUID } from 'node:crypto';
import { waitW17Readiness } from './w17-readiness.mjs';

// Bounded plain-text measurement, not a CSS renderer. Chromium paints both
// probes in the original stacking context using a native Range highlight:
//   B: transparent glyphs/background; F: transparent glyphs + foreground fill.
// No element color, visibility, opacity, pseudo, layout or animation is edited.
// Every complete pixel in the text rectangles and every qualified
// glyph-bearing fractional boundary pixel contributes to the minimum.
// This is a conservative text-rectangle bound, NOT an exact glyph minimum.
// https://www.w3.org/TR/css-pseudo-4/#highlight-painting
export async function observeW17CompositedPaint(target, { capture = async () => {} } = {}) {
  const result = { text: (await target.textContent()).trim(), status: 'unsupported-paint',
    ratio: null, unsupported: [], method: 'native-highlight-text-rectangle-bound' };
  const refuse = reason => { result.unsupported.push(reason); return result; };
  const readiness = await waitW17Readiness(target);
  if (!readiness.ready) return refuse(readiness.reason);
  const name = 'w17-' + randomUUID();
  let probe;
  try {
    probe = await target.evaluateHandle((e, name) => {
      const unsupported = [];
      const s = getComputedStyle(e), doc = e.ownerDocument;
      if (!globalThis.Highlight || !CSS.highlights || !CSS.supports(`selector(::highlight(${name}))`)) unsupported.push('native Highlight API unavailable');
      if (CSS.highlights?.size || !getSelection().isCollapsed) unsupported.push('existing highlight/selection');
      if (e.children.length || !e.textContent.trim()) unsupported.push('requires nonempty direct text only');
      if (devicePixelRatio !== 1) unsupported.push('requires deviceScaleFactor 1');
      if (!/^rgba?\([\d.,\s]+\)$/.test(s.color)) unsupported.push('requires sRGB foreground');
      if (s.webkitTextFillColor !== s.color || parseFloat(s.webkitTextStrokeWidth) !== 0) unsupported.push('nonstandard glyph fill/stroke');
      if (s.fontStyle !== 'normal' || s.writingMode !== 'horizontal-tb' || s.textTransform !== 'none') unsupported.push('unsupported text geometry');
      const textProperties = ['color', 'font', 'letterSpacing', 'textShadow', 'webkitTextFillColor', 'webkitTextStrokeWidth'];
      for (const pseudo of ['::first-line', '::first-letter']) {
        const p = getComputedStyle(e, pseudo);
        if (textProperties.some(key => p[key] !== s[key])) unsupported.push(`${pseudo} changes glyph paint/geometry`);
      }
      // One source-qualified irrelevant animation, not a generic animation
      // allowlist. An opaque fixed face covers the orbit throughout its cycle.
      const live = e.getAnimations().filter(a => ['running', 'pending'].includes(a.playState));
      let orbit = null;
      if (live.length === 1 && live[0].animationName === 'cs-button-aurora-orbit') {
        try {
          const rules = [];
          const walk = list => { for (const rule of list) { rules.push(rule); if (rule.cssRules) walk(rule.cssRules); } };
          for (const sheet of doc.styleSheets) walk(sheet.cssRules);
          const frames = rules.filter(r => r.type === CSSRule.KEYFRAMES_RULE && r.name === 'cs-button-aurora-orbit');
          const props = rules.filter(r => r.constructor.name === 'CSSPropertyRule' && r.name === '--cs-button-aurora-angle');
          const keyframesExact = frames.length > 0 && frames.every(r => r.cssRules.length === 1 && r.cssRules[0].keyText === '100%' && r.cssRules[0].style.length === 1 && r.cssRules[0].style.getPropertyValue('--cs-button-aurora-angle').trim() === '360deg');
          const propertyExact = props.length > 0 && props.every(r => r.syntax === '<angle>' && r.inherits === false && r.initialValue === '0deg');
          const consumersExact = rules.every(r => !r.style || [...r.style].every(k => !r.style.getPropertyValue(k).includes('var(--cs-button-aurora-angle)') || k === 'background-image' && r.style.getPropertyValue(k).includes('conic-gradient(from var(--cs-button-aurora-angle),')));
          const timing = live[0].effect.getTiming();
          if (keyframesExact && propertyExact && consumersExact && timing.duration === 5000 && timing.iterations === Infinity && timing.easing === 'linear' && timing.direction === 'normal' && !live[0].effect.pseudoElement) orbit = live[0];
        } catch { /* An unreadable style source cannot qualify motion. */ }
      }
      for (let x = e; x; x = x.parentElement) {
        const a = getComputedStyle(x);
        // Only the exact pointwise action chain exercised by native controls.
        // Browser paints both filtered endpoints; no computed-color PASS and
        // no spatial filters or ancestor filter stacks are admitted.
        if (a.filter !== 'none' && !(x === e && a.filter === 'saturate(1.16) brightness(1.04)')) unsupported.push(`${x.tagName} filter: ${a.filter}`);
        for (const key of ['backdropFilter', 'maskImage', 'clipPath', 'textShadow']) {
          if (a[key] !== 'none') unsupported.push(`${x.tagName} ${key}: ${a[key]}`);
        }
        if (a.mixBlendMode !== 'normal' || a.opacity !== '1') unsupported.push(`${x.tagName} blend/opacity`);
        if (a.visibility !== 'visible' || a.display === 'none') unsupported.push(`${x.tagName} not visible`);
        if (a.backgroundClip.includes('text') || a.textDecorationLine !== 'none') unsupported.push(`${x.tagName} text clip/decoration`);
        if (x.getAnimations().some(a => ['running', 'pending'].includes(a.playState) && !(x === e && a === orbit))) unsupported.push(`${x.tagName} active animation`);
      }
      const ranges = [...e.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).map(n => {
        const range = new Range(); range.selectNodeContents(n); return range;
      });
      const rectangles = () => ranges.flatMap(r => [...r.getClientRects()].map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })));
      const rects = rectangles();
      if (!rects.length || rects.some(r => r.right <= r.left || r.bottom <= r.top || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)) unsupported.push('empty/clipped/offscreen text range');
      const opaqueFace = 'linear-gradient(100deg, rgb(83, 219, 165), rgb(117, 199, 238) 48%, rgb(181, 166, 244)), ';
      const orbitTimes = [];
      const qualifiesOrbitFace = () => {
        const c = getComputedStyle(e), r = e.getBoundingClientRect();
        const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map(k => c[k]);
        if (!radii.every(v => /^\d+(?:\.\d+)?px$/.test(v) && v === radii[0])) return false;
        const radius = Math.min(parseFloat(radii[0]), r.width / 2, r.height / 2);
        const border = Math.max(...['borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth'].map(k => parseFloat(c[k])));
        // Conservative inscribed rectangle, strictly inside the rounded
        // padding box even at its corners. Include every screenshot pixel.
        const clearance = border + radius * (1 - Math.SQRT1_2);
        const contained = rects.every(t => Math.floor(t.left) >= r.left + clearance && Math.ceil(t.right) <= r.right - clearance && Math.floor(t.top) >= r.top + clearance && Math.ceil(t.bottom) <= r.bottom - clearance);
        const m = new DOMMatrix(c.transform === 'none' ? undefined : c.transform);
        return contained && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 &&
          c.backgroundImage.startsWith(opaqueFace + 'conic-gradient(') &&
          c.backgroundClip === 'padding-box, border-box' && c.backgroundOrigin === 'border-box, border-box' &&
          c.backgroundSize === 'auto, auto' && c.backgroundPosition === '0% 0%, 0% 0%' &&
          c.backgroundBlendMode.split(',').every(v => v.trim() === 'normal') &&
          orbit.playState === 'running' && e.getAnimations().filter(a => ['running', 'pending'].includes(a.playState)).length === 1;
      };
      if (orbit && !qualifiesOrbitFace()) unsupported.push('orbit not occluded by qualified opaque face at all sampled pixels');
      // Snapshot actual document paint, including pseudos whose owners are
      // outside the sample. Never infer paint extents from an owner's box.
      const keys = ['color', 'background', 'border', 'boxShadow', 'textShadow', 'opacity', 'filter', 'backdropFilter', 'mixBlendMode', 'mask', 'clipPath', 'visibility', 'display', 'position', 'zIndex', 'transform', 'translate', 'rotate', 'scale', 'content', 'font', 'webkitTextFillColor', 'webkitTextStrokeWidth'];
      const fingerprint = () => JSON.stringify([...doc.querySelectorAll('*')].map(x => {
        const r = x.getBoundingClientRect();
        return [[r.x, r.y, r.width, r.height], ...['', '::before', '::after'].map(p => {
          const c = getComputedStyle(x, p || null); return keys.map(k => orbit && x === e && !p && k === 'background' ? c[k].replace(/conic-gradient\((?:from [-\d.]+deg, )?/, 'conic-gradient(qualified-orbit, ') : c[k]);
        })];
      }));
      const initial = fingerprint(), geometry = JSON.stringify(rects);
      const originalSheets = [...doc.adoptedStyleSheets], sheet = new CSSStyleSheet(), originalDOM = doc.documentElement.outerHTML;
      let mutations = false;
      const mutationDetails = [];
      const recordMutations = records => { mutations ||= records.length > 0; for (const r of records.slice(0, 4)) mutationDetails.push({ type: r.type, tag: r.target.tagName, class: r.target.className, attribute: r.attributeName }); };
      const observer = new MutationObserver(recordMutations);
      observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
      return {
        unsupported, color: s.color, filter: s.filter, rects, orbitTimes,
        // page.screenshot without fullPage clips in VIEWPORT coordinates.
        clip: { x: Math.floor(Math.min(...rects.map(r => r.left))), y: Math.floor(Math.min(...rects.map(r => r.top))),
          width: Math.ceil(Math.max(...rects.map(r => r.right))) - Math.floor(Math.min(...rects.map(r => r.left))),
          height: Math.ceil(Math.max(...rects.map(r => r.bottom))) - Math.floor(Math.min(...rects.map(r => r.top))) },
        async set(mode) {
          if (mode === 'original') {
            CSS.highlights.delete(name); doc.adoptedStyleSheets = originalSheets;
          } else {
            sheet.replaceSync(`::highlight(${name}) { color: transparent !important; background-color: ${mode === 'foreground' ? s.color : 'transparent'} !important; text-shadow: none !important; }`);
            doc.adoptedStyleSheets = [...originalSheets, sheet];
            CSS.highlights.set(name, new Highlight(...ranges));
          }
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          recordMutations(observer.takeRecords());
          const current = fingerprint();
          if (mutations || current !== initial || JSON.stringify(rectangles()) !== geometry) {
            const a = JSON.parse(initial), b = JSON.parse(current), differences = [];
            for (let i = 0; i < Math.min(a.length, b.length) && differences.length < 4; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
              for (let p = 1; p < 4; p++) for (let k = 0; k < keys.length; k++) if (a[i][p][k] !== b[i][p][k]) differences.push({ element: i, pseudo: ['', '::before', '::after'][p - 1], key: keys[k], before: a[i][p][k], after: b[i][p][k] });
            }
            throw new Error(`document paint/geometry changed during probes: ${JSON.stringify({ mutations, mutationDetails: mutationDetails.slice(0, 4), differences: differences.slice(0, 4) })}`);
          }
          if (orbit) {
            if (!qualifiesOrbitFace() || orbitTimes.length && orbit.currentTime <= orbitTimes.at(-1).time) throw new Error('qualified orbit stopped or changed');
            orbitTimes.push({ time: orbit.currentTime, angle: getComputedStyle(e).getPropertyValue('--cs-button-aurora-angle') });
          }
          if (mode !== 'original') {
            const p = getComputedStyle(e, `::highlight(${name})`);
            if (p.color !== 'rgba(0, 0, 0, 0)' || p.backgroundColor !== (mode === 'foreground' ? s.color : 'rgba(0, 0, 0, 0)')) throw new Error('native highlight style not established');
          }
        },
        restored() { recordMutations(observer.takeRecords()); return !mutations && doc.documentElement.outerHTML === originalDOM && CSS.highlights.size === 0 && doc.adoptedStyleSheets.length === originalSheets.length && [...doc.adoptedStyleSheets].every((s, i) => s === originalSheets[i]); },
        restore() { CSS.highlights?.delete(name); doc.adoptedStyleSheets = originalSheets; observer.disconnect(); },
      };
    }, name);
    const info = await probe.evaluate(p => ({ unsupported: p.unsupported, color: p.color, filter: p.filter, rects: p.rects, clip: p.clip }));
    result.color = info.color;
    if (info.unsupported.length) { result.unsupported = info.unsupported; return result; }
    // Materialize Chromium's highlight/compositing paint path once before
    // measuring. On a retained blurred pseudo the first foreground highlight
    // changes background rounding even after removal; native captures
    // show subsequent complete cycles are byte-stable. This is a fixed setup
    // sequence, never a retry-until-equal or a pixel-difference tolerance.
    // Keep all style/geometry/mutation guards active and retain setup captures.
    for (const mode of ['foreground', 'background', 'original']) {
      await probe.evaluate((p, mode) => p.set(mode), mode);
      const bytes = await target.page().screenshot({ clip: info.clip, scale: 'css', caret: 'initial', animations: 'allow', type: 'png' });
      await capture(`setup-${mode}`, bytes);
    }
    const images = {};
    for (const [label, mode] of [['original', 'original'], ['background', 'background'], ['foreground', 'foreground'], ['foregroundRepeat', 'foreground'], ['backgroundRepeat', 'background'], ['restored', 'original']]) {
      await probe.evaluate((p, mode) => p.set(mode), mode);
      const bytes = await target.page().screenshot({ clip: info.clip, scale: 'css', caret: 'initial', animations: 'allow', type: 'png' });
      await capture(label, bytes);
      images[label] = bytes.toString('base64');
    }
    const measurement = await target.page().evaluate(async ({ images, info }) => {
      const decoded = {};
      for (const [name, data] of Object.entries(images)) {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
        if (bitmap.width !== info.clip.width || bitmap.height !== info.clip.height) throw new Error('screenshot pixel geometry mismatch');
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
        ctx.drawImage(bitmap, 0, 0); decoded[name] = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data; bitmap.close();
      }
      for (const [a, b] of [['original', 'restored'], ['background', 'backgroundRepeat'], ['foreground', 'foregroundRepeat']]) {
        if (decoded[a].some((v, i) => v !== decoded[b][i])) throw new Error(`unstable raster: ${a}/${b}`);
      }
      const { original: o, background: b, foreground: f } = decoded;
      const lum = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
      // Include quantization uncertainty; never round a near-threshold result up.
      const interval = c => [lum(c.map(v => Math.max(0, v - 1))), lum(c.map(v => Math.min(255, v + 1)))];
      const contrast = (a, b) => { const [al, ah] = interval(a), [bl, bh] = interval(b); return al > bh ? (al + .05) / (bh + .05) : bl > ah ? (bl + .05) / (ah + .05) : 1; };
      // Saturation mixes channels with signed coefficients. LCD coverage is
      // independent per channel BEFORE that matrix, so filtered ink need not
      // lie between the two filtered endpoints (native blue 254 vs F=253).
      // Bound the prefilter background by inverse interval propagation, then
      // propagate the full LCD box through the actual signed matrix/clamps.
      // This is not a pixel epsilon: unfiltered qualification stays exact;
      // the same existing one-code-value quantization interval is used.
      const actionFilter = info.filter === 'saturate(1.16) brightness(1.04)';
      const weights = [.213, .715, .072], saturation = 1.16, brightness = 1.04;
      const matrix = weights.map((_, i) => weights.map((w, j) => (i === j ? saturation : 0) + (1 - saturation) * w));
      const inverse = weights.map((_, i) => weights.map((w, j) => (i === j ? 1 / saturation : 0) + (1 - 1 / saturation) * w));
      const clamp = v => Math.max(0, Math.min(255, v));
      const project = (m, box) => m.map(row => [0, 1].map(end => row.reduce((sum, a, j) => sum + a * box[j][a >= 0 ? end : 1 - end], 0)));
      const gamut = project(matrix, [[0, 255], [0, 255], [0, 255]]);
      const sourceForeground = info.color.match(/[\d.]+/g).map(Number);
      if (actionFilter && sourceForeground.length !== 3) throw new Error('filtered foreground must be opaque');
      const expectedForeground = project(matrix, sourceForeground.map(v => [v, v])).map(([v]) => clamp(clamp(v) * brightness));
      const filterCache = new Map();
      const filteredLcdBox = bg => {
        const key = bg.join(',');
        if (!filterCache.has(key)) {
          const matrixBg = bg.map((v, c) => [v <= 1 ? gamut[c][0] : (v - 1) / brightness, v >= 254 ? gamut[c][1] : (v + 1) / brightness]);
          const inputBg = project(inverse, matrixBg).map(([lo, hi]) => [clamp(lo), clamp(hi)]);
          const lcd = inputBg.map(([lo, hi], c) => [Math.min(lo, sourceForeground[c]), Math.max(hi, sourceForeground[c])]);
          filterCache.set(key, project(matrix, lcd).map(([lo, hi]) => [Math.floor(clamp(clamp(lo) * brightness)), Math.ceil(clamp(clamp(hi) * brightness))]));
        }
        return filterCache.get(key);
      };
      let pixels = 0, glyphPixels = 0, solidGlyphPixels = 0, ratio = Infinity, worst = null, glyphFailureWitness = null;
      for (let y = 0; y < info.clip.height; y++) for (let x = 0; x < info.clip.width; x++) {
        const i = (y * info.clip.width + x) * 4, vx = x + info.clip.x, vy = y + info.clip.y;
        const inside = info.rects.some(r => vx >= r.left && vx + 1 <= r.right && vy >= r.top && vy + 1 <= r.bottom);
        const fg = Array.from(f.slice(i, i + 3)), bg = Array.from(b.slice(i, i + 3)), ink = Array.from(o.slice(i, i + 3));
        if ([f[i + 3], b[i + 3], o[i + 3]].some(v => v !== 255)) throw new Error('unresolved raster alpha');
        const changed = ink.some((v, c) => v !== bg[c]);
        // Range metrics can bisect a pixel whose glyph AND highlight fill
        // Chromium paints (observed at the left edge of a heading W). Include
        // those glyph-bearing boundary pixels in both the contrast minimum
        // and the strict endpoint check; never discard their contrast or add
        // a positional tolerance. Blank fractional fringe isn't a full probe.
        if (!inside) {
          if (!changed) continue;
          if (!info.rects.some(r => vx < r.right && vx + 1 > r.left && vy < r.bottom && vy + 1 > r.top)) throw new Error('glyph or coupled paint outside sampled text rectangles');
        }
        pixels++;
        const q = contrast(fg, bg);
        if (q < ratio) { ratio = q; worst = { x: vx, y: vy, foreground: fg, background: bg }; }
        if (changed) {
          glyphPixels++;
          // LCD antialiasing has independent R/G/B coverage: e.g. white
          // Arial on black actually paints (15,55,135) at an edge. Requiring
          // a single alpha rejects real glyphs. Each channel must instead
          // lie strictly between its measured composited endpoints. No
          // epsilon is added; equal endpoints must remain exactly equal.
          const bounds = actionFilter ? filteredLcdBox(bg) : bg.map((v, c) => [Math.min(v, fg[c]), Math.max(v, fg[c])]);
          if (actionFilter && inside && fg.some((v, c) => Math.abs(v - expectedForeground[c]) > 1)) throw new Error('native filtered foreground disagrees with pointwise contract');
          if (ink.some((v, c) => v < bounds[c][0] || v > bounds[c][1])) throw new Error(`original glyphs inconsistent with composited probes at ${vx},${vy}: ${JSON.stringify({ink, bg, fg, bounds})}`);
          if (ink.every((v, c) => Math.abs(v - fg[c]) <= 1)) {
            solidGlyphPixels++;
            const [al, ah] = interval(fg), [bl, bh] = interval(bg);
            const upper = Math.max((ah + .05) / (bl + .05), (bh + .05) / (al + .05));
            if (upper < 4.5 && (!glyphFailureWitness || upper < glyphFailureWitness.contrastUpper)) glyphFailureWitness = { x: vx, y: vy, ink, foreground: fg, background: bg, contrastUpper: upper };
          }
        }
      }
      if (!pixels || !glyphPixels || !solidGlyphPixels) throw new Error('foreground glyph paint not independently observed');
      return { ratio, pixels, glyphPixels, solidGlyphPixels, rectangles: info.rects.length, worst, glyphFailureWitness };
    }, { images, info });
    result.domRestored = await probe.evaluate(p => p.restored());
    if (!result.domRestored) return refuse('exact DOM/highlight/sheet restoration failed');
    result.occludedOrbit = await probe.evaluate(p => p.orbitTimes.length ? { sourceQualified: true, samples: p.orbitTimes } : null);
    return { ...result, ...measurement, status: 'measured-composited-paint' };
  } catch (error) {
    return refuse(error.message);
  } finally {
    if (probe) { await probe.evaluate(p => p.restore()); await probe.dispose(); }
  }
}
