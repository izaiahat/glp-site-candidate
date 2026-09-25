import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const ROUTE = "/guides/mounjaro-coupon/";
const LEGACY_ASSET_SHA256 = new Map([
  ["guide-mounjaro-coupon-1600.avif", "2f863c700e375db1b87bfe6e1e39a2dc3d2046140946c31ef2975321e6d55038"],
  ["guide-mounjaro-coupon-1600.jpg", "fffdf9b46ee4ab87d6eb0fc68504836599b0bca043fbbd86704428295b578d1e"],
  ["guide-mounjaro-coupon-1600.webp", "98669003a226a35d70cea381065ce15a3a056ee1b377fb75750b242f5a0f6246"],
  ["guide-mounjaro-coupon-800.avif", "1f8a628ffc2169fdd747f9269d55e0f7413ebb686b02c48c1504a4db51df7085"],
  ["guide-mounjaro-coupon-800.jpg", "a60c4acb2288f749a33d4df16d44da427ec8ef542b50e9490e4a727fa01141b5"],
  ["guide-mounjaro-coupon-800.webp", "a1fb8a22b60a63ea2bcb0efd0fdae407290f94d04afc790f81f27dbe0f753bb6"],
  ["guide-mounjaro-coupon-og.jpg", "ee1ff46aa06897bc8c4fa84589dbfca2a9a9df199959ff04b96cfe08e949184e"],
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, ROOT), "utf8"));

test("Mounjaro coupon page preserves source identity and the manifest-backed hero family", async () => {
  const [html, batch, manifest] = await Promise.all([
    readFile(new URL("public/guides/mounjaro-coupon/index.html", ROOT), "utf8"),
    readJson("data/blog/content-batch.json"),
    readJson("artifacts/ultracode/article-image-manifest.json"),
  ]);
  const article = batch.articles.find((item) => item.canonical_path === ROUTE);
  const record = manifest.records.find((item) => item.route === ROUTE);
  assert.ok(article, "Mounjaro coupon source record missing");
  assert.ok(record, "Mounjaro coupon image manifest record missing");
  assert.equal(record.title_sha256, sha256(article.h1));
  assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${ROUTE}">`));
  assert.match(html, new RegExp(`<h1>${article.h1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`));
  for (const output of record.outputs) {
    assert.equal(html.includes(`/assets/images/${output.name}`), true, `page does not reference ${output.name}`);
  }
});

test("Pass 2 replaces the cloned Mounjaro family with its unique route master lineage", async () => {
  const manifest = await readJson("artifacts/ultracode/article-image-manifest.json");
  const record = manifest.records.find((item) => item.route === ROUTE);
  assert.ok(record, "Mounjaro coupon image manifest record missing");
  assert.equal(manifest.schema, "glp-article-image-system-v3");
  assert.equal(record.disposition, "generated_from_gpt_image_2_route_master");
  assert.equal(record.generation_model, "gpt_image_2");
  assert.equal(record.master_path, "assets/source/article-masters-pass2/guide-mounjaro-coupon.webp");
  assert.equal(sha256(await readFile(new URL(record.master_path, ROOT))), record.master_sha256);
  assert.deepEqual(new Set(record.outputs.map((output) => output.name)), new Set(LEGACY_ASSET_SHA256.keys()));
  for (const output of record.outputs) {
    const name = output.name;
    const source = await readFile(new URL(`assets/derivatives/${name}`, ROOT));
    const deployed = await readFile(new URL(`public/assets/images/${name}`, ROOT));
    const hash = sha256(source);
    assert.notEqual(hash, LEGACY_ASSET_SHA256.get(name), `legacy clone survived: ${name}`);
    assert.equal(hash, output.sha256, `manifest/source drift: ${name}`);
    assert.equal(sha256(deployed), hash, `public/source mirror drift: ${name}`);
  }
});

// The catalog owns the editorial dateline; rendered material provenance owns
// sitemap freshness. Pin one route and bind its date to the registered receipt.
test("Mounjaro coupon route has one source-bound editorial date and material sitemap lastmod", async () => {
  const [sitemap, batch, provenance, stage, pointer] = await Promise.all([
    readFile(new URL("public/sitemap.xml", ROOT), "utf8"),
    readJson("data/blog/content-batch.json"),
    readJson("data/page-content-provenance.json"),
    readJson("artifacts/ops/aeo-surface-stage.json"),
    readJson("data/predecessors/content-base/current-content-base.json"),
  ]);
  const article = batch.articles.find((item) => item.canonical_path === ROUTE);
  assert.ok(article, "Mounjaro coupon source record missing");
  assert.match(article.updated_at, /^\d{4}-\d{2}-\d{2}$/);
  // D2p ruling: shared disclosure advances sitemap freshness, not article freshness.
  assert.equal(article.updated_at, '2026-08-29');
  const pageBytes = await readFile(new URL('public'+ROUTE+'index.html', ROOT));
  assert.match(pageBytes.toString(), /Updated <time datetime="2026-08-29">August 29, 2026<\/time>/);
  const record = provenance.pages[ROUTE];
  assert.ok(record, "route provenance missing");
  // The stage records its pre-stamp normalized hash; the shipped article then
  // receives a separate editorial dateline stamp. Do not equate those bytes.
  // Editorial freshness remains the catalog's 08-29; the later sitemap date
  // is the registered material-page reconciliation of different output bytes.
  assert.equal(sha256(await readFile(new URL('data/predecessors/content-base/current-content-base.json', ROOT))),
    'f2ff608d5c1d885cd48f861ed636c64e9324cdf91e9131448388575026499aee');
  const manifestBytes = await readFile(new URL('data/predecessors/content-base/deployment-manifest.json', ROOT));
  assert.equal(sha256(manifestBytes), pointer.manifest.sha256);
  const predecessorRows = JSON.parse(manifestBytes).release_rows;
  const projectionBytes = Buffer.from(JSON.stringify(predecessorRows) + '\n');
  assert.equal(stage.runtime_predecessor_manifest_sha256, sha256(projectionBytes));
  const relative = `public/${ROUTE.slice(1)}index.html`;
  const row = predecessorRows.find(item => item.path === relative);
  assert.ok(row, "verified predecessor page missing");
  const predecessor = await readFile(new URL(`data/predecessors/content-base/release/${relative}`, ROOT));
  assert.equal(sha256(predecessor), row.sha256);
  const materialText = bytes => {
    const body = bytes.toString().match(/<body\b[^>]*>([\s\S]*?)<\/body>/)?.[1];
    assert.ok(body, 'route body must exist in both authenticated outputs');
    return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
      .replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, ' DATE ')
      .replace(/<span\b[^>]*data-prices-checked-date[^>]*>[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const runtimeOnly = predecessor.toString().replace('</body>', '<script>window.__TEST_RUNTIME_ONLY__=true;</script></body>');
  const datesOnly = predecessor.toString().replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, '<time datetime="2030-01-01">January 1, 2030</time>');
  assert.equal(materialText(runtimeOnly), materialText(predecessor));
  assert.equal(materialText(datesOnly), materialText(predecessor));
  assert.notEqual(materialText(pageBytes), materialText(predecessor), 'rendered route content, not just dates or runtime stamps, must differ');
  assert.ok(stage.material_page_dates_reconciled.includes(ROUTE));
  assert.equal(record.lastmod, stage.release_date);
  assert.ok(record.lastmod > article.updated_at);
  const exact = `<url><loc>https://glpclinicscout.com${ROUTE}</loc><lastmod>${record.lastmod}</lastmod></url>`;
  assert.equal(sitemap.split(`https://glpclinicscout.com${ROUTE}`).length - 1, 1);
  assert.equal(sitemap.split(exact).length - 1, 1);
});