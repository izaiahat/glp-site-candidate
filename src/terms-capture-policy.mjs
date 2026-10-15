import graph from '../data/phase3-page-graph.json' with { type: 'json' };
import { CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES } from './site-capture-consent-sources.mjs';

// Output admission only: neither raw directory membership nor a sponsor page
// grants subscription consent. Keep the existing allowlist and the explicit
// staged provider work order; never regenerate the weekly eligibility list.
const sources = new Set(CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES);
if (graph.status !== 'STAGED_NOT_DEPLOYED') throw new Error('terms_capture_policy_inputs_invalid');
for (const entry of graph.provider_work_order_additions || []) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.program_id || '')) throw new Error('terms_capture_policy_program_invalid');
  const slug = `providers-${entry.program_id}`;
  sources.add(`${slug}:${slug}-terms-checklist`);
}

export function unapprovedDirectoryTermsRoute(route) {
  if (!/^\/(?:providers|reviews|sponsors)\//.test(route || '')) return false;
  const slug = route.split('/').filter(Boolean).join('-').slice(0, 100).replace(/-+$/g, '');
  return !sources.has(`${slug}:${slug}-terms-checklist`);
}
