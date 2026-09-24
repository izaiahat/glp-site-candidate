import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMysteryShopArtifacts,
  loadEvidenceInputs,
  evidenceLedgerAuthority,
  ROUTE,
  validateMysteryShop,
  validateRenderedSurface,
} from "../src/mystery-shop.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");
const OPS = path.join(ROOT, "artifacts", "ops");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function htmlFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.name.endsWith(".html")) files.push(absolute);
    }
  }
  await walk(root);
  return files;
}

const { config, ledgerBytes, ledger } = loadEvidenceInputs(ROOT);
assert.equal(sha256(ledgerBytes), evidenceLedgerAuthority(ledger).file_sha256, "authoritative capture ledger bytes drifted");
const validation = validateMysteryShop(config, ledger, { ledgerFileSha256: sha256(ledgerBytes) });
const expected = buildMysteryShopArtifacts(config, ledger);
const routeFile = path.join(PUBLIC, ROUTE.replace(/^\//, ""), "index.html");
const actualHtml = await readFile(routeFile, "utf8");
assert.equal(actualHtml, expected.html, "clean-room route differs from validated renderer output");
const surface = validateRenderedSurface(actualHtml);
const actualManifest = JSON.parse(await readFile(path.join(OPS, "wave4-mystery-shop-manifest.json"), "utf8"));
assert.deepEqual(actualManifest, expected.manifest, "Wave 4 manifest is not derived from current evidence and rendered bytes");
const sitemap = await readFile(path.join(PUBLIC, "sitemap.xml"), "utf8");
assert.ok(!sitemap.includes(ROUTE), "link-dark route entered sitemap");
for (const file of await htmlFiles(PUBLIC)) {
  if (file === routeFile) continue;
  const html = await readFile(file, "utf8");
  assert.ok(!new RegExp(`<a\\b[^>]*href=["']${ROUTE.replaceAll("/", "\\/")}`, "i").test(html), `inbound public link found in ${path.relative(PUBLIC, file)}`);
}
const headers = await readFile(path.join(PUBLIC, "_headers"), "utf8");
assert.match(headers, /\/research\/public-funnel-evidence\/\*\n  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet\n  Cache-Control: no-store/);
console.log(JSON.stringify({
  status: "PASS_WAVE4_CLEAN_ROOM_VALIDATION",
  observations: validation.observations,
  accepted_firecrawl_captures: validation.accepted_firecrawl_captures,
  ledger_file_sha256: sha256(ledgerBytes),
  rendered_html_sha256: actualManifest.rendered_html_sha256,
  link_dark: true,
  surface,
  provider_calls: 0,
  analytics_calls: 0,
  external_effects: actualManifest.effects,
}));
