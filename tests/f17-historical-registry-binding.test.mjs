import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readF17PinnedRegistry} from './helpers/f17-pinned-registry.mjs';

const registryPath = 'data/program-registry.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = relative => readFileSync(new URL('../' + relative, import.meta.url));
const source = read('tests/glp41-material-contracts.test.mjs').toString();
const start = source.indexOf("test('F17 approved registry successor binds exact prior and current bytes'");
const end = source.indexOf("\ntest('F34", start);
assert.ok(start >= 0 && end > start);

// Run the complete maintained F17 oracle with injected bytes. The historical
// fixture is source-only custody, never approval of the current registry.
test('F17 historical registry fixture executes immutable custody and refuses current or altered source bytes', () => {
  const declaration = source.match(/^const f17Read = [\s\S]*?;$/m);
  assert.ok(declaration, 'F17 must bind its own historical reader, not current registry bytes');
  const packed = read('tests/fixtures/f17-pinned-program-registry.json.gz');
  const historical = gunzipSync(packed);
  const reader = new Function('read', 'readF17PinnedRegistry', `${declaration[0]}\nreturn f17Read;`)(read, readF17PinnedRegistry);
  assert.deepEqual(reader(registryPath), historical);
  assert.equal(sha(reader(registryPath)), '7fd52a55dd68967fb2d4428d62785a41457281dac07c1a4f24129677869ab94f');
  assert.deepEqual(reader('tests/fixtures/glp41-approved-input-successor.json'), read('tests/fixtures/glp41-approved-input-successor.json'));
  const guard = new Function('test', 'assert', 'f17Read', 'sha', source.slice(start, end));
  const run = candidate => guard((_name, check) => check(), assert,
    relative => relative === registryPath ? candidate : read(relative), sha);
  assert.doesNotThrow(() => run(historical));
  assert.throws(() => run(read(registryPath)), {code:'ERR_ASSERTION'}, 'today\'s source is not the historical pinned input');
  assert.throws(() => run(Buffer.concat([historical, Buffer.from(' ')])), {code:'ERR_ASSERTION'});
});

// Execute the actual maintained GLP234 extraction and its candidate/pins
// callback, not a second copy of that compiler. Its earlier stale-pin assertion
// is outside this bounded slice and remains a separate pre-existing failure.
test('F17 GLP234 extracted consumer preserves candidate and pin injection', () => {
  const caller = read('tests/glp234-try-ageless-identity.test.mjs').toString();
  const consumerStart = caller.indexOf("  const nodeSource = read('tests/glp41-material-contracts.test.mjs').toString();");
  const consumerEnd = caller.indexOf('\n  // Exercise only the browser consumer', consumerStart);
  assert.ok(consumerStart >= 0 && consumerEnd > consumerStart);
  const pins = JSON.parse(read('tests/fixtures/glp41-approved-input-successor.json'));
  const runNode = new Function('read', 'pins', 'input', 'assert', 'sha',
    caller.slice(consumerStart, consumerEnd) + '\nreturn runNode;')(read, pins, registryPath, assert, sha);
  const historical = readF17PinnedRegistry();
  assert.doesNotThrow(() => runNode(historical));
  assert.throws(() => runNode(read(registryPath)), {code:'ERR_ASSERTION'});
  assert.throws(() => runNode(Buffer.concat([historical, Buffer.from(' ')])), {code:'ERR_ASSERTION'});
  const stale = structuredClone(pins);
  stale.inputs[registryPath].after_sha256 = pins.provenance.previous_care_after_sha256;
  assert.throws(() => runNode(historical, stale), {code:'ERR_ASSERTION'});
  const wrongBefore = structuredClone(pins);
  wrongBefore.inputs[registryPath].before_sha256 = pins.provenance.previous_care_after_sha256;
  assert.throws(() => runNode(historical, wrongBefore), {code:'ERR_ASSERTION'});
});
