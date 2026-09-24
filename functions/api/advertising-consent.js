import {advertisingConsent} from '../../src/advertising-issuer.mjs';
export async function onRequest({request,env}) { return advertisingConsent(request,env); }
