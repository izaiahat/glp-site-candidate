import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Add identities, never rewrite the frozen evidence/activation contract or hrefs.
export function loadProviderPageContracts(root) {
  if (root instanceof URL) root = fileURLToPath(root);
  const raw = readFileSync(path.join(root, 'data/provider-page-contracts.json'));
  const contracts = JSON.parse(raw);
  const file = path.join(root, 'data/provider-cta-identity-v2.json');
  if (!existsSync(file)) return contracts;
  const migration = JSON.parse(readFileSync(file));
  if (migration.schema !== 'glp-provider-cta-identity-v2' || migration.metadata_only !== true
      || createHash('sha256').update(raw).digest('hex') !== migration.baseline_contract_sha256)
    throw new Error('cta_identity_baseline_mismatch');
  const allowed = new Set(['jrnys-review','medvi-review']);
  const entries = Object.entries(migration.programs || {});
  if (entries.length !== allowed.size) throw new Error('cta_identity_scope_invalid');
  for (const [pid, identity] of entries) {
    const rows = contracts.providers.filter(row => row.program_id === pid);
    if (!allowed.has(pid) || rows.length !== 1) throw new Error('cta_identity_program_invalid');
    const net = rows[0].network_contract;
    const url = new URL(net.tracking_url);
    if (identity.network !== 'Affiliati' || net.network !== identity.network
        || net.immutable_offer_id !== identity.provider_offer_id || net.publisher_id !== identity.publisher_id
        || !/^\d+$/.test(identity.creative_id || '') || identity.creative_id === identity.provider_offer_id
        || url.protocol !== 'https:' || url.pathname !== '/' || url.hash
        || url.searchParams.getAll('a').length !== 1 || url.searchParams.get('a') !== identity.publisher_id
        || url.searchParams.getAll('c').length !== 1 || url.searchParams.get('c') !== identity.creative_id
        || url.searchParams.getAll('s1').length !== 1 || url.searchParams.get('s1') !== '')
      throw new Error('cta_identity_evidence_mismatch:' + pid);
    // immutable_offer_id retains its original, literal offer meaning.
    Object.assign(net, {identity_schema: migration.schema,
      provider_offer_id: identity.provider_offer_id, creative_id: identity.creative_id});
  }
  return contracts;
}
