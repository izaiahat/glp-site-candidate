// Hash-bound adoption reader. R14 routine entries use standing acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateMaterial, isWWQualification } from './glp_material_acceptance.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
// Adoption records preserve their historical absolute source identities. Only
// file access is rebased to the checked-in, hash-verified copy of that chain.
const ORIGINAL_ROOT = '/home/ubuntu/business';
const localVersionPath = file => file.startsWith(ORIGINAL_ROOT + '/data/evidence-freshness/')
  ? path.join(ROOT, file.slice(ORIGINAL_ROOT.length + 1)) : file;
export const ADOPTIONS = path.join(ROOT, 'ops/evidence-freshness/adoptions.jsonl');
export const VERSIONS = path.join(ROOT, 'data/evidence-freshness/versions');
export const MATERIAL_ACCEPTANCES = path.join(ROOT, 'ops/evidence-freshness/material-acceptances.jsonl');
export const MATERIAL_VERSIONS = path.join(ROOT, 'data/evidence-freshness/material-versions');
const materialAuthorities = new WeakMap();
const qualificationAuthorities = new WeakMap();
export const materialOffersFor = result => structuredClone((materialAuthorities.get(result) || []).filter(r => !isWWQualification(r.material)));
export const materialQualificationsFor = ledger => structuredClone(qualificationAuthorities.get(ledger) || []);
const STANDING_ACCEPTANCE = path.join(ROOT, 'ops/evidence-freshness/routine-refresh-standing-acceptance.json');
const FDA_ID = 'fda-unapproved-glp1-warning-20260802';
const FDA_REQUEST = 'https://www.fda.gov/drugs/postmarket-drug-safety-information-patients-and-providers/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss';
const FDA_RESOLVED = 'https://www.fda.gov/drugs/drug-alerts-and-statements/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss';
const ORIGINAL_LEDGER_SHA256 = '65327bb0db8b99bd4cb556eb04619f63b6d9f3c86907bcfd8fea9d1427fea31c';
const authorities = new WeakMap();
const sha = (value) => createHash('sha256').update(value).digest('hex');
const ordered = (v) => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const canonical = (v) => JSON.stringify(ordered(v));

const visible = (v) => v.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
export const authorityFor = (ledger) => authorities.get(ledger);

// Parameters enable isolated tests. Registered callers always use fixed defaults;
// no path, authority, or approval is taken from a ledger or an environment variable.
// additionalEntries validates a whole proposed adoption chain at once. Simultaneous
// expiry is not a set of independent failures: with one entry at a time, every member's
// successor still carries the others' stale clocks, so no order of single-member checks
// reaches a valid state. Entries are appended to the same ordered log and face the same
// per-entry assertions either way; nothing about validation is relaxed by checking N.
export function loadEvidenceInputs(candidate, { activeFile = ADOPTIONS, versions = VERSIONS, additionalEntry = null,
  additionalEntries = null, materialFile = MATERIAL_ACCEPTANCES, materialVersions = MATERIAL_VERSIONS } = {}) {
  const originalLedgerPath = path.join(candidate, 'data/wave4-source-capture-ledger.json');
  const originalConfigPath = path.join(candidate, 'data/mystery-shop.json');
  const originalBytes = readFileSync(originalLedgerPath);
  assert.equal(sha(originalBytes), ORIGINAL_LEDGER_SHA256, 'historical_ledger_modified');
  const originalLedger = JSON.parse(originalBytes);
  const originalConfigBytes = readFileSync(originalConfigPath);
  const originalConfig = JSON.parse(originalConfigBytes);
  let ledgerPath = originalLedgerPath;
  let configPath = originalConfigPath;
  let capturePath = null;
  let ledgerBytes = originalBytes;
  let configBytes = originalConfigBytes;
  let captureBytes = null;
  let ledger = originalLedger;
  let config = originalConfig;
  let previous = null;
  let previousLedgerHash = sha(originalBytes);
  let previousConfigHash = sha(originalConfigBytes);
  const captures = {};
  const materialOffers = [];
  const externalMaterial = existsSync(materialFile) ? readFileSync(materialFile, 'utf8').split('\n').filter(line => line.trim()).map(JSON.parse) : [];
  for (const entry of externalMaterial) assert.ok(entry.named_material && entry.standing_acceptance_sha256 == null, 'material_external_entry_invalid');
  const entries = existsSync(activeFile) ? readFileSync(activeFile, 'utf8').split('\n').filter(line => line.trim()).map(JSON.parse) : [];
  for (const log of [entries, externalMaterial]) for (let i = 1; i < log.length; i++) assert.ok(log[i].sequence > log[i-1].sequence, 'adoption_append_order_invalid');
  entries.push(...externalMaterial);
  const proposed = additionalEntries ?? (additionalEntry ? [additionalEntry] : []);
  assert.ok(Array.isArray(proposed), 'additional_entries_invalid');
  for (const extra of proposed) {
    if (extra.named_material && externalMaterial.some(e => canonical(e) === canonical(extra))) continue;
    assert.ok(!entries.some(e => canonical(e) === canonical(extra)), 'additional_entry_duplicate');
    entries.push(extra);
  }
  entries.sort((a,b) => a.sequence - b.sequence);
  for (const [index, entry] of entries.entries()) {
    const parentLedger = ledger;
    const parentConfig = config;
    const routine = entry.standing_acceptance_sha256 != null;
    const material = entry.named_material;
    const qualification = isWWQualification(material);
    if (material) {
      assert.ok(!routine, 'material_routine_authority_refused');
      assert.ok(externalMaterial.some(e => canonical(e) === canonical(entry)), 'material_external_acceptance_missing');
    }
    if (routine) assert.equal(entry.standing_acceptance_sha256, sha(readFileSync(STANDING_ACCEPTANCE)), 'standing_acceptance_binding_invalid');
    assert.equal(entry.schema, 'glp-evidence-adoption-v1', 'adoption_schema_invalid');
    assert.equal(entry.sequence, index + 1, 'adoption_sequence_invalid');
    assert.equal(entry.previous_adoption_sha256, previous, 'adoption_history_invalid');
    assert.equal(entry.parent_ledger_sha256, previousLedgerHash, 'adoption_parent_ledger_invalid');
    assert.equal(entry.parent_config_sha256, previousConfigHash, 'adoption_parent_config_invalid');
    assert.match(entry.version, /^[a-f0-9]{64}$/, 'adoption_version_invalid');
    const directory = path.resolve(material ? materialVersions : versions, entry.version);
    const originalDirectory = directory.startsWith(ROOT + '/data/evidence-freshness/')
      ? ORIGINAL_ROOT + directory.slice(ROOT.length) : directory;
    const authenticated = {};
    for (const [kind, filename] of [['ledger', 'ledger.json'], ['config', 'config.json'], ['capture', 'capture.json']]) {
      assert.equal(entry[`${kind}_path`], path.join(originalDirectory, filename), 'adoption_path_invalid');
      authenticated[kind] = readFileSync(localVersionPath(entry[`${kind}_path`]));
      assert.equal(sha(authenticated[kind]), entry[`${kind}_sha256`], `${kind}_external_binding_invalid`);
    }
    assert.equal(entry.version, entry.capture_sha256, 'capture_version_invalid');
    ledgerPath = entry.ledger_path;
    configPath = entry.config_path;
    capturePath = entry.capture_path;
    ledgerBytes = authenticated.ledger;
    configBytes = authenticated.config;
    captureBytes = authenticated.capture;
    ledger = JSON.parse(ledgerBytes);
    config = JSON.parse(configBytes);
    const proof = JSON.parse(captureBytes);
    assert.equal(proof.schema, 'glp-authoritative-capture-v1', 'capture_schema_invalid');
    const retained = parentLedger.records.find(row => row.capture_id === proof.capture_id);
    assert.ok(retained && retained.disposition === 'ACCEPTED', 'new_or_unaccepted_capture_class');
    if (!routine && !material) assert.equal(proof.capture_id, FDA_ID, 'capture_identity_invalid');
    if (material) {
      assert.deepEqual(proof.named_material, material, 'material_proof_binding_invalid');
      validateMaterial(material, proof, retained);
    }
    const requested = routine || material ? retained.requested_url : FDA_REQUEST;
    assert.deepEqual(proof.request, { url: requested, maxAge: 0 }, 'capture_request_invalid');
    assert.equal(proof.response.success, true, 'capture_response_failed');
    const { markdown, metadata } = proof.response.data;
    assert.equal(metadata.statusCode, 200, 'capture_status_invalid');
    assert.equal(metadata.sourceURL, requested, 'capture_authoritative_url_invalid');
    // REST does not emit MCP cache annotations. maxAge=0 is the API's live
    // fetch contract; never accept an explicit cache hit or cached timestamp.
    assert.ok(metadata.cacheState == null || metadata.cacheState === 'miss', 'cached_response_refused');
    assert.ok(metadata.cachedAt == null, 'cached_response_refused');
    const resolved = new URL(metadata.url || metadata['og:url'] || metadata.sourceURL);
    assert.ok((routine || material ? [requested, retained.resolved_url] : [FDA_REQUEST, FDA_RESOLVED]).includes(resolved.origin + resolved.pathname), 'capture_resolved_url_invalid');
    assert.equal(proof.source_url, resolved.origin + resolved.pathname, 'capture_provenance_url_invalid');
    assert.equal(typeof markdown, 'string', 'capture_body_invalid');
    assert.ok(markdown.trim(), 'capture_body_empty');
    assert.equal(proof.content_sha256, sha(markdown), 'capture_content_hash_invalid');
    assert.ok(Number.isFinite(Date.parse(proof.fetch_started_at)) && Number.isFinite(Date.parse(proof.fetched_at)), 'capture_fetch_time_invalid');
    assert.ok(Date.parse(proof.fetched_at) >= Date.parse(proof.fetch_started_at) && Date.parse(proof.fetched_at) <= Date.now(), 'capture_fetch_time_invalid');
    assert.equal(ledger.generated_at_utc, proof.fetched_at, 'successor_generation_invalid');
    assert.equal(ledger.records.length, originalLedger.records.length, 'successor_record_set_invalid');
    for (const old of parentLedger.records) {
      const row = ledger.records.find(item => item.capture_id === old.capture_id);
      assert.ok(row, 'historical_capture_missing');
      if (old.capture_id !== proof.capture_id) {
        assert.deepEqual(row, old, 'independent_capture_pin_or_timestamp_modified');
        continue;
      }
      if (qualification) {
        // This is a new qualification alongside the original, not a repin or
        // a claim that the historical quote/clock was refreshed.
        assert.deepEqual(row, old, 'material_historical_lineage_modified');
        continue;
      }
      const changes = new Set(['cached_at', 'scrape_id', 'resolved_url', 'exact_quote', 'exact_quote_sha256']);
      if (routine) {
        changes.delete('exact_quote');
        changes.delete('exact_quote_sha256');
      }
      assert.deepEqual(Object.keys(row).sort(), Object.keys(old).sort(), 'successor_capture_schema_invalid');
      for (const key of Object.keys(old)) if (!changes.has(key)) assert.deepEqual(row[key], old[key], 'successor_scope_invalid');
      assert.equal(row.cached_at, proof.fetched_at, 'capture_timestamp_provenance_invalid');
      assert.equal(row.scrape_id, metadata.scrapeId, 'capture_scrape_provenance_invalid');
      assert.equal(row.resolved_url, proof.source_url, 'capture_resolved_provenance_invalid');
      assert.equal(row.exact_quote_sha256, sha(row.exact_quote), 'capture_quote_hash_invalid');
      if (material) assert.equal(row.exact_quote, material.exact_quote, 'material_accepted_value_mismatch');
      const current = visible(markdown);
      for (const quote of row.exact_quote.split('\n\n')) assert.ok(quote.trim() && current.includes(visible(quote)), 'capture_quote_not_in_body');
      for (const quote of old.exact_quote.split('\n\n').filter(q => !material || q !== material.replaced_quote)) assert.ok(visible(row.exact_quote).toLowerCase().includes(visible(quote).toLowerCase()), 'historical_claim_unsupported');
    }
    if (routine) {
      assert.equal(proof.material_change.retained_claims_supported, true, 'retained_claim_not_supported');
      assert.deepEqual(proof.material_change.missing_claims, [], 'retained_claim_not_supported');
    }
    const payload = Object.fromEntries(Object.entries(ledger).filter(([key]) => key !== 'ledger_payload_sha256'));
    assert.equal(ledger.ledger_payload_sha256, sha(canonical(payload)), 'successor_payload_hash_invalid');
    const expectedReference = { ...parentConfig.source_capture_ledger, source_file: ledgerPath,
      generated_at_utc: ledger.generated_at_utc, ledger_payload_sha256: ledger.ledger_payload_sha256,
      ledger_file_sha256: entry.ledger_sha256 };
    assert.deepEqual(config.source_capture_ledger, expectedReference, 'successor_reference_invalid');
    const withoutBinding = (value) => ({ ...value, source_capture_ledger: null,
      observations: value.observations.map(({ evidence_sha256, ...observation }) => observation) });
    const expectedConfig = structuredClone(parentConfig);
    if (routine || material) for (const observation of expectedConfig.observations) {
      if (observation.capture_id !== proof.capture_id) continue;
      if (qualification) {
        assert.equal(observation.id, material.observation_id, 'material_observation_parent_binding_invalid');
        assert.equal(observation.source_excerpt, material.historical_quote, 'material_observation_parent_binding_invalid');
        continue;
      }
      for (const quote of observation.source_excerpt.split('\n\n')) assert.ok(quote.trim() && visible(markdown).toLowerCase().includes(visible(quote).toLowerCase()), 'observation_claim_not_in_body');
      observation.observed_at = proof.fetched_at;
      observation.scrape_id = metadata.scrapeId;
      observation.resolved_url = proof.source_url;
    }
    assert.deepEqual(withoutBinding(config), withoutBinding(expectedConfig), 'historical_observation_modified');
    captures[proof.capture_id] = { capture_path: capturePath, capture_sha256: entry.capture_sha256 };
    if (material) materialOffers.push({ material: structuredClone(material), fetched_at: proof.fetched_at,
      source_url: proof.source_url, scrape_id: metadata.scrapeId, capture_sha256: entry.capture_sha256,
      content_sha256: proof.content_sha256 });
    previous = sha(canonical(entry));
    previousLedgerHash = entry.ledger_sha256;
    previousConfigHash = entry.config_sha256;
  }
  if (entries.length) authorities.set(ledger, Object.freeze({ file_sha256: previousLedgerHash,
    payload_sha256: ledger.ledger_payload_sha256, canonical_sha256: sha(canonical(ledger)), source_file: ledgerPath }));
  const result = { ledger, config, ledgerBytes, ledger_path: ledgerPath, config_path: configPath,
    ledger_sha256: sha(ledgerBytes), config_sha256: sha(configBytes), capture_sha256: captureBytes ? sha(captureBytes) : null,
    capture_path: capturePath, captures, adoption_sequence: entries.length, previous_adoption_sha256: previous };
  materialAuthorities.set(result, materialOffers);
  qualificationAuthorities.set(ledger, materialOffers.filter(r => isWWQualification(r.material)));
  return result;
}

async function main() {
  try {
    const mode = process.argv[2];
    assert.ok(['--inputs', '--check-successor'].includes(mode), 'usage: --inputs CANDIDATE | --check-successor CANDIDATE ENTRY [ENTRY...]');
    const candidate = path.resolve(process.argv[3]);
    const entryPaths = mode === '--check-successor' ? process.argv.slice(4) : [];
    assert.ok(mode !== '--check-successor' || entryPaths.length, 'check_successor_requires_entry');
    const additionalEntries = entryPaths.map(entryPath => JSON.parse(readFileSync(entryPath)));
    const result = loadEvidenceInputs(candidate, { additionalEntries: entryPaths.length ? additionalEntries : null });
    if (entryPaths.length) {
      const { validateMysteryShop } = await import(pathToFileURL(path.join(candidate, 'src/mystery-shop.mjs')));
      validateMysteryShop(result.config, result.ledger, { ledgerFileSha256: result.ledger_sha256 });
    }
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => !['ledger', 'config', 'ledgerBytes'].includes(key)))));
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', error: error.message }));
    process.exitCode = 1;
  }
}

// The consumer imports this reader; awaiting it at module scope deadlocks.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
