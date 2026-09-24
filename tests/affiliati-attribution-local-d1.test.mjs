import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { handleAffiliatiPostback } from "../functions/api/postback/affiliati.js";
import { handleGoRequest } from "../src/worker.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const KEY = "synthetic-affiliati-local-d1-key";
const CLICK_ID = "018f2f32-89ab-7def-8123-456789abcdef";

function d1(database) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              const result = database.prepare(sql).run(...params);
              return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
            },
            async all() {
              return { success: true, results: database.prepare(sql).all(...params) };
            },
          };
        },
      };
    },
  };
}

function callback({ clickId = CLICK_ID, offerId = "42896", conversionId = "local-d1-conversion-1", payout = "300.00" } = {}) {
  const url = new URL("https://glpclinicscout.com/api/postback/affiliati");
  url.searchParams.set("key", KEY);
  url.searchParams.set("subid", clickId);
  url.searchParams.set("placement", "providers.fv2s1");
  url.searchParams.set("click_id", clickId);
  url.searchParams.set("conversion_id", conversionId);
  url.searchParams.set("payout", payout);
  url.searchParams.set("offer_id", offerId);
  url.searchParams.set("event", "conversion");
  return new Request(url);
}

test("local D1 proves UUIDv7 /go ownership joins Affiliati revenue and rejects unowned callbacks", async () => {
  const databasePath = path.join(tmpdir(), `glp-affiliati-join-${randomUUID()}.sqlite3`);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(await readFile(path.join(ROOT, "migrations/001_click_map.sql"), "utf8"));
    database.exec(await readFile(path.join(ROOT, "migrations/006_affiliati_attribution_join.sql"), "utf8"));
    database.exec(await readFile(path.join(ROOT, "migrations/007_postback_scoped_identity.sql"), "utf8"));
    const receipt = "a".repeat(64);
    const program = {
      program_id: "jrnys",
      status: "live_operator_approved",
      link_mode: "server_redirect",
      go_route_wired: true,
      live_link_allowed: true,
      promotion_authorized: true,
      operator_selection_receipt_sha256: receipt,
      allowed_page_roles: ["providers"],
      allowed_positions: ["fv2s1"],
      allowed_variants: ["a"],
      constructor_verified: true,
      advertiser_permission_verified: true,
      encoding_verified: true,
      privacy_qa_passed: true,
      redirector_tos_verified: true,
      redirector_tos_source_url: "https://example.com/terms",
      redirector_tos_verified_as_of: "2026-08-30",
      official_fallback: "https://jrnys.com/",
      allowed_fallback_hosts: ["jrnys.com"],
      network: "affiliati",
      network_offer_id: "42896",
      tracking: {
        base_url: "https://example.affiliati.test/?offer_id=42896&aff_id=15309",
        allowed_tracking_hosts: ["example.affiliati.test"],
        generated_link_readback_verified: true,
      },
    };
    const env = {
      AFFILIATI_POSTBACK_KEY: KEY,
      GLP_DB: d1(database),
      AFFILIATE_RUNTIME_MODE: "production",
      AFFILIATE_LIVE_GATE: `operator-approved:${receipt}`,
      ATTRIBUTION_MONTH: "202608",
      CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) },
      PROGRAM_MANIFEST: { internal_fallback: "https://glpclinicscout.com/providers/", programs: [program] },
    };
    const outbound = await handleGoRequest(new Request(
      `https://glpclinicscout.com/go/jrnys?s=providers.fv2s1&v=a&cs_click_id=${CLICK_ID}`,
      { headers: { "user-agent": "Mozilla/5.0", referer: "https://glpclinicscout.com/providers/" } },
    ), env, "jrnys");
    assert.equal(outbound.status, 307);
    assert.equal(outbound.headers.get("x-attribution-log"), "mapped");
    const destination = new URL(outbound.headers.get("location"));
    // AFFILIATI_S1_S2_CONTRACT_V1: /go was called with s=providers.fv2s1, so
    // s1 carries that placement code and s2 carries the click id.
    assert.equal(destination.searchParams.get("s1"), "providers.fv2s1");
    assert.equal(destination.searchParams.get("s2"), CLICK_ID);
    assert.notEqual(destination.searchParams.get("s1"), destination.searchParams.get("s2"));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM affiliate_click_map WHERE click_token=? AND network='affiliati' AND network_offer_id='42896'").get(CLICK_ID).count, 1);

    const first = await handleAffiliatiPostback(callback(), env);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { status: "RECORDED", conversion_id: "local-d1-conversion-1", inserted: 1 });

    const joined = database.prepare(`SELECT r.program_id,r.cs_click_id,r.conversion_id,r.event_status,c.network,c.network_offer_id
      FROM analytics_revenue_ledger_v1 r
      JOIN affiliate_click_map c ON c.click_token=r.cs_click_id
      WHERE r.network='affiliati' AND r.conversion_id=?`).get("local-d1-conversion-1");
    assert.deepEqual({ ...joined }, {
      program_id: "jrnys",
      cs_click_id: CLICK_ID,
      conversion_id: "local-d1-conversion-1",
      event_status: "unclassified",
      network: "affiliati",
      network_offer_id: "42896",
    });

    const replay = await handleAffiliatiPostback(callback(), env);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { status: "DUPLICATE", conversion_id: "local-d1-conversion-1", inserted: 0 });

    const conflictingReplay = await handleAffiliatiPostback(callback({ payout: "301.00" }), env);
    assert.equal(conflictingReplay.status, 409);
    assert.equal((await conflictingReplay.json()).reason, "idempotency_identity_conflict");

    const wrongOffer = await handleAffiliatiPostback(callback({ offerId: "40044", conversionId: "wrong-offer" }), env);
    assert.equal(wrongOffer.status, 409);
    assert.equal((await wrongOffer.json()).reason, "click_identity_not_owned");

    const unknownId = "018f2f32-89ab-7def-9234-456789abcdef";
    const unknown = await handleAffiliatiPostback(callback({ clickId: unknownId, conversionId: "unknown-click" }), env);
    assert.equal(unknown.status, 409);
    assert.equal((await unknown.json()).reason, "click_identity_not_owned");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM analytics_revenue_ledger_v1").get().count, 1);
  } finally {
    database.close();
    await rm(databasePath, { force: true });
  }
});

test("postback fails closed when the owned-click table is unavailable", async () => {
  const databasePath = path.join(tmpdir(), `glp-affiliati-missing-click-${randomUUID()}.sqlite3`);
  const database = new DatabaseSync(databasePath);
  try {
    const response = await handleAffiliatiPostback(callback(), {
      AFFILIATI_POSTBACK_KEY: KEY,
      GLP_DB: d1(database),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "click_ledger_unavailable");
  } finally {
    database.close();
    await rm(databasePath, { force: true });
  }
});
