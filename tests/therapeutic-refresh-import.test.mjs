import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('taxonomy refresh pure import works without live capture adapters and capture still refuses their absence', () => {
  // Reproduce original GLP-361 record 51's missing-adapter startup boundary.
  // This subprocess never imports host adapters, validates private evidence,
  // invokes main(), captures a page, acquires a lease or writes a receipt.
  const code = `import importlib.abc, importlib.util, pathlib, sys
names = {'affiliate_direct_evidence_capture', 'firecrawl_client'}
attempts = []
class UnavailableAdapters(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in names:
            attempts.append(fullname)
            raise ModuleNotFoundError("No module named '" + fullname + "'", name=fullname)
sys.meta_path.insert(0, UnavailableAdapters())
def no_effects(event, args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system', 'os.mkdir', 'os.rename', 'os.remove'):
        raise AssertionError('unexpected effect: ' + event)
    if event == 'open' and ((isinstance(args[1], str) and any(c in args[1] for c in 'wax+')) or args[2] & 3):
        raise AssertionError('unexpected write')
sys.addaudithook(no_effects)
before_path = list(sys.path)
spec = importlib.util.spec_from_file_location('taxonomy_refresh', 'scripts/refresh-therapeutic-taxonomy.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert attempts == [], attempts
assert sys.path == before_path, 'pure import changed module lookup paths'
assert callable(module.validate) and callable(module.main)
row = {field: [] for field in module.FIELDS}
row['molecule_tags'] = ['semaglutide']
policy = {'quotes': {'molecule_tags': {'semaglutide': 'Compounded Semaglutide'}}}
assert module.support(row, policy, 'Compounded Semaglutide')['molecule_tags']['semaglutide']['quote'] == 'Compounded Semaglutide'
try:
    module.support(row, policy, 'Not offered: Compounded Semaglutide')
except ValueError as exc:
    assert str(exc) == 'assertion_qualified_unavailable:molecule_tags:semaglutide'
else:
    raise AssertionError('qualified health assertion was accepted')
try:
    module.capture('https://example.invalid/', pathlib.Path('capture-must-not-exist.json'))
except ModuleNotFoundError as exc:
    assert exc.name == 'affiliate_direct_evidence_capture', str(exc)
else:
    raise AssertionError('capture bypassed missing live adapters')
assert attempts == ['affiliate_direct_evidence_capture'], attempts
print('pure import/support PASS; missing-adapter capture refused; no network/process/write effects')`;
  const env = {...process.env, PYTHONDONTWRITEBYTECODE: '1'};
  delete env.PYTHONPATH;
  delete env.GLP_BUSINESS_ROOT;
  const run = spawnSync('python3', ['-I', '-B', '-c', code], {cwd: root, env, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'pure import/support PASS; missing-adapter capture refused; no network/process/write effects');
});
