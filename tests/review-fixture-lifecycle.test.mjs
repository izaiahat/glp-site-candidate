import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import test, {after} from 'node:test';

// Explicit synthetic transport fixture, not rendered-site or design acceptance.
// Bind the real review server before its first import; never write public/.
// Local shells need not define either CI/host scratch variable. Keep that
// fallback in the user's cache rather than the shared system temp directory.
const scratch = process.env.TMPDIR || process.env.RUNNER_TEMP || path.join(homedir(), '.cache', 'glp-test-fixtures');
await mkdir(scratch, {recursive: true});
const directory = await mkdtemp(path.join(scratch, 'owned-review-fixture-'));
after(() => rm(directory, {recursive: true, force: true}));
const bytes = Buffer.from('<!doctype html><title>TEST fixture</title><p>Exact transport bytes</p>');
await writeFile(path.join(directory, 'index.html'), bytes);
await writeFile(path.join(directory, '_redirects'), '');
const previousRoot = process.env.GLP_REVIEW_PUBLIC_ROOT;
process.env.GLP_REVIEW_PUBLIC_ROOT = directory;
const {withReviewFixture, withReviewPage} = await import('./helpers/owned-review-fixture.mjs');
if (previousRoot === undefined) delete process.env.GLP_REVIEW_PUBLIC_ROOT;
else process.env.GLP_REVIEW_PUBLIC_ROOT = previousRoot;

test('owned review fixture serves exact fixture bytes without an external server', async () => {
  let origin;
  const value = await withReviewFixture(async url => {
    origin = url;
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${origin}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    return 'completed';
  });
  assert.equal(value, 'completed');
  await assert.rejects(fetch(`${origin}/`));
});

test('owned review fixture releases its port when the browser callback fails', async () => {
  let origin;
  const failure = new Error('browser launch or assertion failed');
  await assert.rejects(withReviewFixture(async url => {
    origin = url;
    assert.equal((await fetch(`${origin}/`)).status, 200);
    throw failure;
  }), error => error === failure);
  await assert.rejects(fetch(`${origin}/`));
});

test('owned review fixtures have independent ephemeral origins and lifetimes', async () => {
  await withReviewFixture(async first => {
    await withReviewFixture(async second => {
      assert.notEqual(first, second);
      assert.equal((await fetch(`${first}/`)).status, 200);
      assert.equal((await fetch(`${second}/`)).status, 200);
    });
    assert.equal((await fetch(`${first}/`)).status, 200);
  });
});

test('review page ownership closes each page before a later case can begin', async () => {
  assert.equal(typeof withReviewPage, 'function', 'missing per-case page owner');
  const events = [];
  let sequence = 0;
  const context = { async newPage() {
    const id = ++sequence;
    events.push(`open:${id}`);
    return { id, async close() { events.push(`close:${id}`); } };
  } };
  const result = await withReviewPage(context, async page => {
    events.push(`collect:${page.id}`);
    return page.id;
  });
  assert.equal(result, 1);
  assert.deepEqual(events, ['open:1', 'collect:1', 'close:1']);
  await assert.rejects(withReviewPage(context, async page => {
    events.push(`collect:${page.id}`);
    throw new Error('native action timed out');
  }), /native action timed out/);
  await withReviewPage(context, async page => events.push(`collect:${page.id}`));
  assert.deepEqual(events, ['open:1', 'collect:1', 'close:1', 'open:2', 'collect:2', 'close:2', 'open:3', 'collect:3', 'close:3']);
});
