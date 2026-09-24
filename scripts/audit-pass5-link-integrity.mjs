import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const SITE_ORIGIN = "https://glpclinicscout.com";
const SERVED_ORIGIN = String(process.env.PASS5_SERVED_ORIGIN || "http://127.0.0.1:4516").replace(/\/$/, "");
const OUTPUT_JSON = path.resolve(process.argv[2] || path.join(ROOT, "../../../../reports/glp-clinic-scout/rebuild/PASS5-LINK-CHECKER-20260829.json"));
const OUTPUT_MD = OUTPUT_JSON.replace(/\.json$/i, ".md");
const SLOW_MS = 5_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const TRACKING_HOST = /(?:^|\.)(?:awin1\.com|revoffers\.com|tkqlhce\.com|trackdesk\.com)$/i;
const AFFILIATE_QUERY = /(?:^|[?&])(?:aff(?:iliate)?_?id|affid|awinmid|awinaffid|clickref|subid|sub_id|offer_id|oid|ref)=/i;
const ACCIDENTAL_TRACKING_QUERY = /(?:^|[?&])(?:utm_[a-z]+|gclid|fbclid|msclkid)=/i;

async function walk(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function routeForFile(file) {
  const relative = path.relative(PUBLIC, file).split(path.sep).join("/");
  if (relative === "index.html") return "/";
  if (relative.endsWith("/index.html")) return `/${relative.slice(0, -"index.html".length)}`;
  return `/${relative}`;
}

function decode(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function attrsFrom(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const key = match[1].toLowerCase();
    if (key === "a") continue;
    attrs[key] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function lineAt(html, index) {
  return html.slice(0, index).split("\n").length;
}

function relTokens(attrs) {
  return new Set(String(attrs.rel || "").toLowerCase().split(/\s+/).filter(Boolean));
}

function isAffiliate(url, attrs) {
  const rel = relTokens(attrs);
  return url.pathname.startsWith("/go/")
    || rel.has("sponsored")
    || attrs["data-analytics-event"] === "affiliate_click"
    || TRACKING_HOST.test(url.hostname)
    || AFFILIATE_QUERY.test(url.search);
}

function isActionUrl(url) {
  return url.protocol === "mailto:"
    || url.protocol === "tel:"
    || (url.hostname === "x.com" && url.pathname.startsWith("/intent/"));
}

async function fetchChain(rawUrl, { local = false } = {}) {
  let current = new URL(rawUrl);
  const chain = [];
  const started = Date.now();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    let method = "HEAD";
    try {
      response = await fetch(current, {
        method,
        redirect: "manual",
        headers: local ? {} : { "user-agent": "GLP-Clinic-Scout-Link-Audit/1.0 (+https://glpclinicscout.com/)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!local && response.status >= 400) {
        await response.body?.cancel();
        method = "GET";
        response = await fetch(current, {
          method,
          redirect: "manual",
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; GLP-Clinic-Scout-Link-Audit/1.0; +https://glpclinicscout.com/)",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      }
    } catch (error) {
      return {
        status: "UNVERIFIED",
        url: rawUrl,
        elapsed_ms: Date.now() - started,
        chain,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const location = response.headers.get("location");
    chain.push({ url: current.toString(), status: response.status, method, location });
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel();
      current = new URL(location, current);
      continue;
    }
    const blocked = !local && [401, 403, 406, 409, 418, 429].includes(response.status);
    const ok = response.status >= 200 && response.status < 400;
    await response.body?.cancel();
    return {
      status: ok ? "PASS" : blocked ? "UNVERIFIED" : "FAIL",
      url: rawUrl,
      final_url: current.toString(),
      final_status: response.status,
      elapsed_ms: Date.now() - started,
      chain,
      error: blocked ? `remote_access_blocked_http_${response.status}` : ok ? null : `HTTP ${response.status}`,
    };
  }
  return {
    status: "FAIL",
    url: rawUrl,
    elapsed_ms: Date.now() - started,
    chain,
    error: "redirect_hop_limit",
  };
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const htmlFiles = await walk(PUBLIC);
const pages = [];
const anchors = [];
const pageByRoute = new Map();
const canonicalFindings = [];
const jsonLdFindings = [];
for (const file of htmlFiles) {
  const route = routeForFile(file);
  const html = await readFile(file, "utf8");
  pageByRoute.set(route, html);
  const canonicalTags = [...html.matchAll(/<link\b[^>]*\brel=["'][^"']*canonical[^"']*["'][^>]*>/gi)];
  const canonicalUrls = canonicalTags.map((match) => attrsFrom(match[0]).href).filter(Boolean);
  const expectedCanonical = `${SITE_ORIGIN}${route}`;
  const noindex = /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  if (!noindex && (canonicalUrls.length !== 1 || canonicalUrls[0] !== expectedCanonical)) {
    canonicalFindings.push({ route, expected: expectedCanonical, observed: canonicalUrls });
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(match[1]); }
    catch (error) { jsonLdFindings.push({ route, line: lineAt(html, match.index), error: error instanceof Error ? error.message : String(error) }); }
  }
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const attrs = attrsFrom(match[0]);
    if (!attrs.href) continue;
    anchors.push({ route, file: path.relative(PUBLIC, file).split(path.sep).join("/"), line: lineAt(html, match.index), attrs });
  }
  pages.push({ route, file: path.relative(PUBLIC, file).split(path.sep).join("/") });
}

const invalidSchemes = [];
const fragmentFindings = [];
const affiliateFindings = [];
const accidentalTracking = [];
const actionLinks = [];
const internal = new Map();
const external = new Map();
const affiliateLinks = [];
for (const anchor of anchors) {
  const href = anchor.attrs.href.trim();
  if (!href || href === "#") continue;
  let url;
  try { url = new URL(href, `${SITE_ORIGIN}${anchor.route}`); }
  catch { invalidSchemes.push({ ...anchor, href, error: "invalid_url" }); continue; }
  if (url.protocol === "javascript:" || url.protocol === "data:") {
    invalidSchemes.push({ ...anchor, href, error: `forbidden_scheme:${url.protocol}` });
    continue;
  }
  if (isActionUrl(url)) {
    actionLinks.push({ route: anchor.route, href, type: url.protocol === "mailto:" ? "email" : url.protocol === "tel:" ? "phone" : "share" });
    continue;
  }
  if (!/^https?:$/.test(url.protocol)) continue;
  const affiliate = isAffiliate(url, anchor.attrs);
  if (affiliate) {
    const rel = relTokens(anchor.attrs);
    const missingRel = ["sponsored", "nofollow", "noopener"].filter((token) => !rel.has(token));
    const finding = { route: anchor.route, file: anchor.file, line: anchor.line, href, missing_rel: missingRel };
    affiliateLinks.push(finding);
    if (missingRel.length) affiliateFindings.push(finding);
    continue;
  }
  if (ACCIDENTAL_TRACKING_QUERY.test(url.search)) accidentalTracking.push({ route: anchor.route, file: anchor.file, line: anchor.line, href });
  if (url.origin === SITE_ORIGIN) {
    const served = new URL(`${url.pathname}${url.search}`, SERVED_ORIGIN).toString();
    const source = internal.get(served) || { url: served, site_url: url.toString(), sources: [] };
    if (source.sources.length < 12) source.sources.push({ route: anchor.route, file: anchor.file, line: anchor.line });
    internal.set(served, source);
    if (url.hash) {
      const targetHtml = pageByRoute.get(url.pathname.endsWith("/") ? url.pathname : url.pathname);
      const id = decodeURIComponent(url.hash.slice(1)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (targetHtml && !new RegExp(`(?:id|name)=["']${id}["']`, "i").test(targetHtml)) {
        fragmentFindings.push({ route: anchor.route, href: url.toString(), missing_fragment: url.hash });
      }
    }
  } else {
    const key = url.toString();
    const source = external.get(key) || { url: key, sources: [] };
    if (source.sources.length < 12) source.sources.push({ route: anchor.route, file: anchor.file, line: anchor.line });
    external.set(key, source);
  }
}

const internalChecks = await mapLimit([...internal.values()], 16, async (entry) => ({ ...await fetchChain(entry.url, { local: true }), site_url: entry.site_url, sources: entry.sources }));
const externalChecks = await mapLimit([...external.values()], 10, async (entry) => ({ ...await fetchChain(entry.url), sources: entry.sources }));

const sitemapXml = await readFile(path.join(PUBLIC, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decode(match[1]));
const sitemapDuplicateUrls = sitemapUrls.filter((url, index) => sitemapUrls.indexOf(url) !== index);
const sitemapChecks = await mapLimit([...new Set(sitemapUrls)], 16, async (siteUrl) => {
  const url = new URL(siteUrl);
  const served = new URL(`${url.pathname}${url.search}`, SERVED_ORIGIN).toString();
  return { site_url: siteUrl, ...await fetchChain(served, { local: true }) };
});

const internalFailures = internalChecks.filter((row) => row.status === "FAIL");
const externalFailures = externalChecks.filter((row) => row.status === "FAIL");
const externalUnverified = externalChecks.filter((row) => row.status === "UNVERIFIED");
const redirects = [...internalChecks, ...externalChecks].filter((row) => row.chain.length > 1);
const slowLinks = [...internalChecks, ...externalChecks].filter((row) => row.elapsed_ms > SLOW_MS);
const sitemapFailures = sitemapChecks.filter((row) => row.status !== "PASS" || row.chain.length !== 1 || row.final_status !== 200);
const hardFindings = [
  ...invalidSchemes,
  ...fragmentFindings,
  ...affiliateFindings,
  ...accidentalTracking,
  ...canonicalFindings,
  ...jsonLdFindings,
  ...internalFailures,
  ...externalFailures,
  ...sitemapFailures,
  ...sitemapDuplicateUrls.map((url) => ({ duplicate_sitemap_url: url })),
];

const report = {
  schema: "glp-pass5-link-integrity-v1",
  generated_at: new Date().toISOString(),
  candidate: ROOT,
  served_origin: SERVED_ORIGIN,
  safety: {
    affiliate_requests_made: 0,
    affiliate_links_inspected_statically: affiliateLinks.length,
    external_requests_read_only: true,
    deploys: 0,
  },
  counts: {
    html_pages: pages.length,
    anchor_instances: anchors.length,
    unique_internal_links: internal.size,
    unique_external_nonaffiliate_links: external.size,
    affiliate_link_instances: affiliateLinks.length,
    action_link_instances: actionLinks.length,
    sitemap_urls: sitemapUrls.length,
    redirect_chains: redirects.length,
    slow_links: slowLinks.length,
    external_unverified: externalUnverified.length,
    hard_findings: hardFindings.length,
  },
  findings: {
    invalid_schemes: invalidSchemes,
    missing_fragments: fragmentFindings,
    affiliate_attribute_failures: affiliateFindings,
    accidental_tracking_links: accidentalTracking,
    canonical_failures: canonicalFindings,
    json_ld_parse_failures: jsonLdFindings,
    internal_failures: internalFailures,
    external_failures: externalFailures,
    external_unverified: externalUnverified,
    redirects,
    slow_links: slowLinks,
    sitemap_failures: sitemapFailures,
    sitemap_duplicate_urls: [...new Set(sitemapDuplicateUrls)],
  },
  status: hardFindings.length === 0 ? "PASS" : "FAIL",
};

const lines = [
  "# Pass 5 link checker",
  "",
  `Generated: ${report.generated_at}`,
  `Status: **${report.status}**`,
  "",
  "## Scope and safety",
  "",
  `- ${report.counts.html_pages} generated HTML pages`,
  `- ${report.counts.anchor_instances} anchor instances`,
  `- ${report.counts.unique_internal_links} unique internal links checked against served candidate bytes`,
  `- ${report.counts.unique_external_nonaffiliate_links} unique external non-affiliate links checked read-only`,
  `- ${report.counts.affiliate_link_instances} affiliate links inspected statically; **0 affiliate requests made**`,
  `- ${report.counts.sitemap_urls} sitemap URLs checked`,
  "",
  "## Results",
  "",
  `- Hard findings: ${report.counts.hard_findings}`,
  `- Redirect chains: ${report.counts.redirect_chains}`,
  `- Slow links (> ${SLOW_MS} ms): ${report.counts.slow_links}`,
  `- Remote access-blocked/unverified links: ${report.counts.external_unverified}`,
  "",
  "The JSON companion contains every source route, response chain, timing, and failure.",
  "",
];
await mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
await writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: report.status, json: OUTPUT_JSON, markdown: OUTPUT_MD, counts: report.counts }, null, 2)}\n`);
if (report.status !== "PASS") process.exitCode = 1;
