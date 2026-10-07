import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = reason => { throw new Error('price_refresh_evidence:' + reason); };
const safe = value => {
  const u = new URL(value);
  return u.protocol === 'https:' && !u.username && !u.password && !/fella|revoffers|xentraffic|awin1/i.test(u.hostname)
    && !/\/(go|click|track|checkout|login|signup|register)(\/|$)/i.test(u.pathname)
    && ![...u.searchParams.keys()].some(k => /aff|ref|click|subid|utm|token/i.test(k));
};
const tokens = row => {
  const id = row.medication_id;
  for (const brand of ['ozempic','wegovy','mounjaro','zepbound']) if (id.includes(brand)) return [brand];
  return ['semaglutide','tirzepatide','membership'].filter(t => id.includes(t));
};

/** Extend the exact historic attestation with evidence-supported price changes.
 * Absence grants NOTHING. Every unchanged or unproven row retains the old oracle.
 * The ledger is cumulative: no row deletion, kind/identity/term changes or unknown
 * overwrite is admitted. New brand/provider offerings require ordinary review.
 */
function identitySupported(row, quote) {
  const lower=quote.toLowerCase(), id=row.medication_id;
  const labels=tokens(row);
  if (!labels.length || !labels.every(label=>lower.includes(label))) return false;
  if (id.includes('compounded') && !lower.includes('compound')) return false;
  if (id.includes('injection') && !/inject|once.weekly|weekly shot/.test(lower)) return false;
  if (id.includes('oral') && !/oral|tablet|rdt|rapid.dissolv/.test(lower)) return false;
  return !['semaglutide','tirzepatide','ozempic','wegovy','mounjaro','zepbound'].some(label=>!labels.includes(label) && lower.includes(label));
}
function amountRouteSupported(row, amount, quote) {
  if (!identitySupported(row,quote)) return false;
  const route=row.medication_id.includes('oral')?'oral':row.medication_id.includes('injection')?'injection':null;
  if (!route) return true;
  const cleaned=quote.replaceAll(',','');
  const found=[...cleaned.matchAll(/\binject\w*\b|\bonce.weekly\b|\boral\b|\btablet\b|\bRDT\b|rapid.dissolv\w*/gi)].map(m=>[m.index,/inject|once.weekly/i.test(m[0])?'injection':'oral']);
  if (new Set(found.map(pair=>pair[1])).size<2) return true;
  const pattern=new RegExp('\\$\\s*'+String(amount).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\.00)?(?![\\d.])','g');
  return [...cleaned.matchAll(pattern)].some(m=>found.filter(pair=>pair[0]<m.index).at(-1)?.[1]===route);
}
function periodToken(value) {
  const aliases={month:['month','monthly','mo','/mo','/month','per month','a month'],week:['week','weekly','/week','per week'],year:['year','yearly','annual','/year','per year'],day:['day','daily','/day','per day']};
  const normalized=typeof value==='string'?value.trim().toLowerCase():null;
  return Object.keys(aliases).find(key=>aliases[key].includes(normalized)) || null;
}
function supportsField(field,value,quote,fields) {
  if (typeof value!=='string') return quote.includes(String(value));
  const token=(field==='period'||field.endsWith('_period'))?periodToken(value):null;
  if (!token) return quote.toLowerCase().includes(value.toLowerCase());
  const expression={month:/(?:\/\s*mo(?:nth)?\b|\bmonth(?:ly)?\b)/i,week:/\bweek(?:ly)?\b/i,year:/\b(?:year|yearly|annual)\b/i,day:/\bday(?:ly)?\b/i}[token];
  const monetary=field==='period'?'amount_usd':field.slice(0,-7)+'_usd';
  const amount=fields.find(f=>f.field===monetary)?.value;
  if (typeof amount!=='number') return expression.test(quote);
  const cleaned=quote.replaceAll(',','');
  for(const match of cleaned.matchAll(new RegExp('\\$\\s*'+String(amount).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\.00)?(?![\\d.])','g'))) {
    const after=cleaned.slice(match.index+match[0].length,match.index+match[0].length+65).split('$')[0];
    if(expression.test(after)) return true;
  }
  return false;
}

export function applyPriceRefreshEvidence(root, expectedProviders, now = new Date()) {
  let ledger;
  try { ledger = JSON.parse(readFileSync(path.join(root,'data/price-refresh-ledger.json'))); }
  catch (error) { if (error.code === 'ENOENT') return expectedProviders; throw error; }
  if (ledger.schema !== 'glp-price-refresh-ledger-v1' || !Array.isArray(ledger.entries)) fail('schema');
  const expected = structuredClone(expectedProviders);
  // The deployed baseline may already contain a prefix of the same append-only
  // chain. Authenticate it as an exact chain member, then independently replay
  // the COMPLETE chain. Never blindly apply old entries twice after publication.
  const chains = new Map();
  for (const entry of ledger.entries) {
    const key=entry.program_id + '\\0' + entry.row_id;
    if (!chains.has(key)) chains.set(key,[]);
    chains.get(key).push(entry);
  }
  for (const chain of chains.values()) {
    const first=chain[0], rows=expected[first.program_id]?.medications || [];
    const index=rows.findIndex(r=>r.row_id===first.row_id);
    if (index < 0 || !chain.some(e=>isDeepStrictEqual(rows[index],e.before) || isDeepStrictEqual(rows[index],e.after))) fail('chain_baseline');
    rows[index]=structuredClone(first.before);
  }
  const registry = JSON.parse(readFileSync(path.join(root,'data/program-registry.json')));
  const programs = new Map(registry.programs.map(p => [p.program_id,p]));
  const selection = JSON.parse(readFileSync(path.join(root,'data/affiliate-activation-selection.json')));
  const held = new Set(selection.excluded_network_paused_programs || []);
  for (const p of programs.values()) if (p.commercial_state !== 'live' || p.affiliate_relationship_snapshot?.promotion_denied === true) held.add(p.program_id);
  for (const entry of ledger.entries) {
    const {program_id:pid,row_id,before,after,extraction,source_url,captured_at_utc,reviewed_at_utc,markdown_path,markdown_sha256} = entry;
    const program = programs.get(pid);
    if (!program || held.has(pid) || /fella/i.test(pid) || program.commercial_state !== 'live') fail('held:' + pid);
    const profile = registry.provider_dynamic_profiles.profiles[pid];
    const hosts = new Set((profile?.source_urls || []).map(u => new URL(u).hostname));
    if (!safe(source_url) || !hosts.has(new URL(source_url).hostname)) fail('source:' + pid);
    if (!/^data\/price-refresh-captures\/[a-f0-9]{64}\.md$/.test(markdown_path)) fail('capture_path');
    const raw = readFileSync(path.join(root,markdown_path));
    if (hash(raw) !== markdown_sha256) fail('capture_hash');
    const text = raw.toString('utf8');
    const captured = new Date(captured_at_utc), reviewed = new Date(reviewed_at_utc);
    if (!Number.isFinite(+captured) || !Number.isFinite(+reviewed) || captured > reviewed || reviewed > now || reviewed-captured > 7*86400000) fail('clock');
    const rows = expected[pid]?.medications || [];
    const index = rows.findIndex(r => r.row_id === row_id);
    if (index < 0 || !isDeepStrictEqual(rows[index],before)) fail('preimage:' + row_id);
    if (before.row_id !== after.row_id || before.medication_id !== after.medication_id || before.price_kind !== after.price_kind) fail('identity');
    const labels = tokens(before);
    if (!labels.length || extraction.row_id !== row_id || extraction.medication_id !== before.medication_id
        || extraction.price_kind !== before.price_kind || extraction.source_url !== source_url
        || !extraction.identity_quote || !text.includes(extraction.identity_quote)
        || !identitySupported(before,extraction.identity_quote)) fail('extraction_identity');
    const fields = extraction.fields || [];
    const names = Object.keys(before.facts).sort();
    if (!isDeepStrictEqual(fields.map(f => f.field).sort(),names)) fail('full_field_set');
    const allowed = structuredClone(before);
    let changes = 0;
    for (const field of fields) {
      const old = before.facts[field.field], next = after.facts[field.field];
      if (field.value === null) {
        if (old.value !== null && old.value !== 'UNKNOWN') fail('lost_attestation');
        if (!isDeepStrictEqual(old,next)) fail('unknown_write');
        continue;
      }
      if (!field.quote || !text.includes(field.quote)) fail('quote');
      if (field.field.endsWith('_usd')) {
        if (typeof field.value !== 'number' || !Number.isFinite(field.value) || field.value <= 0) fail('amount');
        const pattern = new RegExp('\\$\\s*' + String(field.value).replace('.', '\\.') + '(?:\\.00)?(?![\\d.])');
        if (!pattern.test(field.quote.replaceAll(',','')) || !amountRouteSupported(before,field.value,field.quote)) fail('amount_quote');
      } else if (typeof field.value !== 'string' || !supportsField(field.field,field.value,field.quote,fields) || field.value !== old.value) fail('terms_change');
      if (field.value === old.value) {
        if (!isDeepStrictEqual(old,next)) fail('unchanged_fact_mutation');
        continue;
      }
      if (!field.field.endsWith('_usd') || next.value !== field.value || !Array.isArray(next.evidence) || !next.evidence.length) fail('unsupported_change');
      for (const e of next.evidence) {
        if (e.source_url !== source_url || e.content_sha256 !== markdown_sha256
            || e.captured_at_utc !== captured_at_utc || e.quote !== field.quote) fail('evidence');
      }
      allowed.facts[field.field] = structuredClone(next);
      changes++;
    }
    if (!changes || !isDeepStrictEqual(allowed,after)) fail('outside_price_facts');
    rows[index] = structuredClone(after);
  }
  return expected;
}
