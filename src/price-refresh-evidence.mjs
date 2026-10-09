import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validatePriceRow} from './pricing-evidence-v2.mjs';

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

// Currency-only successor policy, paired with the Python producer's
// source_plan_anchor/amount_offer_supported/offer_context_errors. Display labels
// are not invented provider quotations. Never borrow terms from another offer.
const oldQuotes = row => [...Object.values(row.facts || {}).flatMap(f=>(f.evidence || []).map(e=>e.quote || '')),...(row.evidence || []).map(e=>e.quote || '')];
const withoutAmounts = value => value.replace(/\$[\d,.]+/g,'$AMOUNT').replace(/\s+/g,' ').trim().toLowerCase();
function sourcePlanAnchor(row) {
  const label=row.plan_label || '', quotes=oldQuotes(row);
  if(label.startsWith('Reported S32 offer:')) return null;
  if(!quotes.length || quotes.some(q=>q.toLowerCase().includes(label.toLowerCase()))) return label;
  const terms=label.match(/\b(?:month-to-month|\d+[- ]month|quarterly|annual|standard|starter bundle|starter|bundle|membership)\b/gi) || [];
  return terms.find(term=>quotes.some(q=>q.toLowerCase().includes(term.toLowerCase()))) || label;
}
function offerContextSupported(row, extraction, text) {
  const anchor=sourcePlanAnchor(row), {plan_quote:plan,conditions_quote:conditions}=extraction;
  if(!row.plan_label || extraction.plan_label!==row.plan_label || typeof plan!=='string' || !plan || !text.includes(plan)
      || (anchor && !plan.toLowerCase().includes(anchor.toLowerCase()))) fail('plan_identity_not_supported');
  if(!isDeepStrictEqual(extraction.qualifiers,row.qualifiers)) fail('qualifiers_missing_or_changed');
  const blocks=text.split(/\n\s*\n/).map(b=>b.trim());
  const containing=blocks.filter(b=>typeof conditions==='string' && conditions && b.includes(conditions));
  if(containing.length!==1 || conditions!==containing[0]) fail('complete_conditions_not_supported');
  const following=blocks[blocks.indexOf(containing[0])+1];
  if(following && /^[*_#\s]*(?:then|only|first|intro|for the first|billed|renew|prepaid|annual)\b/i.test(following)) fail('adjacent_conditions_omitted');
  const quotes=oldQuotes(row), same=quotes.some(q=>withoutAmounts(q).includes(withoutAmounts(conditions)));
  if(quotes.length && !same) fail('new_or_ambiguous_conditions');
  for(const qualifier of row.qualifiers || []) {
    if((qualifier.match(/\$[\d,.]+/g) || []).some(token=>!conditions.includes(token))) fail('qualifier_amount_changed');
    if(!conditions.toLowerCase().includes(qualifier.toLowerCase()) && !same) fail('qualifier_not_supported');
  }
  if(/\bonly\b|\beligib\w*\b|\bminimum\b|\bcommit\w*\b|\bexpires?\b|\bnew patient\b|\bselect\b|\brequir\w*\b|\bdose\b|\bdiscount\b|\bpromo\w*\b|\bshipping\b|\blabs?\b|\bfees?\b|\bexclud\w*\b/i.test(conditions) && !same) fail('new_or_ambiguous_conditions');
}
function amountOfferSupported(row, field, amount, quote) {
  const cleaned=quote.replaceAll(',','');
  const matches=[...cleaned.matchAll(new RegExp('\\$\\s*'+String(amount).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\.00)?(?![\\d.])','g'))];
  if(matches.length!==1) return false;
  const match=matches[0], start=cleaned.lastIndexOf(';',match.index)+1;
  const semi=cleaned.indexOf(';',match.index+match[0].length), end=semi<0?cleaned.length:semi;
  const clause=cleaned.slice(start,end), plan=sourcePlanAnchor(row);
  if(plan && !clause.toLowerCase().includes(plan.toLowerCase())) return false;
  const before=cleaned.slice(start,match.index), after=cleaned.slice(match.index+match[0].length,end).split('$')[0];
  const named=[...before.matchAll(/\b(?:[\w-]+\s+){1,3}plan\b/gi)];
  if(plan && named.length && plan.toLowerCase().includes('plan') && !named.at(-1)[0].toLowerCase().includes(plan.toLowerCase())) return false;
  if(row.plan_label.startsWith('Reported S32 offer:') && /\bplan\b/i.test(clause)
      && !oldQuotes(row).some(q=>withoutAmounts(clause)===withoutAmounts(q))) return false;
  const phases=[...before.matchAll(/\b(first|initial|intro\w*|new patient|then|ongoing|renew\w*|thereafter)\b/gi)];
  const marker=(phases.at(-1)?.[0] || after.match(/\b(first|initial|intro\w*|new patient|ongoing|renew\w*|thereafter)\b/i)?.[0] || '').toLowerCase();
  const phase=marker ? (/^(?:first|initial|intro|new patient)/.test(marker)?'intro':'ongoing') : null;
  if(['intro_usd','ongoing_usd'].includes(field)) { if(phase!==field.replace('_usd','')) return false; }
  else if(['floor_from','monthly_cash'].includes(row.price_kind) && /\bfirst\b|\binitial\b|\bintro\w*\b|\bthen\b|\brenew\w*\b/i.test(clause)) return false;
  if(!['prepaid_bundle','monthly_equivalent_of_billing_period'].includes(row.price_kind) && /\bprepaid\b|\bprepay\w*\b|\bupfront\b|\bannual\b|\byearly\b/i.test(clause)) return false;
  return true;
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
    const profile = registry.provider_dynamic_profiles.profiles[pid];
    const boundIds = [...new Set([pid,...(profile?.registry_program_ids || [])])];
    const boundPrograms = boundIds.map(id=>programs.get(id)).filter(Boolean);
    if (!boundPrograms.length || boundIds.some(id=>held.has(id)) || /fella/i.test(pid)
        || boundPrograms.some(p=>p.commercial_state !== 'live')) fail('held:' + pid);
    const hosts = new Set((profile?.source_urls || []).map(u => new URL(u).hostname));
    if (entry.mode === 'reattest') {
      const rows = expected[pid]?.medications || [], index = rows.findIndex(r=>r.row_id===row_id);
      if(index < 0 || !isDeepStrictEqual(rows[index],before)) fail('reattest_preimage');
      const allowed = structuredClone(before), reviewed = new Date(reviewed_at_utc);
      if(!Number.isFinite(+reviewed) || reviewed > now) fail('reattest_review_clock');
      const renew = (old, next) => {
        if(!Array.isArray(old) || !old.length || !Array.isArray(next) || old.length!==next.length) fail('reattest_witness_set');
        return old.map((w,i)=>{
          const n=next[i], captured=new Date(n.captured_at_utc);
          if(!safe(n.source_url) || !hosts.has(new URL(n.source_url).hostname)
              || !Number.isFinite(+captured) || captured>reviewed || reviewed-captured>7*86400000) fail('reattest_source_clock');
          if(!/^[a-f0-9]{64}$/.test(n.capture_sha256) || n.capture_path!==`data/pricing-evidence/${n.capture_sha256}.md`) fail('reattest_capture_path');
          const raw=readFileSync(path.join(root,n.capture_path));
          if(hash(raw)!==n.capture_sha256 || !w.quote || !raw.toString('utf8').includes(w.quote)) fail('reattest_quote');
          const permitted={...w,capture_path:n.capture_path,capture_sha256:n.capture_sha256,captured_at_utc:n.captured_at_utc};
          if(!isDeepStrictEqual(n,permitted)) fail('reattest_changed_quote_or_source');
          return n;
        });
      };
      for(const name of ['identity_evidence','evidence']) allowed[name]=renew(before[name],after[name]);
      for(const [name,fact] of Object.entries(before.facts)) {
        if(fact.value===null || fact.value==='UNKNOWN') continue;
        allowed.facts[name].evidence=renew(fact.evidence,after.facts[name]?.evidence);
      }
      if(!isDeepStrictEqual(allowed,after)) fail('reattest_changed_value_or_terms');
      const errors=validatePriceRow(after,{root,now:+now});
      if(errors.length) fail('reattest_native_row:'+errors.join(','));
      rows[index]=structuredClone(after);
      continue;
    }
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
    // Attest phase/basis before whole-paragraph conditions for useful refusals.
    for (const field of extraction.fields || []) if(field.field?.endsWith('_usd') && typeof field.value==='number'
        && typeof field.quote==='string' && !amountOfferSupported(before,field.field,field.value,field.quote)) fail('plan_phase_or_basis');
    offerContextSupported(before,extraction,text);
    const fields = extraction.fields || [];
    const names = Object.keys(before.facts).sort();
    if (!isDeepStrictEqual(fields.map(f => f.field).sort(),names)) fail('full_field_set');
    const allowed = structuredClone(before);
    let changes = 0;
    for (const field of fields) {
      const old = before.facts[field.field], next = after.facts[field.field];
      if (field.value === null || field.value === 'UNKNOWN') fail('lost_attestation');
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
        const witness = {source_url,capture_sha256:markdown_sha256,capture_path:`data/pricing-evidence/${markdown_sha256}.md`,captured_at_utc,quote:field.quote};
        if (!isDeepStrictEqual(e,witness)) fail('evidence');
      }
      allowed.facts[field.field] = structuredClone(next);
      changes++;
    }
    if (!changes || !isDeepStrictEqual(allowed,after)) fail('outside_price_facts');
    const nativeErrors=validatePriceRow(after,{root,now:+now});
    if(nativeErrors.length) fail('native_row:'+nativeErrors.join(','));
    rows[index] = structuredClone(after);
  }
  return expected;
}
