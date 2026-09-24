import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const business = '/home/ubuntu/business';
const plan = `${business}/reports/ops/orchestration-restore-20260907/PLAN`;
const execution = `${plan}/K10/EXECUTION/K10-007-D`;
const s26 = `${plan}/S26`;
const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const contains = (text, tokens) => tokens.every(token => text.includes(token));

// These are individual predicates, not an allowlist of successful IDs. A historical
// predicate resolves ONLY preservation of a dated observation, never its UI effects.
const historical = {
  'RN-00201': ['These were found while reviewing ad creatives', 'ordered them folded'],
  'RN-00302': ['tests/browser/pass7-listing*.spec.mjs', 'Listing test owner', 'No source edits'],
  'RN-00507': ['Route family', 'Live URLs', 'In seal', 'Harness render', 'Reviewed', 'Verdict'],
  'RN-00510': ['/providers/{slug}', '| 60 |', 'MATRIX + PASS5', 'EMULATED'],
  'RN-00511': ['/reviews/{slug}', '| 59 |', '27/34 density gap', 'EMULATED'],
  'RN-00512': ['/pharmacies/{slug}', '| 93 |', 'Pharmacy hub/detail', 'EMULATED'],
  'RN-00526': ['301 →', '0 in sitemap', 'absent from sitemap'],
  'RN-00630': ['FABLE CORRECTION', 'glp-design-pass4-live-20260829-r1', 'NOT preview-rebuild-20260820'],
  'RN-EXTRA-3626': ['independent Opus mechanical pass', 'glp-visual-ultracode-20260821', '2026-08-22T20:12:08Z', 'No aesthetic judgment', 'Two temporary probes', 'reverted'],
  'RN-EXTRA-3629': ["Not ready for the operator's design review", 'narrow and concrete'],
  'RN-EXTRA-3795': ['No deploys — candidate only', 'stale dir from 08-20', 'no deploy receipt', 'not a git repo', '1098627'],
  'RN-EXTRA-3826': ['remaining problem is not design', 'routing'],
  'RN-EXTRA-3827': ['Must fix (blocking)'],
  'RN-EXTRA-3832': ['Should fix before review', 'operator-visible'],
  'RN-EXTRA-3836': ['Operator/Fable calls needed', 'do not guess'],
  'RN-EXTRA-3895': ['Skill-order defect', 'loaded after', 'provider-review copy promotion', 'not silently backfilled'],
  'RN-EXTRA-3918': ['scripts/glp_deploy_sealed_successor.py', 'already-sealed', 'Wrangler runs INSIDE', 'nothing is hand-run'],
  'RN-EXTRA-3930': ['8 ×', '166f5ed5', '836b4e9e', '8f7dae85', 'a727bead', 'c139a627', 'cb2dc114', 'd4d9071d', 'd9094901', 'superseded_assets']
};
// Fail-closed executable evidence predicates for obligations that cannot legitimately
// be discharged merely by preserving their prose. No candidate-bound receipt is
// currently authorized as evidence for these; absence is reported, not waived.
const required = {
  'RN-00131': ['row-by-row operator mapping', 'visual proof for every mapped row'],
  'RN-00185': ['Playwright screenshots', 'Firecrawl structural captures', 'closing audit skill coverage'],
  'RN-00192': ['carousel 3s no-pause wrap click', 'rotating text', 'review error scroll', 'sticky scroll', 'dropdown scroll', 'centered buttons'],
  'RN-00228': ['pre-Fable review-animations critique'],
  'RN-00235': ['every changed-motion surface before/after', 'animation critique', '60fps trace', 'reduced-motion capture', 'purpose or removal'],
  'RN-00323': ['complete listing matrix', 'copy/link handoff'],
  'RN-00351': ['all required independent Fable sign-offs bound to exact reviewed digest'],
  'RN-00629': ['current source', 'generated output', 'candidate preview', 'production observation (not authorized here)'],
  'RN-00635': ['current candidate preview inspection'],
  'RN-00899': ['exact LegitScript correspondence', 'retracted apply advice', 'Meta and Google/Bing channel restrictions'],
  'RN-00961': ['undefined price map removed', 'sorting/schema tests', 'fresh 1–32 pipeline', 'same sealed-byte safe suite', '54-route lastmod provenance'],
  'RN-01084': ['joint ads pack', 'operator and Fable review', 'test order and GO', 'Q59 before GO', 'UGC after both tests'],
  'RN-01086': ['operator issue separation', 'Awin lane-owned recovery', 'Telegram dropped unless reopened'],
  'RN-01287': ['disclosure/net-impression review', 'unchanged count-token contract', 'unchanged typed-price contract'],
  'RN-01380': ['all 17 risk rows', 'risk_accepted true', 'express permission false', 'dated acceptance', 'two operator hashes', 'limitations', 'terms provenance'],
  'RN-01499': ['conditional seal retirement after final-pass-8 evidence; no deletion authorized here'],
  'RN-01658': ['carousel timing/wrap/navigation', 'rotating text', 'review error scroll/submit', 'sticky rail', 'dropdown', 'centered actions'],
  'RN-01851': ['complete write provenance excluding hand edits to public/generated/governed/manifest bytes'],
  'RN-01982': ['research-owned facts unchanged', 'copy-only transformation', 'governed snapshot provenance'],
  'RN-01992': ['Fable exact-candidate approval', '375px before/after', '1440px before/after'],
  'RN-02236': ['fifth motion purpose', 'independent Fable review or removal', '0.6 luminance threshold', 'allowlist growth reviewed'],
  'RN-02389': ['0.6 luminance threshold', 'allowlist growth independent review'],
  'RN-02498': ['single listing-renderer owner coordination', 'imagery/A10/F1/F2 shared edit'],
  'RN-02655': ['mapped C URLs actual output re-anchor', 'hard budget per mapped URL'],
  'RN-EXTRA-3737': ['12 retirements and legacy redirects', 'inbound link repair or redirect-aware serving'],
  'RN-EXTRA-3830': ['redirect-aware review server or explicit accepted 404 alternative', 'inbound links separately verified'],
  'RN-EXTRA-3842': ['items 1–4 route/query/detail/redirect/sticky proof', 'operator/Fable judgments retained'],
  'RN-EXTRA-3849': ['18 historical browser cases bound to original fixtures', 'standard/reduced/no-JS', 'denied network', 'initial CSS-shape failure retained'],
  'RN-EXTRA-3885': ['204 distinct/216 attempts', '15 PASS/5 FAIL/1 unexercised/2 source-only', 'remaining height/a11y/journey failures retained in case files'],
  'RN-EXTRA-3905': ['original normalized served bytes', 'original G-Plans response', 'same dated deployment binding'],
  'RN-EXTRA-3934': ['governed pharmacy raw/render binding', 'non-deployed-artifact validation', 'function-transition validation'],
  'RN-EXTRA-3938': ['phase target shapes', 'exact deployment identity joins', 'exact evidence sets', '120/60-minute freshness', 'atomic evidence publication proof (not performed here)']
};
const auditIDs = ['RN-01274', 'RN-01275', 'RN-01276', 'RN-01277', 'RN-01302', 'RN-01304', 'RN-01306', 'RN-01308'];
const candidate = `${business}/site-system/flagship-v2/candidates/glp34-provider-families-20260912`;
// Requests are NOT signatures. No local author-produced JSON can authorize review,
// release, spending, or a waiver. The parent's authenticated approval path owns intake.
const signaturePredicates = {
  'RN-00131': 'Accept row-by-row operator page mapping and visual correspondence',
  'RN-00185': 'Accept closing design audit and skill coverage',
  'RN-00228': 'Sign production-critical review-animations critique',
  'RN-00235': 'Accept each changed-motion purpose, critique, before/after, trace and reduced-motion proof',
  'RN-00351': 'Sign independent review against the exact final candidate digest',
  'RN-01084': 'Approve joint ad pack, test ordering and GO only after its separate Q59 prerequisites',
  'RN-01287': 'Sign disclosure and overall net-impression review; no count/price-contract waiver',

  'RN-01499': 'Authorize exact seal retirement only after independently accepted final-pass-8 evidence',
  'RN-01992': 'Sign exact candidate/provenance and before/after card evidence at 375px and 1440px',
  'RN-02236': 'Approve any fifth motion purpose or require removal; no implied allowlist expansion',
  'RN-02389': 'Approve any luminance allowlist growth; threshold stays 0.6',
  'RN-EXTRA-3830': 'If redirect fidelity is not fixed, explicitly accept the retired-route 404 alternative',
  'RN-EXTRA-3836': 'Adjudicate the named Operator/Fable calls in the source section; do not guess',
  'RN-EXTRA-3842': 'Adjudicate remaining operator design judgments after items 1–4 are separately proven',
  'RN-EXTRA-3934': 'Authorize release only after governed pharmacy, non-deployed-artifact and function-transition checks',
  'RN-EXTRA-3938': 'Authorize exact phase-bound release after target, identity, freshness and publication evidence checks'
};
function artifact(p) {
  const bytes = fs.readFileSync(p);
  return { path: p, sha256: sha(bytes), bytes: bytes.length };
}
function candidateSubject() {
  // Bind the whole currently inspectable subject, not just a mutable directory name.
  // Exclude receipts/node_modules and never follow symlinks out of the candidate.
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Unbound symlink: ${p}`);
      if (entry.isDirectory()) visit(p);
      else if (entry.isFile()) files.push({ path: path.relative(candidate, p), ...artifact(p) });
    }
  };
  for (const folder of ['src', 'assets', 'data', 'public', 'functions', 'scripts', 'tests/browser']) {
    const p = path.join(candidate, folder);
    if (fs.existsSync(p)) visit(p);
  }
  for (const file of ['package.json', 'package-lock.json', 'wrangler.toml']) {
    const p = path.join(candidate, file); if (fs.existsSync(p)) files.push(artifact(p));
  }
  return { path: candidate, scope: 'src/assets/data/public/functions/scripts/tests-browser and package/config files; NOT a release seal',
    file_count: files.length, sha256: sha(JSON.stringify(files)), files };
}
function missing(predicate, id, detail) {
  return { predicate, pass: false, status: 'MISSING_EFFECT_EVIDENCE', occurrence_id: id,
    observed: detail, required_artifact: { candidate, predicate, occurrence_id: id },
    source_preservation_is_not_effect_proof: true };
}
export function priceMapSchemaInspection() {
  return check('Generated provider price-map grammar; unknown is not coerced to zero', () => {
    const file = `${candidate}/public/providers/index.html`, html = read(file);
    const maps = [...html.matchAll(/data-price-map=(?:"([^"]*)"|'([^']*)')/g)].map(m => (m[1] ?? m[2]).replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&'));
    assert.ok(maps.length, 'No generated price-map attributes');
    const known = maps.filter(Boolean); assert.ok(known.length, 'No nonempty price maps to exercise');
    let entries = 0;
    for (const map of known) {
      const seen = new Set();
      for (const part of map.split('|')) {
        const match = /^([A-Z][A-Z_]*):(\d+(?:\.\d+)?)$/.exec(part);
        assert.ok(match, 'Invalid medication:amount price-map entry');
        assert.ok(!seen.has(match[1]), 'Duplicate medication in price map'); seen.add(match[1]);
        assert.ok(Number.isFinite(Number(match[2])) && Number(match[2]) >= 0); entries++;
      }
    }
    return { artifact: artifact(file), attributes: maps.length, nonempty_maps: known.length, entries,
      unknown_empty_maps: maps.length - known.length,
      scope: 'Generated directory attributes only; does not prove source-qualified prices, sorting, pipeline execution, or production' };
  });
}
function concreteChecks(id) {
  const results = [];
  const add = (label, fn) => results.push(check(label, fn));
  if (['RN-00629', 'RN-00961'].includes(id)) results.push(priceMapSchemaInspection());
  if (['RN-00629', 'RN-00961'].includes(id)) add('Current generated provider price maps contain no undefined tokens; empty unknown values remain unknown', () => {
    const p = `${candidate}/public/providers/index.html`, html = read(p);
    const maps = [...html.matchAll(/data-price-map=(?:"([^"]*)"|'([^']*)')/g)];
    assert.ok(maps.length, 'No generated data-price-map attributes found');
    for (const m of maps) {
      const value = (m[1] ?? m[2]).replaceAll('&quot;', '"').replaceAll('&#34;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
      assert.ok(!value.includes('undefined'), 'Undefined price-map token');
    }
    return { ...artifact(p), price_maps: maps.length, empty_unknown_maps: maps.filter(m => !(m[1] ?? m[2])).length,
      scope: 'absence of undefined tokens only; not JSON, sourced-price, sorting or full pipeline proof' };
  });
  if (['RN-01851', 'RN-01982', 'RN-EXTRA-3934'].includes(id)) add('Exact raw/render pharmacy bytes match their governed manifest-bound inputs', () => {
    const b = json(`${candidate}/data/pharmacy-governed-source-binding.json`);
    const manifest = binding(b.governed_manifest);
    const files = [['candidate_raw_source','pharmacy-research-backfill-20260830.json'],['candidate_render_input','phase3-pharmacy-render-input.json']].map(([key, file]) => {
      const a = artifact(`${candidate}/data/${file}`);
      assert.equal(a.sha256, b[key].sha256); assert.equal(a.bytes, b[key].bytes); return a;
    });
    return { files, manifest: b.governed_manifest, snapshot: manifest.snapshot_id ?? b.snapshot_id,
      scope: 'byte integrity only; does not prove complete writer history or release authorization' };
  });
  if (['RN-EXTRA-3737', 'RN-EXTRA-3830', 'RN-EXTRA-3842'].includes(id)) add('Retired-route declaration and current review-server redirect support are separately inspected', () => {
    const redirects = `${candidate}/public/_redirects`, server = `${candidate}/tests/browser/glp34-provider-families.spec.mjs`;
    const declarations = read(redirects).split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
    const code = read(server);
    assert.ok(declarations.length, 'No redirect declarations');
    const supportsRedirects = code.includes("readFileSync") && /(?:readFileSync|read)\([^\n]*_redirects/.test(code);
    return { declarations: declarations.length, redirects: artifact(redirects), harness: artifact(server),
      redirect_aware_server_proven: false, source_mentions_redirect_parser: supportsRedirects,
      limitation: 'Declarations are not redirect behavior; inbound-link defects require separate checks' };
  });
  if (id === 'RN-02655') add('All frozen mapped C URLs rejoin to actual candidate output files, never substituted with /lp/r', () => {
    const freeze = json(`${execution}/../K10-007-A/reference-freeze.json`);
    const urls = new Set();
    const visit = value => {
      if (typeof value === 'string') for (const m of value.matchAll(/(?:https:\/\/[^\s"<>]+)?\/lp\/best-providers\/[a-z0-9/-]+/g)) urls.add(new URL(m[0], 'https://glpclinicscout.com').pathname);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    }; visit(freeze.baseline_rows); assert.ok(urls.size, 'No mapped C URLs found in frozen baseline rows');
    return [...urls].sort().map(route => ({ route, ...artifact(path.join(candidate, 'public', route.replace(/^\//, ''), 'index.html')) }));
  });
  return results;
}

function inboundRetirementCensus() {
  const redirectPath = `${candidate}/public/_redirects`;
  const declarations = read(redirectPath).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const sources = declarations.map(l => l.split(/\s+/)[0]).filter(s => s.startsWith('/'));
  assert.ok(sources.length, 'Nonempty redirect source set required');
  sources.push('/best/online-glp-1-providers/');
  const patterns = [...new Set(sources)].map(source => ({ source, regex: new RegExp(`^${source.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\/$/, '')}/?$`) }));
  const files = [], links = [], violations = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Cannot census symlink: ${p}`);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p.endsWith('.html')) {
        const html = read(p); files.push(artifact(p));
        const route = '/' + path.relative(`${candidate}/public`, p).replace(/index\.html$/, '');
        for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
          const href = (m[1] ?? m[2] ?? m[3]).replaceAll('&amp;', '&');
          if (/^(?:mailto|tel|javascript|data):/i.test(href)) continue;
          let u; try { u = new URL(href, `https://glpclinicscout.com${route}`); } catch { violations.push({ route, href, error: 'malformed href' }); continue; }
          if (u.origin !== 'https://glpclinicscout.com') continue;
          links.push({ route, href });
          const matches = patterns.filter(p => p.regex.test(u.pathname)).map(p => p.source);
          if (matches.length) violations.push({ route, href, retired_sources: matches });
        }
      }
    }
  }; walk(`${candidate}/public`);
  assert.ok(files.length && links.length, 'Non-vacuous all-HTML link census required');
  return { predicate: 'Fix-inbound-links alternative: all emitted HTML anchors avoid every declared retired source and the historical /best/online-glp-1-providers/ path',
    pass: violations.length === 0, observed: { html_files: files.length, internal_anchors: links.length,
      historical_best_path_inbound_count: violations.filter(v => v.retired_sources?.includes('/best/online-glp-1-providers/')).length,
      declared_sources: [...new Set(sources)], violations, public_html_sha256: sha(JSON.stringify(files.sort((a,b) => a.path.localeCompare(b.path)))),
      redirects: artifact(redirectPath), network_actions: 0,
      limitation: 'Static inbound-link repair alternative only; does not prove server redirects, JS-created links, or unrelated journey correctness' } };
}

function check(predicate, fn) {
  try { const observed = fn(); return { predicate, pass: observed !== false, observed }; }
  catch (error) { return { predicate, pass: false, error: String(error.message) }; }
}
function binding(b) { assert.equal(sha(fs.readFileSync(b.path)), b.sha256); return json(b.path); }
function replayAudit() {
  // Import the existing verifier, NOT its __main__ (which writes VERIFY-AUDIT).
  // -B and PYTHONDONTWRITEBYTECODE prevent import-cache filesystem effects.
  const code = 'import sys,json; sys.path.insert(0,sys.argv[1]); import verify_audit as v; from pathlib import Path; print(json.dumps(v.verify(json.loads((Path(sys.argv[1])/"MONEY-PAGE-AUDIT-2026-09-10.json").read_text()))))';
  const run = spawnSync('python3', ['-B', '-c', code, s26], {
    encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  assert.equal(run.status, 0, run.stderr || String(run.error || 'audit replay failed'));
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS'); assert.equal(result.audit_rows, 61);
  return result;
}

export async function provenanceClass(page, origin, viewport) {
  assert.ok(['desktop', 'mobile'].includes(viewport), 'Only named viewport evidence files allowed');
  const url = new URL(origin);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local candidate only');
  // This class performs filesystem evidence reconciliation; no page/request/GO action.
  let previewInspection;
  try {
    assert.ok(page && typeof page.evaluate === 'function', 'Real parent browser page required');
    const current = new URL(page.url()); assert.equal(current.origin, url.origin);
    assert.ok(!current.pathname.startsWith('/go/'));
    const local = path.resolve(candidate, 'public', `.${decodeURIComponent(current.pathname)}`);
    assert.ok(local.startsWith(`${candidate}/public/`));
    const file = fs.statSync(local).isDirectory() ? path.join(local, 'index.html') : local;
    const observed = await page.evaluate(() => ({ title: document.title, h1: document.querySelector('main h1, h1')?.textContent?.trim(), main: document.querySelector('main')?.textContent?.trim().length || 0, ready: document.readyState }));
    assert.ok(observed.main > 100 && observed.h1 && observed.title && observed.ready === 'complete');
    const html = read(file); assert.ok(html.includes(observed.title), 'Served title must match candidate output');
    previewInspection = { predicate: 'Inspect already-open current local candidate preview without navigation', pass: true, observed: { url: current.href, ...observed, artifact: artifact(file), scope: 'current page inspection only, not whole-family visual acceptance' } };
  } catch (error) {
    previewInspection = { predicate: 'Inspect already-open current local candidate preview without navigation', pass: false, error: error.message };
  }
  const subject = check('Hash currently inspectable candidate subject for operator review; not a seal', candidateSubject);
  let inbound;
  try { inbound = inboundRetirementCensus(); }
  catch (error) { inbound = { predicate: 'All-HTML retired-source inbound census', pass: false, error: error.message }; }
  const histogram = json(`${execution}/histogram.json`);
  const inventory = json(`${execution}/before/source-inventory.json`);
  const occurrences = histogram.occurrences.filter(o => o.primary_class === 'provenance-release-gates');
  const dispatchIDs = [...Object.keys(historical), ...Object.keys(required), ...auditIDs];
  assert.equal(occurrences.length, 58);
  assert.equal(new Set(dispatchIDs).size, 58);
  assert.deepEqual([...dispatchIDs].sort(), occurrences.map(o => o.id).sort());
  const notes = new Map(inventory.notes.map(n => [n.id, n]));
  const auditReplay = check('Replay existing S26 verifier: all 61 baseline identities, exact metric/query receipts, page captures, dispositions and gates; dated audit only', replayAudit);
  const rows = [];
  for (const occurrence of occurrences) {
    const n = notes.get(occurrence.id);
    const tests = [];
    const source = check('Exact original line span and literal requirement match; integrity is necessary, not semantic completion', () => {
      assert.ok(n); assert.equal(n.source_path, occurrence.source_path);
      const actual = read(n.source_path).split(/\r?\n/).slice(n.source_line - 1, n.source_end_line).join('\n');
      assert.equal(actual.trim(), n.literal_requirement.trim());
      assert.equal(sha(n.requirement), occurrence.requirement_sha256);
      return { source_path: n.source_path, start: n.source_line, end: n.source_end_line };
    });
    tests.push(source);
    let scope = 'UNVERIFIED_OBLIGATION';
    let constituents = [];
    if (historical[occurrence.id]) {
      scope = 'PRESERVED_DATED_DISPOSITION_ONLY';
      tests.push(check('Individual dated observation retains all named qualifiers and explicit non-current disposition', () => {
        assert.ok(contains(n.literal_requirement, historical[occurrence.id]));
        assert.match(n.disposition, /historical|HISTORICAL/);
        assert.match(n.historical_vs_current, /not current|not independently recertified/);
        assert.match(n.source_path, /2026\d{4}/);
        return { tokens: historical[occurrence.id], disposition: n.disposition, historical_vs_current: n.historical_vs_current, source_date: n.source_path.match(/2026\d{4}/)[0] };
      }));
      // Only these two compound records are pure preserved observations. No current
      // redirect/sitemap behavior or retrospective compliant chronology is asserted.
      if (occurrence.id === 'RN-00526') constituents = [
        check('Historical redirect observation retained separately', () => contains(n.literal_requirement, ['301 →', '/lp/best-providers/compounded-*'])),
        check('Historical sitemap absence retained separately', () => contains(n.literal_requirement, ['0 in sitemap', 'absent from sitemap']))
      ];
      if (occurrence.id === 'RN-EXTRA-3895') constituents = [
        check('Copy-promotion chronology remains explicitly defective, not retroactively compliant', () => contains(n.literal_requirement, ['loaded after exact user-specified provider-review copy promotion', 'not silently backfilled']))
      ];
      if (occurrence.compound_effects.length && !constituents.length) constituents.push(...occurrence.compound_effects.map(effect => missing(effect.effect, occurrence.id, 'Historical observation retained; current effect needs independent dedicated proof')));
    } else if (occurrence.id === 'RN-01380') {
      scope = 'CURRENT_ALL_ROW_RISK_PERMISSION_DISTINCTION';
      tests.push(check('All 17 silent-terms rows preserve risk acceptance separately from express permission, dates, hashes, limitations and terms evidence', () => {
        const ledger = json(`${business}/site-system/flagship-v2/candidates/glp34-provider-families-20260912/data/go-terms-review-ledger.json`);
        const entries = Object.entries(ledger.programs); assert.equal(entries.length, 17);
        for (const [id, row] of entries) {
          assert.equal(row.program_id, id); assert.equal(row.risk_accepted, true); assert.equal(row.express_network_permission_proven, false);
          assert.equal(row.accepted_as_of, '2026-09-10');
          assert.match(row.operator_decision_sha256, /^[a-f0-9]{64}$/); assert.match(row.operator_selection_receipt_sha256, /^[a-f0-9]{64}$/);
          assert.ok(row.limitation && row.limitation.trim().length > 20);
          if (row.terms_source_url) assert.equal(new URL(row.terms_source_url).protocol, 'https:');
          else { assert.equal(row.network, 'affiliati'); assert.equal(sha(fs.readFileSync(row.terms_source_artifact)), row.terms_source_artifact_sha256); }
        }
        return { evaluated: entries.map(([id]) => id), risk_not_express_permission: true };
      }));
    } else if (occurrence.id === 'RN-01982') {
      scope = 'CURRENT_RESEARCH_FACT_IMMUTABILITY';
      tests.push(check('Complete raw and render inputs equal research-bound source and unchanged predecessor, with no new snapshot fabricated', () => {
        const candidate = `${business}/site-system/flagship-v2/candidates/glp34-provider-families-20260912`;
        const predecessor = `${business}/site-system/flagship-v2/work/glp215-accepted-base`;
        const bound = json(`${candidate}/data/pharmacy-governed-source-binding.json`);
        const rows = [];
        for (const [key, file] of [['candidate_raw_source','pharmacy-research-backfill-20260830.json'],['candidate_render_input','phase3-pharmacy-render-input.json']]) {
          const bytes = fs.readFileSync(`${candidate}/data/${file}`);
          assert.equal(bytes.length, bound[key].bytes); assert.equal(sha(bytes), bound[key].sha256);
          assert.deepEqual(bytes, fs.readFileSync(`${predecessor}/data/${file}`));
          rows.push({file, bytes:bytes.length, all_source_fields_unchanged:true});
        }
        binding(bound.governed_manifest);
        return rows;
      }));
    } else if (occurrence.id === 'RN-EXTRA-3737') {
      scope = 'CURRENT_ALL_HTML_INBOUND_REPAIR_ALTERNATIVE';
      tests.push(inbound);
      constituents = [inbound];
    } else if (occurrence.id === 'RN-00635') {
      scope = 'CURRENT_LOCAL_PREVIEW_INSPECTION'; tests.push(previewInspection);
    } else if (required[occurrence.id]) {
      // Every obligation has its own effect record. Concrete diagnostics do not
      // discharge adjacent untested runtime, chronology, independent-review or GO predicates.
      constituents = required[occurrence.id].map(predicate => missing(predicate, occurrence.id,
        `Required ${predicate}; obtain exact-artifact evidence through its owner. This no-network reconciliation cannot infer execution from prose or a generic PASS.`));
      if (occurrence.id === 'RN-00629') tests.push(previewInspection);
    } else {
      scope = 'DATED_S26_SOURCE_RECONCILIATION_ONLY';
      tests.push(auditReplay);
      tests.push(check(`Individual ${occurrence.id} S26 predicate`, () => {
        const doc = json(`${s26}/MONEY-PAGE-AUDIT-2026-09-10.json`);
        const md = read(`${s26}/MONEY-PAGE-AUDIT-2026-09-10.md`);
        switch (occurrence.id) {
          case 'RN-01274':
            assert.equal(doc.rows.length, 61);
            assert.ok(doc.rows.every(r => r.page && r.change_class && r.current_page_receipt && r.gates && r.original_disposition && r.decision));
            return { rows: 61, identities: doc.rows.map(r => ({ id: r.audit_row_id, page: r.page, decision: r.decision, change_class: r.change_class })) };
          case 'RN-01275':
            assert.ok(doc.rows.every(r => md.includes(`| ${r.page} / ${r.program_id || 'directory'} | ${r.decision} |`)));
            return { projected_rows: 61 };
          case 'RN-01276': {
            const receipt = json(`${s26}/VERIFY-AUDIT.json`); binding(receipt.audit);
            assert.equal(path.resolve(receipt.audit.path), `${s26}/MONEY-PAGE-AUDIT-2026-09-10.json`);
            const ws = read(`${plan}/../WS-S/MONEY-PAGE-AUDIT.md`);
            assert.match(ws.slice(0, 6000), /2026-09-10/); assert.match(ws, /historical|Historical/);
            return { receipt, ws_s_historical_retained: true };
          }
          case 'RN-01277':
            assert.notEqual(doc.baseline.path, `${s26}/MONEY-PAGE-AUDIT-2026-09-10.json`);
            binding(doc.baseline); binding(doc.gsc_evidence_index); binding(doc.page_capture_index);
            assert.ok(doc.rows.every(r => r.current_page_receipt.path.startsWith(`${s26}/PAGE-CAPTURES/`)));
            return { baseline: doc.baseline, refreshed: `${s26}/MONEY-PAGE-AUDIT-2026-09-10.json`, indexes: [doc.gsc_evidence_index, doc.page_capture_index] };
          case 'RN-01302': {
            const missing = doc.rows.filter(r => r.current.status === 'UNKNOWN_NO_RETURNED_ROW');
            assert.equal(missing.length, 3);
            assert.ok(missing.every(r => ['clicks', 'impressions', 'ctr', 'position'].every(k => r.current[k] === null)));
            const hidden = doc.rows.filter(r => !r.current_queries.length);
            assert.ok(hidden.length > 0 && hidden.every(r => r.query_visibility.startsWith('UNKNOWN')));
            return { missing_pages: missing.map(r => r.page), hidden_query_pages: hidden.map(r => r.page) };
          }
          case 'RN-01304': {
            const index = binding(doc.gsc_evidence_index);
            const current = binding(index.snapshots['current28-page']);
            const previous = binding(index.snapshots['audit28-page']);
            assert.equal(index.property, 'https://glpclinicscout.com/');
            assert.equal(index.overlapping_windows, true); assert.equal(index.overlap_days, 25);
            assert.equal(current.context.start_date, '2026-08-11'); assert.equal(current.context.end_date, '2026-09-07');
            assert.equal(previous.context.start_date, '2026-08-08'); assert.equal(previous.context.end_date, '2026-09-04');
            assert.equal(current.context.finalization_explicitly_verified, false);
            assert.ok(contains(md, ['three-day lag', 'not a causal experiment', 'No cross-property delta']));
            return { current: current.context, previous: previous.context, limits: index.limits };
          }
          case 'RN-01306':
            binding(doc.weekly_strategy.binding); assert.equal(doc.weekly_strategy.machine_touched, false);
            assert.ok(contains(n.requirement, ['Greenwich Rx/ProRx', 'K6b/Q24', 'Do not create another scheduler']));
            return { weekly_strategy: doc.weekly_strategy, scope: 'Bound historical handoff ownership, not a machine-execution audit' };
          case 'RN-01308':
            assert.ok(doc.rows.every(r => r.publication_authorized === false));
            assert.ok(contains(n.requirement, ['Independent review', 'not established', 'not a release or spend approval']));
            return { publication_authorized: false, release_authorized: false, independent_acceptance_claimed: false };
          default: throw new Error('No S26 predicate');
        }
      }));
      if (occurrence.id === 'RN-01274') constituents = [
        { predicate: 'All 61 original identities and exact/structural dispositions rejoined to baseline', pass: auditReplay.pass, observed: auditReplay },
        { predicate: 'All page captures and GSC metric/query receipts rejoined by exact URL, not sampled', pass: auditReplay.pass, observed: auditReplay }
      ];
    }
    // Merely retaining dated prose is not current semantic completion. Preserve
    // its source readback in this receipt without crediting it to resolved/378.
    const evidence_checks = concreteChecks(occurrence.id);
    if (['RN-EXTRA-3830', 'RN-EXTRA-3842'].includes(occurrence.id)) evidence_checks.push(inbound);
    if (occurrence.id === 'RN-00961' && evidence_checks[0]) constituents[0] = { ...evidence_checks[0], predicate: required[occurrence.id][0] };
    if (occurrence.id === 'RN-EXTRA-3934' && evidence_checks[0]) constituents[0] = { ...evidence_checks[0], predicate: required[occurrence.id][0] };
    const signature_requests = signaturePredicates[occurrence.id] ? [{
      id: `${occurrence.id}:operator-signature`, occurrence_id: occurrence.id,
      status: 'AWAITING_OPERATOR_SIGNATURE', signer: 'Izaiah', signature: null,
      predicate: signaturePredicates[occurrence.id], source_predicate: n?.literal_requirement,
      artifact_to_sign: { candidate, candidate_subject_sha256: subject.pass ? subject.observed.sha256 : null,
        candidate_subject_scope: subject.pass ? subject.observed.scope : null,
        source_requirement_sha256: occurrence.requirement_sha256,
        receipt: `${execution}/after/${viewport}-provenance-class.json` },
      intake: 'Existing authenticated operator approval path; this handler cannot certify signatures',
      permission: 'No release, spending, send, deletion, or independent acceptance is authorized'
    }] : [];
    const resolved = !signature_requests.length && scope !== 'PRESERVED_DATED_DISPOSITION_ONLY' && [...tests, ...constituents].every(t => t.pass === true);
    const failures = [...tests, ...constituents, ...evidence_checks].filter(t => !t.pass);
    rows.push({ id: occurrence.id, status: resolved ? 'RESOLVED' : signature_requests.length ? 'AWAITING_OPERATOR_SIGNATURE' : 'UNVERIFIED', resolved, scope, source: n || null,
      compound_effects: occurrence.compound_effects, tests, constituents,
      evidence_checks, signature_requests, non_signature_failures: failures,
      historical_only: scope === 'PRESERVED_DATED_DISPOSITION_ONLY',
      current_behavior_tested: occurrence.id === 'RN-00635' && previewInspection.pass, release_or_review_authority: false });
  }
  const resolved = rows.filter(r => r.resolved).map(r => r.id);
  const unresolved = rows.filter(r => !r.resolved).map(r => r.id);
  fs.writeFileSync(`${execution}/after/${viewport}-provenance-class.json`, JSON.stringify({
    schema: 'glp34-provenance-occurrences-v2', viewport, origin, denominator: 58,
    skills_loaded: ['site-build-harness', 'research-source-evaluation'], skills_should_have_loaded: ['site-build-harness', 'research-source-evaluation'],
    candidate_subject: subject, signature_requests: rows.flatMap(r => r.signature_requests),
    awaiting_operator_signature_count: rows.filter(r => r.signature_requests.length).length,
    non_signature_failure_count: rows.reduce((sum,r) => sum + r.non_signature_failures.length, 0),
    scope: 'Individual preserved historical dispositions and source reconciliation only; current dependent behaviors and independent gates remain unverified.',
    resolved, unresolved, resolved_count: resolved.length, unresolved_count: unresolved.length,
    complete_family_coverage: false, network_actions: 0, rows
  }, null, 2) + '\n');
  return resolved;
}
