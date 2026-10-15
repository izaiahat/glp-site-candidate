// Synthetic authenticated-API response fixture, not a real payment receipt.
import {createHash} from 'node:crypto';
export function paymentFixture(){
 const order_reference='SYNTHETIC-ORDER',capture_id='SYNTHETIC-CAPTURE',merchant_id='SYNTHETIC-MERCHANT';
 const receipt_json=JSON.stringify({authenticated:true,http_status:200,environment:'live',capture:{id:capture_id,status:'COMPLETED',invoice_id:order_reference,payee:{email_address:'ops@glpclinicscout.com',merchant_id},amount:{value:'500.00',currency_code:'USD'}}});
 return {reviewed_order:true,order_reference,merchant_id,payment_verification:{status:'verified',payment_verified:true,source:'paypal_live_authenticated_capture_readback',order_reference,capture_id,currency:'USD',amount:'500.00',payee:'ops@glpclinicscout.com',receipt_json,receipt_sha256:createHash('sha256').update(receipt_json).digest('hex')}};
}
