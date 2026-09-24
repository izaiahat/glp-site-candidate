import { createHandoff } from '../../src/platform-click-handoff.mjs';
import { GO_RUNTIME_MANIFEST } from '../go/program-manifest.js';
// Candidate proposal; no environment flag or permission/consent row is issued here.
export async function onRequest({request,env}) {
  return createHandoff(request,{...env,PROGRAM_MANIFEST:{programs:Object.values(GO_RUNTIME_MANIFEST.programs)}});
}
