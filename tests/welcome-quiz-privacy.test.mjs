import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const runtime = readFileSync(new URL('../assets/site.js', import.meta.url), 'utf8');
const welcome = runtime.slice(runtime.indexOf('/* ---- W6 /'), runtime.indexOf('/* ---- W7 /'));
const cleanup = runtime.slice(runtime.indexOf('/* Legacy quiz answers'), runtime.indexOf('/* ---- W9 /'));

test('returning welcome never consumes legacy quiz data and clears it from both stores', async () => {
  const dom = new JSDOM('<!doctype html><title>Providers</title><body></body>', {
    url: 'https://glpclinicscout.com/providers/', runScripts: 'outside-only',
  });
  const errors = [];
  dom.virtualConsole.on('jsdomError', error => errors.push(error.message));
  const { window } = dom;
  // JSDOM has no resize/layout engine. This storage-only fixture has no
  // consent banner; native clearance behavior is covered by the browser test.
  window.ResizeObserver = class {
    observe() { assert.fail('this fixture must not observe a consent banner'); }
    disconnect() {}
  };
  const keys = ['gcs.quiz.provider-fit.preferences.v1', 'gcs.quiz.provider-fit.progress.v1'];
  try {
    window.localStorage.setItem('gcs.visit.v1', JSON.stringify({ lastPath: '/providers/', lastSeenAt: Date.now() - 60000 }));
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (const key of keys) store.setItem(key, JSON.stringify({ schema: 'gcs-quiz-provider-fit-progress-v1', completed: true }));
    }
    const reads = [];
    const getItem = window.Storage.prototype.getItem;
    window.Storage.prototype.getItem = function (key) { reads.push(key); return getItem.call(this, key); };
    window.eval(welcome);
    window.eval(cleanup);
    assert.deepEqual(reads.filter(key => keys.includes(key)), [], 'welcome must not read quiz answers or derived completion');
    assert.equal(window.document.querySelector('.cs-welcome-toast p')?.textContent, 'Welcome back. Pick up where you left off.');
    assert.equal(window.document.querySelector('.cs-welcome-toast a'), null);
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (const key of keys) assert.equal(store.getItem(key), null, key);
    }
  } finally {
    window.document.querySelector('.cs-welcome-toast button[aria-label="Dismiss welcome message"]')?.click();
    window.close();
    await Promise.resolve();
    assert.deepEqual(errors, [], 'welcome must not leave observer errors during fixture teardown');
  }
});
