import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

test('enhanced listing state control replaces its native fallback; no-JS keeps it', async () => {
  const browser = await chromium.launch();
  const css = fs.readFileSync(new URL('../../assets/css-src/11-phase3.css', import.meta.url), 'utf8');
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      for (const javaScriptEnabled of [true, false]) {
        const context = await browser.newContext({ viewport, javaScriptEnabled });
        try {
          const page = await context.newPage();
          await page.setContent(`<style>${css}</style><main class="p3-page listing" data-listing-archetype="A"><div data-provider-filters${javaScriptEnabled ? ' data-filter-state-ready="true"' : ''}><div class="p3-state-control"><button data-state-open>Choose state</button><label class="p3-state-native"><select data-state-native aria-label="Choose state"><option>Oregon</option></select></label></div></div></main>`);
          assert.equal(await page.locator('[data-state-native]').isVisible(), !javaScriptEnabled);
          assert.equal(await page.locator('[data-state-open]').isVisible(), true);
          assert.equal(await page.locator('[data-state-native] option').count(), 1);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
});
