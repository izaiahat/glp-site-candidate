import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditLinks } from '../scripts/ci-link-census.mjs';

function fixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-census-'));
  const publicRoot = path.join(root, 'public'), functionsRoot = path.join(root, 'functions');
  mkdirSync(publicRoot); mkdirSync(functionsRoot);
  const put = (name, text) => { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  try { run({ publicRoot, functionsRoot, put }); } finally { rmSync(root, { recursive: true, force: true }); }
}
test('census resolves local files, redirects, query strings and declared Functions without fetching external URLs', () => fixture(({publicRoot, functionsRoot, put}) => {
  put('public/index.html', '<a href="/review/?a=1&amp;b=2">Review</a><a href="/old/">Old</a><a href="/go/demo">Go</a><a href="https://example.invalid/never-fetch">Outside</a>');
  put('public/review/index.html', '<a href="../">Home</a>'); put('public/_redirects', '/old/ /review/ 301\n');
  put('functions/go/[program].js', 'export function onRequestGet() {}');
  assert.deepEqual(auditLinks(publicRoot, functionsRoot).unresolved, []);
}));
test('missing internal target is a real failure', () => fixture(({publicRoot, functionsRoot, put}) => {
  put('public/index.html', '<a href="/missing/">Missing</a>');
  assert.equal(auditLinks(publicRoot, functionsRoot).unresolved_count, 1);
}));
test('redirect cycle is a real failure', () => fixture(({publicRoot, functionsRoot, put}) => {
  put('public/index.html', '<a href="/a/">Cycle</a>'); put('public/_redirects', '/a/ /b/ 301\n/b/ /a/ 301\n');
  assert.equal(auditLinks(publicRoot, functionsRoot).unresolved_count, 1);
}));
test('empty HTML denominator remains visible', () => fixture(({publicRoot, functionsRoot}) => {
  assert.equal(auditLinks(publicRoot, functionsRoot).html_count, 0);
}));
