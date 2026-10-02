// Candidate-only account binding. No secret value, provisioning or promotion.
// Tenant/account: scripts/glp_xentraffic_postback_config.py NETWORK_ID / NETWORK_AFFILIATE_ID
// and scripts/marketplace_adapters/everflow.py TENANT_BINDINGS (business control source).
// Program/offer/issued-link tuples: data/go-selection-receipt.json; exact parity tested.
// Keep the established numeric account reference, not a fabricated composite ID.
export const XENTRAFFIC_TENANT_ID = '2068';
export const XENTRAFFIC_ACCOUNT_REF = '4384';
export const XENTRAFFIC_BINDINGS = Object.freeze([
  ['ro-wegovy-glp1-quiz-us-cpl', '3164', '6KWS5L1'],
  ['eden-xentraffic-offer-3051', '3051', '6D9WBFD'],
  ['lttl-glp-landing-page-2', '3252', '6Q91WCF'],
  ['sunlight-glp1', '3254', '6QCRMSM'],
  ['levelsrx-extra-cpa-home-page', '3245', '6PX9P76'],
  ['tmates-xentraffic-offer-3154', '3154', '6KDXB7X'],
  // The canonical program slug is historical; the selected offer is 3142, NOT 3117.
  ['yucca-health-xentraffic-offer-3117', '3142', '6JS8PDM'],
].map(([programId, offerId, linkCode]) => Object.freeze({
  programId, offerId, trackingUrl: `https://www.xfnjwej33dd.com/841W6MT/${linkCode}/`,
})));

export function xentrafficProgram(programId, offerId) {
  return XENTRAFFIC_BINDINGS.find(row => row.programId === programId && row.offerId === offerId) || null;
}

export function xentrafficAccountRef(program) {
  if (program?.network !== 'xentraffic') return null;
  const binding = xentrafficProgram(program.program_id, program.network_offer_id);
  return binding && program.tracking?.base_url === binding.trackingUrl ? XENTRAFFIC_ACCOUNT_REF : null;
}
