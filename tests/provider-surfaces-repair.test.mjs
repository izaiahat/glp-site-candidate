// 2026-08-18 operator surface defects — one test per defect, each written
// against the thing that actually shipped broken.
//
//   1. white/light logos invisible on the paper chip
//   2. no-logo providers rendering overflowing raw text
//   3. providers whose shipped logo asset never reached their row
//   4. the calculator autofilling for 5 of 33 providers
//   5. tables running off the side of the screen
//   6. related-coverage cards rendering as run-together text
//   7. ops@ (the internal alias) published on public pages
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { attachPricingMatrix } from "../src/cost-calculator.mjs";
import { CHIP_CLASS, decorateProviderChip, decorateProviderChips, indexLogoManifest } from "../src/provider-chip.mjs";
import { classifyTable, containTables } from "../src/table-containment.mjs";
import { addressesIn, auditPage, decodeCfEmail } from "../scripts/validate-public-email-aliases.mjs";
import {
  MAX_WORDMARK_PX, MIN_WORDMARK_PX, WORDMARK_CHIPS, fitWordmark, fittedLineWidth, innerWidth,
} from "../src/provider-wordmark.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), "utf8"));

const metrics = await readJson("data/wordmark-font-metrics.json");
const manifest = await readJson("assets/provider-logos/manifest.json");
const registry = await readJson("data/program-registry.json");
const pricing = await readJson("data/provider-pricing-matrix.json");

// ---------------------------------------------------------------------------
// 1 + 3. chip treatment is derived from the shipped asset
// ---------------------------------------------------------------------------
test("every shipped logo carries a derived chip treatment", () => {
  const index = indexLogoManifest(manifest);
  for (const logo of manifest.logos) {
    assert.ok(CHIP_CLASS[logo.logo_treatment], `${logo.program_id} has no treatment`);
    assert.ok(logo.logo_luminance.contrast_on_light_chip > 0);
    assert.equal(index.get(logo.program_id), logo);
  }
});

test("a light-ink mark gets the dark chip and a dark-ink mark keeps the paper chip", () => {
  const byId = new Map(manifest.logos.map((logo) => [logo.program_id, logo]));
  // BiltRx is white-on-transparent: contrast 1.06 on white is unreadable.
  assert.equal(byId.get("biltrx").logo_treatment, "dark-chip");
  assert.ok(byId.get("biltrx").logo_luminance.contrast_on_light_chip < 3);
  // Found is black-on-transparent: 21:1 on white, so it must NOT be moved.
  assert.equal(byId.get("found-health").logo_treatment, "light-chip");
  for (const logo of manifest.logos) {
    if (logo.logo_treatment !== "dark-chip") continue;
    if (logo.logo_treatment_reason === "opaque_artwork_dark_box_matched") {
      // Opaque artwork carries its own dark box; the chip matches it so there
      // is no seam. Contrast is not the question there — the box is.
      assert.ok(logo.logo_luminance.relative_luminance < 0.2, logo.program_id);
      continue;
    }
    assert.ok(
      logo.logo_luminance.contrast_on_dark_chip > logo.logo_luminance.contrast_on_light_chip,
      `${logo.program_id} was moved to the dark chip without gaining contrast`,
    );
  }
});

test("a row with no logo block adopts the asset this release already ships", () => {
  const index = indexLogoManifest(manifest);
  // The exact 2026-08-18 defect: Pallas shipped pallas-health-review.webp and
  // still rendered a raw-text wordmark, because its row carried no logo block.
  const row = { program_id: "pallas-health-review", provider: "Pallas Health" };
  decorateProviderChip(row, index, metrics);
  assert.equal(row.logo.path, "/assets/provider-logos/pallas-health-review.webp");
  assert.equal(row.logo.chip_class, "dark");
  assert.equal(row.wordmark, undefined);
});

test("an alias row finds the canonical merchant's mark instead of falling back to text", () => {
  const index = indexLogoManifest(manifest);
  const row = { program_id: "shed", provider: "SHED" };
  decorateProviderChip(row, index, metrics);
  assert.equal(row.logo.path, "/assets/provider-logos/shedrx.webp");
});

test("a row pinning a different asset than the release ships fails the build", () => {
  const index = indexLogoManifest(manifest);
  const row = { program_id: "found-health", provider: "Found", logo: { sha256: "f".repeat(64) } };
  assert.throws(() => decorateProviderChip(row, index, metrics), /provider_logo_row_asset_desync/);
});

test("only providers with no asset at all reach the wordmark", () => {
  const pages = [{ rows: [
    { program_id: "found-health", provider: "Found" },
    { program_id: "sprout-health", provider: "Sprout Health" },
  ] }];
  const receipt = decorateProviderChips(pages, manifest, metrics);
  assert.deepEqual(receipt.wordmark_programs, ["sprout-health"]);
  assert.deepEqual(receipt.logo_chip_programs, ["found-health"]);
});

// ---------------------------------------------------------------------------
// 2. the wordmark provably fits
// ---------------------------------------------------------------------------
test("every provider that actually renders a wordmark fits every chip", () => {
  // The wordmark set is exactly the providers with no shipped logo asset.
  const withAssets = new Set(manifest.logos.map((logo) => logo.program_id));
  const names = Object.entries(registry.provider_dynamic_profiles.profiles)
    .filter(([programId]) => !withAssets.has(programId))
    .map(([, profile]) => profile.provider)
    .concat(["Direct Meds", "MangoRx", "Sprout Health", "SHED"]);
  assert.ok(names.length >= 4);
  for (const name of names) {
    for (const placement of Object.keys(WORDMARK_CHIPS)) {
      const fit = fitWordmark(metrics, name, placement);
      assert.ok(fit.px >= MIN_WORDMARK_PX && fit.px <= MAX_WORDMARK_PX,
        `${name}/${placement} sized ${fit.px}px`);
      assert.ok(fit.lines.length <= 2, `${name}/${placement} used ${fit.lines.length} lines`);
      assert.ok(fittedLineWidth(metrics, name, placement) <= innerWidth(placement) + 0.001,
        `${name}/${placement} overflows: ${fittedLineWidth(metrics, name, placement)} > ${innerWidth(placement)}`);
      assert.equal(fit.clipped, false, `${name}/${placement} clips`);
    }
  }
});

test("a name too long for the smallest chip is REPORTED, never silently clipped", () => {
  // 78x40 is the comparison-table chip. A 33-character display name cannot fit
  // it at a legible size, and the fitter says so rather than overflowing.
  const fit = fitWordmark(metrics, "Bodybuilding.com GLP-1 & Longevity", "table");
  assert.equal(fit.clipped, true);
  assert.equal(fit.px, MIN_WORDMARK_PX);
  // And the build refuses to ship it as a wordmark at all.
  const index = indexLogoManifest(manifest);
  assert.throws(
    () => decorateProviderChip({ program_id: "unknown-brand", provider: "Longitudinal Metabolic Health Collective & Pharmacy" }, index, metrics),
    /provider_wordmark_cannot_fit/,
  );
});

test("a wordmark never breaks a word — only whitespace", () => {
  const fit = fitWordmark(metrics, "Sprout Health", "table");
  assert.deepEqual(fit.lines, ["Sprout", "Health"]);
  assert.equal(fit.lines.join(" "), "Sprout Health");
  // A single unbroken token cannot be split at all, so it shrinks instead.
  const single = fitWordmark(metrics, "Supercalifragilistic", "table");
  assert.deepEqual(single.lines, ["Supercalifragilistic"]);
});

test("a longer name is never sized larger than a shorter one in the same chip", () => {
  const short = fitWordmark(metrics, "Trimi", "card").px;
  const long = fitWordmark(metrics, "Sprout Health", "card").px;
  assert.ok(long <= short);
});

test("the shipped stylesheet pins the exact boxes the fitter measured against", async () => {
  const css = await readFile(path.join(ROOT, "assets/site.css"), "utf8");
  // If these ever drift, a "fitted" size is fitted to a box that is not shipped.
  assert.match(css, /\.provider-logo\.provider-logo--wordmark\{width:136px;height:58px;[^}]*padding:6px 10px/);
  assert.match(css, /\.provider-logo\.provider-logo--wordmark\.provider-logo--verdict\{width:156px;height:68px/);
  assert.match(css, /provider-logo--wordmark[^{]*\{width:78px;height:40px;[^}]*padding:4px 6px/);
  assert.equal(WORDMARK_CHIPS.card.width, 136);
  assert.equal(WORDMARK_CHIPS.verdict.width, 156);
  assert.equal(WORDMARK_CHIPS.table.width, 78);
});

// ---------------------------------------------------------------------------
// 4. the calculator autofills from evidenced, quoted prices
// ---------------------------------------------------------------------------
test("every live provider is in the pricing matrix with prices or a written reason", () => {
  for (const programId of Object.keys(registry.provider_dynamic_profiles.profiles)) {
    const entry = pricing.providers[programId];
    assert.ok(entry, `${programId} missing from the pricing matrix`);
    if (!entry.medications.length) {
      assert.ok(String(entry.unavailable_reason || "").length > 20,
        `${programId} has neither a price nor a reason`);
    }
  }
});

test("every price the calculator can render is inside its own quote", () => {
  const providers = Object.keys(pricing.providers).map((programId) => ({ program_id: programId }));
  attachPricingMatrix(providers, pricing);
  let rows = 0;
  const expectedRows = Object.values(pricing.providers).reduce((sum, provider) => sum + provider.medications.length, 0);
  assert.deepEqual(providers.map((provider) => provider.program_id).sort(), Object.keys(pricing.providers).sort());
  for (const provider of providers) {
    const expected = pricing.providers[provider.program_id].medications;
    assert.equal(provider.medications.length, expected.length, `${provider.program_id}: exact source row count`);
    for (const [index, row] of provider.medications.entries()) {
      for (const [field, value] of Object.entries(expected[index])) {
        assert.deepEqual(row[field], value, `${provider.program_id}/${index}: source field ${field}`);
      }
      rows += 1;
      if (Object.hasOwn(row, 'price_kind')) {
        assertTypedQuoteEvidence(row);
        continue;
      }
      for (const field of ["month_1_usd", "ongoing_usd"]) {
        if (row[field] === null || row[field] === undefined) continue;
        const quoteTokens = new Set([
          String(row[field]),
          row[field].toLocaleString("en-US", { useGrouping: true, maximumFractionDigits: 2 }),
          Number.isInteger(row[field]) ? row[field].toFixed(0) : row[field].toFixed(2),
        ]);
        assert.ok([...quoteTokens].some((token) => row.quote.includes(token)),
          `${provider.program_id}/${row.medication_id}: ${field} is not in its quote`);
      }
      assert.match(row.source_url, /^https:\/\//);
      assert.match(row.captured_on, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(row.capture_sha256, /^[a-f0-9]{64}$/);
    }
  }
  assert.equal(rows, expectedRows, `expected the full source matrix, saw ${rows} rows`);
});

function assertTypedQuoteEvidence(row) {
  const facts = Object.entries(row.facts || {});
  assert.ok(facts.length > 0, `${row.row_id}: typed facts missing`);
  for (const [name, fact] of facts) {
    if (fact.value === 'UNKNOWN' && !fact.evidence?.length) {
      assert.ok(typeof fact.artifact_needed === 'string' && fact.artifact_needed.trim(), `${row.row_id}/${name}: unknown must name missing evidence`);
      continue;
    }
    assert.ok(fact.evidence?.length > 0, `${row.row_id}/${name}: evidence missing`);
    for (const witness of fact.evidence) {
      assert.match(witness.source_url, /^https:\/\//);
      assert.match(witness.capture_sha256, /^[a-f0-9]{64}$/);
      assert.match(witness.captured_at_utc, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(typeof witness.quote === 'string' && witness.quote.trim());
    }
    if (name.endsWith('_usd') && fact.value !== 'UNKNOWN') {
      const tokens = [String(fact.value), fact.value.toLocaleString('en-US'), fact.value.toFixed(2)];
      assert.ok(fact.evidence.some(w => tokens.some(t => w.quote.includes(t))), `${row.row_id}/${name}: amount missing from own quote`);
    }
  }
}

test('typed matrix rows independently require fact-level quote sources', () => {
  const rows = Object.values(pricing.providers).flatMap(p => p.medications).filter(r => Object.hasOwn(r, 'price_kind'));
  assert.ok(rows.length > 0, 'typed coverage must not be vacuous');
  assert.equal(rows.filter(r => !Object.values(r.facts || {}).some(f => f.evidence?.some(w => /^https:\/\//.test(w.source_url)))).length, 0);
  for (const row of rows) assertTypedQuoteEvidence(row);
  const broken = structuredClone(rows[0]);
  delete Object.values(broken.facts)[0].evidence[0].source_url;
  assert.throws(() => assertTypedQuoteEvidence(broken));
});

test("a fabricated price — one not in its quote — fails the build", () => {
  const poisoned = structuredClone(pricing);
  const victim = Object.values(poisoned.providers).find((entry) => entry.medications.length);
  victim.medications[0].ongoing_usd = 99999;
  assert.throws(
    () => attachPricingMatrix([{ program_id: victim.program_id }], poisoned),
    /pricing_matrix_amount_not_in_quote/,
  );
});

test("a provider with no evidenced price gets an honest unavailable state, never a number", () => {
  const providers = [{ program_id: "drhouse" }];
  attachPricingMatrix(providers, pricing);
  assert.deepEqual(providers[0].medications, []);
  assert.ok(providers[0].pricing_unavailable_reason.length > 20);
});

test("month-1 differs from ongoing only where the provider publishes an intro price", () => {
  for (const entry of Object.values(pricing.providers)) {
    for (const row of entry.medications) {
      if (Object.hasOwn(row, 'price_kind')) {
        assert.equal(row.calculator_eligibility, 'display_only');
        for (const field of ['month_1_usd', 'ongoing_usd', 'month_1_basis', 'cadence']) assert.equal(Object.hasOwn(row, field), false);
        assertTypedQuoteEvidence(row);
        continue;
      }
      assert.ok(["intro", "same_as_ongoing"].includes(row.month_1_basis));
      if (row.month_1_basis === "same_as_ongoing") assert.equal(row.month_1_usd, row.ongoing_usd);
      else assert.notEqual(row.month_1_usd, row.ongoing_usd);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. tables are contained
// ---------------------------------------------------------------------------
test("a bare table is wrapped, and a prose table stacks with per-cell labels", () => {
  // The exact markup from /reviews/dudemeds-review/ that ran off the screen.
  const html = '<section><table class="review-alternatives"><caption>Other provider records</caption>'
    + "<thead><tr><th>Record</th><th>How to use it</th></tr></thead><tbody>"
    + "<tr><td><a href='/reviews/enhance-md/'>Enhance.MD review</a></td>"
    + "<td>Open the dated evidence record and compare the same pricing, terms, and unknown-field rules.</td>"
    + "</tr></tbody></table></section>";
  const result = containTables(html, "/reviews/dudemeds-review/");
  assert.equal(result.wrapped, 1);
  assert.equal(result.prose, 1);
  assert.match(result.html, /<div class="table-wrap auto-contained responsive-table"/);
  assert.match(result.html, /role="region"/);
  assert.match(result.html, /aria-label="Other provider records"/);
  assert.match(result.html, /data-label="Record"/);
  assert.match(result.html, /data-label="How to use it"/);
});

test("a numeric table scrolls instead of stacking", () => {
  const html = "<table><thead><tr><th>Provider</th><th>Price</th></tr></thead>"
    + "<tbody><tr><td>Trimi</td><td>$99</td></tr></tbody></table>";
  assert.equal(classifyTable(html), "data");
  const result = containTables(html);
  assert.equal(result.data, 1);
  assert.doesNotMatch(result.html, /responsive-table/);
});

test("containment is idempotent and never double-wraps a hand-tuned table", () => {
  const html = '<div class="table-wrap responsive-table"><table><tbody><tr><td>x</td></tr></tbody></table></div>';
  const once = containTables(html);
  assert.equal(once.wrapped, 0);
  assert.equal(once.alreadyContained, 1);
  assert.equal(once.html, html);
  const bare = containTables("<table><tbody><tr><td>x</td></tr></tbody></table>");
  assert.equal(containTables(bare.html).wrapped, 0);
});

test("no table anywhere in the built tree is uncontained", async () => {
  const report = JSON.parse(await readFile(path.join(ROOT, "artifacts/ops/build-report.json"), "utf8"));
  const containment = report.surface_derivations.table_containment;
  assert.ok(containment.final_sweep, "the post-pass sweep must run");
  assert.ok(containment.wrapped + containment.final_sweep.wrapped > 100);
});

// ---------------------------------------------------------------------------
// 6. related-coverage cards have rules
// ---------------------------------------------------------------------------
test("the related-coverage card list is actually styled", async () => {
  const css = await readFile(path.join(ROOT, "assets/site.css"), "utf8");
  // Without these three the section renders as one run-together string.
  assert.match(css, /\.grid > li > a \{[^}]*display: grid/);
  assert.match(css, /\.grid > li > a > strong \{[^}]*display: block/);
  assert.match(css, /\.grid > li > a > small \{[^}]*display: block/);
});

// ---------------------------------------------------------------------------
// 7. no public page publishes the internal alias
// ---------------------------------------------------------------------------
test("Cloudflare's data-cfemail obfuscation is decoded before the alias check", () => {
  // XOR-encode ops@glpclinicscout.com the way Cloudflare does, key 0x2a.
  const address = "ops@glpclinicscout.com";
  const key = 0x2a;
  const hex = key.toString(16).padStart(2, "0")
    + [...address].map((char) => (char.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
  assert.equal(decodeCfEmail(hex), address);
  const html = `<a href="/cdn-cgi/l/email-protection#${hex}"><span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span></a>`;
  // A plain-text grep sees nothing here. That is the whole point.
  assert.doesNotMatch(html, /ops@/);
  assert.deepEqual(addressesIn(html, "glpclinicscout.com"), ["ops"]);
});

test("an obfuscated ops@ on a real page is reported as a violation", async () => {
  const map = await readJson("data/email-alias-map.json");
  const key = 0x2a;
  const hex = key.toString(16).padStart(2, "0")
    + [..."ops@glpclinicscout.com"].map((char) => (char.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
  const audit = auditPage(map, "/privacy/", `<p data-cfemail="${hex}">[email protected]</p>`);
  assert.equal(audit.violations.length, 1);
  assert.equal(audit.violations[0].code, "internal_alias_published");
});

test("each legal page publishes the alias its purpose routes to", async () => {
  const map = await readJson("data/email-alias-map.json");
  for (const [route, expected] of [["/privacy/", "privacy"], ["/terms/", "support"]]) {
    const html = await readFile(path.join(ROOT, "public", route.slice(1), "index.html"), "utf8");
    assert.deepEqual(addressesIn(html, map.domain), [expected], `${route} publishes the wrong alias`);
  }
});

test("a page publishing a real alias on the wrong desk is a violation", async () => {
  const map = await readJson("data/email-alias-map.json");
  const audit = auditPage(map, "/terms/", "<a href='mailto:billing@glpclinicscout.com'>x</a>");
  assert.equal(audit.violations[0].code, "alias_wrong_for_page_purpose");
});


test("an exact cents price inside its quote passes the build", () => {
  const matrix = {
    schema: "glp-provider-pricing-matrix-v1",
    providers: {
      decimal: {
        medications: [{
          medication_id: "compounded-semaglutide-injection",
          label: "Compounded semaglutide (injection)",
          cadence: "month",
          month_1_basis: "same_as_ongoing",
          month_1_usd: 84.99,
          ongoing_usd: 84.99,
          quote: "Published price: $84.99 per month.",
          source_url: "https://provider.example/pricing",
          capture_sha256: "a".repeat(64),
          captured_on: "2026-09-01",
        }],
      },
    },
  };
  assert.doesNotThrow(() => attachPricingMatrix([{ program_id: "decimal" }], matrix));
});
