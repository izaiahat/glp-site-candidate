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

export function assertServedGoIdentity(root, programs, aliases = registryAliases) {
  const census = servedGoIdentityCensus(root, programs, aliases);
  if (!census.anchors.length) throw new Error('served_go_identity_empty');
  if (census.findings.length) throw new Error(`served_go_identity_mismatch:${JSON.stringify(census.findings)}`);
  return census;
}
