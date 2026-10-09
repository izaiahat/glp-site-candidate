import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relationshipDenials } from "../src/affiliate-relationship-sync.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const registry = JSON.parse(read("../data/program-registry.json"));
const economics = JSON.parse(read("../data/funnel-v2-economics.json"));

test("paused/denied relationship leaves the R11 approved commerce set (no CTA required)", () => {
  const denied = new Set(relationshipDenials(registry).flatMap((d) => [d.program_id, d.render_id]));
  // Source of truth: the same sole-writer denial list PR42 used.
  assert.ok(denied.has("trimi-glp-1"), "paused Trimi is promotion_denied");
  const approved = economics.paid_search_provider_order.map((r) => r.program_id).filter((id) => !denied.has(id));
  assert.ok(!approved.includes("trimi-glp-1"));
  assert.ok(approved.length > 0, "remaining commercial order still renders");
  // The R11 funnel filters with exactly that set before enforcing the affiliate_click invariant.
  const src = read("../src/phase3-page-graph.mjs");
  const at = src.indexOf("const deniedIds = new Set(relationshipDenials(registry)");
  assert.ok(at > 0 && at < src.indexOf("approved_commerce_missing"), "denials applied before the commerce check");
  assert.match(src, /!deniedIds\.has\(item\.row\.program_id\)/);
});
