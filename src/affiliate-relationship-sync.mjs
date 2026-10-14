import {deriveDynamicFacetCounts} from './provider-dynamic-profiles.mjs';

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
    const lifecycle = p.affiliate_relationship_snapshot?.lifecycle;
    if (!['withdrawn','ended'].includes(lifecycle)) continue;
    const retainEditorial = lifecycle === 'ended' && p.affiliate_relationship_snapshot.editorial_retained === true;
    p.commercial_state = 'held';
    p.go = {...p.go, entry_state:'held'};
    for (const profile of Object.values(p.profiles || {})) {
      profile.wired = false;
      for (const surface of ['compare','quiz','calculator','review','sitemap','go']) {
        if (retainEditorial && ['review','sitemap'].includes(surface)) continue;
        profile.surfaces[surface] = false;
        (profile.exceptions ||= {})[surface] ||= {enabled:true,
          reason:'Reported selected affiliate relationship withdrawn.',
          surface_restriction_basis:'sole_writer_withdrawn_relationship'};
      }
    }
  }
  const removed = new Set((result.programs || []).filter(p => ['withdrawn','ended'].includes(p.affiliate_relationship_snapshot?.lifecycle)).map(p => p.program_id));
  const dynamic = result.provider_dynamic_profiles;
  if (removed.size && dynamic) {
    if (JSON.stringify(dynamic.expected_counts) !== JSON.stringify(deriveDynamicFacetCounts(dynamic.profiles)))
      throw new Error('relationship_dynamic_raw_count');
    for (const [id, profile] of Object.entries(dynamic.profiles)) {
      const members = profile.registry_program_ids;
      if (!Array.isArray(members) || !members.length) throw new Error('relationship_dynamic_identity');
      if (!members.some(member => removed.has(member))) continue;
      if (!members.every(member => removed.has(member))) throw new Error('relationship_dynamic_partial_identity');
      delete dynamic.profiles[id];
    }
    dynamic.expected_counts = deriveDynamicFacetCounts(dynamic.profiles);
  }
  return result;
}

// Project current denials into consumer copies, not frozen approval evidence.
// Raw counts must first match raw membership; subtraction cannot heal drift.
export function effectiveAffiliateBuildInputs(registry, inputs, profileId) {
  const result = structuredClone(inputs);
  const {eligibility, contentLedger, activationSelection} = result;
  const ids = rows => rows.map(p => p.program_id);
  for (const rows of [registry.programs, eligibility.programs, contentLedger.programs]) {
    if (new Set(ids(rows)).size !== rows.length) throw new Error('relationship_build_identity');
  }
  const ledger = new Map(contentLedger.programs.map(p => [p.program_id, p]));
  const rawLive = registry.programs.filter(p => p.commercial_state === 'live'
    && p.profiles?.[profileId]?.vertical_fit === true && p.profiles[profileId].wired === true
    && p.profiles[profileId].surfaces?.review === true);
  const commercial = p => p?.live_link_allowed === true || p?.promotion_authorized === true;
  const rawDirectCount = rawLive.filter(p => commercial(ledger.get(p.review_slug || p.program_id))).length;
  if (eligibility.program_count !== eligibility.programs.length
      || eligibility.live_program_count !== rawDirectCount
      || activationSelection.live_program_count !== rawDirectCount) throw new Error('relationship_build_raw_count');
  const removed = rawLive.filter(p => ['withdrawn','ended'].includes(p.affiliate_relationship_snapshot?.lifecycle));
  const denied = new Set();
  let directRemoved = 0;
  for (const p of removed) {
    const id = p.review_slug || p.program_id;
    if (p.affiliate_relationship_snapshot.promotion_denied !== true || denied.has(id)
        || !ledger.has(id) || eligibility.programs.filter(row => row.program_id === id).length !== 1)
      throw new Error('relationship_build_identity');
    denied.add(id);
    if (commercial(ledger.get(id))) directRemoved++;
    Object.assign(ledger.get(id), {live_link_allowed:false, promotion_authorized:false});
  }
  // Eligibility is the live-build partition; editorial ledger rows stay present.
  eligibility.programs = eligibility.programs.filter(p => !denied.has(p.program_id));
  eligibility.program_count -= denied.size;
  eligibility.live_program_count -= directRemoved;
  activationSelection.live_program_count -= directRemoved;
  return result;
}

export function relationshipDenials(registry) {
  return (registry?.programs || []).filter(p => p.affiliate_relationship_snapshot?.promotion_denied === true)
    .map(p => ({program_id:p.program_id, render_id:p.review_slug || p.program_id, ...p.affiliate_relationship_snapshot}));
}

export function relationshipEndedNotice(snapshot) {
  if (snapshot?.lifecycle !== 'ended' || snapshot.promotion_denied !== true) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.ended_effective_at || '')) throw new Error('ended_relationship_date_invalid');
  return `Our affiliate relationship with this provider ended on ${snapshot.ended_effective_at}. We no longer display affiliate links for this provider. This editorial review is retained; the relationship ending does not establish that the provider's services are unavailable.`;
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
