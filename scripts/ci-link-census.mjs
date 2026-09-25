import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRedirects } from './review-redirects.mjs';

function* files(root) {
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isDirectory()) yield* files(file);
    else if (item.isFile()) yield file;
  }
}
const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)));

export function auditLinks(publicRoot, functionsRoot) {
  publicRoot = path.resolve(publicRoot);
  const redirects = existsSync(path.join(publicRoot, '_redirects')) ? parseRedirects(readFileSync(path.join(publicRoot, '_redirects'), 'utf8')) : new Map();
  const functionRoutes = existsSync(functionsRoot) ? [...files(functionsRoot)].filter(file => /\.[cm]?js$/.test(file)
    && /export\s+(?:async\s+)?(?:function|const)\s+onRequest/.test(readFileSync(file, 'utf8'))).map(file => {
      let route = '/' + path.relative(functionsRoot, file).split(path.sep).join('/').replace(/\.[cm]?js$/, '').replace(/\/index$/, '');
      route = route.split('/').map(part => /^\[\[.+\]\]$/.test(part) ? '.*' : /^\[.+\]$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
      return new RegExp('^' + route + '/?$');
    }) : [];
  function resolves(urlPath, seen = new Set()) {
    if (seen.has(urlPath)) return false;
    seen.add(urlPath);
    const rule = redirects.get(urlPath);
    if (rule) {
      const dest = new URL(rule.to, 'https://glpclinicscout.com');
      return dest.hostname !== 'glpclinicscout.com' || resolves(dest.pathname, seen);
    }
    let decoded;
    try { decoded = decodeURIComponent(urlPath); } catch { return false; }
    const target = path.resolve(publicRoot, '.' + decoded);
    if (target !== publicRoot && !target.startsWith(publicRoot + path.sep)) return false;
    if (existsSync(target) && statSync(target).isFile()) return true;
    if (existsSync(path.join(target, 'index.html'))) return true;
    return functionRoutes.some(route => route.test(urlPath));
  }
  let htmlCount = 0, hrefCount = 0;
  const targets = new Set(), missing = new Map();
  for (const file of files(publicRoot)) {
    if (!file.endsWith('.html')) continue;
    htmlCount++;
    const route = '/' + path.relative(publicRoot, file).split(path.sep).join('/').replace(/index\.html$/, '');
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      hrefCount++;
      const href = decode(match[1] ?? match[2] ?? match[3]);
      let url;
      try { url = new URL(href, 'https://glpclinicscout.com' + route); } catch { missing.set('invalid-url', file); continue; }
      if (!['http:', 'https:'].includes(url.protocol) || !['glpclinicscout.com', 'www.glpclinicscout.com'].includes(url.hostname)) continue;
      targets.add(url.pathname);
      if (!resolves(url.pathname)) missing.set(url.pathname, path.relative(publicRoot, file));
    }
  }
  return { html_count: htmlCount, href_count: hrefCount, unique_internal_targets: targets.size,
    unresolved_count: missing.size, unresolved: [...missing].map(([target, source]) => ({ target, source })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditLinks(process.argv[2] || 'public', process.argv[3] || 'functions');
  console.log(JSON.stringify({ ...result, unresolved: result.unresolved.slice(0, 30) }, null, 2));
  process.exitCode = result.html_count > 0 && result.href_count > 0 && result.unresolved_count === 0 ? 0 : 1;
}
