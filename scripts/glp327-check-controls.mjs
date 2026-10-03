// Focused native interaction proof for the sponsor composition, not a broad suite.
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const hash = b => createHash('sha256').update(b).digest('hex');
export async function checkControls({ page, browser, width, height, name, surface, origin, out, root, axe }) {
  const interactions = { status: 'PASS', assertions: [] }, expandedImages = [];
  const prove = text => interactions.assertions.push(text);
  const capture = async suffix => {
    const path = resolve(out, `${surface.key}-${name}-${suffix}.png`);
    const bytes = await page.screenshot({ path });
    expandedImages.push({ path: path.replace(root + sep, ''), sha256: hash(bytes) });
  };
  try {
    if (surface.key === 'providers-sponsored-panel') {
      const details = page.locator('[data-sponsor-preview-more-filters]'), summary = details.locator('summary');
      await page.evaluate(() => scrollTo(0, 0));
      await summary.focus(); await page.keyboard.press('Enter');
      assert.equal(await details.evaluate(e => e.open), true);
      const native = details.locator('[data-state-native]');
      assert.equal(await native.isVisible(), true);
      assert.equal(await native.locator('option').count(), 52);
      assert.equal(await page.locator('[data-state-open], [data-state-select]').count(), 0);
      prove('Keyboard opens native Filters; exactly one selector, all 51 states/DC + placeholder');
      await native.selectOption('OR');
      assert.equal(new URL(page.url()).searchParams.get('state'), 'OR');
      assert.match(await page.locator('h1').innerText(), /Oregon/);
      await details.locator('[data-provider-search-reset]').click();
      assert.equal(await native.inputValue(), '');
      prove('Native state updates URL/heading; Reset clears state');
      const group = details.locator('[data-filter-group="treatment"]'), tabs = group.locator('button[data-filter]');
      await tabs.first().focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await tabs.nth(1).evaluate(e => e === document.activeElement), true);
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
      await details.locator('[data-provider-search-reset]').click();
      const input = page.locator('#p3-provider-search');
      await input.fill('Snag'); await input.press('ArrowDown'); await input.press('Enter');
      assert.equal(new URL(page.url()).searchParams.get('provider'), 'SnagRX');
      await details.locator('[data-provider-search-reset]').click();
      assert.equal(await input.inputValue(), '');
      prove('Arrow-key tabs; autocomplete Enter commits provider; Reset clears search');
      if (name === 'mobile') {
        const small = await details.locator('button[data-filter], [data-provider-search-reset], select').evaluateAll(es => es.filter(e => !e.hidden && (e.getBoundingClientRect().width < 44 || e.getBoundingClientRect().height < 44)).map(e => e.textContent.trim()));
        assert.deepEqual(small, []); prove('Expanded mobile controls have >=44px touch targets');
      }
      await page.evaluate(() => scrollTo(0, 0)); await capture('filters-expanded');
      await page.addScriptTag({ content: axe.source });
      const findings = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id));
      assert.deepEqual(findings, []);
      prove('Expanded controls pass serious/critical axe');
      if (name === 'mobile') { await summary.tap(); await summary.tap(); prove('Touch opens/closes native Filters'); }
      await summary.focus(); await page.keyboard.press('Enter');
      assert.equal(await details.evaluate(e => e.open), false);
      assert.ok(await page.locator('[data-sponsor-preview-filters]').evaluate(e => e.getBoundingClientRect().height <= 64));
      prove('Closing restores a single row, <=64px');
      if (name === 'mobile') {
        const menu = page.locator('.cs-menu-toggle'); await menu.tap();
        assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#cs-drawer').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        prove('Directory navigation drawer works by touch and closes with Escape');
      }
      await checkNoJs({ browser, origin, surface, width, height, name, out, root, expandedImages });
      prove('No-JS native details/selector/options and all organic cards remain accessible');
    } else if (surface.key === 'rate-card') {
      const audience = page.locator('[data-sponsor-audience]');
      await audience.locator('summary').scrollIntoViewIfNeeded();
      assert.equal(await audience.evaluate(e => e.open), true);
      await capture('audience-expanded');
      prove('Full audience/reporting/privacy note is readable below the offer');
    }
  } catch (e) { interactions.status = 'FAIL'; interactions.error = String(e); }
  return { interactions, expandedImages };
}
async function checkNoJs({ browser, origin, surface, width, height, name, out, root, expandedImages }) {
  const ctx = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    await ctx.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const p = await ctx.newPage(); await p.goto(origin + surface.route);
    const details = p.locator('[data-sponsor-preview-more-filters]');
    await details.locator('summary').click();
    assert.equal(await details.evaluate(e => e.open), true);
    assert.equal(await details.locator('[data-state-native]').isVisible(), true);
    assert.equal(await details.locator('[data-state-native] option').count(), 52);
    assert.ok(await p.locator('[data-phase3-provider-grid] > [data-phase3-provider]').count() >= 40);
    assert.ok(await p.locator('[data-provider-search-reset]').isVisible());
    await p.evaluate(() => scrollTo(0, 0));
    const path = resolve(out, `${surface.key}-${name}-filters-nojs.png`);
    const bytes = await p.screenshot({ path });
    expandedImages.push({ path: path.replace(root + sep, ''), sha256: hash(bytes) });
  } finally { await ctx.close(); }
}
