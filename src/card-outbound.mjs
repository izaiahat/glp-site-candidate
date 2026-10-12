import {affiliateOutboundMode} from './affiliate-outbound-mode.mjs';
import {subidAttributes} from './affiliate-subid.mjs';

// A reviewed direct destination does not require first-party redirect permission.
// This grants no link: both the resolver and current promotion authority must agree.
export function approvedDirectCard(outbound, affiliate, promotion) {
  return outbound?.mode === 'transparent_direct' && affiliate?.live === true
    && promotion?.status === 'VERIFIED' && promotion.promotion_authorized === true
    && typeof outbound.href === 'string' && outbound.href.startsWith('https://')
    && outbound.href === affiliate.affiliate_href
    && (!promotion.issued_link || promotion.issued_link === outbound.href);
}

// Pure consumer. Promotion data belongs to the authority owner, never this renderer.
export function resolveCardOutbound({program, affiliate, promotionAuthority, pageSlug, position, rankPosition}) {
  const renderId = program?.review_slug || program?.program_id;
  const promotion = promotionAuthority?.programs?.[program?.program_id] ?? promotionAuthority?.programs?.[renderId];
  const mode = affiliateOutboundMode(program, affiliate, promotion);
  if (mode === 'held') return {mode, href:null, attributes:'', f08Key:null};
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(pageSlug || '') || !Number.isSafeInteger(rankPosition) || rankPosition < 1
      || !['provider-card','provider-card-unverified'].includes(position)) throw new Error('card_outbound_assignment_invalid');
  const slot = (position === 'provider-card-unverified' ? 'pcu' : 'pc') + rankPosition;
  const f08Key = `${pageSlug}.${slot}`;
  const route = program?.go?.route;
  if (mode === 'go' && (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(renderId || '') || route !== `/go/${renderId}`)) throw new Error('card_outbound_route_identity_invalid');
  const href = mode === 'go' ? `${route}?s=${encodeURIComponent(f08Key)}&v=a` : affiliate.affiliate_href;
  const attributes = subidAttributes({programId:renderId,network:affiliate.network,href:affiliate.affiliate_href,renderedHref:href,position,rankPosition,pageSlug,pageType:'funnel-v2-comparison',providerSlug:renderId})
    + ` data-page-slug="${pageSlug}" data-subid="${f08Key}" data-variant="a"`
    + (mode === 'go' ? ' data-funnel-v2-go' : ' data-transparent-direct-terms="true"');
  return {mode,href,attributes,f08Key};
}
