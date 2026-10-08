// Proposed economics only. Exact rates/copy/legal approval remains outstanding.
import pricing from '../data/sponsor-pricing.json' with {type:'json'};
import {authenticatedSponsorPayment} from './sponsor-payment-observer.mjs';
export const SPONSOR_PRICING=Object.freeze(pricing);
export const usd=(amount)=>`$${amount}`;
export function refundQuote({kind,launched,undeliveredHours=null}={}) {
 if (!['initial','renewal'].includes(kind)||typeof launched!=='boolean') throw Error('Reviewed order required');
 if (undeliveredHours!==null&&(!Number.isFinite(undeliveredHours)||undeliveredHours<0||undeliveredHours>SPONSOR_PRICING.termHours)) throw Error('Invalid undelivered hours');
 // Preserve full non-launch remedy; do not silently carry old $200/$100 caps.
 // Partial delivery keeps the existing refund-or-mutually-agreed-extension
 // remedy: no new pro-rata formula, tax treatment or setup-fee forfeiture.
 return {status:launched?'manual_review':'proposal_not_refund_authority',amount:launched?null:SPONSOR_PRICING[kind],currency:'USD',tax:'review_required',refundAuthorized:false};
}
export function paymentVerified(order={}) {
 return authenticatedSponsorPayment(order);
}
