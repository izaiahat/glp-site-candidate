import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(candidateRoot, "public");
const baseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4500/");
const defaultOutputPath = path.resolve(
  candidateRoot,
  "../../../../reports/glp-clinic-scout/rebuild/internal-link-audit-both-viewports.json",
);
const outputPath = path.resolve(process.argv[2] || defaultOutputPath);
const viewports = Object.freeze([
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
]);

async function collectHtmlFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectHtmlFiles(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

function routeForFile(filePath) {
  const relative = path.relative(publicRoot, filePath).split(path.sep).join("/");
  if (relative === "index.html") return "/";
  if (relative.endsWith("/index.html")) return `/${relative.slice(0, -"index.html".length)}`;
  return `/${relative}`;
}

function normalizeInternalHref(href) {
  if (!href) return null;
  let url;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.origin !== baseUrl.origin) return null;
  url.hash = "";
  return url.toString();
}

async function checkInternalUrl(rawUrl) {
  let current = new URL(rawUrl);
  const chain = [];
  for (let hop = 0; hop < 6; hop += 1) {
    let response;
    try {
      response = await fetch(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (response.status === 405) {
        response = await fetch(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      }
    } catch (error) {
      return { ok: false, url: rawUrl, chain, error: error instanceof Error ? error.message : String(error) };
    }
    chain.push({ url: current.toString(), status: response.status, location: response.headers.get("location") });
    if (response.status >= 200 && response.status < 400 && ![301, 302, 303, 307, 308].includes(response.status)) {
      return { ok: true, url: rawUrl, chain };
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { ok: false, url: rawUrl, chain, error: `HTTP ${response.status}` };
    }
    const location = response.headers.get("location");
    if (!location) return { ok: false, url: rawUrl, chain, error: "redirect_missing_location" };
    const next = new URL(location, current);
    if (next.origin !== baseUrl.origin) return { ok: true, url: rawUrl, chain, external_redirect: next.toString() };
    current = next;
  }
  return { ok: false, url: rawUrl, chain, error: "redirect_hop_limit" };
}

async function mapLimit(values, limit, fn) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

const routes = (await collectHtmlFiles(publicRoot)).map(routeForFile).sort();
const browser = await chromium.launch({ headless: true });
const audits = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const resourceType = route.request().resourceType();
      if (url.protocol === "data:") await route.continue();
      else if (url.origin !== baseUrl.origin) await route.abort();
      else if (["image", "media", "font"].includes(resourceType)) await route.abort();
      else await route.continue();
    });
    let page = await context.newPage();
    const pageFailures = [];
    const links = new Map();
    let linkInstances = 0;

    for (const route of routes) {
      let response;
      try {
        response = await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (error) {
        pageFailures.push({ route, status: 0, error: error instanceof Error ? error.message : String(error) });
        await page.close().catch(() => {});
        page = await context.newPage();
        continue;
      }
      const status = response?.status() ?? 0;
      if (status < 200 || status >= 400) pageFailures.push({ route, status, error: "page_route_failed" });
      const pageLinks = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")));
      for (const href of pageLinks) {
        const normalized = normalizeInternalHref(href);
        if (!normalized) continue;
        linkInstances += 1;
        const sources = links.get(normalized) || [];
        if (sources.length < 8) sources.push(route);
        links.set(normalized, sources);
      }
    }

    const checks = await mapLimit([...links.keys()], 12, checkInternalUrl);
    const failures = checks.filter((check) => !check.ok);
    audits.push({
      viewport,
      page_count: routes.length,
      page_failures: pageFailures,
      link_instances: linkInstances,
      unique_internal_links: links.size,
      checked_links: checks.length,
      failures: failures.map((failure) => ({ ...failure, sources: links.get(failure.url) || [] })),
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const status = audits.every((audit) => audit.page_failures.length === 0 && audit.failures.length === 0) ? "PASS" : "FAIL";
const result = {
  schema: "glp-internal-link-audit-both-viewports-v1",
  status,
  base_url: baseUrl.toString(),
  generated_at: new Date().toISOString(),
  routes_checked: routes.length,
  audits,
  deploys: 0,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (status !== "PASS") process.exitCode = 1;
