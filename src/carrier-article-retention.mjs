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
export function loadCarrierArticle(root, manifestPath = MANIFEST, manifestSha256 = MANIFEST_SHA256) {
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
    const data = JSON.parse(read(binding.path))[binding.key];
    const matches = binding.identity ? data.filter(x => x[binding.identity] === manifest.route) : [data[manifest.route]];
    if (matches.length !== 1 || !matches[0] || sha(JSON.stringify(sorted(matches[0]))) !== binding.sha256) throw new Error(`carrier_article_metadata_drift:${binding.path}`);
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
export function loadCarrierArticles(root) {
  const retained = [loadCarrierArticle(root), loadCarrierArticle(root,
    'data/carrier-articles/top-rated-glp-1-providers/manifest.json',
    'b8e75f38ad9ddddcefbf85b8e9a7256b71db3b075ceddf87c838ad0f37d67960')];
  return new Map(retained.map(row => [row.manifest.relative, row]));
}
