import { randomUUID } from 'node:crypto';
import { waitW17Readiness } from './w17-readiness.mjs';

// Bounded plain-text measurement, not a CSS renderer. Chromium paints both
// probes in the original stacking context using a native Range highlight:
//   B: transparent glyphs/background; F: transparent glyphs + foreground fill.
// No element color, visibility, opacity, pseudo, layout or animation is edited.
// Every complete pixel in the text rectangles contributes to the minimum.
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
      for (let x = e; x; x = x.parentElement) {
        const a = getComputedStyle(x);
        for (const key of ['filter', 'backdropFilter', 'maskImage', 'clipPath', 'textShadow']) {
          if (a[key] !== 'none') unsupported.push(`${x.tagName} ${key}: ${a[key]}`);
        }
        if (a.mixBlendMode !== 'normal' || a.opacity !== '1') unsupported.push(`${x.tagName} blend/opacity`);
        if (a.visibility !== 'visible' || a.display === 'none') unsupported.push(`${x.tagName} not visible`);
        if (a.backgroundClip.includes('text') || a.textDecorationLine !== 'none') unsupported.push(`${x.tagName} text clip/decoration`);
        if (x.getAnimations().some(a => ['running', 'pending'].includes(a.playState))) unsupported.push(`${x.tagName} active animation`);
      }
      const ranges = [...e.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).map(n => {
        const range = new Range(); range.selectNodeContents(n); return range;
      });
      const rectangles = () => ranges.flatMap(r => [...r.getClientRects()].map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })));
      const rects = rectangles();
      if (!rects.length || rects.some(r => r.right <= r.left || r.bottom <= r.top || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)) unsupported.push('empty/clipped/offscreen text range');
      // Snapshot actual document paint, including pseudos whose owners are
      // outside the sample. Never infer paint extents from an owner's box.
      const keys = ['color', 'background', 'border', 'boxShadow', 'textShadow', 'opacity', 'filter', 'backdropFilter', 'mixBlendMode', 'mask', 'clipPath', 'visibility', 'display', 'position', 'zIndex', 'transform', 'translate', 'rotate', 'scale', 'content', 'font', 'webkitTextFillColor', 'webkitTextStrokeWidth'];
      const fingerprint = () => JSON.stringify([...doc.querySelectorAll('*')].map(x => {
        const r = x.getBoundingClientRect();
        return [[r.x, r.y, r.width, r.height], ...['', '::before', '::after'].map(p => {
          const c = getComputedStyle(x, p || null); return keys.map(k => c[k]);
        })];
      }));
      const initial = fingerprint(), geometry = JSON.stringify(rects);
      const originalSheets = [...doc.adoptedStyleSheets], sheet = new CSSStyleSheet();
      let mutations = false;
      const observer = new MutationObserver(records => { mutations ||= records.length > 0; });
      observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
      return {
        unsupported, color: s.color, rects,
        clip: { x: Math.floor(Math.min(...rects.map(r => r.left)) + scrollX), y: Math.floor(Math.min(...rects.map(r => r.top)) + scrollY),
          width: Math.ceil(Math.max(...rects.map(r => r.right)) + scrollX) - Math.floor(Math.min(...rects.map(r => r.left)) + scrollX),
          height: Math.ceil(Math.max(...rects.map(r => r.bottom)) + scrollY) - Math.floor(Math.min(...rects.map(r => r.top)) + scrollY) },
        offset: { x: scrollX, y: scrollY },
        async set(mode) {
          if (mode === 'original') {
            CSS.highlights.delete(name); doc.adoptedStyleSheets = originalSheets;
          } else {
            sheet.replaceSync(`::highlight(${name}) { color: transparent !important; background-color: ${mode === 'foreground' ? s.color : 'transparent'} !important; text-shadow: none !important; }`);
            doc.adoptedStyleSheets = [...originalSheets, sheet];
            CSS.highlights.set(name, new Highlight(...ranges));
          }
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          mutations ||= observer.takeRecords().length > 0;
          if (mutations || fingerprint() !== initial || JSON.stringify(rectangles()) !== geometry) throw new Error('document paint/geometry changed during probes');
          if (mode !== 'original') {
            const p = getComputedStyle(e, `::highlight(${name})`);
            if (p.color !== 'rgba(0, 0, 0, 0)' || p.backgroundColor !== (mode === 'foreground' ? s.color : 'rgba(0, 0, 0, 0)')) throw new Error('native highlight style not established');
          }
        },
        restore() { CSS.highlights?.delete(name); doc.adoptedStyleSheets = originalSheets; observer.disconnect(); },
      };
    }, name);
    const info = await probe.evaluate(p => ({ unsupported: p.unsupported, color: p.color, rects: p.rects, clip: p.clip, offset: p.offset }));
    result.color = info.color;
    if (info.unsupported.length) { result.unsupported = info.unsupported; return result; }
    const images = {};
    for (const [label, mode] of [['original', 'original'], ['background', 'background'], ['foreground', 'foreground'], ['foregroundRepeat', 'foreground'], ['backgroundRepeat', 'background'], ['restored', 'original']]) {
      await probe.evaluate((p, mode) => p.set(mode), mode);
      const bytes = await target.page().screenshot({ clip: info.clip, scale: 'css', animations: 'allow', type: 'png' });
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
      let pixels = 0, glyphPixels = 0, solidGlyphPixels = 0, ratio = Infinity, worst = null;
      for (let y = 0; y < info.clip.height; y++) for (let x = 0; x < info.clip.width; x++) {
        const i = (y * info.clip.width + x) * 4, vx = x + info.clip.x - info.offset.x, vy = y + info.clip.y - info.offset.y;
        const inside = info.rects.some(r => vx >= r.left && vx + 1 <= r.right && vy >= r.top && vy + 1 <= r.bottom);
        const fg = Array.from(f.slice(i, i + 3)), bg = Array.from(b.slice(i, i + 3)), ink = Array.from(o.slice(i, i + 3));
        if ([f[i + 3], b[i + 3], o[i + 3]].some(v => v !== 255)) throw new Error('unresolved raster alpha');
        const changed = ink.some((v, c) => v !== bg[c]);
        if (!inside) { if (changed) throw new Error('glyph or coupled paint outside sampled text rectangles'); continue; }
        pixels++;
        const q = contrast(fg, bg);
        if (q < ratio) { ratio = q; worst = { x: vx, y: vy, foreground: fg, background: bg }; }
        if (changed) {
          glyphPixels++;
          const channel = [0, 1, 2].sort((a, c) => Math.abs(fg[c] - bg[c]) - Math.abs(fg[a] - bg[a]))[0];
          const delta = fg[channel] - bg[channel], coverage = delta ? (ink[channel] - bg[channel]) / delta : NaN;
          if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1.02 || ink.some((v, c) => Math.abs(v - (bg[c] + coverage * (fg[c] - bg[c]))) > 2)) throw new Error('original glyphs inconsistent with composited probes');
          if (ink.every((v, c) => Math.abs(v - fg[c]) <= 1)) solidGlyphPixels++;
        }
      }
      if (!pixels || !glyphPixels || !solidGlyphPixels) throw new Error('foreground glyph paint not independently observed');
      return { ratio, pixels, glyphPixels, solidGlyphPixels, rectangles: info.rects.length, worst };
    }, { images, info });
    return { ...result, ...measurement, status: 'measured-composited-paint' };
  } catch (error) {
    return refuse(error.message);
  } finally {
    if (probe) { await probe.evaluate(p => p.restore()); await probe.dispose(); }
  }
}
