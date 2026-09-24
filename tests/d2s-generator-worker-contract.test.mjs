import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { deriveGoEntriesFromRegistry } from "../src/program-registry.mjs";
import { loadAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import { handleGoRequest } from "../src/worker.mjs";
import { renderGoRuntimeManifestModule } from "../src/go-runtime-manifest.mjs";

// Synthetic authority lives only in this test. No production authority is issued.
const root = new URL("../", import.meta.url);
const registry = JSON.parse(await readFile(new URL("data/program-registry.json", root)));
const ledger = JSON.parse(await readFile(new URL("data/program-content-ledger.json", root)));
const links = loadAffiliateLinkMap("compare");
const id = "jrnys-review";
const hash = createHash("sha256").update("D2s synthetic test selection, not production authority").digest("hex");
const date = new Date().toISOString().slice(0, 10);
const link = links[id];
assert.ok(link?.live);
const base = {
  program_id: id, network: link.network.toLowerCase(),
  tracking_link_sha256: createHash("sha256").update(link.affiliate_href).digest("hex"),
  status: "VERIFIED", promotion_authorized: true, constructor_verified: true,
  advertiser_permission_verified: true, encoding_verified: true, privacy_qa_passed: true,
  redirector_tos_verified: true, redirector_tos_source_url: "https://example.test/terms",
  redirector_tos_verified_as_of: date, operator_selection_receipt_sha256: hash,
};
const riskReceipt = {
  ...base, redirector_tos_verified: false,
  redirector_risk_acceptance: {
    schema: "go-redirector-risk-acceptance-v1", risk_accepted: true,
    scope: "first-party-redirect-and-documented-subids", express_network_permission_proven: false,
    program_id: id, network: link.network.toLowerCase(), tracking_base_url: link.affiliate_href,
    operator_decision_sha256: createHash("sha256").update("synthetic risk decision, not production approval").digest("hex"),
    operator_selection_receipt_sha256: hash, accepted_as_of: date, terms_source_url: "https://example.test/terms",
    limitation: "Synthetic fixture only: silence is not express permission; creative and channel restrictions remain.",
  },
};
const derive = promotion => deriveGoEntriesFromRegistry(registry, "glp-clinic-scout", ledger.programs, links, { programs: promotion ? { [id]: promotion } : {} });
const entry = promotion => derive(promotion).find(p => p.program_id === id);
let externalFetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { externalFetches++; throw new Error("D2s_external_fetch_forbidden"); };
test.after(() => { globalThis.fetch = originalFetch; assert.equal(externalFetches, 0); });

async function probe(program, gate = hash) {
  const db = new DatabaseSync(":memory:");
  try {
    for (const filename of ["001_click_map.sql", "006_affiliati_attribution_join.sql", "007_postback_scoped_identity.sql"]) {
      // The fixture uses real schema sources, never a fabricated INSERT success.
      db.exec(await readFile(new URL(`migrations/${filename}`, root), "utf8"));
    }
    const adapter = { prepare(sql) { return { bind(...values) { return {
      async run() { const r = db.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async all() { return { success: true, results: db.prepare(sql).all(...values) }; },
    }; } }; } };
    const click = "018f2f32-89ab-7def-8123-456789abcdef";
    const request = new Request(`https://glpclinicscout.com${program.route}?s=providers.rv1&v=a&cs_click_id=${click}`, { headers: { "user-agent": "Mozilla/5.0" } });
    const response = await handleGoRequest(request, { GLP_DB: adapter, PROGRAM_MANIFEST: { programs: [program] }, AFFILIATE_RUNTIME_MODE: "production", AFFILIATE_LIVE_GATE: `operator-approved:${gate}`, CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) } }, id);
    return { status: response.status, reason: response.headers.get("x-redirect-reason"), log: response.headers.get("x-attribution-log"), location: response.headers.get("location"), rows: db.prepare("SELECT click_token,network_offer_id,network_account_ref FROM affiliate_click_map").all() };
  } finally { db.close(); }
}

test("D2s receipt-backed generator fields reach the worker and mint in real SQLite", async () => {
  const p = entry(base);
  assert.equal(p.status, "live_operator_approved");
  assert.equal(p.link_mode, "server_redirect");
  assert.equal(p.operator_selection_receipt_sha256, hash);
  assert.equal(p.redirector_tos_source_url, base.redirector_tos_source_url);
  assert.equal(p.redirector_tos_verified_as_of, date);
  const result = await probe(p);
  assert.equal(result.reason, "affiliate-live");
  assert.equal(result.log, "mapped");
  assert.equal(result.rows.length, 1);
  const url = new URL(result.location);
  assert.equal(url.searchParams.get("s1"), "providers.rv1");
  assert.equal(url.searchParams.get("s2"), result.rows[0].click_token);
  assert.equal(result.rows[0].network_account_ref, "15309");
});

for (const key of ["operator_selection_receipt_sha256", "redirector_tos_source_url", "redirector_tos_verified_as_of", "advertiser_permission_verified", "encoding_verified", "privacy_qa_passed", "tracking_link_sha256", "program_id", "network"]) {
  test(`D2s missing ${key} never authorizes or mints`, async () => {
    const receipt = { ...base }; delete receipt[key];
    const p = entry(receipt);
    assert.equal(p.live_link_allowed, false);
    const r = await probe(p);
    assert.equal(r.log, "not-minted"); assert.equal(r.rows.length, 0);
  });
}
for (const [key, value] of [["program_id", "medvi-review"], ["network", "awin"], ["tracking_link_sha256", "f".repeat(64)], ["operator_selection_receipt_sha256", "not-a-hash"], ["redirector_tos_verified_as_of", "2026-02-30"], ["redirector_tos_verified_as_of", "2099-01-01"], ["redirector_tos_source_url", "https://user:password@example.test/terms"], ["constructor_verified", false], ["status", "WITHHELD"]]) {
  test(`D2s invalid ${key} fails closed`, () => { assert.equal(entry({ ...base, [key]: value }).live_link_allowed, false); });
}
test("D2s entry with no receipt cannot mint", async () => { const p = entry(null); assert.equal(p.live_link_allowed, false); assert.equal((await probe(p)).rows.length, 0); });
test("D2s wrong environment selection gate cannot mint", async () => { const r = await probe(entry(base), "f".repeat(64)); assert.equal(r.log, "not-minted"); assert.equal(r.rows.length, 0); });
test("D2s explicit risk acceptance mints without falsely claiming express ToS permission", async () => {
  const p = entry(riskReceipt);
  assert.equal(p.live_link_allowed, true); assert.equal(p.redirector_tos_verified, false);
  assert.equal(p.redirector_tos_verified_as_of, undefined);
  assert.deepEqual(p.redirector_risk_acceptance, riskReceipt.redirector_risk_acceptance);
  const result = await probe(p); assert.equal(result.log, "mapped"); assert.equal(result.rows.length, 1);
});
for (const key of Object.keys(riskReceipt.redirector_risk_acceptance)) {
  test(`D2s incomplete risk ${key} is refused by producer and worker`, async () => {
    const receipt = structuredClone(riskReceipt); delete receipt.redirector_risk_acceptance[key];
    assert.equal(entry(receipt).live_link_allowed, false);
    const tampered = entry(riskReceipt); delete tampered.redirector_risk_acceptance[key];
    const r = await probe(tampered); assert.equal(r.log, "not-minted"); assert.equal(r.rows.length, 0);
  });
}
test("D2s risk receipt cannot transfer across programs or links", async () => {
  for (const [key, value] of [["program_id", "medvi-review"], ["network", "awin"], ["tracking_base_url", "https://example.test/unbound"], ["operator_selection_receipt_sha256", "f".repeat(64)]]) {
    const receipt = structuredClone(riskReceipt); receipt.redirector_risk_acceptance[key] = value;
    assert.equal(entry(receipt).live_link_allowed, false);
    const tampered = entry(riskReceipt); tampered.redirector_risk_acceptance[key] = value;
    assert.equal((await probe(tampered)).rows.length, 0);
  }
});
test("D2s JSON and module preserve identical generated entries", async () => {
  const manifest = { schema: "affiliate-worker-staging-v3-registry", programs: derive(base) };
  const source = renderGoRuntimeManifestModule(manifest);
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  for (const p of manifest.programs) assert.deepEqual(module.GO_RUNTIME_MANIFEST.programs[p.route_slug || p.program_id], p);
});
