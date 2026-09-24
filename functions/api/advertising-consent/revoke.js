import {revokeAdvertisingConsent} from '../../../src/advertising-issuer.mjs';
export async function onRequest({request,env}) { return revokeAdvertisingConsent(request,env); }
