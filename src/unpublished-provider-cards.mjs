import { createHash } from 'node:crypto';
import { affiliateOutboundMode } from './affiliate-outbound-mode.mjs';

const medicationIds = new Set(['brand-wegovy','brand-wegovy-pill','brand-ozempic','brand-zepbound','brand-mounjaro','compounded-semaglutide-injection','compounded-tirzepatide-injection','compounded-semaglutide-oral']);
const digest = value => createHash('sha256').update(value).digest('hex');

// Evidence is a separate projection, not a placeholder price row. The parent
// ingestion receipt verifies original capture bytes; these copies travel with
// the candidate so the renderer cannot silently depend on an external report.
export function validateUnpublishedOfferEvidence(input) {
  if (input?.schema !== 'glp-unpublished-offer-evidence-v1' || !Array.isArray(input.offers) || !input.sources) throw new Error('unpublished_offer_evidence_schema');
  const keys = new Set();
  for (const offer of input.offers) {
    const key = offer.program_id + ':' + offer.medication_id;
    if (keys.has(key) || !offer.program_id || !medicationIds.has(offer.medication_id) || !offer.label || /\$|\/mo\b|\bper month\b|\bfrom\b/i.test(offer.label)
      || !Array.isArray(offer.duration_months) || offer.duration_months.some(n => ![1,3,6,12].includes(n)) || !offer.evidence?.length) throw new Error('unpublished_offer_tuple_invalid:' + key);
    keys.add(key);
    for (const binding of offer.evidence) {
      const source = input.sources[binding.capture_sha256];
      if (!source || digest(source.text) !== binding.capture_sha256 || !binding.quote || !source.text.includes(binding.quote)
        || binding.source_url !== source.source_url || !/^https:\/\//.test(source.source_url)
        || binding.checked_date !== source.checked_date || !/^\d{4}-\d{2}-\d{2}$/.test(binding.checked_date)) throw new Error('unpublished_offer_binding_invalid:' + key);
    }
  }
  return input;
}

export function selectUnpublishedProviders({ registry, affiliateMap, goAuthority, pricedProviders, medicationIds, durationMonths = null, offerEvidence }) {
  validateUnpublishedOfferEvidence(offerEvidence);
  const priced = new Set(pricedProviders.map(p => p.program_id));
  const selected = registry.programs.flatMap(record => {
    if (priced.has(record.program_id) || /(?:^|-)fella(?:-|$)/.test(record.program_id)) return [];
    const affiliate = affiliateMap[record.program_id];
    const mode = affiliateOutboundMode(record, affiliate, goAuthority.programs?.[record.program_id]);
    if (mode === 'held') return [];
    const offers = offerEvidence.offers.filter(o => o.program_id === record.program_id && medicationIds.includes(o.medication_id)
      && (!durationMonths || o.duration_months.some(n => durationMonths === 3 ? n === 3 : n >= 6)));
    if (!offers.length) return [];
    return [{program_id:record.program_id,provider:record.display_name,record,affiliate,mode,offers,pricing_state:'unpublished'}];
  });
  return selected.sort((a,b) => a.provider.localeCompare(b.provider) || a.program_id.localeCompare(b.program_id));
}
