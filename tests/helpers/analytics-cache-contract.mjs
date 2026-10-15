import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Expected-side cache oracle, independent of the build's filename/report.
// A mutable alias must not retain a superseded consent/analytics runtime.
export function assertCurrentAnalyticsCache(headers, source, alias, versioned) {
  assert.ok(Buffer.isBuffer(source) && source.length > 0, 'native analytics source required');
  assert.deepEqual(alias, source, 'bare analytics bytes drifted from maintained source');
  assert.deepEqual(versioned, source, 'content-addressed analytics bytes drifted from maintained source');
  const filename = `analytics.${createHash('sha256').update(source).digest('hex').slice(0, 16)}.js`;
  const currentUrl = `/assets/${filename}`;
  const routes = headers.split(/\r?\n/).filter(line => line.startsWith('/assets/analytics'));
  assert.deepEqual(routes.sort(), ['/assets/analytics.js', currentUrl].sort(), 'exact analytics cache routes; no missing, stale, duplicate or wildcard rule');
  const block = route => headers.split(`${route}\n`)[1]?.split(/\n(?=\/|#)/)[0].trim();
  assert.equal(block('/assets/analytics.js'), 'Cache-Control: no-store', 'mutable analytics alias must never be immutable');
  assert.equal(block(currentUrl), 'Cache-Control: public, max-age=31536000, immutable', 'only source-addressed analytics is immutable');
}
