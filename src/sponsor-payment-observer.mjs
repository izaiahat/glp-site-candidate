import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Live-only payment admission. Never invoked by neutral preview/rate rendering.
export function authenticatedSponsorPayment(order={}) {
 if(typeof order.order_reference!=='string'||!order.order_reference) return false;
 try {
  // Existing renderers add presentation-only fields, never approved creative.
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
