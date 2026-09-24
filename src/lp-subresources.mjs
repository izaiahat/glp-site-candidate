// Static network-reference accounting: data URLs are inline document bytes.
import { gzipSync } from "node:zlib";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const SUBRESOURCE = /<(?:script|link|img|source|iframe)\b[^>]*>/gi;
const URL_ATTR = /\b(src|href|srcset)="([^"]+)"/i;

function srcsetUrls(value) {
  const urls = [];
  let rest = value;
  while (rest.length) {
    rest = rest.replace(/^[\s,]+/, "");
    if (!rest) break;
    // URL tokens end at whitespace, not embedded commas (notably data:).
    const token = rest.match(/^\S+/)[0];
    rest = rest.slice(token.length);
    urls.push(token.replace(/,+$/, ""));
    if (!token.endsWith(",")) {
      const separator = rest.indexOf(",");
      rest = separator < 0 ? "" : rest.slice(separator + 1);
    }
  }
  return urls;
}

export function referencedUrls(html) {
  const urls = new Set();
  for (const tag of html.matchAll(SUBRESOURCE)) {
    if (/^<link\b/i.test(tag[0]) && /rel="(?:preconnect|dns-prefetch)"/i.test(tag[0])) continue;
    if (/^<link\b/i.test(tag[0]) && !/rel="(?:stylesheet|preload|icon|apple-touch-icon)"/i.test(tag[0])) continue;
    if (/^<script\b/i.test(tag[0]) && !/\bsrc="/i.test(tag[0])) continue;
    const match = tag[0].match(URL_ATTR);
    if (!match) continue;
    const candidates = match[1].toLowerCase() === "srcset" ? srcsetUrls(match[2]) : [match[2].trim()];
    for (const url of candidates) {
      // Test the whole URL before any tokenization; SVG payload commas are
      // not separate fetched resources. Its bytes remain in gzipped HTML.
      if (!url || /^data:/i.test(url) || url.startsWith("#")) continue;
      urls.add(url);
    }
  }
  return [...urls];
}

export async function measureTransfer(html, publicRoot) {
  const urls = referencedUrls(html);
  let bytes = gzipSync(Buffer.from(html)).length;
  const missing = [];
  for (const url of urls) {
    if (/^https?:\/\//i.test(url)) { missing.push(`${url} (cross-origin: outside our control and outside the budget's guarantee)`); continue; }
    const target = path.join(publicRoot, url.split(/[?#]/)[0]);
    try {
      const info = await stat(target);
      bytes += /\.(?:css|js|json|svg|html|txt|xml)$/i.test(target) ? gzipSync(await readFile(target)).length : info.size;
    } catch { missing.push(`${url} (referenced but not in the built tree — a 404 on a paid destination)`); }
  }
  return { bytes, requests: urls.length + 1, missing };
}
