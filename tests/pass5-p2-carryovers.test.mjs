import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onRequest as providersMiddleware } from "../functions/providers/_middleware.js";
import { isValidInternalLinkPath } from "../src/blog-system.mjs";
import { isTallyGatedRoute } from "../src/surface-tallies.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

test("query-bearing provider comparison routes emit a noindex response header", async () => {
  const response = await providersMiddleware({
    request: new Request("https://glpclinicscout.com/providers/?drug=SEMAGLUTIDE&sort=cheapest"),
    next: async () => new Response("comparison", { headers: { "content-type": "text/html" } }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, follow");
  assert.equal(await response.text(), "comparison");
});

test("canonical provider directory remains indexable by middleware", async () => {
  const original = new Response("directory", { headers: { "content-type": "text/html" } });
  const response = await providersMiddleware({
    request: new Request("https://glpclinicscout.com/providers/"),
    next: async () => original,
  });
  assert.equal(response, original);
  assert.equal(response.headers.get("x-robots-tag"), null);
});

test("provider-count validation includes editorial guide routes", () => {
  assert.equal(isTallyGatedRoute("guides/index.html"), true);
  assert.equal(isTallyGatedRoute("guides/online-glp-1-intake-to-pharmacy-fulfillment/index.html"), true);
});

test("editorial internal-link validation accepts bounded comparison query contracts only", () => {
  assert.equal(isValidInternalLinkPath("/providers/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest"), true);
  assert.equal(isValidInternalLinkPath("/guides/what-is-glp-1/"), true);
  assert.equal(isValidInternalLinkPath("https://example.com/providers/"), false);
  assert.equal(isValidInternalLinkPath("/providers/?next=https://example.com"), false);
});

test("late asset cleanup accepts content-hashed analytics runtimes", () => {
  const source = read("scripts/wave2-repairs.mjs");
  assert.ok(source.includes("analytics(?:\\.[a-f0-9]{8,})?\\.js"));
  assert.match(source, /hasAnalyticsRuntime/);
});

test("operator-mapped destinations preserve treatment, term, and cheapest-sort intent", () => {
  const build = read("scripts/build-staging.mjs");
  const graph = JSON.parse(read("data/phase3-page-graph.json"));
  const bulk = graph.bulk_intents.map((row) => row.href);
  const expected = [
    "/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest",
    "/3-month/?drug=TIRZEPATIDE&form=COMPOUNDED&plan=3&sort=cheapest",
    "/6-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&duration=6&sort=cheapest",
    "/6-month/?drug=TIRZEPATIDE&form=COMPOUNDED&duration=6&sort=cheapest",
  ];
  assert.deepEqual(bulk, expected);
  for (const destination of expected) assert.ok(build.includes(destination.replaceAll("&", "&amp;")) || build.includes(destination));
});

test("visible stale provider-count claim is tokenized and uses the canonical sorted route", () => {
  const batch = read("data/blog/content-batch.json");
  assert.doesNotMatch(batch, /Compare 33 providers' published pricing/);
  assert.match(batch, /Compare \{\{LIVE_PROVIDER_COUNT\}\} providers' published pricing/);
  assert.match(batch, /"path": "\/providers\/\?sort=cheapest"/);
});

test("quiz and compact matcher preserve canonical Wegovy Pill and cheapest-sort contracts", () => {
  const config = JSON.parse(read("data/quiz-config.json"));
  const compact = config.phase4_flow.compact_matcher.medication_options.find((row) => row.value === "WEGOVY_PILL");
  const full = config.phase4_flow.intent_options.find((row) => row.value === "WEGOVY_PILL");
  assert.deepEqual({ route: compact.route, drug: compact.drug, form: compact.form }, {
    route: "/wegovy-pill/",
    drug: "WEGOVY_PILL",
    form: "COMPOUNDED",
  });
  assert.deepEqual({ route: full.route, form: full.form }, { route: "/wegovy-pill/", form: "COMPOUNDED" });
  assert.match(read("assets/matches-customized.js"), /sort: "cheapest"/);
  assert.match(read("assets/quiz-page.js"), /sort: "cheapest"/);
});

test("motion transport keeps conservative Lenis tuning", () => {
  const motion = read("assets/motion.js");
  assert.match(motion, /lerp: 0\.1,/);
  assert.match(motion, /wheelMultiplier: 0\.9,/);
});

test("motion transport self-hosts the operator-pinned Lenis 1.3.11 distribution", () => {
  const source = read("assets/vendor/lenis/lenis.min.js");
  const served = read("public/assets/vendor/lenis/lenis.min.js");
  const hash = createHash("sha256").update(source).digest("hex");
  assert.equal(hash, "804047c1d9399736983bb38d5a841f96feb743f46a5090a252ede2ca1bfe1f19");
  assert.equal(served, source);
  assert.match(read("assets/vendor/THIRD-PARTY-NOTICES.md"), /## Lenis 1\.3\.11/);
});
