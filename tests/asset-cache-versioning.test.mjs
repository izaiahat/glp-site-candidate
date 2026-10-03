import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadContentAssets, rewriteContentAssetUrls, emitContentAssets, contentAsset } from '../src/asset-cache-versioning.mjs';
import { normalizePriceIndexUrls } from '../src/price-index-url-normalization.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('changed CSS and home/product image bytes change EVERY consuming path, including five preserved bare-CSS pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glp44-assets-'));
  try {
    await mkdir(path.join(root, 'assets/derivatives'), { recursive: true });
    const names = ['site.css', 'site-tools.css'];
    const images = ['home-hero-fridge', 'home-hero-fruit', 'home-hero-hand',
      'phase3-product-mounjaro', 'phase3-product-ozempic', 'phase3-product-wegovy',
      'phase3-product-wegovy-pill', 'phase3-product-zepbound']
      .flatMap(stem => [640, 1024].map(width => `${stem}-${width}.avif`))
      .concat([768,1536].map(width => `home-lifestyle-phone-${width}.avif`));
    const sources = [...names.map(name => `assets/${name}`), ...images.map(name => `assets/derivatives/${name}`)];
    const oauth = '/google-ads-api/assets/site.css';
    const urls = [...names.map(name => `/assets/${name}`), ...images.map(name => `/assets/images/${name}`), oauth];
    // All real reference roles: bare/versioned stylesheet, preload, src/srcset,
    // canonical-origin structured-data image, and repeated URL in inline CSS.
    const documents = [
      ...['index.html', '404.html', 'privacy/index.html', 'support/index.html', 'terms/index.html']
        .map(route => ({ route: `google-ads-api/${route}`, html: `<link rel="stylesheet" href="${oauth}">` })),
      { route: 'index.html', html: urls.map(url => `<link rel="preload" href="${url}"><img src="${url}" srcset="${url} 1x, ${url} 2x"><script type="application/ld+json">{"image":"https://glpclinicscout.com${url}"}</script><style>p{background:url('${url}')}</style>`).join('') },
      { route: 'quiz/provider-fit/index.html', html: '<link rel="stylesheet" href="/assets/site-tools.css?v=1234567890abcdef">' },
    ];
    for (const [i, source] of sources.entries()) await writeFile(path.join(root, source), `first-${i}`);
    const before = await loadContentAssets(root, names);
    assert.equal(before.size, 20);
    before.set(oauth, contentAsset(oauth, Buffer.from('frozen OAuth CSS:a')));
    const oldDocuments = documents.map(({html}) => rewriteContentAssetUrls(html, before));
    const oldCache = new Map([...before.values()].map(asset => [asset.url, asset.bytes]));
    for (const [i, source] of sources.entries()) await writeFile(path.join(root, source), `second-${i}`);
    const after = await loadContentAssets(root, names);
    assert.equal(after.size, 20);
    after.set(oauth, contentAsset(oauth, Buffer.from('frozen OAuth CSS:b')));
    for (const url of urls) {
      const oldAsset = before.get(url), asset = after.get(url);
      assert.notEqual(asset.url, oldAsset.url, url);
      assert.ok(asset.url.includes(sha(asset.bytes).slice(0,16)), url);
      assert.equal(oldCache.has(asset.url), false, 'an immutable predecessor response cannot satisfy the new path');
    }
    for (const [i, {route, html}] of documents.entries()) {
      const emitted = rewriteContentAssetUrls(html, after);
      assert.notEqual(emitted, oldDocuments[i], route);
      assert.equal(rewriteContentAssetUrls(emitted, after), emitted, 'idempotent producer rewrites');
      const originalRefs = [...html.matchAll(/(?<![A-Za-z0-9:/.-])(?:https:\/\/glpclinicscout\.com)?(\/(?:assets\/[A-Za-z0-9_/.-]+|google-ads-api\/assets\/site\.css))/g)].map(match => match[1]);
      for (const url of urls.filter(url => originalRefs.includes(url))) {
        assert.equal(emitted.includes(url), false, `${route}: bare consumer ${url}`);
        assert.equal(emitted.includes(before.get(url).url), false, `${route}: predecessor consumer ${url}`);
        assert.equal(emitted.split(after.get(url).url).length - 1, originalRefs.filter(ref => ref === url).length, `${route}: every occurrence`);
      }
    }
    const external = '<img src="https://other.example/assets/images/home-hero-fridge-640.avif"><a href="/assets/site.css.map">map</a><a href="/google-ads-api/assets/site.css.map">OAuth map</a><img src="/assets/images/guide-frozen-640.avif">';
    assert.equal(rewriteContentAssetUrls(external, after), external);
    // Existing price-index semantic preservation recognizes only the exact
    // site's CSS role and namespace. Served-byte checks remain unnormalized.
    const priceBefore = '<link rel="stylesheet" href="/assets/site.css?v=1234567890abcdef">';
    const priceAfter = rewriteContentAssetUrls(priceBefore, after);
    assert.equal(normalizePriceIndexUrls(priceAfter), normalizePriceIndexUrls(priceBefore));
    for (const html of [priceAfter.replace('stylesheet','icon'), priceAfter.replace('site.','other.'),
      priceAfter.replace('/assets/cache/','/foreign/'), priceAfter.replace('href="/','href="https://other.example/')]) {
      assert.equal(normalizePriceIndexUrls(html), html, 'unsupported role/path/origin remains strict');
    }
    await emitContentAssets(path.join(root, 'public'), after);
    for (const asset of after.values()) assert.deepEqual(await readFile(path.join(root, 'public', asset.url)), asset.bytes);
  } finally { await rm(root, {recursive: true, force: true}); }
});
