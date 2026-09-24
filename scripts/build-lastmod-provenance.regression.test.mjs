import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureLastmodEmission, prepareLastmod } from './build-lastmod-provenance.mjs';
import { normalizedHash, resolveRouteLastmod } from './postbuild-aeo-surface.mjs';

const pointer = JSON.parse(await readFile('/home/ubuntu/business/reports/glp-clinic-scout/seo-machine/current-content-base.json', 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(pointer.manifest.path);
assert.equal(sha(manifestBytes), pointer.manifest.sha256);
const files = new Map(JSON.parse(manifestBytes).release_rows.map(row => [row.path, row.sha256]));
const route = '/quiz/provider-fit/';
const relative = 'public/quiz/provider-fit/index.html';

async function predecessor(file) {
  const bytes = await readFile(path.join(pointer.release_root, file));
  assert.equal(sha(bytes), files.get(file), file);
  return bytes;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glp34-lastmod-regression-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await readFile(new URL('./build-lastmod-provenance.mjs', import.meta.url), 'utf8');
  const sources = [...source.match(/const SOURCES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const file of [...sources, 'data/blog/content-batch.json']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), await predecessor(file));
  }
  await mkdir(path.join(root, 'public/quiz/provider-fit'), { recursive: true });
  await mkdir(path.join(root, 'artifacts/ops'), { recursive: true });
  const previousHtml = (await predecessor(relative)).toString();
  const html = '<main>UNRELATED REGRESSION FIXTURE CONTENT</main><aside data-price-state-disclosure>Fixture coverage</aside>';
  await writeFile(path.join(root, relative), html);
  await writeFile(path.join(root, 'public/sitemap.xml'), `<urlset><url><loc>https://glpclinicscout.com${route}</loc></url></urlset>`);
  const baseline = JSON.parse((await predecessor('artifacts/ops/build-report.json')).toString());
  async function declarations(extraTallies = {}) {
    const build = {
      lastmod_emission: await captureLastmodEmission(root, [route]),
      surface_derivations: { price_state_tallies: { ...baseline.surface_derivations.price_state_tallies, ...extraTallies } },
    };
    await writeFile(path.join(root, 'artifacts/ops/build-report.json'), JSON.stringify(build));
    const inputs = await prepareLastmod(root);
    return JSON.parse(await readFile(inputs.GLP_LASTMOD_DECLARED_ROUTES_FILE, 'utf8'));
  }
  function refuses(document) {
    const declared = document.routes.includes(route);
    const base = { route, hash: normalizedHash(html), releaseDate: '2026-09-15', declared };
    assert.throws(() => resolveRouteLastmod({ ...base, recorded: { content_sha256: normalizedHash(previousHtml), lastmod: '2026-09-11' } }), /lastmod_provenance_stale/);
    assert.throws(() => resolveRouteLastmod({ ...base, recorded: null }), /lastmod_provenance_missing/);
  }
  return { root, declarations, refuses };
}

test('LM-1: an inert source comment cannot authorize stale or missing provenance', async t => {
  const f = await fixture(t);
  const control = await f.declarations();
  f.refuses(control);
  const source = path.join(f.root, 'scripts/build-staging.mjs');
  await writeFile(source, (await readFile(source, 'utf8')) + '\n// REVIEW ONLY: semantically inert fixture comment\n');
  const changed = await f.declarations();
  assert.deepEqual(changed.routes, control.routes);
  f.refuses(changed);
});

test('LM-2: a build-report-only tally cannot authorize stale or missing provenance', async t => {
  const f = await fixture(t);
  const control = await f.declarations();
  f.refuses(control);
  const changed = await f.declarations({ REVIEW_ONLY_UNDERIVED_COUNTER: 1 });
  assert.deepEqual(changed.routes, control.routes);
  f.refuses(changed);
});
