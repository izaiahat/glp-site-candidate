// Proposed economics only. Exact rates/copy/legal approval remains outstanding.
import {createHash} from 'node:crypto';
import pricing from '../data/sponsor-pricing.json' with {type:'json'};
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
 const receipt=order.payment_verification;
 const expected=order.order_kind==='renewal'?SPONSOR_PRICING.renewal:SPONSOR_PRICING.initial;
 let raw;
 try {
  if(typeof receipt?.receipt_json!=='string'||createHash('sha256').update(receipt.receipt_json).digest('hex')!==receipt.receipt_sha256) return false;
  raw=JSON.parse(receipt.receipt_json);
 } catch {return false;}
 const capture=raw.capture;
 return Boolean(raw.authenticated===true&&raw.http_status===200&&raw.environment==='live'
  &&capture?.status==='COMPLETED'&&capture.id===receipt.capture_id
  &&capture.invoice_id===order.order_reference&&order.merchant_id&&capture.payee?.merchant_id===order.merchant_id
  &&capture.payee?.email_address==='ops@glpclinicscout.com'&&capture.amount?.currency_code==='USD'
  &&Number(capture.amount?.value)===expected
  &&order.reviewed_order===true&&order.order_reference&&receipt?.payment_verified===true
  &&receipt.source==='paypal_live_authenticated_capture_readback'&&receipt.status==='verified'
  &&receipt.order_reference===order.order_reference&&receipt.capture_id&&receipt.currency==='USD'
  &&Number(receipt.amount)===expected&&receipt.payee==='ops@glpclinicscout.com'
  &&/^[0-9a-f]{64}$/.test(receipt.receipt_sha256||''));
}
