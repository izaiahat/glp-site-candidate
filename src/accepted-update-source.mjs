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
function preserveInactiveLegacyGovernance(before, article) {
  // The QA/five-gate subject stays byte-identical. Only the authenticated
  // predecessor owns rendering governance, as in the native R2 builder.
  const neutral = article.commercial_link_taxonomy === 'medical_claims'
    && Array.isArray(article.exact_services) && article.exact_services.length === 0
    && article.has_affiliate_cta === false && article.inline_ftc_disclosure === false
    && article.surface_taxonomy === 'medical' && article.suppress_cta === true
    && article.risk_tier === before.risk_tier
    && article.comparison_required === false && before.comparison_required === false
    && (before.comparison_spec === null || !Object.hasOwn(before, 'comparison_spec'))
    && ['offer_module','affiliate_link','affiliate_links'].every(k => !Object.hasOwn(before,k) && !Object.hasOwn(article,k))
    && !Object.hasOwn(article,'inline_ftc_disclosure_text');
  if (!neutral) throw new Error('accepted_update_governance_changed');
  const result = {...article};
  for (const key of GOVERNANCE) {
    if (Object.hasOwn(before,key)) result[key] = structuredClone(before[key]);
    else delete result[key];
  }
  return result;
}

export function applyAcceptedUpdateOwnership(owners, articles, updates) {
  // Reuse exact predecessor/identity/governance authentication. Only the
  // accepted target query changes; release flags and frozen inputs do not.
  applyAcceptedUpdates(articles, updates);
  const result = [...owners];
  for (const {article} of updates) {
    const before = articles.find(a => a.canonical_path === article.canonical_path);
    const matches = result.map((row, index) => [row, index]).filter(([row]) => row.url === article.canonical_path);
    if (matches.length !== 1) throw new Error('accepted_update_ownership_count_invalid');
    const [owner, index] = matches[0];
    if ((owner.article_id || owner.owner) !== article.article_id || owner.risk_tier !== article.risk_tier
        || owner.primary_keyword !== before.primary_keyword || typeof article.primary_keyword !== 'string' || !article.primary_keyword.trim()) {
      throw new Error('accepted_update_ownership_identity_invalid');
    }
    result[index] = {...owner, primary_keyword: article.primary_keyword};
  }
  return result;
}

export function applyAcceptedUpdates(articles, updates) {
  const result = [...articles];
  for (const {article, before_sha256} of updates) {
    const matches = result.map((a,i) => [a,i]).filter(([a]) => a.canonical_path === article.canonical_path);
    if (matches.length !== 1 || matches[0][0].article_id !== article.article_id) throw new Error('accepted_update_identity_invalid');
    const [before, index] = matches[0];
    if (objectSha(before) !== before_sha256) throw new Error('accepted_update_predecessor_changed');
    const changed = GOVERNANCE.some(k => JSON.stringify(before[k]) !== JSON.stringify(article[k]));
    const replacement = changed ? preserveInactiveLegacyGovernance(before, article) : article;
    if (GOVERNANCE.some(k => JSON.stringify(before[k]) !== JSON.stringify(replacement[k]))) throw new Error('accepted_update_governance_changed');
    result[index] = replacement;
  }
  return result;
}
