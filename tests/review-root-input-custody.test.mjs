import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('GLP361 original static resolver assertion executes for default and independently configured snapshot roots', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'review-root-input-'));
 try {
  for (const configured of [null, root]) {
   const env = {...process.env}; delete env.NODE_TEST_CONTEXT; delete env.GLP_REVIEW_PUBLIC_ROOT;
   if (configured) env.GLP_REVIEW_PUBLIC_ROOT = configured;
   const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=^review static resolver stays inside public$', 'tests/review-server.test.mjs'], {cwd:new URL('../',import.meta.url), env, encoding:'utf8', timeout:30000});
   assert.equal(result.status, 0, result.stdout + result.stderr);
   assert.match(result.stdout, /^# pass 1$/m);
   assert.match(result.stdout, /^# fail 0$/m);
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});
