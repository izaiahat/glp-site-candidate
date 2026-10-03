// Denial-only F03 relationship overlay. This module never grants activation,
// selects a different rail, changes patient prices or calculates earnings.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function historicalAffiliateRegistry(registry) {
  const result = structuredClone(registry);
  for (const p of result.programs || []) delete p.affiliate_relationship_snapshot;
  return result;
}

export function effectiveAffiliateRegistry(registry) {
  const result = structuredClone(registry);
  for (const p of result.programs || []) {
    if (p.affiliate_relationship_snapshot?.lifecycle !== 'withdrawn') continue;
    p.commercial_state = 'held';
    p.go = {...p.go, entry_state:'held'};
    for (const profile of Object.values(p.profiles || {})) {
      profile.wired = false;
      for (const surface of ['compare','quiz','calculator','review','sitemap','go']) {
        profile.surfaces[surface] = false;
        (profile.exceptions ||= {})[surface] ||= {enabled:true,
          reason:'Reported selected affiliate relationship withdrawn.',
          surface_restriction_basis:'sole_writer_withdrawn_relationship'};
      }
    }
  }
  return result;
}

export function relationshipDenials(registry) {
  return (registry?.programs || []).filter(p => p.affiliate_relationship_snapshot?.promotion_denied === true)
    .map(p => ({program_id:p.program_id, render_id:p.review_slug || p.program_id, ...p.affiliate_relationship_snapshot}));
}

export function publicAffiliateTerms(registry) {
  return (registry?.programs || []).flatMap(p => {
    const relationship=p.affiliate_relationship_snapshot, terms=relationship?.terms;
    if (!terms || terms.source_kind !== 'authenticated_network_api_via_sole_sheet_writer'
        || !terms.commission_terms || !/^[a-f0-9]{64}$/.test(terms.capture_sha256 || '')
        || !/^[a-f0-9]{64}$/.test(terms.writer_receipt_sha256 || '')) return [];
    return [{program_id:p.program_id, display_name:p.display_name, network:relationship.network,
      commission_terms:terms.commission_terms, cookie_window:terms.cookie_window || null,
      checked_at:terms.source_checked_at || null, reported_information:true}];
  });
}

export function renderAffiliateTerms(registry) {
  const rows=publicAffiliateTerms(registry);
  if (!rows.length) return '';
  return `<section class="panel" data-affiliate-terms><h2>Reported affiliate terms</h2><p>These are payments the affiliate network reports to the publisher, not prices charged to patients, medical recommendations, or guaranteed earnings. Different payable events and terms are not directly comparable. Unknown terms are not treated as zero. They do not change our evidence scores.</p>${rows.map(p=>`<h3>${esc(p.display_name)}</h3><p>${esc(p.commission_terms)}</p><p class="affiliate-note">Reported information from ${esc(p.network)}; checked ${esc(p.checked_at || 'date unknown')}. Cookie window: ${esc(p.cookie_window || 'not established by this rate source')}.</p>`).join('')}</section>`;
}
