// TEST ONLY: public retained regulatory captures for the unchanged native reader.
// Native hosts must already carry the genuine files. Creation is limited to an
// ephemeral GitHub runner; an existing file is verified, never overwritten.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const captureDirectory = '/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/D2/D2f/fresh-authority';
export const capturePins = Object.freeze({
  'research.md': 'aca5d53141a5e516c94ef621d95d5ffeaa309f4b0a4551327d92c1a16ce2153c',
  'audit-summary.json': '77a54ee02361130524bb07b6940c3c75e96af634eaf7bbe2acb3e90bbf51f84a',
});
export function authenticatedCapture(file, bytes = readFileSync(new URL(`../fixtures/retatrutide-capture/${file}`, import.meta.url))) {
  assert.ok(Object.hasOwn(capturePins, file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), capturePins[file], `${file}: retained capture bytes`);
  return bytes;
}
export function materializeHostedCaptures() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'creation is hosted-test-only, never native adoption');
  const captures = Object.keys(capturePins).map(file => [file, authenticatedCapture(file)]);
  mkdirSync(captureDirectory, {recursive: true});
  assert.equal(realpathSync(captureDirectory), captureDirectory);
  for (const [file, bytes] of captures) {
    const target = path.join(captureDirectory, file);
    let present;
    try { present = lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) {
      assert.ok(present.isFile() && !present.isSymbolicLink());
      authenticatedCapture(file, readFileSync(target));
    } else writeFileSync(target, bytes, {flag: 'wx'});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) materializeHostedCaptures();
