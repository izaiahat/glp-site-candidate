import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { assertCleanRoomBytes, acceptedCleanRoomCitation } from './helpers/clean-room-citation.mjs';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import vm from 'node:vm';
import { historical, predecessor } from './fixtures/clean-room-pre-accepted-guides.mjs';
import { loadAcceptedGuides } from '../src/accepted-guide-source.mjs';
import { renderBlogPost } from '../src/blog-system.mjs';
const root = process.cwd();
const relative = 'public/guides/is-valhalla-vitality-legit/index.html';
function nativePage() {
  const article = loadAcceptedGuides(root).find(a => a.canonical_path === '/guides/is-valhalla-vitality-legit/');
  const author = JSON.parse(readFileSync(path.join(root, 'data/blog/author-registry.json'))).authors.find(a => a.author_id === 'clinic-scout-editorial-team');
  return renderBlogPost(article, null, {...author, id: author.author_id}, []);
}
test('clean-room byte oracle accepts independently accepted external citations from the real native guide renderer', () => {
  const bytes = nativePage();
  assert.equal((bytes.match(/glpwinner/gi)||[]).length, 2);
  assertCleanRoomBytes(bytes, relative, root);
});

test('clean-room source citation classification refuses implementation markers, relocation, loss and authority drift', () => {
  const bytes = nativePage();
  const url = 'https://www.glpwinner.com/providers/valhalla-vitality';
  const replacements = [
    ['body text', '</main>', '<p>glpwinner implementation</p></main>'],
    ['HTML comment', '</head>', '<!-- glpwinner --></head>'],
    ['class', 'class="guide-shell"', 'class="glpwinner guide-shell"'],
    ['style', '</head>', '<style>.glpwinner{display:none}</style></head>'],
    ['executable script', '</head>', '<script>const glpwinner = 1;</script></head>'],
    ['remote script', '</head>', '<script src="https://www.glpwinner.com/app.js"></script></head>'],
    ['unapproved resource', '</head>', `<link rel="stylesheet" href="${url}"></head>`],
    ['unapproved anchor', '</main>', `<a href="${url}">another link</a></main>`],
    ['anchor event', `href="${url}"`, `onclick="alert(1)" href="${url}"`],
    ['tracking rel', 'rel="nofollow noopener" data-citation="guide_source_ledger">Open source</a><small>Checked 2026-09-02</small></li><li id="guide-source-7"', 'rel="sponsored nofollow noopener" data-citation="guide_source_ledger">Open source</a><small>Checked 2026-09-02</small></li><li id="guide-source-7"'],
    ['misclassified citation', `href="${url}" rel="nofollow noopener" data-citation="guide_source_ledger"`, `href="${url}" rel="nofollow noopener" data-citation="unapproved"`],
    ['row identity', 'id="guide-source-6"', 'id="guide-source-66"'],
    ['publisher identity', '<strong>GLP Winner</strong>', '<strong>Unreviewed Publisher</strong>'],
    ['schema route', '"url":"https://glpclinicscout.com/guides/is-valhalla-vitality-legit/"', '"url":"https://glpclinicscout.com/guides/other/"'],
    ['wrong URL', url, url + '?tracking=1'],
    ['citation moved to headline', '"headline":', '"implementation":"glpwinner","headline":'],
    ['citation array lost', '"citation":', '"implementation_sources":'],
    ['healthy unrelated citation lost', '"https://valhallavitality.com/services/glp-1",', ''],
    ['ledger source loss', `href="${url}"`, 'href="https://other.example/"'],
    ['duplicate ledger source', '<li id="guide-source-6">', '<li id="guide-source-6"></li><li id="guide-source-6">'],
  ];
  for (const [label, before, after] of replacements) {
    assert.ok(bytes.includes(before), `${label}: actual native mutation target`);
    const changed = bytes.replace(before, after);
    assert.notEqual(changed, bytes, label);
    assert.throws(() => assertCleanRoomBytes(changed, relative, root), undefined, label);
  }
  assert.throws(() => assertCleanRoomBytes(bytes.replaceAll(url, 'https://other.example/'), relative, root), undefined, 'complete cite loss is not a marker-free pass');
  for (const name of ['public/another/index.html', 'public/assets/app.js', 'public/assets/app.css'])
    assert.throws(() => assertCleanRoomBytes(bytes, name, root), assert.AssertionError, name);
  for (const name of ['article.json','qa.json','review.json']) {
    assert.throws(() => acceptedCleanRoomCitation(root, file => {
      const raw = readFileSync(file);
      return file.endsWith('/' + name) ? Buffer.concat([raw, Buffer.from('\n')]) : raw;
    }), assert.AssertionError, `original ${name} raw tampering cannot be blessed by a current manifest repin`);
  }
});

test('complete owning callback refuses a coherent manifest retarget with original authority bytes intact', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'clean-room-retarget-'));
  try {
    const route = '/guides/is-valhalla-vitality-legit/';
    const originalDir = 'data/blog/accepted-guides/is-valhalla-vitality-legit';
    const manifest = JSON.parse(readFileSync(path.join(root, 'data/blog/accepted-guides/manifest.json')));
    const dir = path.join(fixture, 'data/blog/accepted-guides');
    mkdirSync(dir, {recursive:true});
    for (const entry of manifest.entries) {
      for (const kind of ['article','qa','review']) {
        const name = entry[kind].path;
        mkdirSync(path.dirname(path.join(fixture, name)), {recursive:true});
        writeFileSync(path.join(fixture, name), readFileSync(path.join(root, name)));
      }
    }
    // Keep every independently pinned original untouched. Only synthetic copies
    // and the disposable manifest change; the native acceptance reader stays real.
    const originals = Object.fromEntries(['article','qa','review'].map(kind => [kind,
      readFileSync(path.join(root, originalDir, kind + '.json'))]));
    const article = JSON.parse(originals.article), qa = JSON.parse(originals.qa), review = JSON.parse(originals.review);
    const acceptedURLs = article.sources.map(s => s.url);
    article.sources[0].url = 'https://rv119.invalid/unapproved-source';
    const alternate = 'data/blog/accepted-guides/clean-room-synthetic-retarget';
    mkdirSync(path.join(fixture, alternate));
    const save = (kind, value) => {
      const raw = Buffer.from(JSON.stringify(value, null, 2) + '\n');
      const name = alternate + '/' + kind + '.json';
      writeFileSync(path.join(fixture, name), raw);
      return {path:name, sha256:createHash('sha256').update(raw).digest('hex')};
    };
    const entry = manifest.entries.find(e => e.route === route);
    entry.article = save('article', article);
    qa.artifacts['06-article.json'].sha256 = entry.article.sha256;
    entry.qa = save('qa', qa);
    entry.review = save('review', review);
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const selected = loadAcceptedGuides(fixture).find(a => a.canonical_path === route);
    assert.deepEqual(selected.sources, article.sources, 'real native reader accepts the coherent alternate roster');
    assert.notDeepEqual(selected.sources.map(s => s.url), acceptedURLs);
    for (const [kind, raw] of Object.entries(originals))
      assert.deepEqual(readFileSync(path.join(fixture, originalDir, kind + '.json')), raw, 'original ' + kind + ' bytes intact');
    const page = nativePage();
    const before = '"citation":' + JSON.stringify(acceptedURLs);
    const after = '"citation":' + JSON.stringify(selected.sources.map(s => s.url));
    assert.ok(page.includes(before));
    const substituted = page.replace(before, after);
    assert.notEqual(substituted, page);
    const source = readFileSync(path.join(root, 'tests/design-pass4-contract.test.mjs'), 'utf8');
    const prefix = 'test("every shipped HTML, CSS, and JS byte preserves the clean-room boundary", () => {';
    const start = source.indexOf(prefix), end = source.indexOf('\n});', start) + 4;
    assert.ok(start > 0 && end > start);
    const callback = source.slice(start, end);
    const execute = (bytes, targetRoot) => vm.runInNewContext(callback, {
      test:(_, fn) => fn(), assert, path, ROOT:targetRoot,
      readdirSync:() => [relative.slice('public/'.length)], statSync:() => ({isDirectory:() => false}),
      readFileSync:() => bytes, assertCleanRoomBytes,
    }, {timeout:2000});
    execute(page, root);
    assert.throws(() => execute(substituted, root), /complete independent citation roster/);
    assert.throws(() => execute(substituted, fixture), assert.AssertionError,
      'manifest re-target must not substitute authenticated authority');
  } finally {
    rmSync(fixture, {recursive:true, force:true});
  }
});

test('complete original clean-room callback remains byte-identical and strict on three authenticated predecessor HTML/CSS/JS representatives', () => {
  assert.equal(predecessor, '59adaddfa6800c3cd87592ad88829a081a35e3c3');
  const decode = entry => {
    const bytes = gunzipSync(Buffer.from(entry.gzip, 'base64'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
    return bytes.toString();
  };
  const source = decode(historical[0]);
  const prefix = 'test("every shipped HTML, CSS, and JS byte preserves the clean-room boundary", () => {';
  const start = source.indexOf(prefix), end = source.indexOf('\n});', start) + 4;
  assert.ok(start > 0 && end > start);
  const callback = source.slice(start, end);
  const native = readFileSync(path.join(root, 'tests/design-pass4-contract.test.mjs'), 'utf8');
  const nativeStart = native.indexOf(prefix), nativeEnd = native.indexOf('\n});', nativeStart) + 4;
  assert.equal(native.slice(nativeStart, nativeEnd).replace(
    'assertCleanRoomBytes(readFileSync(file, "utf8"), path.relative(ROOT, file), ROOT);',
    'assert.doesNotMatch(readFileSync(file, "utf8"), /glpwinner/i, `clean-room marker leaked into ${path.relative(ROOT, file)}`);'
  ), callback, 'only current byte classification changes; complete original walk stays intact');
  const historicalFiles = historical.slice(1).map((entry, i) => ({name: ['page.html','style.css','runtime.js'][i], bytes:decode(entry)}));
  const execute = files => vm.runInNewContext(callback, {
    test: (_, fn) => fn(), assert, path, ROOT:'/historical',
    readdirSync: () => files.map(f => f.name), statSync: () => ({isDirectory: () => false}),
    readFileSync: file => files.find(f => f.name === path.basename(file)).bytes,
  }, {timeout:1000});
  execute(historicalFiles);
  for (let i=0; i<historicalFiles.length; i++) {
    const changed = historicalFiles.map((f,j) => ({...f, bytes:f.bytes + (i===j?' glpwinner':'')}));
    assert.throws(() => execute(changed), assert.AssertionError, historicalFiles[i].name);
  }
  assert.throws(() => execute([{name:'page.html',bytes:nativePage()}]), assert.AssertionError, 'authentic current citation cannot masquerade as old implementation-free generation');
  for (const entry of historical) {
    const bad = {...entry, gzip:gzipSync(Buffer.from(decode(entry) + '\n')).toString('base64')};
    assert.throws(() => decode(bad), assert.AssertionError, entry.path);
  }
});
