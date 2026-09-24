import { createHash } from 'node:crypto';
import { redirectorTermsAllowed } from './go-redirector-authority.mjs';

// Build-time consumers share the producer's exact receipt contract. This module
// is not imported by the edge worker, which independently validates its entry.
export function goPromotionReceiptComplete(promotion, program, link) {
  return Boolean(program.commercial_state === 'live'
    && promotion?.status === 'VERIFIED'
    && promotion.program_id === program.program_id
    && promotion.network === String(link?.network || '').toLowerCase()
    && /^[a-f0-9]{64}$/.test(promotion.operator_selection_receipt_sha256 || '')
    && link?.affiliate_href
    && promotion.tracking_link_sha256 === createHash('sha256').update(link.affiliate_href).digest('hex')
    && ['promotion_authorized','constructor_verified','advertiser_permission_verified','encoding_verified','privacy_qa_passed'].every(key=>promotion[key]===true)
    && redirectorTermsAllowed({...promotion,tracking:{base_url:link.affiliate_href}}));
}
