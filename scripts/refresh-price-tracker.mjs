import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { refreshPriceTrackerRecords } from "../src/price-tracker.mjs";

const TRACKER = fileURLToPath(new URL("../data/price-tracker.json", import.meta.url));

export async function refreshPriceTracker() {
  const before = await readFile(TRACKER, "utf8");
  const original = JSON.parse(before);
  const refreshed = refreshPriceTrackerRecords(original);
  const changed = JSON.stringify(original.records) !== JSON.stringify(refreshed.records);
  if (changed) {
    const temporary = `${TRACKER}.tmp-${process.pid}`;
    await writeFile(temporary, JSON.stringify(refreshed, null, 2) + "\n", { mode: 0o644 });
    await rename(temporary, TRACKER);
  }
  const actual = JSON.parse(await readFile(TRACKER, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(refreshed)) throw new Error("tracker_refresh_readback_mismatch");
  return {
    status: changed ? "REFRESHED_ACCEPTED_CAPTURES" : "UNCHANGED_ACCEPTED_CAPTURES",
    records: actual.records.map(({ id, source_capture_id, source_scrape_id, checked_at, quote_sha256 }) =>
      ({ id, source_capture_id, source_scrape_id, checked_at, quote_sha256 })),
  };
}
