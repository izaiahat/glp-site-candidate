import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { detailPrograms } from './helpers/d2w-s9-contracts.mjs';

const root = new URL("..", import.meta.url).pathname;
const read = (relative) => readFile(path.join(root, relative), "utf8");
const exists = async (relative) => { await stat(path.join(root, relative)); return true; };
const registry = JSON.parse(await read("data/program-registry.json"));
const graph = JSON.parse(await read("data/phase3-page-graph.json"));
const pharmacies = JSON.parse(await read("data/phase3-pharmacy-render-input.json"));
const articleImages = JSON.parse(await read("artifacts/ultracode/article-image-manifest.json"));
const canonicalReviewProviderCount = registry.programs.filter((program) => {
  const profile = program.profiles?.["glp-clinic-scout"];
  return /^\/reviews\/[a-z0-9-]+\/$/.test(program.review_path || "")
    && profile?.canonical_identity?.role !== "alias";
}).length;

test("late-audit review hub and submission output are governed and complete", async () => {
  const hub = await read("public/reviews/index.html");
  const submit = await read("public/reviews/submit/index.html");
  assert.equal((hub.match(/data-review-card/g) || []).length, canonicalReviewProviderCount + pharmacies.entries.length);
  assert.doesNotMatch(hub, /Approved submitted reviews/);
  assert.match(hub, /Submitted experiences are checked before they can appear here/);
  assert.match(hub, /data-review-type-filter="provider"/);
  assert.match(hub, /data-review-type-filter="pharmacy"/);
  assert.match(hub, /data-review-load-more/);
  assert.match(submit, /name="robots" content="noindex,follow,noarchive,nosnippet"/);
  assert.equal((submit.match(/data-review-entity-type="provider"/g) || []).length, canonicalReviewProviderCount);
  assert.equal((submit.match(/data-review-entity-type="pharmacy"/g) || []).length, pharmacies.entries.length);
  assert.match(submit, /type="file" name="evidence"/);
  await exists("public/assets/review-hub.js");
});

test("every provider detail and review route serves provider-specific original artwork", async () => {
  const providerRows = detailPrograms(registry, graph);
  const governedProviderIds = new Set(providerRows.map((program) => program.program_id));
  const programs = [...new Map(providerRows.map((program) => [program.program_id, program])).values()];
  const redirects = await read("public/_redirects");
  const redirectSources = new Set(redirects.trim().split("\n").map((line) => line.split(/\s+/)[0]));
  assert.equal(programs.length, governedProviderIds.size);
  for (const program of programs) {
    const detail = await read(`public/providers/${program.program_id}/index.html`);
    assert.match(detail, new RegExp(`data-provider-visual="${program.program_id}"`));
    const sceneAsset = `assets/derivatives/provider-review-pass2/${program.program_id}-1280.avif`;
    try {
      await exists(sceneAsset);
      assert.match(detail, new RegExp(`/assets/images/provider-review-pass2/${program.program_id}-1280\\.avif`));
      assert.match(detail, /data-provider-visual-kind="editorial-scene"/);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await exists(`public/assets/provider-logos/${program.program_id}.webp`);
      assert.match(detail, /data-provider-visual-kind="provider-logo-fallback"/);
      assert.match(detail, new RegExp(`/assets/provider-logos/${program.program_id}\\.webp`));
    }
  }
  for (const program of registry.programs) {
    if (!program.review_path || redirectSources.has(program.review_path)) continue;
    const review = await read(`public/${program.review_path.replace(/^\//, "")}index.html`);
    assert.match(review, new RegExp(`data-provider-scene="${program.program_id}"`));
  }
});

test("every brand, compounded, and bulk route serves a distinct product visual", async () => {
  const routes = [
    ...graph.brand_pages.map((page) => [page, `brand-${page.slug}`]),
    ...graph.compounded_pages.map((page) => [page, `compounded-${page.medication_id}`]),
    ...graph.bulk_pages.map((page) => [page, `bulk-${page.duration_months}-month`]),
  ];
  assert.equal(routes.length, 9);
  for (const [page, id] of routes) {
    const html = await read(`public/${page.route.replace(/^\//, "")}index.html`);
    assert.match(html, new RegExp(`data-product-visual="${id}"`));
    assert.match(html, new RegExp(`/assets/images/product-comparison-pass2/${id}-1280\\.avif`));
  }
});

test("paid compounded routes keep original-art lineage while loading one compact AVIF", async () => {
  for (const page of graph.compounded_pages) {
    const id = `compounded-${page.medication_id}`;
    const html = await read(`public/${page.route.replace(/^\//, "")}index.html`);
    const picture = html.match(new RegExp(`<picture class="p3-product-visual" data-product-visual="${id}"[\\s\\S]*?<\\/picture>`))?.[0] || "";
    assert.match(picture, new RegExp(`data-full-src="/assets/images/product-comparison-pass2/${id}-1280\\.avif"`));
    assert.match(picture, new RegExp(`<img src="/assets/images/product-comparison-pass2/${id}-640\\.avif"`));
    assert.doesNotMatch(picture, /<source\b|srcset=/);
    assert.doesNotMatch(html, /\/assets\/vendor\/(?:gsap|lenis)\/|\/assets\/motion\.js/);
  }
});

test("all served article documents expose the complete share control set", async () => {
  let checked = 0;
  for (const record of articleImages.records) {
    const relative = `public/${record.route.replace(/^\//, "")}index.html`;
    try {
      const html = await read(relative);
      assert.equal((html.match(/data-article-share/g) || []).length, 1, record.route);
      assert.match(html, /data-share-native/, record.route);
      assert.match(html, /mailto:\?subject=/, record.route);
      assert.match(html, /https:\/\/x\.com\/intent\/post\?/, record.route);
      assert.match(html, /data-share-copy/, record.route);
      checked += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  assert.equal(checked, 72); // Current corpus includes the Ezra and top-rated GLP-1 carrier guides.
  await exists("public/assets/editorial-share.js");
});

test("article hero alt replacement preserves dollar amounts as literal text", async () => {
  const [gala, mounjaro, batchSource] = await Promise.all([
    read("public/guides/gala-vs-shed/index.html"),
    read("public/guides/mounjaro-coupon/index.html"),
    read("data/blog/content-batch.json"),
  ]);
  const article = JSON.parse(batchSource).articles.find((item) => item.canonical_path === "/guides/mounjaro-coupon/");
  assert.ok(article, "Mounjaro coupon source record missing");
  assert.match(article.h1, /\$/);
  const expectedAlt = `alt="Guide overview for ${article.h1}"`;
  assert.match(expectedAlt, /\$/);
  assert.match(gala, /alt="Guide overview for Gala vs Shed: compare the full terms, not a \$20 headline gap"/);
  assert.equal(mounjaro.split(expectedAlt).length - 1, 1);
});

test("late-audit aliases, zero-click subscriptions, O23 desktop layout, and D36 replay entrances survive the current build", async () => {
  const redirects = await read("public/_redirects");
  assert.doesNotMatch(redirects, /^\/(?:semaglutide|tirzepatide)\/\s/m);
  for (const medication of ["semaglutide", "tirzepatide"]) {
    const category = await read(`public/${medication}/index.html`);
    assert.ok(category.includes(`data-g08-medication="${medication}"`));
    assert.ok(category.includes(`<link rel="canonical" href="https://glpclinicscout.com/${medication}/">`));
    assert.match(category, /name="robots" content="index,follow,max-image-preview:large"/);
  }
  assert.match(redirects, /^\/support\/\s+\/privacy\/lead-capture\/\s+301$/m);
  const home = await read("public/index.html");
  const css = await read("public/assets/site-home.css");
  const captureForm = home.match(/<form[^>]*data-content-upgrade-form-inline[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(captureForm, /name="email"/);
  assert.doesNotMatch(captureForm, /type="checkbox"|name="email_consent"/);
  assert.doesNotMatch(home, /data-motion-once="true"/);
  assert.ok((home.match(/data-motion-once="false"/g) || []).length >= 16);
  const homeReview = home.match(/<form[^>]*data-review-intake[^>]*data-review-compact[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(homeReview, />Submit for review<\/button>/);
  assert.doesNotMatch(homeReview, /type="file" name="evidence"|data-review-step="counterpart"/);
  assert.match(css, /\.cs-review-sheet__panel \.p5-review-form--compact textarea\s*\{[^}]*min-height:\s*88px/s);
  assert.match(css, /\.cs-review-sheet__panel \.p5-review-form--compact \.p5-actions \.cta\s*\{[^}]*width:\s*100%/s);
});
