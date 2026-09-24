#!/usr/bin/env node
// BUILD GATE — every approved-provider link is monetized, or explicitly marked
// with a reason. Nothing in between ships.
//
// Operator directive 2026-08-19 (verbatim): "make sure that we wire ANY link to
// ANY approved provider on our site with a valid affiliate link so that we make
// sure anytime anyone clicks a link for a provider on our site, regardless of
// where it is, we get paid if they sign up. this should have been the standard
// from the start."
//
// The gate reads the BUILT TREE, not the templates, because the site injects
// tables and surfaces after templates render (`scripts/wave2-repairs.mjs`).
// Whatever a reader can actually click is what gets judged.
//
// Findings, by class:
//   unmarked_bare_approved_provider_link — an approved provider's domain,
//       linked with neither attribution nor a recorded citation reason. This is
//       the class the directive exists to kill.
//   affiliate_link_missing_sponsored_rel — attribution present, disclosure
//       missing. Untagged affiliate links are a Google manual-action risk
//       (TreatmentMD's mistake); we do not repeat it.
//   partner_portal_link_public — a link into OUR authenticated network account.
//       Dead for the reader, and it publishes our publisher id.
//   citation_reason_unknown — a marker with a reason outside the allowlist.
//
// Usage:
//   node scripts/validate-approved-provider-link-monetization.mjs [--tree DIR]
//        [--json OUT] [--allow-failures]   (last one: fixture/report mode)

import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITATION_REASONS, EQUIVALENT_CITATION_MARKERS, NON_PUBLIC_SOURCE_HOSTS, isCitationReason } from "../src/citation-attribution.mjs";
import { TRACKING_HOSTS, loadApprovedProviderDomainMap, lookupProviderDomain } from "../src/approved-provider-domains.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ANCHOR = /<a\b([^>]*)>/gi;
const HREF = /\bhref\s*=\s*"([^"]*)"/i;
const REL = /\brel\s*=\s*"([^"]*)"/i;
const DATA_CITATION = /\bdata-citation\s*=\s*"([^"]*)"/i;

function walkHtml(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, acc);
    else if (entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function decodeHref(raw) {
  return String(raw || "").replaceAll("&amp;", "&").trim();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function auditTree(treeDir, options = {}) {
  const { domains, programs } = options.map || loadApprovedProviderDomainMap();
  const monetizedHrefs = new Map();
  for (const [slug, program] of programs) {
    for (const href of program.monetized_hrefs) monetizedHrefs.set(decodeHref(href), slug);
  }

  const files = statSync(treeDir).isDirectory() ? walkHtml(treeDir) : [treeDir];
  const findings = [];
  const ledger = {
    monetized: [],
    marked_citation: [],
  };
  const counts = { anchors_scanned: 0, provider_anchors: 0, monetized: 0, marked_citation: 0 };

  for (const file of files) {
    const relative = path.relative(treeDir, file) || path.basename(file);
    const html = readFileSync(file, "utf8");
    ANCHOR.lastIndex = 0;
    let match;
    while ((match = ANCHOR.exec(html))) {
      const attrs = match[1] || "";
      const rawHref = attrs.match(HREF)?.[1];
      if (!rawHref) continue;
      counts.anchors_scanned += 1;
      const href = decodeHref(rawHref);
      const rel = (attrs.match(REL)?.[1] || "").toLowerCase();
      const citationReason = attrs.match(DATA_CITATION)?.[1]
        || Object.entries(EQUIVALENT_CITATION_MARKERS).find(([marker]) => new RegExp(`\\b${marker}\\b`).test(attrs))?.[1]
        || null;
      const at = { file: relative, href, rel: rel || null };

      if (citationReason && !isCitationReason(citationReason)) {
        findings.push({ class: "citation_reason_unknown", reason: citationReason, ...at });
        continue;
      }

      // Internal /go/ commercial redirects are our attribution too.
      if (href.startsWith("/go/")) {
        if (!rel.includes("sponsored")) findings.push({ class: "affiliate_link_missing_sponsored_rel", target: "internal_go_route", ...at });
        else { counts.monetized += 1; ledger.monetized.push({ ...at, form: "go_route" }); }
        continue;
      }

      if (!/^https?:\/\//i.test(href)) continue;
      const host = hostOf(href);
      if (!host) continue;

      if (NON_PUBLIC_SOURCE_HOSTS.has(host)) {
        findings.push({ class: "partner_portal_link_public", host, ...at });
        continue;
      }

      const isNetworkTracking = TRACKING_HOSTS.has(host);
      const monetizedProgram = monetizedHrefs.get(href) || null;
      if (isNetworkTracking || monetizedProgram) {
        counts.provider_anchors += 1;
        if (!rel.includes("sponsored")) {
          findings.push({ class: "affiliate_link_missing_sponsored_rel", program_id: monetizedProgram, host, ...at });
          continue;
        }
        counts.monetized += 1;
        ledger.monetized.push({ ...at, program_id: monetizedProgram, form: isNetworkTracking ? "network_tracking" : "transparent_direct" });
        continue;
      }

      const provider = lookupProviderDomain(domains, host);
      if (!provider) continue;
      counts.provider_anchors += 1;

      if (citationReason) {
        counts.marked_citation += 1;
        ledger.marked_citation.push({ ...at, program_ids: provider.program_ids, reason: citationReason });
        continue;
      }

      const suppressed = provider.program_ids
        .map((slug) => programs.get(slug))
        .filter(Boolean)
        .find((program) => program.suppression);
      findings.push({
        class: "unmarked_bare_approved_provider_link",
        host,
        program_ids: provider.program_ids,
        matched_via: provider.matched_via || "exact_host",
        monetized_form_available: provider.program_ids.some((slug) => programs.get(slug)?.monetized),
        suppression_reason: suppressed?.suppression?.surface_restriction_basis || null,
        ...at,
      });
    }
  }

  findings.sort((left, right) => (left.file + left.href).localeCompare(right.file + right.href));
  return {
    schema: "glp-approved-provider-link-monetization-v1",
    tree: treeDir,
    files_scanned: files.length,
    approved_provider_domain_count: domains.size,
    approved_program_count: programs.size,
    counts,
    findings,
    ledger,
    status: findings.length === 0 ? "PASS" : "FAIL",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  // Paths resolve against the invoking working directory, so the deploy sensor
  // can point the same validator at any release root it is about to ship.
  const treeDir = path.resolve(process.cwd(), arg("--tree", "public"));
  const report = auditTree(treeDir);
  const jsonOut = arg("--json", null);
  if (jsonOut) {
    const out = path.resolve(process.cwd(), jsonOut);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  }

  const summary = `approved-provider link monetization: ${report.counts.provider_anchors} provider anchors across ${report.files_scanned} pages · ${report.counts.monetized} monetized · ${report.counts.marked_citation} marked citations · ${report.findings.length} findings`;
  if (report.status === "PASS") {
    console.log(`PASS — ${summary}`);
    return;
  }
  console.error(`FAIL — ${summary}`);
  const byClass = new Map();
  for (const finding of report.findings) byClass.set(finding.class, (byClass.get(finding.class) || 0) + 1);
  for (const [name, count] of byClass) console.error(`  ${name}: ${count}`);
  for (const finding of report.findings.slice(0, 25)) console.error(`    ${finding.class} · ${finding.file} · ${finding.href}`);
  if (report.findings.length > 25) console.error(`    …${report.findings.length - 25} more`);
  if (!argv.includes("--allow-failures")) process.exitCode = 1;
}

// Symlinked release roots (the deploy sensor stages one) make argv[1] and
// import.meta.url disagree unless both are resolved through the filesystem.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  const real = (target) => { try { return realpathSync(target); } catch { return path.resolve(target); } };
  return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
}

if (invokedDirectly()) main();

export { CITATION_REASONS };
