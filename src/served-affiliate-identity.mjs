import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'parse5';

// Offline, non-executing census, including lazy-card HTML in served JSON and
// template contents. No URL is requested, and no private href is reported.
const registry = JSON.parse(readFileSync(new URL('../data/program-registry.json', import.meta.url)));
const registryAliases = Object.fromEntries(registry.programs.map(p => [p.review_slug || p.program_id, p.program_id]));

export function servedGoIdentityCensus(root, programs, aliases = registryAliases) {
  const anchors = [], findings = [];
  let htmlFiles = 0, jsonFiles = 0;
  function markup(text, file) {
    function visit(node) {
      if (node.tagName === 'a') {
        const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
        const url = new URL(attrs.href || '', 'https://glpclinicscout.com');
        if (url.origin === 'https://glpclinicscout.com' && url.pathname.startsWith('/go/')) {
          const program = attrs['data-program'], network = attrs['data-network'];
          anchors.push({ file, program, network });
          const slug = decodeURIComponent(url.pathname.split('/')[2] || '');
          const routeProgram = programs[slug];
          if (!routeProgram || !programs[program] || (aliases[slug] || slug) !== (aliases[program] || program)) {
            findings.push({ file, program, slug, reason: 'crosswired_go' });
          }
          if (!programs[program]?.network || network !== programs[program].network) {
            findings.push({ file, program, network, expected: programs[program]?.network ?? null });
          }
        }
      }
      for (const child of node.childNodes || []) visit(child);
      if (node.content) visit(node.content);
    }
    visit(parse(text));
  }
  function payload(value, file) {
    if (typeof value === 'string' && /<a\b/i.test(value)) markup(value, file);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) payload(child, file);
  }
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), file = relative(root, path);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.html')) { htmlFiles++; markup(readFileSync(path, 'utf8'), file); }
      else if (entry.name.endsWith('.json')) { jsonFiles++; payload(JSON.parse(readFileSync(path, 'utf8')), file); }
    }
  }
  walk(root);
  return { htmlFiles, jsonFiles, anchors, findings };
}

// Independent raw-source oracle: deliberately does not call the promotion
// loader. A derived VERIFIED projection must never erase a current raw hold.
export function rawHeldInputs(root) {
  const read = file => JSON.parse(readFileSync(join(root, 'data', file)));
  const selection = read('go-selection-receipt.json').programs;
  const registry = read('program-registry.json').programs;
  const legacy = read('go-runtime-promotion-authority.json').programs;
  const approved = read('approved-program-registry.json').programs;
  const activation = read('affiliate-activation-selection.json');
  const held = new Map(), aliases = {};
  const add = (id, source) => held.set(id, [...(held.get(id) || []), source]);
  add('fella-health', 'permanent exclusion');
  for (const p of registry) {
    aliases[p.review_slug || p.program_id] = p.program_id;
    if (p.affiliate_relationship_snapshot?.promotion_denied === true) add(p.program_id, 'sole-writer:adverse-selected-relationship');
    if (/held|withheld|paused|excluded/i.test(p.commercial_state || '')) add(p.program_id, 'program-registry:commercial_state');
    for (const [surface, exception] of Object.entries(p.profiles?.['glp-clinic-scout']?.exceptions || {})) {
      if (exception.enabled === true && /hold|paused|excluded/i.test(exception.surface_restriction_basis || ''))
        add(p.program_id, `program-registry:exceptions.${surface}`);
    }
  }
  for (const p of approved) if (p.existing_release_alias) aliases[p.registry_id] = aliases[p.existing_release_alias] || p.existing_release_alias;
  for (const p of selection) {
    aliases[p.render_id] = p.program_id;
    if (p.disposition === 'HOLD' || p.status === 'WITHHELD') add(p.program_id, 'go-selection-receipt:HOLD');
  }
  for (const [id, p] of Object.entries(legacy)) if (p.status === 'WITHHELD') add(id, 'raw-go-runtime-promotion-authority:WITHHELD');
  for (const id of activation.excluded_network_paused_programs || []) add(id, 'affiliate-activation-selection:excluded_network_paused_programs');
  const issued = [];
  const bind = (id, href) => { id = aliases[id] || id; if (held.has(id) && href) issued.push({id, href}); };
  for (const p of selection) bind(p.program_id, p.issued_link);
  for (const p of approved) bind(p.registry_id, p.tracking?.provider_issued_url);
  for (const p of read('affiliate-wire-in-approvals.json').programs) bind(p.existing_release_alias, p.tracking?.provider_issued_url);
  return { held: [...held].sort(([a], [b]) => a.localeCompare(b)).map(([id, sources]) => ({id, sources})), aliases, issued };
}

export function rawHeldOutputCensus(documents, inputs, runtime) {
  const ids = new Set(inputs.held.map(p => p.id)), anchors = [], routes = [];
  const canonical = id => inputs.aliases[id] || id;
  const issued = inputs.issued.map(row => ({id:row.id, url:new URL(row.href)}));
  let htmlFiles = 0, jsonFiles = 0;
  function markup(text, file, pointer = null) {
    function visit(node) {
      if (node.tagName === 'a') {
        const a = Object.fromEntries((node.attrs || []).map(v => [v.name, v.value]));
        const url = new URL(a.href || '', 'https://glpclinicscout.com');
        const go = url.origin === 'https://glpclinicscout.com' && url.pathname.startsWith('/go/');
        // Also catch unlabelled issued links and links with extra sub-ID params.
        const issuedIds = issued.filter(row => row.url.origin === url.origin && row.url.pathname === url.pathname
          && [...row.url.searchParams].every(([key, value]) => url.searchParams.getAll(key).includes(value))).map(row => row.id);
        const promotional = go || a['data-analytics-event'] === 'affiliate_click' || /\bsponsored\b/.test(a.rel || '') || issuedIds.length;
        const candidates = new Set([canonical(a['data-program']), ...(go ? [canonical(decodeURIComponent(url.pathname.split('/')[2]))] : []), ...issuedIds]);
        if (promotional) for (const id of candidates) if (ids.has(id)) anchors.push({id, file, pointer, line:node.sourceCodeLocation?.startLine});
      }
      for (const child of node.childNodes || []) visit(child);
      if (node.content) visit(node.content);
    }
    visit(parse(text, {sourceCodeLocationInfo:true}));
  }
  function payload(value, file, pointer = '$') {
    if (typeof value === 'string' && /<a\b/i.test(value)) markup(value, file, pointer);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) payload(child, file, `${pointer}.${key}`);
  }
  for (const doc of documents) {
    if (doc.file.endsWith('.html')) { htmlFiles++; markup(doc.text, doc.file); }
    else if (doc.file.endsWith('.json')) { jsonFiles++; payload(JSON.parse(doc.text), doc.file); }
  }
  for (const [slug, row] of Object.entries(runtime)) {
    for (const id of new Set([canonical(slug), canonical(row.program_id)])) {
      if (ids.has(id) && (row.live_link_allowed === true || row.promotion_authorized === true)) routes.push({id, slug});
    }
  }
  return { held:inputs.held, htmlFiles, jsonFiles, documents:htmlFiles + jsonFiles, anchors, routes,
    counts:Object.fromEntries([...ids].map(id => [id, anchors.filter(a => a.id === id).length])) };
}

export function assertRawHeldOutput(census, id = null) {
  if (!census.held.length || !census.htmlFiles || !census.jsonFiles) throw new Error('raw_held_census_empty');
  const anchors = census.anchors.filter(row => !id || row.id === id), routes = census.routes.filter(row => !id || row.id === id);
  if (anchors.length || routes.length) throw new Error(`raw_held_output_live:${JSON.stringify({anchors, routes})}`);
  return census;
}

export function assertServedGoIdentity(root, programs, aliases = registryAliases) {
  const census = servedGoIdentityCensus(root, programs, aliases);
  if (!census.anchors.length) throw new Error('served_go_identity_empty');
  if (census.findings.length) throw new Error(`served_go_identity_mismatch:${JSON.stringify(census.findings)}`);
  return census;
}
