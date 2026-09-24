import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resolveFile = (relative) => path.isAbsolute(relative) ? relative : path.join(ROOT, relative);
const readText = (relative) => readFileSync(resolveFile(relative), "utf8");
const readJson = (relative) => JSON.parse(readText(relative));
const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (relative) => hashBytes(readFileSync(resolveFile(relative)));

const ARTICLE_MANIFEST_PATH = "artifacts/ultracode/article-image-manifest.json";
const PASS2_MANIFEST_PATH = "artifacts/ultracode/pass2-image-derivative-manifest.json";
const PRODUCT_COMPARISON_MANIFEST_PATH = "artifacts/ultracode/pass2-product-comparison-image-manifest.json";
const PROVIDER_MANIFEST_PATH = "assets/provider-logos/manifest.json";
const PROVIDER_ATLAS_PATH = "assets/provider-logos/pass2-lp-atlas.json";
const PROVIDER_SCENE_MANIFEST_PATH = "artifacts/ultracode/pass2-provider-review-image-manifest.json";
const PROVIDER_SCENE_STATE_PATH = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-provider-review-image-generation/state.json";
const VISUAL_QA_PATH = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-image-generation/VISUAL-QA-20260825.json";
const CONTACT_SHEET_MANIFEST_PATH = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-image-generation/contact-sheets/manifest.json";
const MIN_ARTICLE_DHASH_DISTANCE = 64;
const PRODUCT_SLUGS = ["wegovy-pill", "wegovy", "ozempic", "mounjaro", "zepbound"];
const PRODUCT_DISPLAY_NAMES = new Map([
  ["wegovy-pill", "Wegovy pill"],
  ["wegovy", "Wegovy"],
  ["ozempic", "Ozempic"],
  ["mounjaro", "Mounjaro"],
  ["zepbound", "Zepbound"],
]);
const CONSOLIDATED_ARTICLE_ROUTES = new Set([
  "/guides/cheapest-glp1/",
  "/guides/compare-online-glp-1-provider-fees/",
  "/guides/glp-1-program-total-cost-comparison/",
  "/guides/healthrx-vs-agelessrx/",
  "/guides/wellorithm-vs-enhance-md/",
]);

function corpusRoutes() {
  const routes = [];
  for (const source of ["data/blog/content-batch.json", "data/blog/content-national-wow-additions.json"]) {
    routes.push(...readJson(source).articles.map((article) => article.canonical_path));
  }
  return routes.sort();
}

function articleStem(route) {
  return `guide-${route.split("/").filter(Boolean).at(-1)}`;
}

function duplicates(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

async function servedHash(request, url, expectedContentType) {
  const response = await request.get(url, { maxRedirects: 0 });
  expect(response.status(), url).toBe(200);
  expect(response.headers().location || "", `${url} must not redirect`).toBe("");
  if (expectedContentType) expect((response.headers()["content-type"] || "").split(";")[0], url).toBe(expectedContentType);
  return hashBytes(await response.body());
}

function hammingDistanceHex(left, right) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (value) { distance += value & 1; value >>>= 1; }
  }
  return distance;
}

function htmlAttributes(tag = "") {
  const attributes = {};
  for (const match of tag.matchAll(/\b([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function htmlMeta(html, key, value) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    if ((attributes[key] || "").toLowerCase() === value.toLowerCase()) return attributes.content || "";
  }
  return "";
}

function htmlCanonical(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    if ((attributes.rel || "").split(/\s+/).includes("canonical")) return attributes.href || "";
  }
  return "";
}

function htmlRelease(html) {
  return htmlAttributes(html.match(/<html\b[^>]*>/i)?.[0] || "")["data-release"] || "";
}

async function servedDHashes(page, urls) {
  return page.evaluate(async (imageUrls) => {
    const hashes = [];
    for (const url of imageUrls) {
      const response = await fetch(url, { cache: "no-store" });
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = 17;
      canvas.height = 16;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, 17, 16);
      bitmap.close();
      const pixels = context.getImageData(0, 0, 17, 16).data;
      let bits = "";
      for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
        const left = (y * 17 + x) * 4;
        const right = left + 4;
        const leftLuma = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
        const rightLuma = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
        bits += leftLuma > rightLuma ? "1" : "0";
      }
      hashes.push(Array.from({ length: 64 }, (_, index) => Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16)).join(""));
    }
    return hashes;
  }, urls);
}

async function collectPrimaryArt(page, selector) {
  return page.locator(selector).evaluateAll((images) => images.map((image) => {
    const picture = image.closest("picture");
    const link = image.closest("a[href]");
    return {
      route: link?.getAttribute("href") || "",
      src: image.getAttribute("src") || "",
      alt: image.getAttribute("alt"),
      width: image.getAttribute("width"),
      height: image.getAttribute("height"),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      hasPicture: Boolean(picture),
      avifSrcset: picture?.querySelector('source[type="image/avif"]')?.getAttribute("srcset") || "",
      webpSrcset: picture?.querySelector('source[type="image/webp"]')?.getAttribute("srcset") || "",
    };
  }));
}

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;

test.setTimeout(300_000);
test.beforeEach(async ({ page }) => {
  await page.route(ANALYTICS, (route) => route.fulfill({ status: 204, body: "" }));
});

test("O-33 served home uses the local Clinic Scout image house style with distinct decoded hero art", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator(".cs-home2-hero")).toBeVisible();

  const pictures = page.locator(".cs-home2-cluster picture");
  await expect(pictures).toHaveCount(3);
  const records = await pictures.evaluateAll((nodes) => nodes.map((picture) => {
    const image = picture.querySelector("img");
    return {
      src: image?.getAttribute("src") || "",
      alt: image?.getAttribute("alt") || "",
      width: image?.getAttribute("width") || "",
      height: image?.getAttribute("height") || "",
      naturalWidth: image?.naturalWidth || 0,
      naturalHeight: image?.naturalHeight || 0,
      avif: picture.querySelector('source[type="image/avif"]')?.getAttribute("srcset") || "",
      webp: picture.querySelector('source[type="image/webp"]')?.getAttribute("srcset") || "",
    };
  }));

  for (const record of records) {
    expect(record.src).toMatch(/^\/assets\/images\/home-hero-(?:fruit|fridge|hand)-1024\.jpg$/);
    expect(record.alt.trim()).not.toBe("");
    expect([record.width, record.height]).toEqual(["1024", "1024"]);
    expect(record.naturalWidth).toBeGreaterThan(0);
    expect(record.naturalHeight).toBeGreaterThan(0);
    expect(record.avif).toMatch(/640\.avif 640w.*1024\.avif 1024w/);
    expect(record.webp).toMatch(/640\.webp 640w.*1024\.webp 1024w/);
  }
  expect(new Set(records.map((record) => record.src)).size).toBe(3);
  const hashes = await Promise.all(records.map((record) => servedHash(request, record.src)));
  expect(new Set(hashes).size).toBe(3);
});

test("O-34 every article route is bound to exact v3 route masters, visual QA, and a 64-bit dHash separation floor", async ({ page }) => {
  const manifest = readJson(ARTICLE_MANIFEST_PATH);
  const routes = corpusRoutes();
  const records = [...manifest.records].sort((left, right) => left.route.localeCompare(right.route));
  const statePath = manifest.route_master_state.path;
  const state = readJson(statePath);
  const visualQa = readJson(VISUAL_QA_PATH);
  const sheets = readJson(CONTACT_SHEET_MANIFEST_PATH);

  expect(manifest.schema).toBe("glp-article-image-system-v3");
  expect(manifest.status).toBe("PASS");
  expect([manifest.article_count, manifest.route_master_count, manifest.output_count]).toEqual([69, 69, 483]);
  expect(manifest.generation_model).toBe("gpt_image_2");
  expect(manifest.external_generation_services_used).toBe(69);
  expect(manifest.competitor_assets_used).toBe(0);
  expect(records.map((record) => record.route)).toEqual(routes);
  expect(new Set(records.map((record) => record.stem)).size).toBe(69);
  expect(new Set(records.map((record) => record.subject.trim())).size).toBe(69);
  expect(new Set(records.map((record) => record.master_sha256)).size).toBe(69);
  expect(hashFile(statePath)).toBe(manifest.route_master_state.sha256);
  expect(state.schema).toBe("glp-pass2-route-image-generation-v1");
  expect(state.job_set_type).toBe("gpt_image_2");
  expect(Object.keys(state.records)).toHaveLength(69);

  for (const record of records) {
    const generated = state.records[record.route];
    expect(generated.status, record.route).toBe("PASS");
    expect(generated.stem, record.route).toBe(record.stem);
    expect(generated.subject, record.route).toBe(record.subject);
    expect(generated.output_sha256, record.route).toBe(record.master_sha256);
    expect(generated.prompt_sha256, record.route).toBe(record.prompt_sha256);
    expect(hashFile(record.master_path), record.route).toBe(record.master_sha256);
  }

  expect(visualQa).toMatchObject({
    schema: "glp-pass2-route-image-visual-qa-v1",
    status: "PASS",
    route_master_count: 69,
    sheet_count: 8,
    regeneration_required: [],
    deploy_count: 0,
  });
  expect(path.resolve(visualQa.contact_sheet_manifest)).toBe(path.resolve(CONTACT_SHEET_MANIFEST_PATH));
  expect(visualQa.sheets).toHaveLength(8);
  expect(visualQa.sheets.every((row, index) => row.sheet === index + 1 && row.status === "PASS" && row.note.trim())).toBe(true);
  expect(sheets).toMatchObject({
    schema: "glp-pass2-route-image-contact-sheets-v1",
    status: "PASS",
    route_master_count: 69,
    unique_route_master_hashes: 69,
  });
  expect(sheets.sheets).toHaveLength(8);
  const sheetRoutes = sheets.sheets.flatMap((sheet) => sheet.routes);
  expect(sheetRoutes).toHaveLength(69);
  expect(new Set(sheetRoutes).size).toBe(69);
  expect([...sheetRoutes].sort()).toEqual(routes);
  for (const sheet of sheets.sheets) expect(hashFile(sheet.path), sheet.path).toBe(sheet.sha256);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const hashes = await servedDHashes(page, records.map((record) => `/assets/images/${record.stem}-1600.jpg`));
  expect(hashes).toHaveLength(69);
  expect(hashes.every((digest) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
  let closest = 256;
  for (let left = 0; left < hashes.length; left += 1) for (let right = left + 1; right < hashes.length; right += 1) {
    closest = Math.min(closest, hammingDistanceHex(hashes[left], hashes[right]));
  }
  expect(closest, `closest 256-bit dHash pair must be >= ${MIN_ARTICLE_DHASH_DISTANCE} bits apart`).toBeGreaterThanOrEqual(MIN_ARTICLE_DHASH_DISTANCE);
});

test("O-35 all seven outputs and the exact bound hero picture are served for 64 pages; five redirects are exact one-hop 301s", async ({ page, request }) => {
  const articleManifest = readJson(ARTICLE_MANIFEST_PATH);
  const records = new Map(articleManifest.records.map((record) => [record.route, record]));
  const articles = ["data/blog/content-batch.json", "data/blog/content-national-wow-additions.json"]
    .flatMap((source) => readJson(source).articles);
  const articleByRoute = new Map(articles.map((article) => [article.canonical_path, article]));
  const routes = [...records.keys()].sort();
  expect(routes).toHaveLength(69);
  expect(new Set(routes).size).toBe(69);
  const redirectRows = new Map(readText("public/_redirects").split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((row) => row.length >= 3).map(([from, to, status]) => [from, { to, status: Number(status) }]));
  for (const route of CONSOLIDATED_ARTICLE_ROUTES) expect(redirectRows.get(route), route).toEqual({ to: "/providers/", status: 301 });

  const problems = [];
  let activePages = 0;
  let redirects = 0;
  for (const route of routes) {
    const record = records.get(route);
    if (record.outputs.length !== 7) problems.push(`${route}: expected seven manifest outputs`);
    for (const output of record.outputs) {
      const expectedMime = output.name.endsWith(".avif") ? "image/avif" : output.name.endsWith(".webp") ? "image/webp" : "image/jpeg";
      for (const prefix of ["assets/derivatives", "public/assets/images"]) {
        const relative = `${prefix}/${output.name}`;
        if (!existsSync(resolveFile(relative)) || hashFile(relative) !== output.sha256) problems.push(`${route}: local hash mismatch ${relative}`);
      }
      const response = await request.get(`/assets/images/${output.name}`, { maxRedirects: 0 });
      const bytes = await response.body();
      if (response.status() !== 200
        || (response.headers().location || "") !== ""
        || (response.headers()["content-type"] || "").split(";")[0] !== expectedMime
        || hashBytes(bytes) !== output.sha256) problems.push(`${route}: served output mismatch ${output.name}`);
    }

    const initial = await request.get(route, { maxRedirects: 0 });
    if (CONSOLIDATED_ARTICLE_ROUTES.has(route)) {
      redirects += 1;
      const expectedLocation = new URL("/providers/", initial.url()).href;
      if (initial.status() !== 301 || initial.headers().location !== expectedLocation) problems.push(`${route}: expected exact 301 Location ${expectedLocation}`);
      const target = await request.get(initial.headers().location || "/invalid", { maxRedirects: 0 });
      if (target.status() !== 200 || new URL(target.url()).pathname !== "/providers/") problems.push(`${route}: one-hop target not exact HTTP 200 /providers/`);
      continue;
    }

    activePages += 1;
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    if (response?.status() !== 200 || new URL(page.url()).pathname !== route) problems.push(`${route}: active route did not stay HTTP 200`);
    const picture = page.locator(`picture:has(img[src="/assets/images/${record.stem}-1600.jpg"])`);
    const count = await picture.count();
    if (count !== 1) {
      problems.push(`${route}: exact hero picture count ${count}`);
      continue;
    }
    const observed = await picture.evaluate((node) => {
      const image = node.querySelector("img");
      const avif = node.querySelector('source[type="image/avif"]');
      const webp = node.querySelector('source[type="image/webp"]');
      return {
        imageSrc: image?.getAttribute("src") || "",
        imageSrcset: image?.getAttribute("srcset") || "",
        imageSizes: image?.getAttribute("sizes") || "",
        alt: image?.getAttribute("alt") || "",
        width: image?.getAttribute("width") || "",
        height: image?.getAttribute("height") || "",
        avifSrcset: avif?.getAttribute("srcset") || "",
        avifSizes: avif?.getAttribute("sizes") || "",
        webpSrcset: webp?.getAttribute("srcset") || "",
        webpSizes: webp?.getAttribute("sizes") || "",
      };
    });
    const prefix = `/assets/images/${record.stem}`;
    const article = articleByRoute.get(route);
    const expectedAlt = article.images?.[0]?.alt?.trim() || `Guide overview for ${article.h1}`;
    const expected = {
      imageSrc: `${prefix}-1600.jpg`,
      imageSrcset: `${prefix}-800.jpg 800w, ${prefix}-1600.jpg 1600w`,
      alt: expectedAlt,
      width: "1600",
      height: "900",
      avifSrcset: `${prefix}-800.avif 800w, ${prefix}-1600.avif 1600w`,
      webpSrcset: `${prefix}-800.webp 800w, ${prefix}-1600.webp 1600w`,
    };
    for (const [field, value] of Object.entries(expected)) if (observed[field] !== value) problems.push(`${route}: ${field} mismatch`);
    if (!observed.imageSizes || observed.imageSizes !== observed.avifSizes || observed.imageSizes !== observed.webpSizes) problems.push(`${route}: sizes missing or split across exact picture`);
  }
  expect({ activePages, redirects }).toEqual({ activePages: 64, redirects: 5 });
  expect(problems).toEqual([]);
});

test("O-36 exact Orderly sprite/review identity lineage and responsive on-theme scene art are required per surface", async ({ page, request }) => {
  const manifest = readJson(PROVIDER_MANIFEST_PATH);
  const atlas = readJson(PROVIDER_ATLAS_PATH);
  const sceneManifest = readJson(PROVIDER_SCENE_MANIFEST_PATH);
  const sceneState = readJson(PROVIDER_SCENE_STATE_PATH);
  const orderly = manifest.logos.find((logo) => logo.program_id === "orderlymeds");
  const atlasEntry = atlas.entries.find((entry) => entry.program_id === "orderlymeds");
  const orderlyScene = sceneManifest.records.find((record) => record.program_id === "orderlymeds");
  expect(manifest.status).toBe("PASS");
  expect(manifest.runtime_remote_assets).toBe(0);
  expect(manifest.logos).toHaveLength(32);
  expect(orderly).toMatchObject({
    provider: "OrderlyMeds",
    logo_treatment: "light-chip",
    output_file: "orderlymeds.webp",
    public_path: "/assets/provider-logos/orderlymeds.webp",
    output_sha256: "eab41bf3122ef6f46aaa6a034e37a8bd4fe20a2bd25f5de6ec2dc0e7ca05b0d3",
    width: 345,
    height: 63,
    runtime_remote_load: false,
  });
  expect(atlas).toMatchObject({
    schema: "glp-provider-logo-lp-atlas-v1",
    status: "PASS",
    public_path: "/assets/provider-logos/pass2-lp-atlas.webp",
    display_atlas_width: 768,
    display_atlas_height: 184,
    entry_count: 32,
  });
  expect(atlas.source_manifest_sha256).toBe(hashFile(PROVIDER_MANIFEST_PATH));
  expect(atlas.atlas_sha256).toBe(hashFile("assets/provider-logos/pass2-lp-atlas.webp"));
  expect(atlas.atlas_sha256).toBe(hashFile("public/assets/provider-logos/pass2-lp-atlas.webp"));
  expect(atlasEntry).toMatchObject({
    source_path: "/assets/provider-logos/orderlymeds.webp",
    source_sha256: orderly.output_sha256,
    display_x: 96,
    display_y: 92,
    logo_treatment: "light-chip",
  });
  expect(sceneManifest).toMatchObject({
    schema: "glp-pass2-provider-review-image-manifest-v1",
    status: "PASS",
    provider_count: 35,
    passed_count: 35,
    derivative_count: 210,
    unique_master_hashes: 35,
    unique_derivative_hashes: 210,
    provider_calls_during_build: 0,
  });
  expect(sceneState).toMatchObject({ schema: "glp-pass2-provider-review-image-generation-v1", job_set_type: "gpt_image_2", model: "GPT Image 2", quality: "high", resolution: "4k" });
  expect(Object.keys(sceneState.records)).toHaveLength(35);
  expect(orderlyScene).toEqual(sceneState.records.orderlymeds);
  expect(orderlyScene).toMatchObject({
    status: "PASS",
    program_id: "orderlymeds",
    display_name: "OrderlyMeds",
    review_path: "/reviews/orderlymeds/",
    subject: "Provider-specific editorial evidence scene for the governed Clinic Scout identity OrderlyMeds.",
    width: 3840,
    height: 2160,
  });
  expect(hashFile(orderlyScene.output_relative_path)).toBe(orderlyScene.output_sha256);
  expect(orderlyScene.derivatives).toHaveLength(6);
  for (const derivative of orderlyScene.derivatives) {
    expect(hashFile(derivative.path), derivative.path).toBe(derivative.sha256);
    const publicPath = `public/${derivative.path.replace(/^assets\/derivatives\//, "assets/images/")}`;
    expect(hashFile(publicPath), publicPath).toBe(derivative.sha256);
    const servedPath = `/${publicPath.replace(/^public\//, "")}`;
    const expectedType = servedPath.endsWith(".avif") ? "image/avif" : servedPath.endsWith(".webp") ? "image/webp" : "image/jpeg";
    expect(await servedHash(request, servedPath, expectedType), servedPath).toBe(derivative.sha256);
  }

  const sceneProblems = [];
  for (const route of ["/providers/orderlymeds/", "/reviews/orderlymeds/"]) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBe(200);
    expect(new URL(page.url()).pathname, route).toBe(route);
    const scenes = await page.locator('picture img:not([src*="/provider-logos/"])').evaluateAll(async (images) => Promise.all(images.map(async (image) => {
      await image.decode().catch(() => {});
      const picture = image.closest("picture");
      return {
        currentSrc: new URL(image.currentSrc || image.src, location.href).pathname,
        src: image.getAttribute("src") || "",
        jpgSrcset: image.getAttribute("srcset") || "",
        sizes: image.getAttribute("sizes") || "",
        alt: image.alt,
        width: image.getAttribute("width") || "",
        height: image.getAttribute("height") || "",
        decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        avif: picture?.querySelector('source[type="image/avif"]')?.getAttribute("srcset") || "",
        avifSizes: picture?.querySelector('source[type="image/avif"]')?.getAttribute("sizes") || "",
        webp: picture?.querySelector('source[type="image/webp"]')?.getAttribute("srcset") || "",
        webpSizes: picture?.querySelector('source[type="image/webp"]')?.getAttribute("sizes") || "",
      };
    })));
    const prefix = "/assets/images/provider-review-pass2/orderlymeds";
    const surface = route.startsWith("/providers/")
      ? {
        sizes: "(max-width:760px) calc(100vw - 32px), 720px",
        alt: "Original editorial evidence scene for the OrderlyMeds provider profile",
      }
      : {
        sizes: "(max-width:760px) calc(100vw - 32px), 920px",
        alt: "Editorial evidence desk for the OrderlyMeds review with a blank research dossier and comparison materials",
      };
    const specific = scenes.filter((scene) => scene.src === `${prefix}-1280.jpg`
      && scene.avif === `${prefix}-640.avif 640w, ${prefix}-1280.avif 1280w`
      && scene.webp === `${prefix}-640.webp 640w, ${prefix}-1280.webp 1280w`
      && scene.jpgSrcset === `${prefix}-640.jpg 640w, ${prefix}-1280.jpg 1280w`
      && scene.sizes === surface.sizes && scene.avifSizes === surface.sizes && scene.webpSizes === surface.sizes
      && scene.alt === surface.alt
      && scene.width === "1280" && scene.height === "720" && scene.decoded);
    if (specific.length !== 1) sceneProblems.push({ route, blocker: "missing_or_nonexact_responsive_orderly_specific_on_theme_scene", expectedMasterSha256: orderlyScene.output_sha256, candidates: scenes });

    if (route.startsWith("/providers/")) {
      const identities = page.locator('.provider-logo[role="img"]');
      expect(await identities.count()).toBeGreaterThanOrEqual(1);
      const observedRows = await identities.evaluateAll((nodes) => nodes.map((node) => {
        const style = getComputedStyle(node);
        const source = style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1] || "";
        return {
          classes: [...node.classList].sort(),
          ariaLabel: node.getAttribute("aria-label"),
          src: new URL(source, location.href).pathname,
          x: style.backgroundPositionX,
          y: style.backgroundPositionY,
          size: style.backgroundSize,
        };
      }));
      for (const observed of observedRows) {
        expect(observed).toEqual({
          classes: ["provider-logo", "provider-logo--light", "provider-logo--sprite"],
          ariaLabel: "OrderlyMeds logo",
          src: "/assets/provider-logos/pass2-lp-atlas.webp",
          x: "-96px",
          y: "-92px",
          size: "768px 184px",
        });
      }
      expect(await servedHash(request, observedRows[0].src, "image/webp")).toBe(atlas.atlas_sha256);
    } else {
      await expect(page.locator(".review-logo--light")).toHaveCount(1);
      const image = page.locator(".review-logo--light > img");
      await expect(image).toHaveCount(1);
      await expect(image).toHaveAttribute("src", "/assets/provider-logos/orderlymeds.webp");
      await expect(image).toHaveAttribute("alt", "OrderlyMeds logo");
      await expect(image).toHaveAttribute("width", "345");
      await expect(image).toHaveAttribute("height", "63");
      expect(await image.evaluate(async (node) => { await node.decode(); return [node.naturalWidth, node.naturalHeight]; })).toEqual([345, 63]);
      expect(await servedHash(request, orderly.public_path, "image/webp")).toBe(orderly.output_sha256);
    }
  }
  expect(sceneProblems, "O-36 is BLOCKED until both Orderly surfaces have responsive provider-specific on-theme scene imagery; logos alone cannot PASS").toEqual([]);
});

test("O-37 five brand product routes bind the exact responsive AVIF/WebP/JPG inventory to five unique GPT Image 2 originals", async ({ page, request }) => {
  const manifest = readJson(PRODUCT_COMPARISON_MANIFEST_PATH);
  expect(manifest).toMatchObject({
    schema: "glp-pass2-product-comparison-image-manifest-v1",
    status: "PASS",
    expected: 9,
  });
  expect(manifest.records).toHaveLength(9);
  expect(manifest.records.every((record) => record.status === "PASS" && record.model === "gpt_image_2")).toBe(true);
  expect(new Set(manifest.records.map((record) => record.master_sha256)).size).toBe(9);
  const recordById = new Map(manifest.records.map((record) => [record.id, record]));

  const fallbackHashes = [];
  for (const slug of PRODUCT_SLUGS) {
    const route = `/${slug}/`;
    const stem = `brand-${slug}`;
    const record = recordById.get(stem);
    expect(record, stem).toBeTruthy();
    expect(record).toMatchObject({ id: stem, kind: "brand", route, status: "PASS", model: "gpt_image_2" });
    expect(hashFile(record.master_path), record.master_path).toBe(record.master_sha256);
    const widths = stem === "brand-wegovy" ? [384, 640, 1280] : [640, 1280];
    const expectedOutputs = widths.flatMap((width) => ["avif", "webp", "jpg"].map((format) => ({
      path: `assets/derivatives/product-comparison-pass2/${stem}-${width}.${format}`,
      width,
      height: Math.round(width * 9 / 16),
      format,
    })));
    expect(record.outputs.map(({ path, width, height, format }) => ({ path, width, height, format }))
      .sort((left, right) => left.path.localeCompare(right.path))).toEqual(
      expectedOutputs.sort((left, right) => left.path.localeCompare(right.path)),
    );

    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBe(200);
    expect(new URL(page.url()).pathname, route).toBe(route);
    const picture = page.locator(`picture[data-product-visual="${stem}"]`);
    await expect(picture).toHaveCount(1);
    const prefix = `/assets/images/product-comparison-pass2/${stem}`;
    const sizes = "(max-width:760px) calc(100vw - 32px), 720px";
    const mobileWidth = stem === "brand-wegovy" ? 384 : 640;
    await expect(picture.locator("source")).toHaveCount(4);
    await expect.poll(() => picture.locator("source").evaluateAll((nodes) => nodes.map((node) => Object.fromEntries([...node.attributes].map(({ name, value }) => [name, value]))))).toEqual([
      { media: "(max-width:760px)", srcset: `${prefix}-${mobileWidth}.webp`, type: "image/webp" },
      { media: "(max-width:760px)", srcset: `${prefix}-${mobileWidth}.avif`, type: "image/avif" },
      { srcset: `${prefix}-640.avif 640w, ${prefix}-1280.avif 1280w`, sizes: "720px", type: "image/avif" },
      { srcset: `${prefix}-640.webp 640w, ${prefix}-1280.webp 1280w`, sizes: "720px", type: "image/webp" },
    ]);
    const image = picture.locator("img");
    await expect(image).toHaveAttribute("src", `${prefix}-1280.jpg`);
    await expect(image).toHaveAttribute("srcset", `${prefix}-640.jpg 640w, ${prefix}-1280.jpg 1280w`);
    await expect(image).toHaveAttribute("sizes", sizes);
    await expect(image).toHaveAttribute("alt", `Original editorial comparison scene for the ${PRODUCT_DISPLAY_NAMES.get(slug)} evidence route`);
    await expect(image).toHaveAttribute("width", "1280");
    await expect(image).toHaveAttribute("height", "720");
    expect(await image.evaluate(async (node) => { await node.decode(); return node.complete && node.naturalWidth > 0 && node.naturalHeight > 0; })).toBe(true);

    for (const output of record.outputs) {
      expect(hashFile(output.path), output.path).toBe(output.sha256);
      const publicPath = output.path.replace(/^assets\/derivatives\//, "public/assets/images/");
      expect(hashFile(publicPath), publicPath).toBe(output.sha256);
      const assetPath = `/${publicPath.replace(/^public\//, "")}`;
      const mime = output.format === "jpg" ? "image/jpeg" : `image/${output.format}`;
      expect(await servedHash(request, assetPath, mime), assetPath).toBe(output.sha256);
      expect([output.width, output.height]).toEqual([output.width, Math.round(output.width * 9 / 16)]);
      if (output.width === 1280 && output.format === "jpg") fallbackHashes.push(output.sha256);
    }
  }
  expect(new Set(fallbackHashes).size).toBe(5);
});

test("O-38 sitemap, release disposition, canonical/social imagery, publish commands, and audit-only Pass-2 derivatives are exact", async ({ request }) => {
  const pkg = readJson("package.json");
  expect(pkg.scripts["generate:article-route-masters"]).toBe("python3 scripts/pass2-generate-route-images.py --workers 3");
  expect(pkg.scripts["generate:article-imagery"]).toBe("python3 scripts/generate-article-imagery.py");
  expect(pkg.scripts["publish:article-imagery"]).toBe(
    "npm run generate:article-route-masters && npm run generate:article-imagery && python3 scripts/pass2-image-derivative-audit.py",
  );
  expect(pkg.scripts.build).not.toMatch(/generate:article-route-masters|publish:article-imagery/);
  expect(pkg.scripts["validate:article-imagery"]).toBe("python3 scripts/generate-article-imagery.py --check");

  const articleManifest = readJson(ARTICLE_MANIFEST_PATH);
  const pass2 = readJson(PASS2_MANIFEST_PATH);
  expect(pass2).toMatchObject({
    schema: "gcs.pass2.image-derivative-audit.v1",
    audit_status: "PASS",
    release_readiness: "PASS",
    execution_mode: "candidate-local deterministic Pillow only; zero network/provider calls",
  });
  expect(pass2.derivative_summary).toMatchObject({
    article_output_count: 621,
    product_output_count: 30,
    total_output_count: 651,
    public_mirror_count: 651,
    public_mirror_mismatch_count: 0,
  });
  expect(pass2.gaps).toHaveLength(5);
  expect(pass2.gaps.every((gap) => gap.reason === "omitted_no_upscale_source_master_is_1024px" && gap.requested_width === 1600 && gap.source_width === 1024 && gap.severity !== "release_blocker")).toBe(true);
  expect(pass2.source_manifests.every((row) => hashFile(row.path) === row.sha256)).toBe(true);
  expect(pass2.commands.check).toBe("python3 scripts/pass2-image-derivative-audit.py --check");

  const sitemap = await request.get("/sitemap.xml", { maxRedirects: 0 });
  expect(sitemap.status()).toBe(200);
  expect((sitemap.headers()["content-type"] || "").split(";")[0]).toMatch(/xml/);
  const sitemapText = await sitemap.text();
  const urls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(urls).toHaveLength(230);
  expect(new Set(urls).size).toBe(230);
  const sitemapPaths = new Set(urls.map((value) => {
    const url = new URL(value);
    expect(url.origin).toBe("https://glpclinicscout.com");
    return url.pathname;
  }));

  const problems = [];
  const disposition = { releaseReady: 0, held: 0, redirects: 0 };
  let pass2ReferenceCount = 0;
  for (const record of articleManifest.records) {
    const initial = await request.get(record.route, { maxRedirects: 0 });
    if (CONSOLIDATED_ARTICLE_ROUTES.has(record.route)) {
      disposition.redirects += 1;
      const expectedLocation = new URL("/providers/", initial.url()).href;
      if (initial.status() !== 301 || initial.headers().location !== expectedLocation || sitemapPaths.has(record.route)) problems.push(`${record.route}: redirect disposition mismatch`);
      const target = await request.get(initial.headers().location || "/invalid", { maxRedirects: 0 });
      if (target.status() !== 200 || new URL(target.url()).pathname !== "/providers/") problems.push(`${record.route}: redirect is not one hop`);
      continue;
    }
    const html = await initial.text();
    pass2ReferenceCount += (html.match(/\/assets\/images\/pass2\//g) || []).length;
    const release = htmlRelease(html);
    const robots = htmlMeta(html, "name", "robots");
    if (release === "release-ready") {
      disposition.releaseReady += 1;
      const expectedCanonical = `https://glpclinicscout.com${record.route}`;
      const expectedSocial = `https://glpclinicscout.com/assets/images/${record.stem}-og.jpg`;
      if (initial.status() !== 200
        || robots !== "index,follow,max-image-preview:large"
        || !sitemapPaths.has(record.route)
        || htmlCanonical(html) !== expectedCanonical
        || htmlMeta(html, "property", "og:image") !== expectedSocial
        || htmlMeta(html, "name", "twitter:image") !== expectedSocial) problems.push(`${record.route}: indexable canonical/social/sitemap mismatch`);
      const output = record.outputs.find((row) => row.name === `${record.stem}-og.jpg`);
      if (!output || await servedHash(request, `/assets/images/${record.stem}-og.jpg`, "image/jpeg") !== output.sha256) problems.push(`${record.route}: OG bytes mismatch`);
    } else if (release === "held") {
      disposition.held += 1;
      if (initial.status() !== 200 || robots !== "noindex,nofollow,noarchive,nosnippet,max-image-preview:large" || sitemapPaths.has(record.route)) problems.push(`${record.route}: held noindex/sitemap mismatch`);
    } else {
      problems.push(`${record.route}: unknown data-release ${release}`);
    }
  }
  for (const slug of PRODUCT_SLUGS) {
    const response = await request.get(`/${slug}/`, { maxRedirects: 0 });
    pass2ReferenceCount += ((await response.text()).match(/\/assets\/images\/pass2\//g) || []).length;
  }
  expect(disposition).toEqual({ releaseReady: 44, held: 20, redirects: 5 });
  expect(problems).toEqual([]);
  expect(pass2ReferenceCount, "Pass-2 480/960/1600 derivatives are audit-only current bytes and must not be described as served").toBe(0);
});

test("G-8 home and insights primary art is unrepeated by served bytes and has responsive picture, alt, and intrinsic dimensions", async ({ page, request }) => {
  const issues = [];

  for (const viewport of [
    { label: "desktop", width: 1440, height: 1000 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const surface of [
      { label: "home", route: "/", selector: ".cs-home2-editorial .cs-home2-article:visible img" },
      { label: "insights", route: "/insights/", selector: ".p3-insight-cycle img" },
    ]) {
      const response = await page.goto(surface.route, { waitUntil: "domcontentloaded" });
      if (response?.status() !== 200) issues.push(`${surface.label}@${viewport.label}: HTTP ${response?.status()}`);
      const art = await collectPrimaryArt(page, surface.selector);
      if (art.length === 0) issues.push(`${surface.label}@${viewport.label}: no primary art found`);

      const repeatedUrls = duplicates(art.map((row) => row.src));
      if (repeatedUrls.length) issues.push(`${surface.label}@${viewport.label}: repeated served URLs ${JSON.stringify(repeatedUrls)}`);

      const servedHashes = [];
      for (const row of art) {
        const response = await request.get(row.src);
        if (response.status() !== 200) issues.push(`${surface.label}@${viewport.label}: ${row.src} HTTP ${response.status()}`);
        else servedHashes.push(hashBytes(await response.body()));
      }
      const repeatedHashes = duplicates(servedHashes);
      if (repeatedHashes.length) issues.push(`${surface.label}@${viewport.label}: repeated served image bytes ${JSON.stringify(repeatedHashes)}`);

      const incomplete = art.filter((row) => !row.hasPicture
        || !row.avifSrcset
        || !row.webpSrcset
        || !row.alt?.trim()
        || !/^\d+$/.test(row.width || "")
        || !/^\d+$/.test(row.height || ""));
      if (incomplete.length) {
        issues.push(`${surface.label}@${viewport.label}: ${incomplete.length}/${art.length} primary images lack the complete responsive/accessibility/intrinsic contract; sample=${JSON.stringify(incomplete.slice(0, 2))}`);
      }
    }
  }

  expect(issues, "G-8 remains fail-closed; do not suppress repeated-source or responsive-markup blockers").toEqual([]);
});
