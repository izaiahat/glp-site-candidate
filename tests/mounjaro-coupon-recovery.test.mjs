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

// The refreshed catalog row owns the route's machine date. This still pins one
// exact route and one exact date, so a missing, duplicate, or bulk-stamped row fails.
test("Mounjaro coupon route has one truthful catalog-bound sitemap lastmod", async () => {
  const [sitemap, batch] = await Promise.all([
    readFile(new URL("public/sitemap.xml", ROOT), "utf8"),
    readJson("data/blog/content-batch.json"),
  ]);
  const article = batch.articles.find((item) => item.canonical_path === ROUTE);
  assert.ok(article, "Mounjaro coupon source record missing");
  assert.match(article.updated_at, /^\d{4}-\d{2}-\d{2}$/);
  // D2p ruling: shared disclosure advances sitemap freshness, not article freshness.
  assert.equal(article.updated_at, '2026-08-29');
  const page = await readFile(new URL('public'+ROUTE+'index.html', ROOT), 'utf8');
  assert.match(page, /Updated <time datetime="2026-08-29">August 29, 2026<\/time>/);
  const exact = `<url><loc>https://glpclinicscout.com${ROUTE}</loc><lastmod>2026-09-09</lastmod></url>`;
  assert.equal(sitemap.split(`https://glpclinicscout.com${ROUTE}`).length - 1, 1);
  assert.equal(sitemap.split(exact).length - 1, 1);
});