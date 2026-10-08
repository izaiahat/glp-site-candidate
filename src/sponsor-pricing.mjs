// Proposed economics only. Exact rates/copy/legal approval remains outstanding.
import pricing from '../data/sponsor-pricing.json' with {type:'json'};
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
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
 // Invoke only the fixed installed read-only processor observer. A JSON paid
 // flag/receipt/hash is never payment authority. Missing installation, busy
 // custody, unknown account/payment or expired approval all fail closed.
 if(typeof order.order_reference!=='string'||!order.order_reference) return false;
 try {
  // Existing renderers add presentation-only preview/id fields; neither is
  // approved creative or payment input. Never drop arbitrary caller fields.
  const {preview,id,...reviewedOrder}=order;
  if(preview!==undefined&&preview!==false) return false;
  const input=JSON.stringify(reviewedOrder);
  if(Buffer.byteLength(input)>65536) return false;
  const result=spawnSync('/home/ubuntu/.hermes/hermes-agent/venv/bin/python3',
   ['-I','/home/ubuntu/business/scripts/glp_sponsor_site_payment.py'],
   {input,encoding:'utf8',shell:false,timeout:180000,maxBuffer:65536});
  if(result.error||result.status!==0) return false;
  const observed=JSON.parse(result.stdout);
  return observed.payment_verified===true
   && observed.source==='paypal_authenticated_invoice_reporting_observer'
   && observed.order_reference===order.order_reference
   && observed.request_sha256===createHash('sha256').update(input).digest('hex');
 } catch {return false;}
}
