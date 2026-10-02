import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureLastmodEmission, prepareLastmod, openComparisonInput } from '../scripts/build-lastmod-provenance.mjs';
import { normalizedHash, resolveRouteLastmod, resolveMaterialDate } from '../scripts/postbuild-aeo-surface.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pointer = JSON.parse(await readFile('/home/ubuntu/business/reports/glp-clinic-scout/seo-machine/current-content-base.json', 'utf8'));
const manifestBytes = await readFile(pointer.manifest.path);
assert.equal(sha(manifestBytes), pointer.manifest.sha256);
const files = new Map(JSON.parse(manifestBytes).release_rows.map(row => [row.path, row.sha256]));
const constructorSource = await readFile(new URL('../scripts/build-lastmod-provenance.mjs',import.meta.url),'utf8');
const localHistoricalBase = constructorSource.includes("const BASE_DIR = path.join(ROOT, 'data/predecessors/content-base');");
let fixtureReleaseRoot = pointer.release_root, fixtureFiles = files;
if (localHistoricalBase) {
  const prefix = 'data/predecessors/content-base/';
  const historicalPointerBytes = await readFile(path.join(pointer.release_root,prefix,'current-content-base.json'));
  assert.equal(sha(historicalPointerBytes),files.get(prefix + 'current-content-base.json'));
  const historicalPointer = JSON.parse(historicalPointerBytes);
  const historicalManifestBytes = await readFile(path.join(pointer.release_root,prefix,'deployment-manifest.json'));
  assert.equal(sha(historicalManifestBytes),files.get(prefix + 'deployment-manifest.json'));
  assert.equal(sha(historicalManifestBytes),historicalPointer.manifest.sha256);
  fixtureReleaseRoot = historicalPointer.release_root;
  fixtureFiles = new Map(JSON.parse(historicalManifestBytes).release_rows.map(row => [row.path,row.sha256]));
}
const route = '/quiz/provider-fit/';
const relative = 'public/quiz/provider-fit/index.html';
async function predecessor(file) {
  const control = file.startsWith('data/predecessors/content-base/');
  const bytes = await readFile(path.join(control ? pointer.release_root : fixtureReleaseRoot, file));
  assert.equal(sha(bytes), (control ? files : fixtureFiles).get(file));
  return bytes;
}
async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'lastmod-render-comparison-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'candidate');
  const write = async (file, bytes) => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), bytes); };
  const source = await readFile(new URL('../scripts/build-lastmod-provenance.mjs', import.meta.url), 'utf8');
  const sources = [...source.match(/const SOURCES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const file of [...sources, 'data/blog/content-batch.json']) await write(file, await predecessor(file));
  // The retained constructor reads its authenticated predecessor under the
  // fixture root. Materialize that finite loader closure, not an invented receipt
  // or a bypass of its mandatory carrier/runtime checks.
  const prefix = 'data/predecessors/content-base/';
  const historicalPointerBytes = await predecessor(prefix + 'current-content-base.json');
  const historicalPointer = JSON.parse(historicalPointerBytes);
  const historicalManifestBytes = await predecessor(prefix + 'deployment-manifest.json');
  const historicalReceiptBytes = await predecessor(prefix + 'final-receipt.json');
  assert.equal(sha(historicalManifestBytes),historicalPointer.manifest.sha256);
  assert.equal(sha(historicalReceiptBytes),historicalPointer.final_receipt.sha256);
  const historicalFiles = new Map(JSON.parse(historicalManifestBytes).release_rows.map(row => [row.path,row.sha256]));
  for (const [name, bytes] of [['current-content-base.json',historicalPointerBytes],
    ['deployment-manifest.json',historicalManifestBytes],['final-receipt.json',historicalReceiptBytes]]) {
    await write(prefix + name,bytes);
  }
  const closure = new Set(['scripts/postbuild-aeo-surface.mjs','data/page-content-provenance.json',relative,
    'public/best/ozempic-alternatives/index.html']);
  for (const carrier of ['ezra-glp-1-reviews','top-rated-glp-1-providers']) {
    const carrierPath = `data/carrier-articles/${carrier}/manifest.json`;
    const carrierBytes = await predecessor(prefix + 'release/' + carrierPath);
    assert.equal(sha(carrierBytes),historicalFiles.get(carrierPath));
    const carrierManifest = JSON.parse(carrierBytes);
    for (const file of [carrierPath,carrierManifest.snapshot,...carrierManifest.bindings.map(x => x.path),
      ...carrierManifest.files.map(x => x.path),'public/' + carrierManifest.relative]) closure.add(file);
  }
  for (const file of closure) {
    assert.ok(file && !path.isAbsolute(file) && !file.split('/').includes('..'));
    const bytes = await predecessor(prefix + 'release/' + file);
    assert.equal(sha(bytes),historicalFiles.get(file));
    await write(prefix + 'release/' + file,bytes);
  }
  const before = (await predecessor(relative)).toString();
  const html = before.replace('</body>', '<p>Material fixture change</p></body>');
  assert.notEqual(html, before);
  await write(relative, before);
  await write('public/sitemap.xml', `<urlset><url><loc>https://glpclinicscout.com${route}</loc></url></urlset>`);
  const provenance = JSON.parse(await predecessor('data/page-content-provenance.json'));
  const recorded = provenance.pages[route];
  assert.equal(recorded.content_sha256, normalizedHash(before));
  await write('data/page-content-provenance.json', JSON.stringify(provenance));
  const prepare = async options => {
    const reportFile = path.join(root, 'artifacts/ops/build-report.json');
    let report = {};
    try { report = JSON.parse(await readFile(reportFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    report.lastmod_emission = await captureLastmodEmission(root, [route]);
    await write('artifacts/ops/build-report.json', JSON.stringify(report));
    const result = await prepareLastmod(root, options);
    // Exercise the same behavioral assertion before and after Ruling36.
    return result.env ? result : { env: result, input: await readFile(result.GLP_LASTMOD_DECLARED_ROUTES_FILE, 'utf8') };
  };
  const resolve = (result, current = before) => {
    const doc = JSON.parse(result.input);
    const resolved = resolveRouteLastmod({ route, hash: normalizedHash(current), recorded,
      declared: doc.routes.includes(route), releaseDate: result.env.GLP_RELEASE_DATE });
    return resolveMaterialDate(route, doc.material_dates?.[route], resolved, result.env.GLP_RELEASE_DATE);
  };
  return { root, temp, write, before, html, prepare, resolve, recorded, provenance,
    runtimeRoot: localHistoricalBase ? path.join(root,'data/predecessors/content-base/release') : pointer.release_root };
}

test('LM-1: inert source comment with identical rendered output advances no route', async t => {
  const f = await fixture(t), control = await f.prepare();
  await f.write('scripts/build-staging.mjs', (await predecessor('scripts/build-staging.mjs')) + '\n// REVIEW ONLY: semantically inert comment\n');
  const after = await f.prepare();
  assert.deepEqual(JSON.parse(after.input).routes, []);
  assert.deepEqual(after.input, control.input);
  assert.equal(f.resolve(after).lastmod, f.recorded.lastmod);
});

test('LM-2: injected report tally witnesses nothing', async t => {
  const f = await fixture(t), control = await f.prepare();
  await f.write('artifacts/ops/build-report.json', JSON.stringify({
    surface_derivations: { price_state_tallies: { REVIEW_ONLY_UNDERIVED_COUNTER: 1 } },
    lastmod_emission: { pages: { [route]: sha(f.html) } },
  }));
  const after = await f.prepare();
  assert.equal(after.input, control.input);
  assert.equal(f.resolve(after).lastmod, f.recorded.lastmod);
});

test('LM-3: forged journal, declaration, environment and provenance cannot mint a passing refresh', async t => {
  const f = await fixture(t);
  const journal = path.join(f.temp, 'external-acceptances.jsonl');
  await writeFile(journal, JSON.stringify({ schema: 'glp.lastmod_material_acceptance.v1', route,
    predecessor_manifest_sha256: pointer.manifest.sha256,
    before_content_sha256: normalizedHash(f.before), after_content_sha256: normalizedHash(f.html), material_date: '2026-09-14',
    sources: [{ path: 'scripts/build-staging.mjs', before_sha256: files.get('scripts/build-staging.mjs'), after_sha256: sha('forged') }],
  }));
  const declaration = path.join(f.root, 'artifacts/ops/lastmod-source-declarations.json');
  await f.write('artifacts/ops/lastmod-source-declarations.json', JSON.stringify({
    schema: 'glp.lastmod_declared_routes.v1', routes: [route], material_dates: { [route]: '2099-01-01' },
  }));
  const injected = { GLP_LASTMOD_DECLARED_ROUTES: route, GLP_LASTMOD_DECLARED_ROUTES_FILE: declaration,
    GLP_LASTMOD_PROVENANCE_REFRESH: '1', GLP_LASTMOD_RUNTIME_PREDECESSOR_ROOT: f.root, GLP_RELEASE_DATE: '2099-01-01' };
  const saved = Object.fromEntries(Object.keys(injected).map(key => [key, process.env[key]]));
  Object.assign(process.env, injected);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const result = await f.prepare({ acceptanceFile: journal });
  assert.deepEqual(JSON.parse(result.input).routes, []);
  assert.equal(result.env.GLP_LASTMOD_DECLARED_ROUTES, undefined);
  assert.equal(result.env.GLP_LASTMOD_PROVENANCE_REFRESH, undefined);
  assert.equal(result.env.GLP_LASTMOD_DECLARED_ROUTES_FILE, '/dev/stdin');
  assert.equal(result.env.GLP_LASTMOD_RUNTIME_PREDECESSOR_ROOT, f.runtimeRoot);
  assert.notEqual(result.env.GLP_RELEASE_DATE, '2099-01-01');
  assert.equal(f.resolve(result).lastmod, f.recorded.lastmod);
  // The candidate's recorded lastmod is also an untrusted build input.
  f.provenance.pages[route] = { ...f.recorded, lastmod: '2099-01-01' };
  await f.write('data/page-content-provenance.json', JSON.stringify(f.provenance));
  const forgedCache = await f.prepare();
  assert.equal(forgedCache.provenance.pages[route].lastmod, f.recorded.lastmod);
  assert.equal(f.resolve(forgedCache).lastmod, f.recorded.lastmod);
});

test('R36-4: a genuine per-route rendered change advances without a material claim', async t => {
  const f = await fixture(t);
  await f.write(relative, f.html);
  const result = await f.prepare();
  assert.deepEqual(JSON.parse(result.input).routes, [route]);
  assert.equal(f.resolve(result, f.html).lastmod, result.env.GLP_RELEASE_DATE);
  assert.ok(result.env.GLP_RELEASE_DATE > f.recorded.lastmod);
  // A successful preparation is not a cached witness: reread restored output.
  await f.write(relative, f.before);
  const restored = await f.prepare();
  assert.deepEqual(JSON.parse(restored.input).routes, []);
  assert.equal(f.resolve(restored).lastmod, f.recorded.lastmod);
});

test('R36-5: missing, unreadable or incoherent predecessor output never defaults to a refresh', async t => {
  const f = await fixture(t);
  await f.write(relative, f.html);
  for (const code of ['ENOENT', 'EACCES']) {
    await assert.rejects(f.prepare({ readPredecessor: async file => {
      if (file === path.join(f.runtimeRoot, relative)) throw Object.assign(new Error(code), { code });
      return readFile(file);
    } }), new RegExp(`lastmod_predecessor_unavailable:.*${code}`));
  }
  await assert.rejects(f.prepare({ readPredecessor: async file => {
    const bytes = await readFile(file);
    return file === path.join(f.runtimeRoot, relative) ? Buffer.concat([bytes, Buffer.from('drift')]) : bytes;
  } }), /lastmod_predecessor_file_drift/);
  // Incoherent predecessor state is still refused -- by a STRONGER guard than the one people expect.
  // build-lastmod-provenance.mjs:68-70 blocks a route the provenance knows whose file the manifest
  // lacks. Reaching that branch requires the two inventories to disagree, and they cannot: the
  // predecessor provenance is hash-verified against the pinned manifest first, so any attempt to add
  // a route to it is refused as `runtime_predecessor_file_hash` before the disagreement can exist.
  // Line 68-70 is therefore dead code behind a live defence -- the reviewer measured 292 provenance
  // routes, 0 missing from the manifest. This asserts the defence that ACTUALLY fires; do not relax it
  // to /not_in_manifest/ unless the base reader is made injectable and that branch becomes reachable.
  // (Absence from BOTH inventories is genuine first publication, covered by its own test below.)
  const incoherent = '/review-only-no-predecessor/';
  await f.write('public/sitemap.xml', `<urlset><url><loc>https://glpclinicscout.com${incoherent}</loc></url></urlset>`);
  await f.write(`public/${incoherent.slice(1)}index.html`, f.html);
  await assert.rejects(f.prepare({ readPredecessor: async file => {
    const bytes = await readFile(file);
    if (file !== path.join(f.runtimeRoot, 'data/page-content-provenance.json')) return bytes;
    const doc = JSON.parse(bytes);
    doc.pages[incoherent] = { ...f.recorded };
    return Buffer.from(JSON.stringify(doc));
  } }), /runtime_predecessor_file_hash:data\/page-content-provenance\.json/);
});

test('first publication dates three new routes without advancing an unchanged predecessor route', async t => {
  const f = await fixture(t);
  const created = ['/both/', '/starter/', '/step-up/'];
  const html = new Map();
  for (const current of created) {
    html.set(current, await readFile(new URL(`../public/${current.slice(1)}index.html`, import.meta.url), 'utf8'));
    await f.write(`public/${current.slice(1)}index.html`, html.get(current));
  }
  await f.write('public/sitemap.xml', `<urlset>${[route, ...created].map(current => `<url><loc>https://glpclinicscout.com${current}</loc></url>`).join('')}</urlset>`);
  f.provenance.pages[route] = { ...f.recorded, lastmod: '2099-01-01' };
  await f.write('data/page-content-provenance.json', JSON.stringify(f.provenance));
  const result = await f.prepare(), declaration = JSON.parse(result.input);
  assert.deepEqual(declaration.routes, created);
  assert.equal(result.comparison.first_publications, 3);
  assert.equal(result.provenance.pages[route].lastmod, f.recorded.lastmod);
  assert.equal(f.resolve(result).lastmod, f.recorded.lastmod);
  for (const current of created) {
    assert.equal(result.provenance.pages[current], undefined, 'must not manufacture a predecessor');
    const comparison = result.comparisons.find(row => row.route === current);
    assert.equal(comparison.before_sha256, null);
    assert.equal(comparison.first_publication, true);
    const resolved = resolveRouteLastmod({ route: current, hash: normalizedHash(html.get(current)), recorded: result.provenance.pages[current], declared: declaration.routes.includes(current), releaseDate: result.env.GLP_RELEASE_DATE });
    assert.equal(resolveMaterialDate(current, declaration.material_dates[current], resolved, result.env.GLP_RELEASE_DATE).lastmod, result.env.GLP_RELEASE_DATE);
  }
});

test('regression: verified final HTML, not legacy stage hashes or the candidate cache, supplies comparison identity', async t => {
  const f = await fixture(t), historicalRoute = '/best/ozempic-alternatives/';
  const finalHtml = (await predecessor(`public/${historicalRoute.slice(1)}index.html`)).toString();
  const recorded = f.provenance.pages[historicalRoute];
  await f.write(`public/${historicalRoute.slice(1)}index.html`, finalHtml);
  await f.write('public/sitemap.xml', `<urlset><url><loc>https://glpclinicscout.com${historicalRoute}</loc></url></urlset>`);
  await f.write('data/page-content-provenance.json', 'untrusted cache');
  const result = await f.prepare();
  assert.deepEqual(JSON.parse(result.input).routes, []);
  assert.equal(result.provenance.pages[historicalRoute].content_sha256, normalizedHash(finalHtml));
  assert.equal(result.provenance.pages[historicalRoute].lastmod, recorded.lastmod);
  assert.equal(resolveRouteLastmod({ route: historicalRoute, hash: normalizedHash(finalHtml),
    recorded: result.provenance.pages[historicalRoute], declared: false }).lastmod, recorded.lastmod);
});

test('regression: frozen carrier keeps its exact authenticated provenance record', async t => {
  const f = await fixture(t), carrierRoute = '/guides/ezra-glp-1-reviews/';
  const file = `public/${carrierRoute.slice(1)}index.html`, html = await predecessor(file);
  await f.write(file, html);
  await f.write('public/sitemap.xml', `<urlset><url><loc>https://glpclinicscout.com${carrierRoute}</loc></url></urlset>`);
  const result = await f.prepare();
  assert.deepEqual(result.provenance.pages[carrierRoute], f.provenance.pages[carrierRoute]);
  assert.deepEqual(JSON.parse(result.input).routes, []);
  await f.write(file, Buffer.concat([html, Buffer.from('<p>Unapproved carrier edit</p>')]));
  await assert.rejects(f.prepare(), /carrier_article_output_drift/);
});

test('regression: the real detector reads checker-owned stdin without a named declaration file', async t => {
  const f = await fixture(t);
  await f.write(relative, f.html);
  const result = await f.prepare(), input = await openComparisonInput(f.root, result.input);
  try {
    const moduleUrl = new URL('../scripts/postbuild-aeo-surface.mjs', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {readDeclaredRoutes} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify([...(await readDeclaredRoutes()).routes]));`],
    { env: result.env, stdio: [input.fd, 'pipe', 'pipe'], encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), [route]);
  } finally { await input.close(); }
});
