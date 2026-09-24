// SPEC-EDITORIAL-MONETIZATION-20260819 §4.4 — the tests that ship WITH the flip.
//
// The gate that held these pages dark was a two-sided `=== false / === null`
// assertion. Removing it without replacing it with something stricter would have
// been the exact "weaken a validator to make something pass" move this codebase
// forbids. These are the replacement: the v2 shape is receipt-bound, the surface
// authority is enforced per-program, and the evidence layer is proven unchanged.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EDITORIAL_MONETIZATION_GATE_RECEIPT_SHA256,
  renderGuideOfferModule,
  resolveBlogComparisonSpec,
  reviewBrief,
} from "../src/blog-system.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(readFileSync(path.join(ROOT, relative), "utf8"));

function publicHtmlFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...publicHtmlFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(full);
  }
  return files;
}

const ledger = readJson("data/program-content-ledger.json");
const registry = readJson("data/program-registry.json");
const batch = readJson("data/blog/content-batch.json");
const guideOf = (canonicalPath) => batch.articles.find((article) => article.canonical_path === canonicalPath);

const RULED_YES = [
  "/guides/gala-vs-shed/",
  "/guides/trimi-vs-yourera/",
  "/guides/found-vs-trimi-insurance-self-pay/",
  "/guides/glp-1-insurance-support-vs-coverage/",
  "/guides/glp-1-subscription-cancellation-terms/",
  "/guides/glp-1-hsa-fsa-reimbursement-evidence/",
];
const RULED_NO = ["/guides/online-glp-1-intake-to-pharmacy-fulfillment/"];

// The release carries the receipt its own gate is bound to. Reaching outside the
// tree for it would not survive sealing, and a gate whose evidence lives somewhere
// else is a gate you cannot audit from the artifact you actually shipped.
test("the gate receipt in code is the sha256 of the operator acceptance receipt shipped in this release", () => {
  const receiptPath = path.join(ROOT, "data/operator-gate-receipts/2026-08-19-editorial-monetization-ruling-acceptance.json");
  const bytes = readFileSync(receiptPath);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), EDITORIAL_MONETIZATION_GATE_RECEIPT_SHA256);
  const receipt = JSON.parse(bytes.toString("utf8"));
  assert.equal(receipt.schema, "glp.operator_gate_receipt.v1");
  assert.equal(receipt.kind, "editorial_monetization_ruling_acceptance");
  assert.match(receipt.decision, /^ACCEPTED/);
});

test("v1 held comparison specs still resolve link-dark — the machine can mint un-ruled guides", () => {
  const brief = {
    comparison_required: true,
    canonical_path: "/guides/example-v1/",
    comparison_spec: {
      schema: "blog-comparison-spec-v1",
      live_link_allowed: false,
      operator_gate_receipt: null,
      page_slug: "example-v1",
      row_program_ids: ["found-health", "trimi-glp-1", "yourera-program", "gala-health"],
    },
  };
  const spec = resolveBlogComparisonSpec(brief, ledger.programs);
  assert.equal(spec.rows.length, 4);
  for (const row of spec.rows) {
    assert.equal(row.live_link_allowed, false);
    assert.equal(row.promotion_authorized, false);
    assert.equal(row.affiliate_link_mode, "held_blog_comparison");
    assert.equal(row.affiliate_href, undefined);
  }
});

test("a v2 spec carrying the WRONG operator receipt is rejected, not downgraded", () => {
  const brief = {
    comparison_required: true,
    canonical_path: "/guides/example-v2/",
    comparison_spec: {
      schema: "blog-comparison-spec-v2",
      live_link_allowed: true,
      operator_gate_receipt: "0".repeat(64),
      page_slug: "example-v2",
      source_checked_through: "2026-07-23",
      row_program_ids: ["found-health", "trimi-glp-1", "yourera-program", "gala-health"],
    },
  };
  assert.throws(() => resolveBlogComparisonSpec(brief, ledger.programs), /blog_comparison_spec_gate_invalid/);
});

test("a v2 spec with no source_checked_through is rejected (the subid month contract)", () => {
  const brief = {
    comparison_required: true,
    canonical_path: "/guides/example-v2b/",
    comparison_spec: {
      schema: "blog-comparison-spec-v2",
      live_link_allowed: true,
      operator_gate_receipt: EDITORIAL_MONETIZATION_GATE_RECEIPT_SHA256,
      page_slug: "example-v2b",
      row_program_ids: ["found-health", "trimi-glp-1", "yourera-program", "gala-health"],
    },
  };
  assert.throws(() => resolveBlogComparisonSpec(brief, ledger.programs), /blog_comparison_spec_gate_invalid/);
});

test("the four ruled comparison guides resolve live rows through the guides link map", () => {
  for (const canonical of RULED_YES.slice(0, 4)) {
    const brief = guideOf(canonical);
    const spec = resolveBlogComparisonSpec(brief, ledger.programs);
    const live = spec.rows.filter((row) => row.live_link_allowed && row.affiliate_href);
    assert.ok(live.length >= 3, `${canonical}: expected >=3 live rows, got ${live.length}`);
    for (const row of live) {
      assert.match(row.affiliate_href, /^https:\/\/(?:track\.revoffers\.com|www\.awin1\.com)\//);
      assert.equal(row.affiliate_link_mode, "transparent_direct");
    }
  }
});

test("shedrx and serena-health stay internal-fallback on guides until the §4.5 re-mint", () => {
  for (const canonical of RULED_YES.slice(0, 4)) {
    const spec = resolveBlogComparisonSpec(guideOf(canonical), ledger.programs);
    for (const row of spec.rows) {
      if (!["shedrx", "serena-health"].includes(row.program_id)) continue;
      assert.equal(row.live_link_allowed, false, `${canonical}: ${row.program_id} lit before its surface authority exists`);
      assert.equal(row.affiliate_href, undefined);
    }
  }
});

test("only the §2 CAN-column programs carry the guides surface", () => {
  const can = new Set(["found-health", "gala-health", "healthrx", "trimi-glp-1", "try-ageless", "yourera-program"]);
  for (const program of registry.programs) {
    const surfaces = program.profiles?.["glp-clinic-scout"]?.surfaces || {};
    if (can.has(program.program_id)) assert.equal(surfaces.guides, true, `${program.program_id} should carry guides`);
    else assert.notEqual(surfaces.guides, true, `${program.program_id} must NOT carry guides`);
  }
});

test("the offer module refuses a row with no captured wording — the §3.6 boundary is mechanical", () => {
  const spec = {
    schema: "blog-comparison-spec-v2",
    live_link_allowed: true,
    operator_gate_receipt: EDITORIAL_MONETIZATION_GATE_RECEIPT_SHA256,
    page_slug: "boundary-probe",
    source_checked_through: "2026-07-23",
    date_modified: "2026-07-23",
    path: "/guides/boundary-probe/",
  };
  assert.throws(
    () => renderGuideOfferModule({ heading: "Probe", rows: [{ program_id: "trimi-glp-1", checked_date: "2026-07-23" }] }, ledger.programs, spec),
    /guide_offer_module_row_evidence_missing/,
  );
  assert.throws(
    () => renderGuideOfferModule({ heading: "Probe", inside_sources_block: true, rows: [{ program_id: "trimi-glp-1", captured_wording: "x", checked_date: "2026-07-23" }] }, ledger.programs, spec),
    /guide_offer_module_inside_evidence_layer/,
  );
});

test("the offer module refuses to render without the v2 gate", () => {
  assert.throws(
    () => renderGuideOfferModule(
      { heading: "Probe", rows: [{ program_id: "trimi-glp-1", captured_wording: "x", checked_date: "2026-07-23" }] },
      ledger.programs,
      { schema: "blog-comparison-spec-v1", live_link_allowed: false, operator_gate_receipt: null },
    ),
    /guide_offer_module_gate_invalid/,
  );
});

test("the two ruled-NO surfaces stay citation-only in the briefs themselves", () => {
  for (const canonical of RULED_NO) {
    const brief = guideOf(canonical);
    assert.equal(brief.has_affiliate_cta, false);
    assert.equal(brief.inline_ftc_disclosure, false);
    assert.equal(brief.comparison_required, false);
    assert.equal(brief.offer_module, undefined);
  }
});

test("every ruled-YES brief passes reviewBrief and carries present-tense FTC copy", () => {
  const authors = readJson("data/blog/author-registry.json");
  const authorFor = (brief) => authors.authors.find((item) => item.id === (brief.author_id || "clinic-scout-editorial-team")) || authors.authors[0];
  for (const canonical of RULED_YES) {
    const brief = guideOf(canonical);
    assert.equal(brief.surface_taxonomy, "commercial", canonical);
    assert.equal(brief.ftc_disclosure_placement, "before_first_affiliate_link", canonical);
    assert.doesNotMatch(brief.inline_ftc_disclosure_text, /held link|future eligible|no outbound affiliate link is active|later approved/i, canonical);
    assert.equal(reviewBrief(brief, authorFor(brief)).status, "PASS", canonical);
  }
});

test("a live page whose FTC copy still describes a held future is HELD, not published", () => {
  const authors = readJson("data/blog/author-registry.json");
  const brief = structuredClone(guideOf("/guides/gala-vs-shed/"));
  brief.inline_ftc_disclosure_text = "We may earn compensation if a held link is later approved and used.";
  const author = authors.authors.find((item) => item.id === (brief.author_id || "clinic-scout-editorial-team")) || authors.authors[0];
  assert.equal(reviewBrief(brief, author).reason, "ftc_disclosure_describes_held_future_on_live_page");
});

// §4.4(2) citation-immutability diff. Strip the nodes this ruling ADDS, then assert
// the rest of the page is byte-identical to the predecessor release. That is the only
// honest proof that no evidence meaning changed — a claim, a quote, a date, a source
// URL or an anchor target moving would show up here immediately.
const PREDECESSOR = path.resolve(ROOT, "../../releases/glp-buffer-2026-08-19-d2ad32ab6e78fbee/public");

function stripMonetizationNodes(html) {
  return html
    .replace(/<section class="guide-offer-module"[\s\S]*?<\/section>/g, "")
    .replace(/<p class="table-disclosure">[\s\S]*?<\/p>/g, "")
    .replace(/<span class="affiliate-disclosure">[\s\S]*?<\/span>/g, "")
    .replace(/<td data-label="Next steps">[\s\S]*?<\/td>/g, "")
    // The ruling's own CSS block and the surface-taxonomy flip's evidence-band line.
    .replace(/\/\* ED B-13 guide monetization surfaces[\s\S]*?@media\(max-width:640px\)\{\.guide-offer-row \.dual-cta\{grid-template-columns:1fr\}\}/g, "")
    .replace(/ · Prices checked <time datetime="[^"]*" data-prices-checked-date>[^<]*<\/time>/g, "");
}

test("citation immutability — the evidence layer of every ruled guide is unchanged vs the predecessor", { skip: existsSync(PREDECESSOR) ? false : "predecessor release tree not present next to this tree" }, () => {
  const monetizationOnlyCanonicals = [...RULED_YES, ...RULED_NO].filter((canonical) => {
    const brief = guideOf(canonical);
    return !(brief?.batch_gate_passed === true
      && /^[a-f0-9]{64}$/.test(brief?.operator_release_receipt || ""));
  });
  for (const canonical of monetizationOnlyCanonicals) {
    const relative = path.join(canonical.replace(/^\//, ""), "index.html");
    const before = readFileSync(path.join(PREDECESSOR, relative), "utf8");
    const after = readFileSync(path.join(ROOT, "public", relative), "utf8");
    const beforeSources = before.match(/<section class="guide-sources"[\s\S]*?<\/section>/)?.[0];
    const afterSources = after.match(/<section class="guide-sources"[\s\S]*?<\/section>/)?.[0];
    assert.ok(beforeSources && afterSources, `${canonical}: source ledger missing`);
    // B-08 (a DIFFERENT item in this same batch) deliberately rewrote every source
    // anchor's LABEL from the semantically empty "Open source" to issuer + document
    // type + date. That is an intended, separately-proven change, so the label text is
    // normalized out here. Everything else in the ledger - the issuer, the "Supports:"
    // claim text, the href, the checked date, the list order, the item count - is
    // compared byte-for-byte, which is precisely the evidence meaning this ruling
    // promised not to touch.
    const normalizeLabels = (html) => html
      .replace(/(data-citation="[^"]*">)[^<]*(<\/a>)/g, "$1CITATION_LABEL$2")
      .replace(/<small>(?:Checked|current as of) /gi, "<small>DATE_PREFIX ");
    assert.equal(normalizeLabels(afterSources), normalizeLabels(beforeSources), `${canonical}: the source ledger changed`);
    const citationHrefs = (html) => [...html.matchAll(/<a\b[^>]*data-citation[^>]*href="([^"]*)"/g)].map((match) => match[1]).sort();
    assert.deepEqual(citationHrefs(after), citationHrefs(before), `${canonical}: a citation target moved`);
  }
});

test("no monetized guide leaks an affiliate host into its JSON-LD citation array", () => {
  for (const canonical of RULED_YES) {
    const html = readFileSync(path.join(ROOT, "public", canonical.replace(/^\//, ""), "index.html"), "utf8");
    for (const script of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const text = script[1];
      assert.doesNotMatch(text, /track\.revoffers\.com|awin1\.com/, `${canonical}: affiliate URL inside structured data`);
    }
  }
});

test("served public HTML globally excludes D35/D54 stale copy labels", async () => {
  const { quizCopySurface, readQuizFragmentHashes } = await import("../src/quiz-copy-boundary.mjs");
  const publicRoot = path.join(ROOT, "public");
  const hashes = readQuizFragmentHashes(publicRoot);
  const htmlFiles = publicHtmlFiles(publicRoot);
  assert.ok(htmlFiles.length > 0, "public HTML corpus is empty");

  const violations = [];
  for (const file of htmlFiles) {
    const relative = path.relative(publicRoot, file);
    const html = readFileSync(file, "utf8");
    const prose = quizCopySurface(html, relative, hashes);
    for (const match of prose.matchAll(/\b(?:was )?checked (?:through )?2026-\d{2}-\d{2}(?!\d)/gi)) {
      violations.push(`${relative}: ${match[0]}`);
    }
    if (prose.includes("Related coverage")) violations.push(`${relative}: Related coverage`);
  }

  assert.deepEqual(violations, []);
});
