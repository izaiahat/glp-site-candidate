import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('registered taxonomy refresh reconciles its seal without changing evidence dates', () => {
  const registry = JSON.parse(readFileSync(new URL('../data/program-registry.json', import.meta.url)));
  const dates = Object.fromEntries(Object.entries(registry.therapeutic_taxonomy.programs)
    .map(([id, row]) => [id, row.verified_as_of]));
  const ordered = Object.values(dates).sort();
  assert.notEqual(ordered[0], ordered.at(-1), 'fixture needs distinct evidence dates');
  registry.therapeutic_taxonomy.sealed_as_of = ordered[0];
  const code = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('taxonomy_refresh','scripts/refresh-therapeutic-taxonomy.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
result=module.validate(json.load(sys.stdin),[])['therapeutic_taxonomy']
print(json.dumps({'seal':result['sealed_as_of'],'dates':{key:row['verified_as_of'] for key,row in result['programs'].items()}}))`;
  const run = spawnSync('python3', ['-c', code], {
    cwd: root, input: JSON.stringify(registry), encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.seal, ordered.at(-1));
  assert.deepEqual(result.dates, dates);
});
