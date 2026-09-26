#!/usr/bin/env node
// D1 orchestration only: existing build/validators/no-write wrapper, no deploy.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const ensure = (value, message) => { if (!value) throw new Error(message); };
export function noEgress(attempts) { ensure(Array.isArray(attempts) && attempts.length === 0, 'D1_egress_attempt'); }
export function publishedSecrets(directory) {
  const run = spawnSync('gitleaks', ['dir', '--redact', '--no-banner', '--config', path.join(ROOT, '.gitleaks.toml'), directory], { stdio: 'ignore' });
  ensure(!run.error && run.status === 0, 'D1_published_secret_scan_failed');
}
export function treeFiles(root) {
  const rows = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = lstatSync(file);
      ensure(!stat.isSymbolicLink(), 'D1_artifact_symlink');
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) rows.push({ file: path.relative(root, file), sha256: sha(readFileSync(file)) });
    }
  }
  walk(root); ensure(rows.length > 0, 'D1_artifact_empty');
  return { sha256: sha(JSON.stringify(rows)), files: rows };
}
export function checkAnchorMarkup(documents, authority, aliases, runtime, required) {
  const { parse } = require('parse5');
  ensure(documents.length > 0 && required.length > 0, 'D1_anchor_selection_empty');
  const counts = {}, failures = [];
  function markup(text, file) {
    function visit(node) {
      if (node.tagName === 'a') {
        const a = Object.fromEntries((node.attrs || []).map(v => [v.name, v.value]));
        const url = new URL(a.href || '', 'https://glpclinicscout.com');
        const go = url.origin === 'https://glpclinicscout.com' && url.pathname.startsWith('/go/');
        if (go) {
          const slug = decodeURIComponent(url.pathname.split('/')[2] || '');
          const row = runtime[slug];
          const id = a['data-program'];
          if (!id || (aliases[slug] || slug) !== (aliases[id] || id)) failures.push(`${file}:crosswired_go:${slug}:${id || 'missing'}`);
          if (!row || row.live_link_allowed !== true || row.promotion_authorized !== true) failures.push(`${file}:held_go:${slug}`);
        }
        if (go || a['data-analytics-event'] === 'affiliate_click' || /\bsponsored\b/.test(a.rel || '')) {
          const id = a['data-program'], row = authority[aliases[id] || id] || authority[id];
          if (!id || row?.status !== 'VERIFIED' || row.promotion_authorized !== true) failures.push(`${file}:unauthorized_anchor:${id || 'missing'}`);
          if (!/\bsponsored\b/.test(a.rel || '') || !/\bnofollow\b/.test(a.rel || '')) failures.push(`${file}:missing_rel:${id}`);
          counts[id] = (counts[id] || 0) + 1;
        }
      }
      for (const child of node.childNodes || []) visit(child);
      if (node.content) visit(node.content);
    }
    visit(parse(text));
  }
  function payload(value, file) {
    if (typeof value === 'string' && /<a\b/i.test(value)) markup(value, file);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) payload(child, file);
  }
  for (const doc of documents) doc.file.endsWith('.json') ? payload(JSON.parse(doc.text), doc.file) : markup(doc.text, doc.file);
  for (const id of required) if (!counts[id]) failures.push(`missing_authorized_anchor:${id}`);
  ensure(failures.length === 0, `D1_affiliate_failure:${JSON.stringify(failures)}`);
  return { documents: documents.length, counts };
}
export function browserCases(report) {
  const result = [];
  function visit(suite) {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) result.push({
      file: `tests/browser/${spec.file}`, title: spec.title, project: test.projectName,
      expectedStatus: test.expectedStatus, status: test.status, results: (test.results || []).map(r => r.status),
    });
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report?.suites || []) visit(suite);
  return result;
}
export function checkBrowser(report, selection) {
  ensure(selection?.cases?.length > 0 && selection?.projects?.length > 0, 'D1_browser_selection_empty');
  const expected = selection.cases.flatMap(c => selection.projects.map(project => ({ file: c.file, title: c.title, project })));
  const key = row => JSON.stringify([row.file, row.title, row.project]);
  const actual = browserCases(report), wanted = expected.map(key).sort(), got = actual.map(key).sort();
  ensure(new Set(wanted).size === wanted.length && JSON.stringify(wanted) === JSON.stringify(got), 'D1_browser_denominator_mismatch');
  ensure(!report.errors?.length && report.config?.updateSnapshots === 'none', 'D1_browser_report_invalid');
  ensure(actual.every(r => r.expectedStatus === 'passed' && r.status === 'expected' && r.results.length === 1 && r.results[0] === 'passed'), 'D1_required_browser_failure_or_skip');
  return actual;
}

export function checkDispositions(manifest, quarantine) {
  const buckets = {
    a: ['C01','F25'],
    b: ['C03','F14','F17','F22','F26','F34','F35','F36','F37'],
    c: ['F02','F03','F06','F07','F09','F10','F11','F15','F16','F19','F28','F29','F30','F31','F32'],
  };
  const expected = Object.entries(buckets).flatMap(([bucket, ids]) => ids.map(id => [id,bucket]));
  ensure(manifest.schema === 'glp41-d1-dispositions-v1' && manifest.rows?.length === 26, 'D1_disposition_denominator');
  ensure(new Set(manifest.rows.map(row => row.id)).size === 26, 'D1_disposition_duplicate');
  for (const [id,bucket] of expected) {
    const row = manifest.rows.find(row => row.id === id);
    ensure(row?.bucket === bucket && row.evidence?.length > 40 && row.verification?.length > 5, `D1_disposition_missing_or_changed:${id}`);
    const warnings = quarantine.diagnostics.filter(item => item.id === id);
    ensure(bucket === 'c' ? warnings.length === 1 && warnings[0].reason === row.evidence : warnings.length === 0, `D1_material_quarantine:${id}`);
  }
  return { rows: 26, fixed: buckets.a, stale: buckets.b, nonblocking: buckets.c };
}

async function main() {
  ensure(process.argv.length === 4 && process.argv[2] === '--out', 'usage: node scripts/ci-release-gate.mjs --out <new external directory>');
  ensure(path.resolve(process.cwd()) === path.resolve(ROOT), 'D1_wrong_cwd');
  const out = path.resolve(process.argv[3]);
  ensure(!out.startsWith(path.resolve(ROOT) + path.sep) && !existsSync(out), 'D1_output_requires_new_external_directory');
  mkdirSync(out, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const result = { schema: 'glp-d1-release-result-v1', started_at: new Date().toISOString(), head: git('rev-parse', 'HEAD'), status: 'FAIL', steps: [], release_authorized: false };
  const save = () => writeFileSync(path.join(out, 'gate.json'), JSON.stringify(result, null, 2) + '\n');
  const step = async (id, fn) => {
    try { const evidence = await fn(); result.steps.push({ id, status: 'PASS', evidence }); }
    catch (error) { result.steps.push({ id, status: 'FAIL', error: String(error.message) }); }
    save();
  };
  const buildLock = path.join(process.env.GLP_PRIVATE_EVIDENCE_ROOT || '', 'scripts/candidate_build_lock.py');
  const seat = 'rebuild-p13-release';
  let buildLockHeld = false;
  try {
    ensure(git('status', '--porcelain', '--untracked-files=all') === '', 'D1_clean_head_required');
    const config = readJson(path.join(ROOT, 'ops/release-gate.json'));
    await step('disposition-contract', () => checkDispositions(readJson(path.join(ROOT, 'ops/release-dispositions.json')), readJson(path.join(ROOT, 'ops/test-quarantine.json'))));
    result.nonblocking_diagnostics = readJson(path.join(ROOT, 'ops/test-quarantine.json')).diagnostics;
    result.selection_sha256 = sha(readFileSync(path.join(ROOT, 'ops/release-gate.json')));
    ensure(config.browser.cases.length > 0 && config.browser.projects.length > 0, 'D1_browser_selection_empty');
    result.required_cases = config.browser.cases.length * config.browser.projects.length;
    const { spawnLogged } = await import('../artifacts/ultracode/tools/qa-common.mjs');
    const command = async (id, bin, args, env = {}) => {
      const receipt = await spawnLogged(bin, args, { cwd: ROOT, log: path.join(out, `${id}.log`), tee: false, env });
      receipt.log_sha256 = sha(readFileSync(path.join(out, `${id}.log`)));
      const requiredNodeCounts = { 'host-bootstrap': 250, 'material-contracts': 43, 'harness-negatives': 9, 'go-destination-contracts': 43, 'public-name-regression': 1, 'release-export-artifact': 3, 'affiliati-postback-contract': 46 };
      if (requiredNodeCounts[id]) {
        const log = readFileSync(path.join(out, `${id}.log`), 'utf8');
        const counts = Object.fromEntries(['tests','pass','fail','skipped'].map(key => [key, Number(log.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? -1)]));
        receipt.node_counts = counts;
        if (counts.tests !== requiredNodeCounts[id] || counts.pass !== counts.tests || counts.fail !== 0 || counts.skipped !== 0) receipt.exit = receipt.exit || 1;
      }
      result.steps.push({ id, status: receipt.exit === 0 ? 'PASS' : 'FAIL', ...receipt }); save();
    };
    // NODE_ENV=production silently omits the test dependencies on this host.
    delete process.env.NODE_ENV;
    delete process.env.PLAYWRIGHT_BASE_URL;
    delete process.env.GLP_REVIEW_PUBLIC_ROOT;
    execFileSync('python3', [buildLock, 'acquire', '--seat', seat], {stdio: 'pipe'});
    buildLockHeld = true;
    // The host admits one heavy build/browser lane. Keep the same reservation
    // across generation, artifact verification and browser execution.
    await command('host-bootstrap', 'bash', ['scripts/ci-bootstrap-gate.sh']);
    await command('material-contracts', process.execPath, ['--test', '--test-concurrency=1', 'tests/glp41-material-contracts.test.mjs', 'tests/lastmod-declared-routes.test.mjs', 'tests/d2s-carrier-article-retention.test.mjs', 'tests/content-upgrade.test.mjs', 'tests/price-watch-email.test.mjs']);
    await command('affiliati-postback-contract', process.execPath, ['--test', '--test-concurrency=1', 'tests/affiliati-postback-contract.test.mjs']);
    await command('release-export-artifact', process.execPath, ['--test', 'tests/release-export-artifact.test.mjs']);
    await command('public-name-regression', process.execPath, ['--test', 'tests/skinnyrx-public-name.test.mjs'], { GLP_PUBLIC_NAME_TEST_ROOT: path.join(ROOT, 'public') });
    await command('harness-negatives', process.execPath, ['--test', 'tests/release-gate-harness.test.mjs']);
    await command('go-destination-contracts', process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=^(D2s |/go |network constructor |every go manifest |unadopted go |Direct Meds review go |browser instrumentation )', 'tests/funnel-v2-instrumentation.test.mjs', 'tests/d2s-generator-worker-contract.test.mjs']);
    const publicRoot = path.join(ROOT, 'public');
    const trackedDigest = () => sha(JSON.stringify(git('ls-files').split('\n').map(file => [file, sha(readFileSync(path.join(ROOT, file)))])));
    result.built_source_sha256 = trackedDigest();
    result.private_registry_sha256 = sha(readFileSync(process.env.GLP_PRIVATE_APPROVED_REGISTRY));
    result.output_before = treeFiles(publicRoot); save();
    await step('published-secrets', () => { publishedSecrets(publicRoot); return { scanner: 'gitleaks', findings: 0 }; });
    await step('affiliate-census', async () => {
      const { loadGoPromotionAuthority, loadGoSelection } = await import('../src/go-runtime-selection.mjs');
      const { GO_RUNTIME_MANIFEST } = await import('../functions/go/program-manifest.js');
      const { assertServedGoIdentity, rawHeldInputs, rawHeldOutputCensus, assertRawHeldOutput } = await import('../src/served-affiliate-identity.mjs');
      const registry = readJson(path.join(ROOT, 'data/program-registry.json'));
      const aliases = Object.fromEntries(registry.programs.map(p => [p.review_slug || p.program_id, p.program_id]));
      const required = Object.values(loadGoSelection().programs).filter(p => p.status === 'VERIFIED').map(p => p.render_id);
      const documents = result.output_before.files.filter(p => /\.(html|json)$/.test(p.file)).map(p => ({ file: p.file, text: readFileSync(path.join(publicRoot, p.file), 'utf8') }));
      const census = checkAnchorMarkup(documents, loadGoPromotionAuthority().programs, aliases, GO_RUNTIME_MANIFEST.programs, required);
      const identity = assertServedGoIdentity(publicRoot, readJson(path.join(ROOT, 'data/tracking-allowed-hosts.json')).programs);
      const raw_held = assertRawHeldOutput(rawHeldOutputCensus(documents, rawHeldInputs(ROOT), GO_RUNTIME_MANIFEST.programs));
      return { ...census, go_identity_anchors: identity.anchors.length, raw_held };
    });
    const browserLock = JSON.parse(execFileSync('python3', [buildLock, 'require-held', '--seat', seat], {encoding: 'utf8'}));
    result.steps.push({id:'browser-lock-held',status:'PASS',evidence:browserLock}); save();
    await command('browser', process.execPath, ['artifacts/ultracode/tools/test-browser-nowrite.mjs'], {
      GLP_RELEASE_SELECTION: path.join(ROOT, 'ops/release-gate.json'), PLAYWRIGHT_WORKERS: '1',
      PLAYWRIGHT_PORT: '4296', PLAYWRIGHT_SCRATCH_ROOT: path.join(out, 'browser-scratch'),
      PLAYWRIGHT_OUTPUT_DIR: path.join(out, 'traces'), GLP_BROWSER_REPORT_PATH: path.join(out, 'browser.json'),
      GLP_LOCAL_REVIEW_DB: path.join(out, 'local-review.sqlite3'),
    });
    await step('browser-required-effects', () => {
      const report = readJson(path.join(out, 'browser.json'));
      result.browser_cases = browserCases(report);
      result.browser_stats = report.stats;
      return checkBrowser(report, config.browser);
    });
    await step('no-egress', () => {
      const receiptPath = path.join(ROOT, 'artifacts/ultracode/browser-nowrite-report.json');
      copyFileSync(receiptPath, path.join(out, 'browser-nowrite-report.json'));
      const receipt = readJson(receiptPath); noEgress(receipt.deny_by_default.attempts);
      ensure(receipt.denominator.intact && receipt.snapshot_writes_disabled, 'D1_no_write_denominator_failed');
      return { attempts: 0, mapped_local_tunnels: receipt.deny_by_default.mapped_local_tunnels.length };
    });
    await step('artifact-stability', () => {
      result.output_after = treeFiles(publicRoot);
      ensure(result.output_before.sha256 === result.output_after.sha256, 'D1_artifact_changed_during_readback');
      ensure(git('rev-parse', 'HEAD') === result.head, 'D1_head_changed');
      ensure(trackedDigest() === result.built_source_sha256, 'D1_source_changed_during_readback');
      ensure(sha(readFileSync(process.env.GLP_PRIVATE_APPROVED_REGISTRY)) === result.private_registry_sha256, 'D1_private_registry_changed');
      return { unchanged: true };
    });
    for (const row of config.unresolved_material_requirements) result.steps.push({ id: `${row.owner}:${row.id}`, status: 'FAIL', error: row.requirement, disposition: row.status });
    result.generated_diff_paths = git('diff', '--name-only').split('\n').filter(Boolean);
    result.generated_diff_sha256 = sha(execFileSync('git', ['diff', '--binary'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
    result.authority_files = ['data/go-runtime-selection.json', 'data/go-runtime-promotion-authority.json', 'data/tracking-allowed-hosts.json', 'artifacts/ops/build-report.json'].filter(f => existsSync(path.join(ROOT, f))).map(file => ({ file, sha256: sha(readFileSync(path.join(ROOT, file))) }));
  } catch (error) { result.steps.push({ id: 'gate-precondition', status: 'FAIL', error: String(error.message) }); }
  finally {
    if (buildLockHeld) {
      try {
        execFileSync('python3', [buildLock, 'release', '--seat', seat], {stdio: 'pipe'});
        result.build_lock_released = true;
      } catch (error) { result.steps.push({id:'build-lock-release',status:'FAIL',error:String(error.message)}); }
    }
  }
  result.status = result.steps.length > 0 && result.steps.every(s => s.status === 'PASS') ? 'PASS' : 'FAIL';
  result.finished_at = new Date().toISOString(); save();
  console.log(JSON.stringify({ head: result.head, status: result.status, failed_requirements: result.steps.filter(s => s.status !== 'PASS').map(s => ({ id: s.id, error: s.error })), receipt: path.join(out, 'gate.json') }, null, 2));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
