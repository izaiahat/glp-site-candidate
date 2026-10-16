import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyWave2P1Surfaces } from '../src/wave2-p1-surfaces.mjs';
import { CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES } from '../src/site-capture-consent-sources.mjs';
import graph from '../data/phase3-page-graph.json' with { type: 'json' };

const frame = route => `<!doctype html><html><head><link rel="canonical" href="https://glpclinicscout.com${route}"></head><body><main><h1>Placeholder</h1><p>Retained source.</p></main></body></html>`;
const extras = ['feelgood-review', 'instarx-review', 'ivim-health-review', 'retaclinic-review', 'rightwell-review', 'tyde-wellness-review', 'willow-review'];
const routes = extras.flatMap(id => [`/providers/${id}/`, `/reviews/${id}/`]).concat(['/sponsors/example-provider/', '/sponsors/rates/']);

test('GLP361 all sixteen unapproved marketing emitters are suppressed at the maintained finalizer without adding subscription grants', () => {
  assert.equal(routes.length, 16);
  const before = [...CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES];
  for (const route of routes) {
    const html = frame(route);
    const out = applyWave2P1Surfaces(html, route.slice(1) + 'index.html');
    assert.doesNotMatch(out, /\/api\/content-upgrade|name="email"|occasional provider-comparison/);
    assert.ok(out.includes('<p>Retained source.</p>'));
    // Synthetic carried-forward P1 transport; not a native or historic capture.
    const oldForm = '<aside data-p1-capture-surface><form action="/api/content-upgrade"><input name="email"></form></aside><script data-p1-content-upgrade>void 0</script><script src="/assets/content-capture-resilient.js" data-p1-capture-resilience></script>';
    const carried = html.replace('</main>', oldForm + '</main>');
    assert.equal(applyWave2P1Surfaces(carried), out);
    assert.equal(applyWave2P1Surfaces(out), out);
    const slug = route.split('/').filter(Boolean).join('-');
    assert.equal(CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES.includes(`${slug}:${slug}-terms-checklist`), false);
  }
  assert.deepEqual(CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES, before);
});

test('GLP361 approved marketing, staged provider work and neutral guide delivery remain distinct; unknown non-owned forms refuse reconciliation', () => {
  for (const route of ['/providers/', '/reviews/gobymeds/', ...graph.provider_work_order_additions.map(x => `/providers/${x.program_id}/`)]) {
    assert.match(applyWave2P1Surfaces(frame(route)), /data-p1-capture-surface/);
  }
  const guide = applyWave2P1Surfaces(frame('/guides/is-valhalla-vitality-legit/'));
  assert.match(guide, /value="guide-link-resource"/);
  assert.doesNotMatch(guide, /occasional provider-comparison/);
  const unknown = frame('/sponsors/rates/').replace('</main>', '<form action="/api/content-upgrade"><input name="email"></form></main>');
  assert.throws(() => applyWave2P1Surfaces(unknown), /unapproved_terms_capture_requires_reconciliation/);
  for (const route of ['/providers/new-unapproved/', '/reviews/new-unapproved/', '/sponsors/new-unapproved/']) {
    assert.doesNotMatch(applyWave2P1Surfaces(frame(route)), /\/api\/content-upgrade/);
  }
});
