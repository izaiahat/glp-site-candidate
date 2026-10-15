import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const suiteUrl = new URL('./pass2-detail-quiz.test.mjs', import.meta.url);
const source = readFileSync(suiteUrl, 'utf8');
const titles = [
  'PASS 2 quiz starts without an email or privacy checkbox gate',
  'PASS 2 quiz leads with the governed treatment-intent choice set',
  'Phase 4 quiz keeps uncapped eligible result sets and state/treatment-scoped exploration',
  'Phase 4 every treatment-intent option resolves to an owned route or governed result family',
];

// Execute the owning module's actual collection statements, not its assertions.
// Explicit injected boundaries deny unrelated projections and artifact access.
// Native post-build execution of the four callbacks remains separate acceptance.
function collect({read = readFileSync, project = () => { throw new Error('unrelated_taxonomy_projection'); }} = {}) {
  const registered = [];
  const body = source.replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(suiteUrl.href));
  vm.runInNewContext(body, {
    URL, readFileSync: read, test: (title, callback) => registered.push({title, callback}),
    assert, projectMoneyPagesFromRegistry: () => ({}), projectQuizFromRegistry: () => ({}),
    projectTherapeuticSurfaces: project,
  }, {filename: suiteUrl.pathname, timeout: 1000});
  assert.deepEqual(registered.map(row => row.title), titles);
  assert.ok(registered.every(row => typeof row.callback === 'function'));
}

test('PASS 2 collection does not evaluate an unused taxonomy projection', () => {
  collect();
});

test('PASS 2 collection reads only its source config; the built-output test owns its artifact read', () => {
  const reads = [];
  collect({read: url => {
    reads.push(url.href);
    assert.equal(url.href, new URL('../data/quiz-config.json', suiteUrl).href, 'unrelated collection input');
    return readFileSync(url, 'utf8');
  }});
  assert.deepEqual(reads, [new URL('../data/quiz-config.json', suiteUrl).href]);
});
