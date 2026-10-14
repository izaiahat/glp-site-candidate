// Operator-approved main-release source lane. Accepted prose stays byte-bound;
// old catalogs and their frozen image lineage are not rewritten by an addition.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function loadAcceptedGuides(root, manifestName = 'manifest.json') {
  if (!['manifest.json','updates.json'].includes(manifestName)) throw new Error('accepted_manifest_name_invalid');
  const manifest = JSON.parse(readFileSync(path.join(root, 'data/blog/accepted-guides', manifestName)));
  const routes = new Set();
  return manifest.entries.map(entry => {
    const read = spec => {
      if (!/^data\/blog\/accepted-guides\/[a-z0-9-]+\/[a-z0-9_.-]+\.json$/.test(spec.path)) throw new Error('accepted_guide_path_invalid');
      const bytes = readFileSync(path.join(root, spec.path));
      if (sha(bytes) !== spec.sha256) throw new Error('accepted_guide_source_drift');
      return JSON.parse(bytes);
    };
    const article = read(entry.article), qa = read(entry.qa), review = read(entry.review);
    if (qa.status !== 'PASS' || Object.values(qa.checks).some(x => x !== true) ||
        review.status !== 'PASS_OPUS_SEO_DRAFT' || review.findings.length ||
        JSON.stringify(review.gates.map(g => g.gate).sort()) !== JSON.stringify(['A','B','C','D','E']) ||
        review.gates.some(g => g.status !== 'PASS' || g.findings.length)) throw new Error('accepted_guide_acceptance_invalid');
    if (qa.artifacts['06-article.json'].sha256 !== entry.article.sha256 ||
        article.canonical_path !== entry.route || review.authority.selection_binding.target_route !== entry.route ||
        article.batch_gate_passed !== true || article.operator_release_receipt !== null || !/^[a-f0-9]{64}$/.test(review.receipt_sha256 || '') ||
        !/^\/guides\/[a-z0-9-]+\/$/.test(entry.route) || routes.has(entry.route) ||
        article.has_affiliate_cta !== false || article.suppress_cta !== true) throw new Error('accepted_guide_identity_invalid');
    // Source-reviewed event metadata is a rendering projection, never a rewrite
    // of the accepted article/QA/review. Evidence hashes are audit references,
    // not authentication or a replacement for independent source/health review.
    let datePublished = article.date_published;
    if (entry.first_publication !== undefined) {
      const event = entry.first_publication;
      const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace('Z', '.000Z');
      const day = value => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles',
        year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(value));
      if (!event || event.timezone !== 'America/Los_Angeles'
          || !instant(event.not_before_utc) || !instant(event.observed_live_by_utc)
          || event.not_before_utc > event.observed_live_by_utc
          || day(event.not_before_utc) !== event.date || day(event.observed_live_by_utc) !== event.date
          || !/^[a-f0-9-]{36}$/.test(event.deployment_id || '') || !/^[a-f0-9]{40}$/.test(event.site_head || '')
          || !Array.isArray(event.evidence) || !event.evidence.length
          || event.evidence.some(s => !s.path?.startsWith('reports/') || !/^[a-f0-9]{64}$/.test(s.sha256 || ''))
          || (datePublished != null && datePublished !== event.date)) throw new Error('accepted_guide_publication_binding_invalid');
      datePublished = event.date;
    }
    routes.add(entry.route);
    return {...article, date_published: datePublished, operator_release_receipt: review.receipt_sha256};
  });
}
export function acceptedGuideOwnership(articles) {
  return articles.map(a => ({primary_keyword:a.primary_keyword,url:a.canonical_path,risk_tier:a.risk_tier,owner:a.article_id,article_id:a.article_id,status:a.status}));
}
const esc = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function addAcceptedInboundLinks(html, route, articles) {
  const links = articles.flatMap(article => (article.inbound_link_plan || [])
    .filter(plan => plan.source_route === route)
    .map(plan => {
      if (plan.target_route !== article.canonical_path) throw new Error('accepted_guide_inbound_target_invalid');
      return `<li><a href="${esc(article.canonical_path)}">${esc(article.title)}</a></li>`;
    }));
  if (!links.length) return html;
  if ((html.match(/<\/main>/g)||[]).length !== 1) throw new Error('accepted_guide_inbound_main_invalid');
  return html.replace('</main>', `<aside class="guide-related" aria-label="Related accepted guides"><h2>Related guides</h2><ul>${links.join('')}</ul></aside></main>`);
}
