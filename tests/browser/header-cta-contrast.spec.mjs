import { expect, test } from '@playwright/test';

const luminance = rgb => rgb.map(v => v / 255)
  .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

function opaqueRgb(value) {
  const match = /^rgb\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)\)$/.exec(value);
  expect(match, `unsupported or nonopaque color: ${value}`).not.toBeNull();
  return match.slice(1).map(Number);
}

function filtered(rgb, filter) {
  if (filter === 'none') return rgb;
  // Fail closed if the rendering contract changes; never silently ignore filters.
  expect(filter).toBe('saturate(1.16) brightness(1.04)');
  const [r, g, b] = rgb, s = 1.16;
  return [
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
  ].map(v => Math.min(255, Math.max(0, v)) * 1.04).map(v => Math.min(255, v));
}

async function contrast(cta, state, testInfo) {
  const paint = await cta.evaluate(el => {
    const read = node => {
      const s = getComputedStyle(node);
      return Object.fromEntries(['color', 'backgroundImage', 'backgroundClip', 'backgroundSize',
        'backgroundBlendMode', 'opacity', 'filter', 'mixBlendMode', 'textShadow', 'webkitTextFillColor']
        .map(key => [key, s[key]]));
    };
    const ancestors = [];
    for (let node = el.parentElement; node; node = node.parentElement) ancestors.push(read(node));
    return { ...read(el), ancestors, children: el.children.length,
      pseudo: ['::before', '::after'].map(p => getComputedStyle(el, p).content) };
  });
  expect(paint.children, 'plain text CTA; descendant paint needs an explicit oracle').toBe(0);
  expect(paint.pseudo).toEqual(['none', 'none']);
  expect(paint.opacity).toBe('1');
  expect(paint.mixBlendMode).toBe('normal');
  expect(paint.textShadow).toBe('none');
  expect(paint.webkitTextFillColor).toBe(paint.color);
  for (const ancestor of paint.ancestors) {
    expect(ancestor.opacity).toBe('1');
    expect(ancestor.filter).toBe('none');
    expect(ancestor.mixBlendMode).toBe('normal');
  }
  expect(paint.backgroundClip.split(', ')[0]).toBe('padding-box');
  expect(paint.backgroundSize.split(', ')[0]).toBe('auto');
  expect(paint.backgroundBlendMode.split(', ').every(v => v === 'normal')).toBe(true);
  // Only the first, opaque padding-box layer paints under the text. The second
  // conic gradient is the border; transparent background-color is NOT black.
  const face = /^linear-gradient\((.*)\), conic-gradient\(/.exec(paint.backgroundImage)?.[1];
  expect(face, 'expected opaque sRGB linear face above the aurora border').toBeTruthy();
  const colors = face.match(/rgb\([^)]*\)/g) || [];
  const shape = face.replace(/rgb\([^)]*\)/g, 'COLOR');
  expect(shape).toMatch(/^[\d.]+deg, COLOR(?: [\d.]+%)?(?:, COLOR(?: [\d.]+%)?)+$/);
  const stops = colors.map(opaqueRgb).map(rgb => filtered(rgb, paint.filter));
  const foreground = luminance(filtered(opaqueRgb(paint.color), paint.filter));
  // Affine sRGB interpolation/filtering followed by monotone clamping bounds
  // each channel by its endpoint extrema. Monotone WCAG luminance therefore
  // bounds EVERY point in every segment, not merely a finite set of samples.
  // This whole-face lower bound is conservative (not a glyph-position minimum).
  const low = luminance([0, 1, 2].map(i => Math.min(...stops.map(rgb => rgb[i]))));
  const high = luminance([0, 1, 2].map(i => Math.max(...stops.map(rgb => rgb[i]))));
  const worstCaseLowerBound = foreground < low ? (low + 0.05) / (foreground + 0.05)
    : foreground > high ? (foreground + 0.05) / (high + 0.05) : 1;
  await testInfo.attach(`contrast-${state}`, { contentType: 'application/json',
    body: JSON.stringify({ state, paint, worstCaseLowerBound, required: 4.5 }, null, 2) });
  expect(worstCaseLowerBound, `${state}: whole-gradient WCAG AA contrast`).toBeGreaterThanOrEqual(4.5);
}

// jsdom cannot resolve the real cascade, media queries, pseudo states and
// filters faithfully. Use the existing built-page browser suite instead.
test('GLP-200 home header CTA keeps 4.5 contrast in every interaction state', async ({ page, context, baseURL, isMobile }, testInfo) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    return url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !/^\/(go|api)\//.test(url.pathname)
      ? route.continue() : route.abort('blockedbyclient');
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (isMobile) await page.locator('[data-menu-toggle]').filter({ visible: true }).click();
  const cta = page.locator(isMobile ? '.cs-drawer' : '.gcs-nav')
    .getByRole('link', { name: 'Find your fit', exact: true });
  await expect(cta).toBeVisible();
  await page.mouse.move(0, 0);
  await expect.poll(() => cta.evaluate(el => el.matches(':hover, :focus-visible, :active'))).toBe(false);
  await contrast(cta, 'default', testInfo);
  await cta.hover();
  await expect.poll(() => cta.evaluate(el => el.matches(':hover'))).toBe(true);
  await contrast(cta, 'hover', testInfo);
  await page.mouse.move(0, 0);
  for (let tabs = 0; tabs < 60 && !(await cta.evaluate(el => el === document.activeElement)); tabs++) {
    await page.keyboard.press('Tab');
  }
  await expect(cta).toBeFocused();
  await expect.poll(() => cta.evaluate(el => el.matches(':focus-visible'))).toBe(true);
  await contrast(cta, 'focus-visible', testInfo);
  await page.keyboard.press('Tab');
  await cta.hover();
  await page.mouse.down();
  try {
    // Mouse press intentionally exercises :active even in a mobile viewport;
    // emulated held touch does not reliably activate that pseudo class.
    await expect.poll(() => cta.evaluate(el => el.matches(':active'))).toBe(true);
    await contrast(cta, 'active', testInfo);
  } finally {
    await page.mouse.move(0, 0);
    await page.mouse.up(); // release off-link: no navigation or form submission
  }
});
