import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { handleAffiliatiPostback } from "../functions/api/postback/affiliati.js";
import { AFFILIATI_OFFERS } from "../src/affiliati-attribution.mjs";

const KEY = "synthetic-affiliati-test-key";
const CLICK_ID = "018f2f32-89ab-7def-8123-456789abcdef";
const BASE = "https://glpclinicscout.com/api/postback/affiliati";

function dbFixture({ ownedClicks = [{ click_token: CLICK_ID, program_id: "jrnys", network: "affiliati", network_offer_id: "42896", network_account_ref: "15309" }] } = {}) {
  const revenueRows = [];
  const insertBinds = [];
  return {
    insertBinds,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (!sql.startsWith("INSERT INTO analytics_revenue_ledger_v1")) throw new Error("unexpected_run");
              insertBinds.push(args);
              if (revenueRows.some((row) => row.network === args[2] && row.network_account_ref === args[3] && row.program_id === args[4] && row.conversion_id === args[7] && row.event_type === args[9] && row.event_status === args[10])) throw new Error("unique_constraint");
              revenueRows.push({
                revenue_event_id: args[1],
                network: args[2],
                network_account_ref: args[3],
                program_id: args[4],
                cs_click_id: args[6],
                conversion_id: args[7],
                event_type: args[9],
                event_status: args[10],
                commission_minor: args[13],
                raw_row_sha256: args[17],
                attributes_json: args[18],
              });
              return { meta: { changes: 1 } };
            },
            async all() {
              if (sql.startsWith("SELECT click_token")) {
                return { results: ownedClicks.filter((click) => click.click_token === args[0]) };
              }
              if (sql.startsWith("SELECT revenue_event_id")) {
                return { results: revenueRows.filter((row) => row.network === args[0] && row.network_account_ref === args[1] && row.program_id === args[2] && row.conversion_id === args[3] && row.event_type === args[4]) };
              }
              throw new Error("unexpected_all");
            },
          };
        },
      };
    },
  };
}

function url({ key = KEY, s1 = CLICK_ID, s2 = CLICK_ID, conversion = "synthetic-affiliati-1", offer = "42896", event = "conversion" } = {}) {
  const value = new URL(BASE);
  if (key !== null) value.searchParams.set("key", key);
  value.searchParams.set("subid", s1);
  if (s2 !== null) value.searchParams.set("click_id", s2);
  value.searchParams.set("conversion_id", conversion);
  value.searchParams.set("payout", "");
  value.searchParams.set("offer_id", offer);
  value.searchParams.set("event", event);
  return value;
}

async function invoke(options, db = dbFixture()) {
  const response = await handleAffiliatiPostback(new Request(url(options)), {
    AFFILIATI_POSTBACK_KEY: KEY,
    GLP_DB: db,
  });
  return { response, body: await response.json(), db };
}

test("receiver rejects missing and wrong static keys", async () => {
  assert.equal((await invoke({ key: null })).response.status, 403);
  assert.equal((await invoke({ key: "wrong" })).response.status, 403);
});

test("receiver joins registered subid to one owned click, accepts empty test payout, and deduplicates replay", async () => {
  const db = dbFixture();
  const first = await invoke({}, db);
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body, { status: "RECORDED", conversion_id: "synthetic-affiliati-1", inserted: 1 });
  assert.equal(db.insertBinds.length, 1);
  assert.equal(db.insertBinds[0][4], "jrnys");
  assert.equal(db.insertBinds[0][5], null);
  assert.equal(db.insertBinds[0][6], CLICK_ID);
  assert.equal(db.insertBinds[0][13], null);
  assert.equal(JSON.parse(db.insertBinds[0][18]).owned_click_join, true);

  const replay = await invoke({}, db);
  assert.equal(replay.response.status, 200);
  assert.deepEqual(replay.body, { status: "DUPLICATE", conversion_id: "synthetic-affiliati-1", inserted: 0 });
});

for (const [offer, programId] of [["42896", "jrnys"], ["43194", "medvi"]]) {
  for (const [payout, expectedMinor] of [
    ["", null],
    ["0", 0],
    ["0.0", 0],
    ["0.00", 0],
    ["0.000", 0],
    ["0.0000", 0],
    ["300.0000", 30000],
    ["3.1", 310],
    ["3.10", 310],
    ["3.1000", 310],
    ["0.0100", 1],
    [" $3.1000 ", 310],
    ["2147483647.0000", 214748364700],
  ]) {
    test(`receiver records ${programId} TEST payout ${JSON.stringify(payout)} as ${expectedMinor} minor units`, async () => {
      const db = dbFixture({ ownedClicks: [{
        click_token: CLICK_ID,
        program_id: programId,
        network: "affiliati",
        network_offer_id: offer,
        network_account_ref: "15309",
        is_test: 1,
      }] });
      const callback = url({ offer });
      callback.searchParams.set("payout", payout);
      callback.searchParams.set("is_test", "false");
      const env = { AFFILIATI_POSTBACK_KEY: KEY, GLP_DB: db };
      const response = await handleAffiliatiPostback(new Request(callback), env);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "RECORDED", conversion_id: "synthetic-affiliati-1", inserted: 1 });
      assert.equal(db.insertBinds.length, 1);
      assert.equal(db.insertBinds[0][4], programId);
      assert.equal(db.insertBinds[0][6], CLICK_ID);
      assert.equal(db.insertBinds[0][10], "test_recorded");
      assert.equal(db.insertBinds[0][13], expectedMinor);
      const attributes = JSON.parse(db.insertBinds[0][18]);
      assert.equal(attributes.is_test, true);
      assert.equal(attributes.classification, "TEST");
      assert.equal(attributes.offer_id, offer);
      assert.equal(attributes.owned_click_join, true);

      if (payout === "0.0000") callback.searchParams.set("payout", "0.00");
      const replay = await handleAffiliatiPostback(new Request(callback), env);
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), { status: "DUPLICATE", conversion_id: "synthetic-affiliati-1", inserted: 0 });
      assert.equal(db.insertBinds.length, 1);
    });
  }
}

for (const payout of [
  "0.005",
  "0.0050",
  "0.0001",
  "3.1010",
  "0.00000",
  "300.00000",
  "2147483647.0100",
  "-1.00",
  "1e2",
  "NaN",
  "Infinity",
  "1.",
]) {
  test(`receiver rejects invalid payout ${JSON.stringify(payout)} without a revenue write`, async () => {
    const db = dbFixture();
    const callback = url();
    callback.searchParams.set("payout", payout);
    const response = await handleAffiliatiPostback(new Request(callback), { AFFILIATI_POSTBACK_KEY: KEY, GLP_DB: db });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { status: "INVALID", reason: "payout_invalid" });
    assert.equal(db.insertBinds.length, 0);
  });
}

test("receiver fails closed when click_id disagrees with authoritative subid", async () => {
  const result = await invoke({ s2: "different-click-id" });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.reason, "click_id_roundtrip_mismatch");
});

test("receiver requires a strict lowercase UUIDv7 callback identity", async () => {
  const uppercase = CLICK_ID.toUpperCase();
  const result = await invoke({ s1: uppercase, s2: uppercase });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.reason, "cs_click_id_invalid");
  assert.equal(result.db.insertBinds.length, 0);
});

test("receiver rejects unowned or mismatched click identities before revenue write", async () => {
  const unknown = await invoke({}, dbFixture({ ownedClicks: [] }));
  assert.equal(unknown.response.status, 409);
  assert.equal(unknown.body.reason, "click_identity_not_owned");
  assert.equal(unknown.db.insertBinds.length, 0);

  const mismatch = await invoke({}, dbFixture({ ownedClicks: [{ click_token: CLICK_ID, program_id: "direct-meds", network: "affiliati", network_offer_id: "40044" }] }));
  assert.equal(mismatch.response.status, 409);
  assert.equal(mismatch.db.insertBinds.length, 0);

  const wrongNetwork = await invoke({}, dbFixture({ ownedClicks: [{ click_token: CLICK_ID, program_id: "jrnys", network: "katalys", network_offer_id: "42896" }] }));
  assert.equal(wrongNetwork.response.status, 409);
  assert.equal(wrongNetwork.db.insertBinds.length, 0);
});

test("receiver rejects a conflicting replay instead of hiding it behind idempotency", async () => {
  const db = dbFixture();
  assert.equal((await invoke({}, db)).response.status, 200);
  const changedPayoutUrl = url();
  changedPayoutUrl.searchParams.set("payout", "1.00");
  const response = await handleAffiliatiPostback(new Request(changedPayoutUrl), { AFFILIATI_POSTBACK_KEY: KEY, GLP_DB: db });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "idempotency_identity_conflict");
  assert.equal(db.insertBinds.length, 1);
});

test("receiver rejects unknown offers and non-conversion events before D1 access", async () => {
  assert.equal((await invoke({ offer: "99999" })).body.reason, "offer_not_governed");
  assert.equal((await invoke({ event: "lead" })).body.reason, "event_invalid");
});

test("all three offers preserve outbound s1 placement/s2 click and registered inbound subid", async () => {
  const contract = JSON.parse(await readFile(new URL("../data/affiliati-postback-contract.json", import.meta.url), "utf8"));
  assert.deepEqual(contract.offers.map((row) => ({ offer_id: row.offer_id, provider: row.provider, campaign_id: row.campaign_id })), AFFILIATI_OFFERS);
  assert.equal(contract.identity_contract.s1, "placement; not conversion identity");
  assert.match(contract.identity_contract.s2, /compatibility duplicate/);
  assert.equal(contract.parameter_map.subid.macro, "#s2#");
  assert.equal(contract.parameter_map.subid.required, true);
  assert.equal(contract.parameter_map.click_id.required, false);
  assert.equal(contract.parameter_map.placement.macro, "#s1#");
  assert.equal(contract.persistence.click_table, "affiliate_click_map");
  assert.equal(contract.persistence.revenue_table, "analytics_revenue_ledger_v1");
  assert.equal(contract.tracking_links_requested, 0);
  assert.equal(contract.tracking_links_opened, 0);
  assert.equal(contract.tracking_links_clicked, 0);

  const analytics = await readFile(new URL("../assets/analytics.js", import.meta.url), "utf8");
  assert.match(analytics, /\? \[clickId, clickId\]/);
  assert.match(analytics, /anchor\.dataset\.network !== "Affiliati"/);
});
