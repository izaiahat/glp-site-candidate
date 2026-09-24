import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const route='/guides/mounjaro-coupon/';
// D2p separated a page disclosure edit from its article's editorial date.
// Reuse the exact evidence row; no new date or provenance hash is authored here.
export function inheritedDisclosureDates(requestedRoute, article, readBytes=readFileSync) {
  if(requestedRoute!==route)return null;
  const bytes=readBytes(new URL('../data/d2w-s9-d2p-provenance-evidence.json',import.meta.url));
  if(sha(bytes)!=='9f44cbdd3bd4614405d8e125f358518ed2e9aa364e5df934a74c8490e94f7015')throw Error('inherited_disclosure_evidence_hash_mismatch');
  const evidence=JSON.parse(bytes),rows=evidence.rows.filter(r=>r.route===route);
  if(rows.length!==1 || rows[0].previous_lastmod!==rows[0].current_lastmod || !/^\d{4}-\d{2}-\d{2}$/.test(rows[0].current_lastmod))throw Error('inherited_disclosure_evidence_invalid');
  if(article?.canonical_path!==route || article.updated_at!=='2026-08-29')throw Error('inherited_disclosure_editorial_source_changed');
  return {lastmod:rows[0].current_lastmod,editorialDate:article.updated_at};
}
