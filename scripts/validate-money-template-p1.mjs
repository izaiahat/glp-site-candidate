import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RECEIPT = "/home/ubuntu/business/reports/glp-clinic-scout/operator-national-wow-20260723/money-template-p1-20260724/validation-receipt.json";
const PUBLIC = process.env.GCS_PUBLIC_ROOT ? path.resolve(process.env.GCS_PUBLIC_ROOT) : path.join(ROOT, "public");
const RECEIPT = process.argv[2] || DEFAULT_RECEIPT;
const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const count = (text, pattern) => [...text.matchAll(pattern)].length;
const visibleText = (html) => html
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

const [specs, sourceManifest, logoManifest, activation, registry] = await Promise.all([
  readJson("data/money-page-specs.json"),
  readJson("data/provider-logo-sources.json"),
  readJson("assets/provider-logos/manifest.json"),
  readJson("data/affiliate-activation-selection.json"),
  readJson("data/program-registry.json"),
]);

assert.equal(specs.template_revision, "money-page-p1-v2-wave0");
assert.equal(specs.pages.length, 13);
assert.deepEqual(specs.p1_components, ["provider_logos", "item_list_schema", "provider_review_pages", "inline_numbered_citations", "official_site_cta_qualifier", "verified_promo_field", "exit_intent_capture", "decision_matrix"]);
assert.ok(sourceManifest.programs.length >= 18);
const sourceLogoProgramIds = sourceManifest.programs.map((program) => program.program_id).sort();
const renderedLogoProgramIds = logoManifest.logos.map((logo) => logo.program_id).sort();
assert.equal(new Set(sourceLogoProgramIds).size, sourceLogoProgramIds.length);
assert.equal(logoManifest.status, "PASS");
assert.equal(logoManifest.count, sourceManifest.programs.length);
assert.deepEqual(renderedLogoProgramIds, sourceLogoProgramIds);
assert.equal(logoManifest.runtime_remote_assets, 0);
assert.equal(activation.programs.length, 13);
assert.equal(activation.programs.every((program) => program.link_mode === "transparent_direct" && /^[a-f0-9]{64}$/.test(program.tracking_link_sha256)), true);

const providers = new Set();
const PROFILE_ID = "glp-clinic-scout";
const canonicalByRenderId = new Map(registry.programs.map((program) => {
  const renderId = String(program.review_slug || program.program_id);
  const declaration = program.profiles?.[PROFILE_ID]?.canonical_identity;
  return [renderId, declaration?.role === "alias" ? String(declaration.canonical_program_id) : renderId];
}));
const canonicalRegistryById = new Map(registry.programs
  .filter((program) => program.profiles?.[PROFILE_ID]?.canonical_identity?.role !== "alias")
  .map((program) => [String(program.review_slug || program.program_id), program]));
const dynamicProviderIds = Object.keys(registry.provider_dynamic_profiles?.profiles || {}).sort();
assert.equal(dynamicProviderIds.length, 28);
const canonicalId = (programId) => canonicalByRenderId.get(programId) || programId;
let rowCount = 0;
for (const logo of logoManifest.logos) {
  const sourceBytes = await readFile(path.join(ROOT, "assets/provider-logos", logo.output_file));
  const publicBytes = await readFile(path.join(PUBLIC, logo.public_path.replace(/^\//, "")));
  assert.equal(sha256(sourceBytes), logo.output_sha256, `source_logo_hash:${logo.program_id}`);
  assert.equal(sha256(publicBytes), logo.output_sha256, `public_logo_hash:${logo.program_id}`);
  assert.equal(logo.runtime_remote_load, false);
  assert.match(logo.source_page_url, /^https:\/\//);
}

for (const page of specs.pages) {
  assert.equal(page.template_revision, "money-page-p1-v2-wave0");
  assert.ok(page.decision_matrix.length >= 3);
  assert.equal(page.content_upgrade.status, "STAGED_CAPTURE_SENDS_HELD");
  const htmlPath = path.join(PUBLIC, page.path.replace(/^\//, ""), "index.html");
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /data-release="live"/);
  assert.match(html, /data-link-dark="false"/);
  assert.match(html, /<meta\b(?=[^>]*name="robots")(?=[^>]*content="index,follow)/);
  assert.equal(/<a\b[^>]*href="\/go\//.test(html), false, `active_go_anchor:${page.page_id}`);
  assert.equal(/class="[^\"]*cta[^\"]*affiliate[^\"]*disabled/.test(html), false, `disabled_affiliate_cta:${page.page_id}`);
  assert.equal(/held until operator go-live|no live route|link-dark|noindex in staging|release-held|Addendum A|Batch 6 ledger|substantiation worksheet cell|supporting material matrix cell|held gates/i.test(visibleText(html)), false, `public_ops_jargon:${page.page_id}`);
  const tableHead = html.match(/<table\b[^>]*data-sortable[^>]*>[\s\S]*?<thead>([\s\S]*?)<\/thead>/)?.[1] || "";
  const tableHeaders = [...tableHead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => visibleText(match[1]).trim());
  assert.deepEqual(tableHeaders, [
    "Provider logo",
    "Provider",
    "Starting price",
    "Medications offered",
    "Insurance",
    "Average wait",
    "Evidence score",
    "Next steps",
  ], `eight_column_final_design:${page.page_id}`);
  const decisionPrograms = [...html.matchAll(/class="[^\"]*decision-matrix-row[^\"]*"[^>]*data-decision-program="([^\"]+)"/g)].map((match) => match[1]);
  const pagePrograms = new Set(page.rows.map((row) => row.program_id));
  assert.ok(decisionPrograms.length >= Math.min(2, page.rows.length), `decision_matrix_minimum:${page.page_id}`);
  assert.equal(new Set(decisionPrograms).size, decisionPrograms.length, `decision_matrix_unique:${page.page_id}`);
  assert.ok(decisionPrograms.every((programId) => pagePrograms.has(programId)), `decision_matrix_references:${page.page_id}`);
  assert.equal(count(html, /data-promo-status=/g), 0, `unverified_promo_fields_removed:${page.page_id}`);
  assert.match(html, /data-content-upgrade-form/);
  assert.match(html, /action="\/api\/content-upgrade"/);
  assert.match(html, /Done — your checklist is on its way to your inbox\./);
  assert.doesNotMatch(html, /Success — you are signed up|you(?:'|’)re subscribed/i, `capture_completion_copy:${page.page_id}`);
  assert.equal(/data-analytics-event="[^\"]+"[^>]*(email|phone|bmi|weight|diagnosis)=/i.test(html), false);
  assert.ok(count(html, /data-link-mode="transparent-direct"/g) >= page.rows.length, `transparent_direct_links:${page.page_id}`);
  assert.ok(count(html, /data-subid="[a-z0-9-]+-(?:intro|pros|pricing|conclusion)-\d{6}"/g) >= page.rows.length, `deterministic_subids:${page.page_id}`);
  assert.ok(count(html, /data-analytics-event="affiliate_click"/g) >= page.rows.length, `affiliate_analytics:${page.page_id}`);
  assert.ok(count(html, /class="inline-citation"/g) >= page.rows.length * 4, `inline_citations:${page.page_id}`);
  assert.ok(count(html, /class="provider-logo /g) >= page.rows.length * 2, `provider_logos:${page.page_id}`);
  assert.equal(count(html, /Read [^<]+ review/g) >= page.rows.length, true, `third_cta:${page.page_id}`);
  const ldScripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  assert.equal(ldScripts.length, 1);
  const graph = ldScripts[0]["@graph"];
  assert.equal(graph.some((node) => node["@type"] === "AggregateRating"), false);
  const itemList = graph.find((node) => node["@type"] === "ItemList");
  assert.ok(itemList, `item_list_missing:${page.page_id}`);
  const canonicalPageIds = [...new Set(page.rows.map((row) => canonicalId(row.program_id)))];
  assert.equal(itemList.numberOfItems, canonicalPageIds.length);
  assert.equal(itemList.itemListElement.length, canonicalPageIds.length);
  assert.deepEqual(itemList.itemListElement.map((item) => item.position), canonicalPageIds.map((_, index) => index + 1));
  for (const source of page.sources) {
    assert.match(source.source_id, /^source-[1-9][0-9]*$/);
    assert.match(html, new RegExp(`id="${source.source_id}"`));
  }
  for (const row of page.rows) {
    rowCount += 1;
    providers.add(canonicalId(row.program_id));
    assert.equal(row.review_path, `/reviews/${row.program_id}/`);
    if (row.logo) {
      assert.equal(row.logo.runtime_remote_load, false);
      assert.match(row.logo.sha256, /^[a-f0-9]{64}$/);
      assert.match(html, new RegExp(row.logo.path.replaceAll("/", "\\/")));
    }
    assert.equal(row.promo.status, "NOT_VERIFIED");
    assert.equal(row.promo.code, null);
    assert.equal(row.promo.source_url, null);
    const renderedProgramId = canonicalId(row.program_id);
    const renderedRow = page.rows.find((candidate) => candidate.program_id === renderedProgramId);
    assert.ok(renderedRow, `canonical_row_missing:${page.page_id}:${row.program_id}`);
    assert.match(html, new RegExp(`href="${`/reviews/${renderedProgramId}/`.replaceAll("/", "\\/")}"`));
    assert.match(html, new RegExp(`href="#${renderedRow.citation_source_id}"`));
  }
}

const expectedRowCount = specs.pages.reduce((total, page) => total + page.rows.length, 0);
assert.equal(rowCount, expectedRowCount);
assert.ok(rowCount >= providers.size);
assert.deepEqual([...providers].sort(), dynamicProviderIds);
for (const programId of providers) {
  const reviewHtml = await readFile(path.join(PUBLIC, "reviews", programId, "index.html"), "utf8");
  const registryProgram = canonicalRegistryById.get(programId);
  assert.ok(registryProgram, `canonical_registry_program_missing:${programId}`);
  const goEnabled = registryProgram.profiles?.[PROFILE_ID]?.surfaces?.go === true;
  assert.match(reviewHtml, /<meta\b(?=[^>]*name="robots")(?=[^>]*content="index,follow)/);
  assert.match(reviewHtml, /source-cited/i);
  assert.match(reviewHtml, /class="[^"]*\bcitation\b[^"]*"/);
  assert.match(reviewHtml, /id="source-1"/);
  assert.equal(/<a\b[^>]*href="\/go\//.test(reviewHtml), false);
  assert.equal(reviewHtml.includes("AggregateRating"), false);
  if (reviewHtml.includes("data-release=")) {
    assert.match(reviewHtml, /data-release="release-ready"/);
    assert.match(reviewHtml, new RegExp(`data-link-dark="${goEnabled ? "false" : "true"}"`));
    assert.match(reviewHtml, /Source-cited editorial review/);
    if (goEnabled) {
      assert.match(reviewHtml, /data-link-mode="transparent-direct"/);
      assert.match(reviewHtml, /<a\b(?=[^>]*class="[^"]*\bcta\b)(?=[^>]*class="[^"]*\bprimary\b)(?=[^>]*class="[^"]*\baffiliate\b)/);
    } else {
      assert.equal(reviewHtml.includes("data-link-mode=\"transparent-direct\""), false, `held_review_direct_link:${programId}`);
      assert.equal(/<a\b(?=[^>]*class="[^"]*\bcta\b)(?=[^>]*class="[^"]*\bprimary\b)(?=[^>]*class="[^"]*\baffiliate\b)/.test(reviewHtml), false, `held_review_affiliate_cta:${programId}`);
    }
    assert.equal(/held until operator go-live|no live route|noindex in staging|release-held|Addendum A/i.test(visibleText(reviewHtml)), false);
    assert.match(reviewHtml, /class="review-logo /);
  }
}

const captureSource = await readFile(path.join(ROOT, "src/content-upgrade.mjs"), "utf8");
assert.match(captureSource, /CONTENT_UPGRADE_CAPTURE_HELD/);
assert.match(captureSource, /emailSends: "resend_env_gated"/);
assert.match(captureSource, /emailSendsAuthorizedByDefault: false/);
assert.match(captureSource, /emailConsentRequired: true/);
assert.match(captureSource, /emailSendGate: "RESEND_ENABLED"/);
assert.match(captureSource, /providerSharing: false/);
assert.match(captureSource, /forbiddenFields: \["phone", "state", "bmi", "weight", "current_medications", "diagnosis", "medical_history", "quiz_answers"\]/);

const result = { status: "PASS", revision: specs.template_revision, money_pages: specs.pages.length, provider_reviews: providers.size, row_instances: rowCount, p1_components: specs.p1_components.length, logo_assets: logoManifest.count, runtime_remote_logo_assets: logoManifest.runtime_remote_assets, transparent_direct_programs: activation.programs.length, active_go_anchors: 0, capture_runtime: "CAPTURE_PLUS_TRANSACTIONAL_EMAIL_ENV_GATED", email_sends_authorized_by_default: false, email_send_gate: "RESEND_ENABLED", provider_sharing_authorized: false };
await mkdir(path.dirname(RECEIPT), { recursive: true });
await writeFile(RECEIPT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
