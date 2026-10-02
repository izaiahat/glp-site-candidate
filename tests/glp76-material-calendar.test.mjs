import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaterialDate } from '../scripts/postbuild-aeo-surface.mjs';

// GLP76 accepted review counterexample (GLP325 is a parked discovery alias):
// reports/ops/glp76-updater-date-fix-20260926/PRO-RECONCILED-REVIEW.json
// Exercise the maintained producer, not glp76-material-date-resolver.cjs.
test('GLP76 material dates reject impossible calendar days without changing valid-date ownership', () => {
  const route = '/guides/found-vs-trimi-insurance-self-pay/';
  const baseline = { lastmod: '2026-07-23', action: 'catalog_owned_editorial_date' };
  const release = '2026-09-26';
  const resolve = (materialDate, resolved = baseline) =>
    resolveMaterialDate(route, materialDate, resolved, release);
  const error = { message: `lastmod_material_date_future_or_invalid:${route}` };

  assert.throws(() => resolve('2026-08-32'), error);
  // Date.parse normalizes non-leap February 29; an invalid month yields NaN.
  assert.throws(() => resolve('2026-02-29'), error);
  assert.throws(() => resolve('2026-00-01'), error);
  assert.throws(() => resolve('invalid'), error);
  assert.throws(() => resolve('2026-09-27'), error);
  assert.deepEqual(resolve('2026-09-09'), {
    lastmod: '2026-09-09', action: 'declared_material_page_edit',
  });
  assert.deepEqual(resolve('2024-02-29', { lastmod: '2024-02-28' }), {
    lastmod: '2024-02-29', action: 'declared_material_page_edit',
  });
  assert.strictEqual(resolve(undefined), baseline);
  const newer = { lastmod: '2026-09-10', action: 'catalog_owned_editorial_date' };
  assert.strictEqual(resolve('2026-09-09', newer), newer);
  assert.deepEqual(baseline, { lastmod: '2026-07-23', action: 'catalog_owned_editorial_date' });
});
