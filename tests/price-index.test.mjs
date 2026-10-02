import test from "node:test";
import assert from "node:assert/strict";
import { detailPrograms } from './helpers/d2w-s9-contracts.mjs';
import { createHash } from "node:crypto";
import { readFile, cp, mkdtemp, mkdir, rm, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {historicalPriceIndexRegistry} from '../src/price-index-historical-registry.mjs';
import {
  buildPriceIndexArtifacts,
  migratePriceIndexHistoryV1ToV2,
  normalizePriceIndexSourceHashes,
  renderPriceIndex,
  snapshotPriceIndexRows,
  validatePriceIndexInputs,
} from "../src/price-index.mjs";

const ROOT = new URL("../", import.meta.url);
const DATA = new URL("../data/", import.meta.url);
const trackerFixture = JSON.parse(await readFile(new URL("price-tracker.json", DATA)));
const LATEST_OBSERVED_ON = trackerFixture.price_index.observations.at(-1).observed_on;
const NOW = `${LATEST_OBSERVED_ON}T23:59:59Z`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

async function fixture() {
  const names = ["price-tracker.json", "original-data-study.json", "program-registry.json", "program-content-ledger.json"];
  const bytes = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, DATA))])));
  // This suite exercises the historical price algorithm and its negative
  // evidence controls. Current HOLD/research projections have separate hostile
  // suites; use the actual build-staging frozen binding, not raw live evidence.
  const bound = frozenPriceLedger(bytes['program-content-ledger.json'],await readFile(new URL('price-index-frozen-content-ledger.json',DATA)),JSON.parse(await readFile(new URL('price-index-nonprice-binding.json',DATA))));
  return {
    tracker: JSON.parse(bytes["price-tracker.json"]),
    study: JSON.parse(bytes["original-data-study.json"]),
    programRegistry: historicalPriceIndexRegistry(JSON.parse(bytes["program-registry.json"]),bound.ledger),
    contentLedger: bound.ledger,
    sourceHashes: {
      original_data_study_sha256: sha256(bytes["original-data-study.json"]),
      program_content_ledger_sha256: bound.frozen_sha256,
      program_registry_sha256: sha256(bytes["program-registry.json"]),
    },
  };
}

function independentMetrics(records, medication) {
  const values = records.filter((record) => record.medication === medication).map((record) => record.amount_usd).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return { provider_count: values.length, median_usd: median, min_usd: values[0], max_usd: values.at(-1), spread_usd: values.at(-1) - values[0] };
}

test("price index derives the exact median, min, max, and spread from tracker rows", async () => {
  const input = await fixture();
  const result = validatePriceIndexInputs(input, { now: NOW });
  assert.equal(result.status, "PASS");
  const frozenManifest=JSON.parse(await readFile(new URL('../artifacts/ops/price-index-manifest.json',import.meta.url)));
  assert.equal(result.live_provider_count,frozenManifest.live_provider_count);
  assert.equal(result.indexed_provider_count, 19);
  assert.equal(result.record_count, 35);
  assert.deepEqual(result.metrics, [
    { medication: "semaglutide", provider_count: 17, median_usd: 112, min_usd: 74, max_usd: 179, spread_usd: 105 },
    { medication: "tirzepatide", provider_count: 18, median_usd: 182.5, min_usd: 125, max_usd: 279, spread_usd: 154 },
  ]);
  for (const metric of result.metrics) {
    assert.deepEqual({ provider_count: metric.provider_count, median_usd: metric.median_usd, min_usd: metric.min_usd, max_usd: metric.max_usd, spread_usd: metric.spread_usd }, independentMetrics(input.tracker.price_index.records, metric.medication));
  }
});

test("first publication records one observed week and refuses to invent movers", async () => {
  const input = await fixture();
  input.tracker.price_index.observations = input.tracker.price_index.observations.slice(0, 1);
  input.tracker.price_index.observations.at(-1).source_files = normalizePriceIndexSourceHashes(input.programRegistry, input.sourceHashes);
  const result = validatePriceIndexInputs(input, { now: NOW });
  assert.equal(input.tracker.price_index.schema, "glp-clinic-scout-price-index-v2");
  assert.equal(result.observation_count, 1);
  assert.equal(result.history_started_on, "2026-08-08");
  assert.equal(result.latest_observation.data_as_of, "2026-08-06");
  assert.deepEqual(result.movers, { status: "NO_PRIOR_OBSERVED_WEEK", previous_observed_on: null, movers: [] });
  assert.equal(result.latest_observation.record_set_sha256, sha256(canonical(result.latest_observation.records)));
  assert.deepEqual(result.latest_observation.records, snapshotPriceIndexRows(input.tracker.price_index.records));
});

test("v1 history migration is deterministic and preserves the real observation meaning and amounts", async () => {
  const input = await fixture();
  const v1 = structuredClone(input.tracker);
  v1.price_index.observations = v1.price_index.observations.slice(0, 1);
  const original = structuredClone(v1.price_index.observations[0]);
  v1.price_index.schema = "glp-clinic-scout-price-index-v1";
  v1.price_index.observations[0].records = original.records.map(({ id, amount_usd }) => ({ id, amount_usd }));
  v1.price_index.observations[0].record_set_sha256 = sha256(canonical(v1.price_index.observations[0].records));

  const first = migratePriceIndexHistoryV1ToV2(v1);
  const second = migratePriceIndexHistoryV1ToV2(v1);
  assert.equal(first.migrated, true);
  assert.deepEqual(first, second);
  assert.equal(first.tracker.price_index.schema, "glp-clinic-scout-price-index-v2");
  const migrated = first.tracker.price_index.observations[0];
  assert.equal(migrated.observed_on, original.observed_on);
  assert.equal(migrated.data_as_of, original.data_as_of);
  assert.deepEqual(migrated.source_files, original.source_files);
  assert.deepEqual(
    migrated.records.map(({ id, amount_usd }) => ({ id, amount_usd })),
    original.records.map(({ id, amount_usd }) => ({ id, amount_usd })),
  );
  assert.equal(migrated.record_set_sha256, sha256(canonical(migrated.records)));
});

test("real variable-cardinality history accepts a new current provider without backfilling it", async () => {
  const input = await fixture();
  input.tracker.price_index.observations = input.tracker.price_index.observations.slice(0, 1);
  input.tracker.price_index.observations.at(-1).source_files = normalizePriceIndexSourceHashes(input.programRegistry, input.sourceHashes);
  const latest = input.tracker.price_index.observations[0];
  const priorRecords = structuredClone(latest.records.slice(0, -1));
  priorRecords[0].amount_usd += 10;
  const prior = {
    observed_on: "2026-08-01",
    data_as_of: "2026-08-01",
    source_files: structuredClone(latest.source_files),
    record_set_sha256: sha256(canonical(priorRecords)),
    records: priorRecords,
  };
  input.tracker.price_index.observations.unshift(prior);
  const result = validatePriceIndexInputs(input, { now: NOW });
  assert.equal(result.observation_count, 2);
  assert.equal(result.latest_observation.records.length, prior.records.length + 1);
  assert.equal(result.movers.status, "OBSERVED_MOVERS");
  assert.equal(result.movers.movers.length, 1);
  assert.equal(result.movers.movers[0].id, latest.records[0].id);
  assert.equal(result.movers.movers.some((row) => row.id === latest.records.at(-1).id), false);
});

test("each tracker amount is bound to dated first-party content-ledger evidence", async () => {
  const input = await fixture();
  const badAmount = structuredClone(input);
  badAmount.tracker.price_index.records[0].amount_usd = 1;
  badAmount.tracker.price_index.observations[0].records[0].amount_usd = 1;
  badAmount.tracker.price_index.observations[0].record_set_sha256 = sha256(canonical(badAmount.tracker.price_index.observations[0].records));
  assert.throws(() => validatePriceIndexInputs(badAmount, { now: NOW }), /price_index_amount_not_in_evidence/);

  const badSource = structuredClone(input);
  const provider = badSource.contentLedger.programs.find((row) => row.program_id === badSource.tracker.price_index.records[0].provider_id);
  provider.research_first_month_price.source_url = "https://www.awin1.com/fabricated";
  // Even an already-projected registry must authenticate the complete supplied
  // frozen ledger before the downstream per-record source URL check.
  assert.throws(() => validatePriceIndexInputs(badSource, { now: NOW }), { message: "price_index_historical_ledger_drift" });
});

test("rendered source template is exact-route, indexable, source-complete, and reviewer-claim free", async () => {
  const input = await fixture();
  const validated = validatePriceIndexInputs(input, { now: NOW });
  const html = renderPriceIndex(input, { now: NOW });
  assert.match(html, /<link rel="canonical" href="https:\/\/glpclinicscout\.com\/glp-1-price-index\/">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.equal((html.match(/data-index-record-id=/g) || []).length, 35);
  assert.equal((html.match(/data-first-party-source/g) || []).length, 35);
  assert.match(html, new RegExp(`data-mover-status="${validated.movers.status}"`));
  assert.match(html, /No earlier weeks were backfilled/);
  assert.match(html, /Compounded drugs are not FDA-approved/);
  assert.doesNotMatch(html, /href="\/go\/|MedicalReview|reviewedBy|Medically reviewed by/i);
});

test("manifest hashes and derivation facts reproduce the generated page", async () => {
  const input = await fixture();
  const { html, manifest } = buildPriceIndexArtifacts(input, { now: NOW });
  assert.equal(manifest.status, "PASS");
  assert.equal(manifest.route, "/glp-1-price-index/");
  assert.equal(manifest.html_sha256, sha256(html));
  assert.equal(manifest.record_set_sha256, input.tracker.price_index.observations.at(-1).record_set_sha256);
  assert.equal(manifest.artifact_facts.rendered_record_count, 35);
  assert.equal(manifest.artifact_facts.first_party_source_count, 35);
  assert.equal(manifest.artifact_facts.affiliate_redirect_anchor_count, 0);
  assert.equal(manifest.artifact_facts.medical_reviewer_claim_count, 0);
});

test("weekly observer is same-day idempotent and preserves tracker bytes", async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'd2p-price-index-'));
  t.after(async () => {
    // cp preserves sealed directory modes. Change only our disposable copy,
    // never the source seal; skip symlinks while making cleanup traversable.
    async function writableDirectories(dir) {
      await chmod(dir, 0o700);
      for (const entry of await readdir(dir, {withFileTypes:true})) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) await writableDirectories(path.join(dir, entry.name));
      }
    }
    await writableDirectories(scratch);
    await rm(scratch, {recursive:true, force:true});
  });
  for (const dir of ['src','data']) await cp(new URL(dir+'/', ROOT), path.join(scratch,dir), {recursive:true});
  await mkdir(path.join(scratch,'scripts'));
  await cp(new URL('scripts/update-price-index.mjs',ROOT), path.join(scratch,'scripts/update-price-index.mjs'));
  const trackerUrl = path.join(scratch,'data/price-tracker.json');
  const before = await readFile(trackerUrl);
  const run = spawnSync(process.execPath, ["scripts/update-price-index.mjs", "--observed-on", LATEST_OBSERVED_ON], { cwd: scratch, encoding: "utf8" });
  const after = await readFile(trackerUrl);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /UNCHANGED_ALREADY_OBSERVED/);
  assert.equal(sha256(after), sha256(before));
});

test("built Price Index is sitemap-exact and every physical Phase 3 money family links to it", async () => {
  const page = await readFile(new URL("../public/glp-1-price-index/index.html", import.meta.url), "utf8");
  const sitemap = await readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  const graph = JSON.parse(await readFile(new URL("phase3-page-graph.json", DATA)));
  const registry = JSON.parse(await readFile(new URL("program-registry.json", DATA)));
  const exact = `<url><loc>https://glpclinicscout.com/glp-1-price-index/</loc><lastmod>${LATEST_OBSERVED_ON}</lastmod></url>`;
  assert.equal(sitemap.split("https://glpclinicscout.com/glp-1-price-index/").length - 1, 1);
  assert.equal(sitemap.split(exact).length - 1, 1);
  assert.match(page, /data-index-record-id="orderlymeds-semaglutide"/);
  assert.match(page, /\$112 median/);
  assert.match(page, /\$182\.50 median/);
  const routes = ["/providers/", "/self-pay/", "/bulk/", ...graph.brand_pages.map((row) => row.route), ...graph.compounded_pages.map((row) => row.route), ...graph.bulk_pages.map((row) => row.route), ...detailPrograms(registry, graph).map((row) => `/providers/${row.program_id}/`)];
  for (const route of routes) {
    const html = await readFile(new URL(`../public${route}index.html`, import.meta.url), "utf8");
    assert.match(html, /href="\/glp-1-price-index\/"/, route);
  }
});
