// Existing-route replacements use the same exact QA/five-gate accepted source
// lane; they replace once, never append a duplicate or mutate frozen catalogs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadAcceptedGuides } from './accepted-guide-source.mjs';
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
export const objectSha = x => createHash('sha256').update(JSON.stringify(stable(x)) + '\n').digest('hex');
const GOVERNANCE = ['risk_tier','surface_taxonomy','comparison_required','comparison_spec','offer_module',
  'has_affiliate_cta','affiliate_link','affiliate_links','inline_ftc_disclosure','inline_ftc_disclosure_text',
  'ftc_disclosure_placement','suppress_cta'];
export function loadAcceptedUpdates(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'data/blog/accepted-guides/updates.json')));
  if (manifest.schema !== 'glp-accepted-guide-updates-v1') throw new Error('accepted_update_manifest_invalid');
  const articles = loadAcceptedGuides(root, 'updates.json');
  return articles.map((article, index) => ({article, before_sha256:manifest.entries[index].before_sha256}));
}
export function applyAcceptedUpdates(articles, updates) {
  const result = [...articles];
  for (const {article, before_sha256} of updates) {
    const matches = result.map((a,i) => [a,i]).filter(([a]) => a.canonical_path === article.canonical_path);
    if (matches.length !== 1 || matches[0][0].article_id !== article.article_id) throw new Error('accepted_update_identity_invalid');
    const [before, index] = matches[0];
    if (objectSha(before) !== before_sha256) throw new Error('accepted_update_predecessor_changed');
    if (GOVERNANCE.some(k => JSON.stringify(before[k]) !== JSON.stringify(article[k]))) throw new Error('accepted_update_governance_changed');
    result[index] = article;
  }
  return result;
}
