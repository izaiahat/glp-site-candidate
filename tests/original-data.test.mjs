import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildStudyArtifacts, csvCell, deriveDisclosureSummary, validateStudy } from "../src/original-data.mjs";
import study from "../data/original-data-study.json" with { type: "json" };

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const mutate = (fn) => { const copy = structuredClone(study); fn(copy); return copy; };
const mustReject = (fn, pattern) => assert.throws(() => validateStudy(mutate(fn)), pattern);

test("bounded disclosure sample validates and derives only basis-separated counts and bounds", () => {
  assert.deepEqual(validateStudy(study), { status: "PASS", rows: 4, sources: 4 });
  assert.deepEqual(deriveDisclosureSummary(study), {
    sampled_page_count: 4,
    recurring_membership_row_count: 3,
    one_time_initial_visit_row_count: 1,
    recurring_membership_displayed_bounds: { displayed_min_usd: 74, displayed_max_usd: 149 },
    one_time_initial_visit_displayed_bounds: { displayed_min_usd: 129, displayed_max_usd: 129 },
    all_sampled_pages_explicitly_excluded_medication_at_capture: true,
  });
  assert.deepEqual(study.rows.map((row) => row.provider_id), ["ro", "weightwatchers", "lifemd", "plushcare"]);
  assert.ok(study.rows.every((row) => row.medication_included === false));
});

test("every row has exactly one accepted provenance-bound source and Mochi is absent", () => {
  assert.equal(new Set(study.rows.map((row) => row.source_id)).size, 4);
  assert.deepEqual(new Set(study.rows.map((row) => row.source_id)), new Set(study.sources.map((source) => source.source_id)));
  for (const source of study.sources) {
    assert.equal(source.disposition, "ACCEPTED");
    assert.equal(source.status_code, 200);
    assert.match(source.capture_id, /-20260802$/);
    assert.match(source.scrape_id, /^[a-f0-9-]{36}$/);
    assert.match(source.first_party_url, /^https:\/\//);
    assert.equal(sha256(source.exact_quote), source.exact_quote_sha256);
  }
  assert.doesNotMatch(JSON.stringify(study), /mochi/i);
});

test("capture quote tampering fails even when an attacker recomputes the quote hash", () => {
  mustReject((copy) => { copy.sources[0].exact_quote += " tampered"; }, /quote_hash_mismatch/);
  mustReject((copy) => {
    copy.sources[0].exact_quote += " tampered";
    copy.sources[0].exact_quote_sha256 = sha256(copy.sources[0].exact_quote);
  }, /capture_binding_invalid/);
});

test("missing, duplicate, rejected, evil-host, and mismatched capture references fail closed", () => {
  for (const fn of [
    (copy) => { copy.sources.pop(); copy.methodology.sample_size = 3; },
    (copy) => { copy.sources[1].source_id = copy.sources[0].source_id; },
    (copy) => { copy.sources[0].capture_id = copy.sources[1].capture_id; },
    (copy) => { copy.sources[0].scrape_id = copy.sources[1].scrape_id; },
    (copy) => { copy.sources[0].disposition = "REJECTED_SOURCE_404"; copy.sources[0].status_code = 404; },
    (copy) => { copy.sources[0].first_party_url = "https://evil.example/ro"; },
    (copy) => { copy.sources[0].requested_url = "https://ro.co@evil.example/weight-loss/pricing/"; },
    (copy) => { copy.rows[1].source_id = copy.rows[0].source_id; },
    (copy) => { copy.rows[0].source_id = "missing-source"; },
  ]) mustReject(fn);
});

test("strict schemas and sample-size integrity reject undeclared or inconsistent fields", () => {
  for (const fn of [
    (copy) => { copy.extra = true; },
    (copy) => { copy.source_ledger.extra = true; },
    (copy) => { copy.methodology.aggregate = 101; },
    (copy) => { copy.sources[0].cached_html = "unbound"; },
    (copy) => { copy.rows[0].claimed_effect = "works better"; },
    (copy) => { copy.methodology.sample_size = 5; },
    (copy) => { copy.rows.pop(); },
  ]) mustReject(fn, /schema|denominator|methodology_binding/);
});

test("stale, future, malformed, and collection-mismatched timestamps fail closed", () => {
  for (const fn of [
    (copy) => { copy.sources[0].checked_at = "not-a-date"; },
    (copy) => { copy.sources[0].checked_at = "2026-08-03T01:40:13.532Z"; },
    (copy) => { copy.sources[0].checked_at = "2026-07-01T01:40:13.532Z"; },
    (copy) => { copy.methodology.collection_started_at = "2026-08-02T01:40:14.000Z"; },
    (copy) => { copy.methodology.collection_ended_at = "2026-08-03T00:00:00Z"; },
    (copy) => { copy.as_of_utc = "2026-08-02"; copy.source_ledger.generated_at_utc = "2026-08-02"; },
  ]) mustReject(fn);
});

test("row amounts, price bases, and medication status must be supported by their exact quotes", () => {
  for (const fn of [
    (copy) => { copy.rows[0].displayed_amount_min_usd = 73; },
    (copy) => { copy.rows[2].displayed_amount_max_usd = 150; },
    (copy) => { copy.rows[3].price_basis = "recurring_membership"; copy.rows[3].billing_period = "month"; },
    (copy) => { copy.rows[0].billing_period = "visit"; },
    (copy) => { copy.rows[0].medication_included = true; },
  ]) mustReject(fn);
});

test("CSV formula injection is neutralized including leading control or whitespace characters", () => {
  for (const value of ["=1+1", "+SUM(A:A)", "-2+3", "@cmd", "  =IMPORTXML(1)", "\t+cmd", "\n@cmd"]) assert.ok(csvCell(value).replace(/^"/, "").startsWith("'"), value);
  mustReject((copy) => { copy.rows[0].provider_name = " =IMPORTXML(\"bad\")"; });
  mustReject((copy) => { copy.rows[0].qualifier = "\t+cmd"; });
});

test("PII-like strings and unsupported clinical-effect claims are rejected", () => {
  for (const value of ["jane@example.com", "+1 (212) 555-0199", "Patients lost 20 pounds", "Clinically proven safest"]) {
    mustReject((copy) => { copy.rows[0].qualifier = value; }, /high_risk|row_text|string/);
  }
});

test("methodology, provider identity, and qualifiers are pinned to the accepted source projection", () => {
  mustReject((copy) => { copy.methodology.sampling_frame = "This is representative of the market and everyone qualifies."; }, /high_risk|methodology_binding/);
  mustReject((copy) => { copy.methodology.comparison_rule = "All rows have no commitment required and one typical market price."; }, /high_risk|methodology_binding/);
  mustReject((copy) => { copy.rows[0].provider_id = "hims"; copy.rows[0].provider_name = "Hims"; }, /provider_binding/);
  mustReject((copy) => { copy.rows[0].provider_name = "Ro"; }, /provider_binding/);
  mustReject((copy) => { copy.rows[0].qualifier += " No commitment required."; }, /high_risk|qualifier_quote_mismatch/);
  mustReject((copy) => { copy.rows[1].qualifier = copy.sources[0].exact_quote; }, /qualifier_quote_mismatch/);
  for (const row of study.rows) assert.equal(row.qualifier, study.sources.find((source) => source.source_id === row.source_id).exact_quote);
});

test("renderer publishes no mixed-basis price statistic or market-wide inference", () => {
  const artifacts = buildStudyArtifacts(study);
  const publicPayload = JSON.stringify({ html: artifacts.html, csv: artifacts.csv, dataset: artifacts.dataset, methodology: artifacts.methodology });
  assert.doesNotMatch(publicPayload, /\b(?:median|average)\b/i);
  assert.doesNotMatch(artifacts.html, /market (?:price|cost|benchmark)|typical price|industry-wide/i);
  assert.match(artifacts.html, /3 recurring membership rows/);
  assert.match(artifacts.html, /1 initial-visit row/);
  assert.match(artifacts.html, /4 of 4 pages/);
  assert.match(artifacts.html, /no combined price statistic is calculated/i);
});

test("route is self-canonical, noindex/nofollow, source-plain, and runtime network-dark", () => {
  const { html, manifest } = buildStudyArtifacts(study);
  assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/glpclinicscout\.com\/research\/original-data\/public-glp-1-program-pricing-sample\/">/);
  assert.equal((html.match(/<a\b/g) || []).length, 3);
  assert.equal((html.match(/<a\b[^>]*href="https?:/g) || []).length, 0);
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.doesNotMatch(html, /<script\b[^>]*src=|<form\b|mailto:|tel:|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|gtag|googletagmanager|clarity|analytics\.js/i);
  assert.deepEqual(manifest.route_capabilities, {
    form_count: 0,
    executable_script_count: 0,
    external_script_count: 0,
    external_clickable_link_count: 0,
    contact_link_count: 0,
    network_api_token_count: 0,
    analytics_token_count: 0,
  });
  for (const source of study.sources) assert.match(html, new RegExp(`<code>${source.first_party_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</code>`));
});

test("JSON-LD is valid Dataset markup and keeps the same title and canonical URL", () => {
  const { html } = buildStudyArtifacts(study);
  const block = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
  assert.ok(block);
  const data = JSON.parse(block);
  assert.equal(data["@context"], "https://schema.org");
  assert.equal(data["@type"], "Dataset");
  assert.equal(data.name, study.title);
  assert.equal(data.url, study.canonical_url);
  assert.equal(data.isBasedOn.length, 4);
});

test("artifact derivation is deterministic and download hashes match exact bytes", () => {
  const first = buildStudyArtifacts(study);
  const second = buildStudyArtifacts(structuredClone(study));
  assert.deepEqual(first, second);
  assert.equal(first.manifest.csv_sha256, sha256(first.csv));
  assert.equal(first.manifest.dataset_sha256, sha256(first.datasetText));
  assert.equal(first.manifest.methodology_sha256, sha256(first.methodologyText));
  assert.equal(first.manifest.route_sha256, sha256(first.html));
});

test("built route, downloads, and manifest have byte-for-byte derivation parity", async () => {
  const artifacts = buildStudyArtifacts(study);
  const [html, csv, dataset, methodology, manifestText, headers] = await Promise.all([
    readFile(new URL("../public/research/original-data/public-glp-1-program-pricing-sample/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/data/public-glp-1-program-pricing-sample.csv", import.meta.url), "utf8"),
    readFile(new URL("../public/data/public-glp-1-program-pricing-sample.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/public-glp-1-program-pricing-sample-methodology.json", import.meta.url), "utf8"),
    readFile(new URL("../artifacts/ops/wave4-original-data-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../public/_headers", import.meta.url), "utf8"),
  ]);
  assert.equal(html, artifacts.html);
  assert.equal(csv, artifacts.csv);
  assert.equal(dataset, artifacts.datasetText);
  assert.equal(methodology, artifacts.methodologyText);
  assert.deepEqual(JSON.parse(manifestText), artifacts.manifest);
  assert.match(headers, /\/research\/original-data\/public-glp-1-program-pricing-sample\/\*/);
  assert.match(headers, /X-Robots-Tag: noindex, nofollow, noarchive, nosnippet/);
  assert.match(headers, /connect-src 'none'/);
});
