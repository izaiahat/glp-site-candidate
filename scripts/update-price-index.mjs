#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frozenPriceLedger } from "../src/price-index-nonprice-binding.mjs";
import {
  migratePriceIndexHistoryV1ToV2,
  normalizePriceIndexSourceHashes,
  snapshotPriceIndexRows,
  validatePriceIndexInputs,
} from "../src/price-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const FILES = {
  tracker: path.join(DATA, "price-tracker.json"),
  study: path.join(DATA, "original-data-study.json"),
  programRegistry: path.join(DATA, "program-registry.json"),
  contentLedger: path.join(DATA, "program-content-ledger.json"),
  frozenContentLedger: path.join(DATA, "price-index-frozen-content-ledger.json"),
  nonpriceBinding: path.join(DATA, "price-index-nonprice-binding.json"),
};

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const observedOn = argument("--observed-on") || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || observedOn > new Date().toISOString().slice(0, 10)) throw new Error("price_index_observed_on_invalid");

const bytes = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([key, file]) => [key, await readFile(file)])));
const parsed = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, JSON.parse(value)]));
// The observer consumes the same authenticated whole-ledger oracle as the
// renderer. Never append changed live copy as a synthetic price observation.
const priceLedger = frozenPriceLedger(bytes.contentLedger, bytes.frozenContentLedger, parsed.nonpriceBinding);
parsed.contentLedger = priceLedger.ledger;
const sourceHashes = normalizePriceIndexSourceHashes(parsed.programRegistry, {
  original_data_study_sha256: sha256(bytes.study),
  program_content_ledger_sha256: priceLedger.frozen_sha256,
  program_registry_sha256: sha256(bytes.programRegistry),
});
const migration = migratePriceIndexHistoryV1ToV2(parsed.tracker);
parsed.tracker = migration.tracker;
const config = parsed.tracker.price_index;
if (!config || !Array.isArray(config.records) || !Array.isArray(config.observations)) throw new Error("price_index_config_missing");
const ledgerById = new Map(parsed.contentLedger.programs.map((program) => [program.program_id, program]));
const sourceDates = config.records.map((record) => ledgerById.get(record.provider_id)?.research_first_month_price?.verified_as_of);
if (sourceDates.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value || ""))) throw new Error("price_index_record_source_date_missing");
const records = snapshotPriceIndexRows(config.records);
const observation = {
  observed_on: observedOn,
  data_as_of: [...sourceDates].sort().at(-1),
  source_files: sourceHashes,
  record_set_sha256: sha256(canonical(records)),
  records,
};
const existing = config.observations.find((item) => item.observed_on === observedOn);
let status;
if (existing) {
  if (canonical(existing) !== canonical(observation)) throw new Error("price_index_same_day_observation_conflict");
  status = migration.migrated ? "MIGRATED_V1_TO_V2_ALREADY_OBSERVED" : "UNCHANGED_ALREADY_OBSERVED";
  if (migration.migrated) {
    const output = JSON.stringify(parsed.tracker, null, 2) + "\n";
    const temporary = `${FILES.tracker}.tmp-${process.pid}`;
    await writeFile(temporary, output, { mode: 0o644 });
    await rename(temporary, FILES.tracker);
    await chmod(FILES.tracker, 0o644);
  }
} else {
  const latest = config.observations.at(-1);
  if (latest && latest.observed_on >= observedOn) throw new Error("price_index_observation_order_invalid");
  config.observations.push(observation);
  const output = JSON.stringify(parsed.tracker, null, 2) + "\n";
  const temporary = `${FILES.tracker}.tmp-${process.pid}`;
  await writeFile(temporary, output, { mode: 0o644 });
  await rename(temporary, FILES.tracker);
  await chmod(FILES.tracker, 0o644);
  status = "APPENDED_OBSERVED_WEEK";
}

const result = validatePriceIndexInputs({
  tracker: parsed.tracker,
  study: parsed.study,
  programRegistry: parsed.programRegistry,
  contentLedger: parsed.contentLedger,
  sourceHashes,
}, { now: `${observedOn}T23:59:59Z` });
console.log(JSON.stringify({
  status,
  observed_on: observedOn,
  data_as_of: observation.data_as_of,
  observation_count: result.observation_count,
  live_provider_count: result.live_provider_count,
  indexed_provider_count: result.indexed_provider_count,
  record_count: result.record_count,
  record_set_sha256: observation.record_set_sha256,
  source_files: sourceHashes,
}, null, 2));
