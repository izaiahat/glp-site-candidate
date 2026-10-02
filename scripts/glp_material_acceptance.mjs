// Shared material evidence validator; never grants authority or writes a log.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const hash = v => createHash('sha256').update(v).digest('hex');
export const MATERIAL_ID = 'zepbound-savings-20260802';
export const OFFER_ID = 'zepbound-commercially-uncovered-single-dose-pen-2026';
export const WW_ID = 'weightwatchers-clinic-pricing-20260802';
export const isWWQualification = material => material?.schema === 'glp-named-ww-renewal-v1' && material.capture_id === WW_ID;
const text = v => v.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_#`]/g,'').replace(/\s+/g,' ').trim();
export function validateMaterial(material, proof, retained) {
  const qualification = isWWQualification(material);
  if (!qualification) {
    assert.equal(material.schema, 'glp-named-material-v1', 'material_schema_invalid');
    assert.equal(material.capture_id, MATERIAL_ID, 'material_named_capture_invalid');
    assert.equal(material.offer_id, OFFER_ID, 'material_offer_mapping_invalid');
    assert.match(material.parent_offer_sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(proof.capture_id, material.capture_id, 'material_capture_mismatch');
  const raw = Buffer.from(proof.original_capture_base64, 'base64');
  assert.equal(hash(raw), material.original_capture_sha256, 'material_original_capture_hash_invalid');
  const original = JSON.parse(raw);
  assert.equal(original.schema, 'glp-separate-source-capture-v1', 'material_original_schema_invalid');
  for (const key of ['capture_id','request','response','source_url','fetch_started_at','fetched_at','content_sha256']) assert.deepEqual(proof[key], original[key], 'material_original_provenance_changed');
  assert.deepEqual(original.parent_record, retained, 'material_original_parent_invalid');
  const body = proof.response.data.markdown;
  assert.equal(hash(body), proof.content_sha256, 'material_body_hash_invalid');
  assert.equal(proof.request.url, retained.requested_url, 'material_request_invalid');
  assert.equal(proof.request.maxAge, 0, 'material_cache_invalid');
  assert.equal(proof.response.success, true);
  const meta = proof.response.data.metadata;
  assert.equal(meta.statusCode, 200);
  assert.equal(meta.sourceURL, retained.requested_url, 'material_request_invalid');
  const resolved = meta.url || meta['og:url'] || meta.sourceURL;
  assert.ok([retained.requested_url,retained.resolved_url].includes(resolved), 'material_resolved_invalid');
  assert.equal(proof.source_url, resolved);
  assert.equal(new URL(resolved).protocol, 'https:');
  assert.ok(meta.cacheState == null || meta.cacheState === 'miss');
  assert.ok(meta.cachedAt == null);
  assert.match(meta.scrapeId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const start = Date.parse(proof.fetch_started_at), end = Date.parse(proof.fetched_at);
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && start <= end && end <= Date.now(), 'material_clock_invalid');
  assert.ok(retained.cached_at == null || end >= Date.parse(retained.cached_at), 'material_clock_rollback');
  if (qualification) {
    assert.deepEqual(Object.keys(material).sort(), ['schema','capture_id','observation_id','original_capture_sha256','historical_quote','exact_quote','renewal_terms'].sort(), 'material_qualification_schema_invalid');
    assert.equal(material.observation_id, 'weightwatchers-pricing-public', 'material_observation_mapping_invalid');
    assert.equal(material.historical_quote, retained.exact_quote, 'material_historical_lineage_invalid');
    assert.ok(typeof material.exact_quote === 'string' && body.includes(material.exact_quote), 'material_exact_excerpt_absent');
    const sentence = '^$25 for your first month with a 12-month or 6-month plan. After the first month, membership continues for $74/mo (12-month plan) or $84/mo (6-month plan) for the remainder of your applicable plan term. Cost of GLP-1 medications not included. Plans auto-renew for another 12-month or 6-month period at the same monthly rate at the end of each plan term.';
    assert.equal(material.exact_quote, sentence, 'material_renewal_context_invalid');
    assert.deepEqual(material.renewal_terms, [{term_months:6,monthly_usd:84},{term_months:12,monthly_usd:74}], 'material_renewal_value_not_entailed');
    return material;
  }
  const oldQuotes = retained.exact_quote.split('\n\n');
  assert.equal(material.replaced_quote, oldQuotes.at(-1), 'material_replacement_scope_invalid');
  assert.equal(material.limits.length, 2, 'material_limits_invalid');
  const [pen, kwik] = material.limits;
  assert.equal(pen.formulation, 'single-dose pen');
  assert.equal(kwik.formulation, 'single-patient-use KwikPen');
  for (const limit of material.limits) {
    assert.ok(Number.isInteger(limit.count) && limit.count > 0, 'material_count_invalid');
    assert.ok(typeof limit.excerpt === 'string' && body.includes(limit.excerpt), 'material_exact_excerpt_absent');
    // A single contiguous source paragraph must connect this formulation to
    // this annual limit. Unrelated numbers elsewhere in the body cannot qualify.
    assert.ok(!/\n/.test(limit.excerpt), 'material_context_split');
    const s = text(limit.excerpt);
    const prefix = limit === pen
      ? 'Month is defined as 28-days and up to 4 single-dose pens. Card savings are subject to a maximum monthly savings based on wholesale acquisition cost minus $499,'
      : 'For all Zepbound single-patient-use KwikPen dosages, month is defined as 28-days and up to 1 single-patient-use KwikPen.';
    assert.ok(s.startsWith(prefix), 'material_formulation_context_invalid');
    const expression = limit === pen
      ? /up to a maximum of (\d+) prescription fills per calendar year\./g
      : /Card may be used for a maximum of up to (\d+) prescription fills per calendar year\./g;
    const matches = [...s.matchAll(expression)];
    assert.equal(matches.length, 1, 'material_limit_evidence_invalid');
    assert.equal(Number(matches[0][1]), limit.count, 'material_typed_limit_not_entailed');
  }
  assert.equal(material.exact_quote, [...oldQuotes.slice(0,-1), ...material.limits.map(l=>l.excerpt)].join('\n\n'), 'material_other_claim_changed');
  for (const quote of oldQuotes.slice(0,-1)) assert.ok(text(body).includes(text(quote)), 'material_retained_claim_absent');
  return material;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const {material,proof,retained}=JSON.parse(readFileSync(0,'utf8'));validateMaterial(material,proof,retained);console.log('VALID_EVIDENCE_NOT_ACCEPTANCE'); }
  catch(e) {console.error(e.message);process.exitCode=1;}
}
