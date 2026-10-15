// Historical-capture projection ONLY. This never changes CAPTURE.json or a
// packet/install/approval manifest, and cannot authorize the new live observer.
// Native observer/processor tests and independent money-boundary review are
// separate. Only the exact delegate below may differ; every render/economics
// byte and every existing geometry assertion remains pinned to the capture.
export function retainedPricingCaptureSource(source) {
 const imported="import {authenticatedSponsorPayment} from './sponsor-payment-observer.mjs';\n";
 const delegated='export function paymentVerified(order={}) {\n return authenticatedSponsorPayment(order);\n}\n';
 const previous=`export function paymentVerified(_order={}) {
 // No registered authenticated PayPal ingestion/allocation producer exists.
 // A caller-supplied JSON document, authenticated:true flag, or matching hash
 // is not authentication. Keep every live placement closed until independent
 // producer/provider/payer/order/gross/freshness/replay custody is installed.
 return false;
}
`;
 if(source.split(imported).length!==2||source.split(delegated).length!==2) throw Error('Exact live-only observer delegate required');
 return source.replace(imported,'').replace(delegated,previous);
}
