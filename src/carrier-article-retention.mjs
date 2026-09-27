// D2s operator amendment: retain the exact already-published carrier article.
// This is a frozen source input, not a failed-build restoration fallback.
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { releaseExportPolicy, policyMarkup, stageCandidateExportPolicy, candidateExportShellFindings } from './candidate-export-policy.mjs';
const MANIFEST = 'data/carrier-articles/ezra-glp-1-reviews/manifest.json';
const MANIFEST_SHA256 = '07c9a4ba3a9f9ec8a8c025b3a4979a2ed354b506a480097eb81e386a97107c6b';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = x => Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
export function assertCarrierArticleBytes(retained, bytes) {
  if (sha(bytes) !== retained.manifest.html_sha256) throw new Error('carrier_article_output_drift');
}
export function renderedCarrierArticle(retained, stage = releaseExportPolicy().stage) {
  assertCarrierArticleBytes(retained, retained.bytes);
  if (stage === 'candidate') return retained.bytes;
  releaseExportPolicy(stage);
  const original = retained.bytes.toString();
  const held = policyMarkup(releaseExportPolicy('candidate'));
  if (original.split(held).length !== 2 || candidateExportShellFindings(original, {stage:'candidate'}).length) throw new Error('carrier_article_candidate_shell_drift');
  const html = stageCandidateExportPolicy(original.replace(held, policyMarkup(releaseExportPolicy(stage))), {stage});
  if (candidateExportShellFindings(html, {stage}).length || html.match(/<main\b[\s\S]*?<\/main>/)?.[0] !== original.match(/<main\b[\s\S]*?<\/main>/)?.[0]) throw new Error('carrier_article_production_shell_drift');
  return Buffer.from(html);
}
export function assertCarrierArticleOutput(retained, bytes, stage = releaseExportPolicy().stage) {
  if (!Buffer.from(bytes).equals(renderedCarrierArticle(retained, stage))) throw new Error('carrier_article_output_drift');
}
// GLP-75 option (a): only these two frozen carriers may split the historical
// record hash from the six mandatory bindings added by the registered rebind.
// No stored record, historical pin, held byte or other binding is rewritten.
const IMAGE_MANIFEST = 'artifacts/ultracode/article-image-manifest.json';
const INPUT_KEYS = ['image_inputs', 'image_inputs_sha256', 'current_image_inputs', 'current_image_inputs_sha256', 'image_input_diff', 'inputs_stale'];
const REBIND_RECEIPT = 'artifacts/ultracode/article-image-REBIND-abfcc41435f896df-7f3b9b7eca877071.json';
const REBIND_RECEIPT_SHA256 = '0f6d74cbc966525b4a6d4cfffd4868b6e4d90ac95a104da81828d189d3963241';
const REBIND_CARRIERS = [
  [MANIFEST, MANIFEST_SHA256, '/guides/ezra-glp-1-reviews/'],
  ['data/carrier-articles/top-rated-glp-1-providers/manifest.json', 'b8e75f38ad9ddddcefbf85b8e9a7256b71db3b075ceddf87c838ad0f37d67960', '/guides/top-rated-glp-1-providers/'],
];
const canonical = value => JSON.stringify(sorted(value));
const historicalImageRecord = record => Object.fromEntries(Object.entries(record).filter(([key]) => !INPUT_KEYS.includes(key)));
function validateCarrierImageInputs(read, manifest, binding, record, imageBytes) {
  const fail = reason => { throw new Error(`carrier_article_image_binding_${reason}:${manifest.route}`); };
  // The complete article is independently frozen by the old carrier manifest.
  // BASELINE-EQUIVALENCE evidence in ops/glp75-carrier-image-rebind.md proves this
  // exact record equals the hash-authenticated generation-baseline article.
  const articleBindings = manifest.bindings.filter(b => b.path === 'data/blog/content-batch.json' && b.key === 'articles' && b.identity === 'canonical_path');
  if (articleBindings.length !== 1) fail('article_anchor');
  const articleBinding = articleBindings[0];
  const articles = JSON.parse(read(articleBinding.path)).articles.filter(a => a.canonical_path === manifest.route);
  if (articles.length !== 1 || sha(canonical(articles[0])) !== articleBinding.sha256) fail('article_anchor');
  const article = articles[0];
  const inputs = {canonical_path: article.canonical_path, h1: article.h1, primary_keyword: article.primary_keyword ?? ''};
  if (Object.values(inputs).some(v => typeof v !== 'string') || sha(inputs.h1) !== record.title_sha256) fail('identity');
  // This exact metadata-only transition requires original == current, not a WARN
  // or an original supplied by the image record itself. Coherent forgery fails.
  const expected = {image_inputs: inputs, image_inputs_sha256: sha(canonical(inputs)),
    current_image_inputs: inputs, current_image_inputs_sha256: sha(canonical(inputs)),
    image_input_diff: {}, inputs_stale: false};
  for (const key of INPUT_KEYS) {
    if (!Object.hasOwn(record, key) || canonical(record[key]) !== canonical(expected[key])) fail(`unauthenticated_${key}`);
  }
  // Authenticate the existing producer receipt, then its preimage and current
  // manifest. These are additional checks, never substitutes for the old pins.
  const receiptBytes = read(REBIND_RECEIPT);
  if (sha(receiptBytes) !== REBIND_RECEIPT_SHA256) fail('receipt_drift');
  const receipt = JSON.parse(receiptBytes);
  const beforeBytes = read(`artifacts/ultracode/article-image-manifest-before-${receipt.before_manifest_sha256}.json`);
  if (sha(beforeBytes) !== receipt.before_manifest_sha256 || sha(imageBytes) !== receipt.after_manifest_sha256) fail('manifest_lineage');
  const before = JSON.parse(beforeBytes);
  const originals = before.records.filter(r => r.route === manifest.route);
  if (originals.length !== 1 || sha(canonical(originals[0])) !== binding.sha256 ||
      canonical(originals[0]) !== canonical(historicalImageRecord(record))) fail('historical_record');
  const entries = receipt.records.filter(r => r.route === manifest.route);
  const expectedEntry = {route: manifest.route, before_input_sha256: expected.image_inputs_sha256,
    after_input_sha256: expected.current_image_inputs_sha256, inputs_stale: false, diff: {}};
  if (entries.length !== 1 || canonical(entries[0]) !== canonical(expectedEntry)) fail('receipt_inputs');
  if (canonical(before.source_files) !== canonical(receipt.before_source_files) ||
      canonical(JSON.parse(imageBytes).source_files) !== canonical(receipt.after_source_files)) fail('source_lineage');
  for (const source of receipt.after_source_files) if (sha(read(source.path)) !== source.sha256) fail('current_source');
}
export function loadCarrierArticle(root, manifestPath = MANIFEST, manifestSha256 = MANIFEST_SHA256) {
  return loadCarrierArticleContract(root, manifestPath, manifestSha256, true);
}
function loadCarrierArticleContract(root, manifestPath, manifestSha256, requireRebind) {
  function read(relative) {
    if (!relative || path.isAbsolute(relative) || relative.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('carrier_article_path');
    const parts = relative.split('/');
    for (let i = 1; i <= parts.length; i++) if (lstatSync(path.join(root, ...parts.slice(0, i))).isSymbolicLink()) throw new Error('carrier_article_symlink');
    return readFileSync(path.join(root, relative));
  }
  const raw = read(manifestPath);
  if (sha(raw) !== manifestSha256) throw new Error('carrier_article_manifest_drift');
  const manifest = JSON.parse(raw);
  for (const binding of manifest.bindings) {
    const bindingBytes = read(binding.path);
    const data = JSON.parse(bindingBytes)[binding.key];
    const matches = binding.identity ? data.filter(x => x[binding.identity] === manifest.route) : [data[manifest.route]];
    const splitInputs = requireRebind && binding.path === IMAGE_MANIFEST && binding.key === 'records' && binding.identity === 'route' &&
      REBIND_CARRIERS.some(([p, h, route]) => p === manifestPath && h === manifestSha256 && route === manifest.route);
    if (matches.length !== 1 || !matches[0] || sha(canonical(splitInputs ? historicalImageRecord(matches[0]) : matches[0])) !== binding.sha256) throw new Error(`carrier_article_metadata_drift:${binding.path}`);
    if (splitInputs) validateCarrierImageInputs(read, manifest, binding, matches[0], bindingBytes);
  }
  for (const file of manifest.files) {
    const bytes = read(file.path);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`carrier_article_asset_drift:${file.path}`);
  }
  const bytes = read(manifest.snapshot);
  const retained = { manifest, manifest_sha256: manifestSha256, bytes };
  assertCarrierArticleBytes(retained, bytes);
  return retained;
}
// Comparison-only entry for authenticated, pre-rebind predecessor releases.
// It uses the unchanged WHOLE-record historical hash: no field exclusion, no
// receipt successor, no caller-selected pins. Never use for current emission.
export function loadHistoricalCarrierArticles(root) {
  const retained = REBIND_CARRIERS.map(([p, h]) => loadCarrierArticleContract(root, p, h, false));
  return new Map(retained.map(row => [row.manifest.relative, row]));
}
export function loadCarrierArticles(root) {
  const retained = [loadCarrierArticle(root), loadCarrierArticle(root,
    'data/carrier-articles/top-rated-glp-1-providers/manifest.json',
    'b8e75f38ad9ddddcefbf85b8e9a7256b71db3b075ceddf87c838ad0f37d67960')];
  return new Map(retained.map(row => [row.manifest.relative, row]));
}
