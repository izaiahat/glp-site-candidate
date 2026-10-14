import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Execute only the maintained setup with recording filesystem operations.
// No tree is copied, carrier snapshot rendered, postbuild stage or clock invoked.
const source = readFileSync(new URL('./lastmod-declared-routes.test.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  const work =', source.indexOf('async function fixture()'));
const end = source.indexOf('  for (const article of loadCarrierArticles(ROOT).values())', start);
assert.ok(start > 0 && end > start, 'maintained fixture dependency setup must exist');
const setup = new Function('ROOT', 'path', 'mkdir', 'mkdtemp', 'cp',
  'return (async () => {' + source.slice(start, end) + '\nreturn root; })();');
const analytics = readFileSync(new URL('../assets/analytics.js', import.meta.url));

test('lastmod fixture supplies exact raw analytics to its copied carrier renderer', async () => {
  for (const checkout of ['/source/site', '/relocated/source with spaces']) {
    const fixture = path.join(checkout, 'artifacts/test-work/aeo-declared-recording');
    const calls = [];
    const copies = new Map();
    const root = await setup(checkout, path,
      async (...args) => { calls.push(['mkdir', ...args]); },
      async prefix => { assert.equal(prefix, path.join(checkout, 'artifacts/test-work/aeo-declared-')); return fixture; },
      async (from, to, options) => {
        calls.push(['cp', from, to, options]);
        // Recording only: exact source bytes, never a synthetic analytics asset.
        if (from === path.join(checkout, 'assets/analytics.js')) copies.set(to, analytics);
      });
    assert.equal(root, fixture);
    assert.deepEqual(copies.get(path.join(root, 'assets/analytics.js')), analytics,
      'copied carrier renderer would encounter ENOENT without its raw analytics dependency');
    const assetCopies = calls.filter(([name, from]) => name === 'cp' && from.startsWith(path.join(checkout, 'assets') + '/'));
    assert.deepEqual(assetCopies, [['cp', path.join(checkout, 'assets/analytics.js'), path.join(root, 'assets/analytics.js'), undefined]],
      'only the exact required raw asset is copied; no generated public assets or broad asset tree');
    const mkdirIndex = calls.findIndex(([name, dir, options]) => name === 'mkdir' && dir === path.join(root, 'assets') && options?.recursive === true);
    const copyIndex = calls.indexOf(assetCopies[0]);
    assert.ok(mkdirIndex >= 0 && mkdirIndex < copyIndex, 'dependency parent exists before copy');
    const publicCopy = calls.find(([name, from]) => name === 'cp' && from === path.join(checkout, 'public'));
    assert.equal(publicCopy[3].filter(path.join(checkout, 'public/assets/analytics.js')), false,
      'generated/public assets remain excluded from the fixture input');
    assert.equal(publicCopy[3].filter(path.join(checkout, 'public/how-we-rate/index.html')), true);
  }
});
