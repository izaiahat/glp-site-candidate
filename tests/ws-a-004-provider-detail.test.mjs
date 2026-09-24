import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../src/phase3-page-graph.mjs", import.meta.url), "utf8");
const start = source.indexOf("function renderProviderDetail(");
const end = source.indexOf("function renderSelfPay(", start);
const detail = source.slice(start, end);
assert.equal((detail.match(/return /g) || []).length, 1);
assert.doesNotMatch(detail, /const entry = pricingEntryForProgram/);
console.log(JSON.stringify({ status: "PASS", finding: "F02", check: "unreachable provider-detail implementation absent" }));
