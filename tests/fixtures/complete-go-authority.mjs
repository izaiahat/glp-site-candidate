import { createHash } from 'node:crypto';

// TEST ONLY: synthetic receipt-complete authority, never production evidence.
export function completeGoAuthority(program, link) {
  return {
    status: 'VERIFIED',
    program_id: program.program_id,
    network: link.network.toLowerCase(),
    tracking_link_sha256: createHash('sha256').update(link.affiliate_href).digest('hex'),
    operator_selection_receipt_sha256: createHash('sha256').update(`TEST ONLY:${program.program_id}:${link.affiliate_href}`).digest('hex'),
    promotion_authorized: true,
    constructor_verified: true,
    advertiser_permission_verified: true,
    encoding_verified: true,
    privacy_qa_passed: true,
    redirector_tos_verified: true,
    redirector_tos_source_url: 'https://terms.invalid/test-only',
    redirector_tos_verified_as_of: '2026-08-01',
  };
}
