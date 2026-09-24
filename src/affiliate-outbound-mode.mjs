import { goPromotionReceiptComplete } from './go-promotion-contract.mjs';
// Build-time link routing, not activation authority. The existing affiliate
// resolver owns exact issued-href approval; runtime /go needs its additional
// constructor and redirector permissions. Never equate a surface flag with them.
export function affiliateOutboundMode(program, link, promotion) {
  const profile = program?.profiles?.["glp-clinic-scout"];
  if (program?.commercial_state !== "live" || profile?.vertical_fit !== true
      || profile?.wired !== true || profile?.surfaces?.compare !== true
      || link?.live !== true || !link.affiliate_href || !link.network) return "held";
  const directTerms = program.go?.entry_state === "held"
    && profile.exceptions?.go?.enabled === true
    && profile.exceptions.go.surface_restriction_basis === "operator_terms_transparent_direct_only";
  if (directTerms) return "transparent_direct";
  if (program.go?.entry_state === "held" || profile.surfaces.go !== true) return "held";
  const goVerified = goPromotionReceiptComplete(promotion, program, link);
  return goVerified ? "go" : "transparent_direct";
}
