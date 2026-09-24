import {createAdvertisingIssuer,boundedBody} from './advertising-issuer.mjs';
const reply = status => new Response(null, { status, headers: {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'
} });

export async function createHandoff(request, env) {
  if (request.method !== 'POST') return reply(405);
  if (request.headers.get('Sec-GPC') === '1') return reply(403);
  // Staging issuer accepts only independently pre-registered TEST probes.
  // No caller-selected permission, TEST bit, reviewer or registration authority.
  const issuer=createAdvertisingIssuer(env);
  if(!issuer)return reply(503);
  try{return await issuer.createHandoff(request,await boundedBody(request));}
  catch{return reply(503);}
}
