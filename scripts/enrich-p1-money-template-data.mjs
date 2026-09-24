import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONEY = path.join(ROOT, "data", "money-page-specs.json");
const LOGOS = path.join(ROOT, "assets", "provider-logos", "manifest.json");
const REVISION = "money-page-p1-v1";

function exactSourceId(page, url) {
  const index = page.sources.findIndex((source) => source.url === url);
  if (index < 0) throw new Error(`provider_source_missing:${page.page_id}:${url}`);
  return `source-${index + 1}`;
}

function decisionMatrix(page) {
  return page.best_for.map((item) => ({
    want: item.intent_label,
    program_id: item.program_id,
    provider: item.provider,
    reason: item.one_line,
  }));
}

function contentUpgrade(page) {
  return {
    lead_magnet_key: `${page.page_slug}-terms-checklist`,
    title: "Get the 7-point provider terms checklist",
    description: `A one-page source-check list for ${page.h1.toLowerCase()}, including total cost, commitment, eligibility, shipping, support, cancellation, and evidence-date prompts.`,
    capture_endpoint: "/api/content-upgrade",
    consent_version: "glp-content-upgrade-v1-20260724",
    status: "STAGED_CAPTURE_SENDS_HELD",
  };
}

async function main() {
  const [money, logoManifest] = await Promise.all([
    readFile(MONEY, "utf8").then(JSON.parse),
    readFile(LOGOS, "utf8").then(JSON.parse),
  ]);
  if (logoManifest.status !== "PASS" || logoManifest.count !== 18 || logoManifest.runtime_remote_assets !== 0) throw new Error("logo_manifest_invalid");
  const logos = new Map(logoManifest.logos.map((logo) => [logo.program_id, logo]));
  const ids = new Set();
  for (const page of money.pages) {
    if (!Array.isArray(page.sources) || !page.sources.length) throw new Error(`page_sources_missing:${page.page_id}`);
    page.template_revision = REVISION;
    page.date_modified = "2026-07-24";
    page.sources = page.sources.map((source, index) => ({ ...source, source_id: `source-${index + 1}` }));
    page.decision_matrix = decisionMatrix(page);
    page.content_upgrade = contentUpgrade(page);
    page.rows = page.rows.map((row) => {
      ids.add(row.program_id);
      const logo = logos.get(row.program_id);
      if (!logo) throw new Error(`logo_missing:${row.program_id}`);
      return {
        ...row,
        review_path: `/reviews/${row.program_id}/`,
        citation_source_id: exactSourceId(page, row.source_url),
        logo: {
          path: logo.public_path,
          alt: `${row.provider} logo`,
          width: logo.width,
          height: logo.height,
          media_type: logo.media_type,
          surface: logo.surface,
          source_page_url: logo.source_page_url,
          source_asset_url: logo.source_asset_url,
          verified_as_of: logo.verified_as_of,
          sha256: logo.output_sha256,
          runtime_remote_load: false,
        },
        promo: {
          status: "NOT_VERIFIED",
          label: "No verified promo code",
          code: null,
          source_url: null,
          verified_as_of: page.source_checked_through || page.date_modified,
        },
      };
    });
  }
  if (money.pages.length !== 13 || ids.size !== 13) throw new Error("p1_page_or_provider_count_invalid");
  money.template_revision = REVISION;
  money.p1_components = [
    "provider_logos",
    "item_list_schema",
    "provider_review_pages",
    "inline_numbered_citations",
    "official_site_cta_qualifier",
    "verified_promo_field",
    "exit_intent_capture",
    "decision_matrix",
  ];
  money.logo_manifest_sha256 = logoManifest.source_manifest_sha256;
  await writeFile(MONEY, `${JSON.stringify(money, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", revision: REVISION, pages: money.pages.length, providers: ids.size }));
}

await main();
