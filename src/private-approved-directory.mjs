// Read-only custody bridge: private issuer URLs never belong in the Git mirror.
// Only the four captured directory rows are consumed; no public registry row,
// promotion grant, route, price, or scored profile can be overridden here.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OVERLAY_SHA256 = 'e2b75664ac8d1a741ac0d80a874b2d2c90e8124a7872548af2248b76e09273b8';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validatePrivateDirectoryRows(rows, authority) {
  if (!Array.isArray(rows) || rows.length !== 4 || hash(JSON.stringify(rows)) !== OVERLAY_SHA256)
    throw new Error('private_directory_capture_drift');
  for (const row of rows) {
    const grant = authority?.[row.registry_id];
    const href = row.tracking?.provider_issued_url;
    const digest = hash(href || '');
    if (row.network !== 'ClickDealer' || row.directory_only !== true
        || row.canonical_vertical !== 'glp1-weightloss'
        || row.enumeration_class !== 'provider_joined_or_approved_exact_id'
        || grant?.status !== 'VERIFIED' || grant.promotion_authorized !== true
        || grant.issued_link_sha256 !== digest || row.tracking.issued_link_sha256 !== digest
        || new URL(href).protocol !== 'https:' || new URL(href).hostname !== row.tracking.tracking_host)
      throw new Error('private_directory_authority_mismatch');
  }
  return rows;
}

export function loadApprovedDirectoryRegistry({ root = ROOT, privateFile = process.env.GLP_PRIVATE_APPROVED_REGISTRY } = {}) {
  const approved = JSON.parse(readFileSync(path.join(root, 'data/approved-program-registry.json'), 'utf8'));
  if (!privateFile) return approved; // The required presence test stays RED without custody.
  const captured = JSON.parse(readFileSync(privateFile, 'utf8'));
  const authority = JSON.parse(readFileSync(path.join(root, 'data/go-runtime-promotion-authority.json'), 'utf8')).programs;
  const rows = validatePrivateDirectoryRows(captured.approved_directory_programs, authority);
  return { ...approved, approved_directory_programs: rows };
}
