import { affiliatiOffer, isUuidV7 } from "../../../src/affiliati-attribution.mjs";

const encoder = new TextEncoder();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-robots-tag": "noindex,nofollow,noarchive",
    },
  });
}

async function constantTimeEqual(actual, expected) {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(actual || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected || ""))),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0 && String(actual || "").length === String(expected || "").length;
}

function identity(value, field, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error(`required_field_missing:${field}`);
    return null;
  }
  if (typeof value !== "string" || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`identity_field_invalid:${field}`);
  }
  return value;
}

function payoutMinor(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  // Cake may append zero-only sub-cent digits; keep cents in the capture.
  const match = text.match(/^\$?([0-9]+)(?:\.([0-9]{1,2})0{0,2})?$/u);
  if (!match) throw new Error("payout_invalid");
  const minor = (BigInt(match[1]) * 100n) + BigInt((match[2] || "").padEnd(2, "0"));
  if (minor > 214748364700n) throw new Error("payout_invalid");
  return Number(minor);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readRevenueRows(db, expected) {
  const readback = await db.prepare(
    "SELECT revenue_event_id,network,network_account_ref,program_id,cs_click_id,conversion_id,event_type,event_status," +
    "commission_minor,raw_row_sha256,attributes_json FROM analytics_revenue_ledger_v1 " +
    "WHERE network=? AND network_account_ref=? AND program_id=? AND conversion_id=? AND event_type=? LIMIT 2",
  ).bind("affiliati", expected.accountRef, expected.programId, expected.conversionId, "accepted_conversion").all();
  return readback?.results || [];
}

function revenueRowState(rows, expected) {
  if (rows.length === 0) return "missing";
  if (rows.length !== 1) return "invalid";
  const row = rows[0];
  let attributes;
  try { attributes = JSON.parse(row.attributes_json || "{}"); } catch { return "invalid"; }
  const commissionMinor = row.commission_minor === null || row.commission_minor === undefined
    ? null
    : Number(row.commission_minor);
  return (
    row.revenue_event_id === expected.revenueEventId
    && row.network === "affiliati"
    && row.network_account_ref === expected.accountRef
    && row.program_id === expected.programId
    && row.cs_click_id === expected.clickId
    && row.conversion_id === expected.conversionId
    && row.event_type === "accepted_conversion"
    && row.event_status === expected.eventStatus
    && commissionMinor === expected.payoutMinor
    && row.raw_row_sha256 === expected.rawRowSha256
    && attributes.offer_id === expected.offerId
    && attributes.placement === expected.placement
    && attributes.is_test === expected.isTest
  ) ? "exact" : "conflict";
}

export async function handleAffiliatiPostback(request, env) {
  const expectedKey = String(env.AFFILIATI_POSTBACK_KEY || "");
  if (!expectedKey) return json(503, { status: "HELD", reason: "receiver_not_configured" });

  const url = new URL(request.url);
  if (!(await constantTimeEqual(url.searchParams.get("key"), expectedKey))) {
    return json(403, { status: "FORBIDDEN" });
  }

  let payload;
  try {
    // Registered template: subid=#s2#, click_id=#s2#, placement=#s1#.
    // Duplicate identity parameters cannot silently select different click rows.
    for (const field of ["subid", "click_id", "placement"]) {
      if (url.searchParams.getAll(field).length > 1) throw new Error(`identity_field_ambiguous:${field}`);
    }
    const clickId = identity(url.searchParams.get("subid"), "subid", { required: true });
    const compatibilityClickId = identity(url.searchParams.get("click_id"), "click_id");
    if (compatibilityClickId && compatibilityClickId !== clickId) throw new Error("click_id_roundtrip_mismatch");
    if (!isUuidV7(clickId)) throw new Error("cs_click_id_invalid");
    const placement = identity(url.searchParams.get("placement"), "placement");
    const testFlag = url.searchParams.get("is_test");
    if (testFlag !== null && !["true", "false", "1", "0"].includes(testFlag)) throw new Error("is_test_invalid");
    const offerId = identity(url.searchParams.get("offer_id"), "offer_id", { required: true });
    const offer = affiliatiOffer(offerId);
    if (!offer) throw new Error("offer_not_governed");
    const event = identity(url.searchParams.get("event") || "conversion", "event", { required: true });
    if (event !== "conversion") throw new Error("event_invalid");
    payload = {
      placement,
      clickId,
      requestedTest: testFlag === "true" || testFlag === "1",
      conversionId: identity(url.searchParams.get("conversion_id"), "conversion_id", { required: true }),
      payoutMinor: payoutMinor(url.searchParams.get("payout")),
      offerId,
      offer,
      event,
    };
  } catch (error) {
    return json(400, { status: "INVALID", reason: error.message });
  }

  const db = env.GLP_DB;
  if (!db?.prepare) return json(503, { status: "HELD", reason: "ledger_binding_missing" });
  const accountRef = String(env.AFFILIATI_POSTBACK_ACCOUNT_REF || "15309");
  if (!/^[0-9]{1,20}$/.test(accountRef)) return json(503, { status: "HELD", reason: "account_binding_invalid" });
  const programsByOffer = {
    "40044": ["katalys-1304", "direct-meds"],
    "42896": ["jrnys", "jrnys-review"],
    "43194": ["medvi", "medvi-review"],
  };

  let ownedClick;
  try {
    const ownership = await db.prepare(
      "SELECT click_token,program_id,network,network_offer_id,network_account_ref,is_test,probe_ref FROM affiliate_click_map " +
      "WHERE click_token=? LIMIT 2",
    ).bind(payload.clickId).all();
    const matches = ownership?.results || [];
    if (
      matches.length !== 1
      || matches[0].network !== "affiliati"
      || matches[0].network_offer_id !== payload.offerId
      || matches[0].network_account_ref !== accountRef
      || !programsByOffer[payload.offerId]?.includes(matches[0].program_id)
    ) return json(409, { status: "REJECTED", reason: "click_identity_not_owned" });
    [ownedClick] = matches;
  } catch {
    return json(503, { status: "FAIL_CLOSED", reason: "click_ledger_unavailable" });
  }

  const receivedAt = new Date().toISOString();
  // Callers can label TEST, never upgrade unknown or server-owned TEST to real.
  const isTest = payload.requestedTest || ownedClick.is_test === 1 || Boolean(ownedClick.probe_ref)
    ? true : (ownedClick.is_test === 0 ? false : null);
  const eventStatus = isTest === true ? "test_recorded" : (isTest === false ? "owned_click_recorded" : "unclassified");
  const eventIdentity = {
    schema: "glp-affiliati-postback-identity-v3",
    network: "affiliati",
    network_account_ref: accountRef,
    program_id: ownedClick.program_id,
    conversion_id: payload.conversionId,
    event_type: "accepted_conversion",
  };
  const rawIdentity = {
    network: "affiliati",
    network_account_ref: accountRef,
    program_id: ownedClick.program_id,
    placement: payload.placement,
    is_test: isTest,
    click_id: payload.clickId,
    conversion_id: payload.conversionId,
    payout_minor: payload.payoutMinor,
    offer_id: payload.offerId,
    event: payload.event,
  };
  const revenueEventId = await sha256(canonical(eventIdentity));
  const rawRowSha256 = await sha256(canonical(rawIdentity));
  const attributesJson = canonical({
    receiver_schema: "glp-affiliati-pages-postback-v3",
    source: "affiliati_portal_postback",
    placement: payload.placement,
    is_test: isTest,
    classification: isTest === true ? "TEST" : (isTest === false ? "server_classified_non_test" : "UNKNOWN"),
    probe_ref: ownedClick.probe_ref || null,
    network_account_ref: accountRef,
    offer_id: payload.offerId,
    provider: payload.offer.provider,
    owned_click_join: true,
  });

  const expectedRevenue = {
    revenueEventId,
    accountRef,
    eventStatus,
    placement: payload.placement,
    isTest,
    programId: ownedClick.program_id,
    clickId: payload.clickId,
    conversionId: payload.conversionId,
    payoutMinor: payload.payoutMinor,
    rawRowSha256,
    offerId: payload.offerId,
  };

  try {
    const priorState = revenueRowState(await readRevenueRows(db, expectedRevenue), expectedRevenue);
    if (priorState === "exact") return json(200, { status: "DUPLICATE", conversion_id: payload.conversionId, inserted: 0 });
    if (priorState === "conflict") return json(409, { status: "REJECTED", reason: "idempotency_identity_conflict" });
    if (priorState === "invalid") return json(503, { status: "FAIL_CLOSED", reason: "ledger_readback_invalid" });
  } catch {
    return json(503, { status: "FAIL_CLOSED", reason: "ledger_readback_unavailable" });
  }

  try {
    const inserted = await db.prepare(
      "INSERT INTO analytics_revenue_ledger_v1 " +
      "(ledger_row_id,revenue_event_id,network,network_account_ref,program_id,network_click_id," +
      "cs_click_id,conversion_id,order_ref_hash,event_type,event_status,currency,order_amount_minor," +
      "commission_minor,occurred_at,imported_at,source_file_sha256,raw_row_sha256,attributes_json) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      revenueEventId,
      revenueEventId,
      "affiliati",
      accountRef,
      ownedClick.program_id,
      null,
      payload.clickId,
      payload.conversionId,
      null,
      "accepted_conversion",
      eventStatus,
      "USD",
      null,
      payload.payoutMinor,
      receivedAt,
      receivedAt,
      rawRowSha256,
      rawRowSha256,
      attributesJson,
    ).run();
    if (Number(inserted?.meta?.changes || 0) !== 1) throw new Error("ledger_insert_not_applied");
  } catch {
    try {
      const racedState = revenueRowState(await readRevenueRows(db, expectedRevenue), expectedRevenue);
      if (racedState === "exact") return json(200, { status: "DUPLICATE", conversion_id: payload.conversionId, inserted: 0 });
      if (racedState === "conflict") return json(409, { status: "REJECTED", reason: "idempotency_identity_conflict" });
    } catch { /* preserve the fail-closed write result below */ }
    return json(503, { status: "FAIL_CLOSED", reason: "ledger_write_failed" });
  }

  try {
    const recordedState = revenueRowState(await readRevenueRows(db, expectedRevenue), expectedRevenue);
    if (recordedState !== "exact") return json(503, { status: "FAIL_CLOSED", reason: "ledger_readback_invalid" });
  } catch {
    return json(503, { status: "FAIL_CLOSED", reason: "ledger_readback_unavailable" });
  }
  return json(200, { status: "RECORDED", conversion_id: payload.conversionId, inserted: 1 });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json(405, { status: "METHOD_NOT_ALLOWED" });
  return handleAffiliatiPostback(request, env);
}
