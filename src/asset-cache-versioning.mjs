import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Extend the existing analytics content-filename convention to assembled CSS
// and the maintained home/product derivative families. Frozen article assets
// and their exact retained HTML are not reissued by this producer.
export async function loadContentAssets(root, stylesheets) {
  const entries = stylesheets.map(name => [`/assets/${name}`, `assets/${name}`]);
  for (const name of (await readdir(path.join(root, 'assets/derivatives'))).sort()) {
    if (/^(?:home-|phase3-product-).+\.(?:avif|webp|jpe?g|png)$/.test(name)) entries.push([`/assets/images/${name}`, `assets/derivatives/${name}`]);
  }
  return new Map(await Promise.all(entries.map(async ([original, source]) => {
    const bytes = await readFile(path.join(root, source));
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0,16);
    const relative = original.slice('/assets/'.length);
    const ext = path.extname(relative);
    const url = `/assets/cache/${relative.slice(0,-ext.length)}.${digest}${ext}`;
    return [original, {url, bytes}];
  })));
}

export function rewriteContentAssetUrls(html, assets) {
  // Quoted HTML attributes, srcset, CSS url(), and JSON-LD all use the same
  // root/canonical URL spellings. Replace exact paths only; never a foreign
  // origin, prefix match, query, clinical text, or unrelated preserved asset.
  return html.replace(/(?<![A-Za-z0-9:/.-])(https:\/\/glpclinicscout\.com)?(\/assets\/[A-Za-z0-9_/.-]+)/g,
    (whole, origin = '', original) => assets.has(original) ? origin + assets.get(original).url : whole);
}

export async function emitContentAssets(publicRoot, assets) {
  for (const asset of assets.values()) {
    const destination = path.join(publicRoot, asset.url);
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, asset.bytes);
  }
}
