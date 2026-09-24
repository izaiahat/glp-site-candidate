import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { handleAffiliatiPostback } from "../functions/api/postback/affiliati.js";

const CLICK = "018f2f32-89ab-7def-8123-456789abcdef";
const OTHER = "018f2f32-89ab-7def-8123-456789abcdea";
const KEY = "d2w-local-template-test-only";
async function fixture(t, { program = "jrnys-review", offer = "42896" } = {}) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const name of ["001_click_map.sql", "006_affiliati_attribution_join.sql", "007_postback_scoped_identity.sql"]) {
    sql.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  sql.prepare("INSERT INTO affiliate_click_map (click_token,event_id,page_slug,link_position,program_id,merchant,variant,yyyymm,created_at,ivt_status,ua_class,referrer_class,analytics_consent,ga4_status,network,network_offer_id,network_account_ref,is_test,probe_ref) VALUES (?,'D2w-test','providers','rv1',?,'fixture','a','202609','2026-09-10T00:00:00Z','allowed','browser','internal','denied','suppressed','affiliati',?,'15309',1,'D2w-LOCAL-ONLY')").run(CLICK, program, offer);
  let queries = 0;
  const db = { prepare(query) { queries++; return { bind(...args) { return {
    async all() { return { results: sql.prepare(query).all(...args) }; },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; },
  }; } }; } };
  const invoke = async (changes = {}, duplicates = []) => {
    const url = new URL("https://receiver.invalid/api/postback/affiliati");
    const params = { key: KEY, subid: CLICK, click_id: CLICK, placement: "providers.rv1", conversion_id: "D2w-local-test", payout: "", offer_id: offer, event: "conversion", is_test: "false", ...changes };
    for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
    for (const [key, value] of duplicates) url.searchParams.append(key, value);
    const response = await handleAffiliatiPostback(new Request(url), { AFFILIATI_POSTBACK_KEY: KEY, GLP_DB: db });
    return { status: response.status, body: await response.json() };
  };
  return { sql, invoke, queries: () => queries, rows: () => sql.prepare("SELECT * FROM analytics_revenue_ledger_v1").all() };
}

for (const [program, offer] of [["direct-meds", "40044"], ["jrnys-review", "42896"], ["medvi-review", "43194"]]) {
  test(`D2w registered subid-only TEST callback joins ${program} and keeps placement`, async t => {
    const f = await fixture(t, { program, offer });
    assert.deepEqual(await f.invoke({ click_id: null }), { status: 200, body: { status: "RECORDED", conversion_id: "D2w-local-test", inserted: 1 } });
    const joined = f.sql.prepare("SELECT r.cs_click_id,c.click_token,r.program_id,r.event_status,r.commission_minor,r.attributes_json FROM analytics_revenue_ledger_v1 r JOIN affiliate_click_map c ON c.click_token=r.cs_click_id").get();
    assert.equal(joined.cs_click_id, CLICK);
    assert.equal(joined.click_token, CLICK);
    assert.equal(joined.program_id, program);
    assert.equal(joined.event_status, "test_recorded");
    assert.equal(joined.commission_minor, null);
    assert.equal(JSON.parse(joined.attributes_json).placement, "providers.rv1");
    assert.equal(JSON.parse(joined.attributes_json).is_test, true);
    assert.equal((await f.invoke()).body.status, "DUPLICATE");
    assert.equal((await f.invoke({ placement: "cost.rv1" })).status, 409);
    assert.equal(f.rows().length, 1);
  });
}

for (const [name, changes, reason] of [
  ["missing primary", { subid: null }, "required_field_missing:subid"],
  ["placement is not click", { subid: "providers.rv1", click_id: null }, "cs_click_id_invalid"],
  ["uppercase", { subid: CLICK.toUpperCase(), click_id: null }, "cs_click_id_invalid"],
  ["compatibility conflict", { click_id: OTHER }, "click_id_roundtrip_mismatch"],
  ["placement controls", { placement: "providers.\nrv1" }, "identity_field_invalid:placement"],
]) test(`D2w ${name} rejects before D1`, async t => {
  const f = await fixture(t);
  const result = await f.invoke(changes);
  assert.equal(result.status, 400);
  assert.equal(result.body.reason, reason);
  assert.equal(f.queries(), 0);
  assert.equal(f.rows().length, 0);
});

for (const field of ["subid", "click_id", "placement"]) test(`D2w duplicate ${field} is ambiguous and rejected`, async t => {
  const f = await fixture(t);
  assert.equal((await f.invoke({}, [[field, CLICK]])).status, 400);
  assert.equal(f.queries(), 0);
});

test("D2w invalid authentication still precedes template parsing and D1", async t => {
  const f = await fixture(t);
  assert.equal((await f.invoke({ key: "wrong", subid: null })).status, 403);
  assert.equal(f.queries(), 0);
});
