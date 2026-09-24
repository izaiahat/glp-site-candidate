import test from "node:test";
import assert from "node:assert/strict";
import { activeCouponMap, renderCouponChip, validateCouponFeed } from "../src/coupon-offers.mjs";

const sample = () => ({
  schema: "glp-coupon-offers-v1",
  updated_at: "2026-08-22T00:00:00Z",
  source_contract: { write_owner: "affiliate-machines", consumers: ["site-build"], max_age_days: 45, status_values: ["VERIFIED", "HELD"] },
  offers: [{ program_id: "provider-one", network: "maxbounty", network_offer_id: "991", status: "VERIFIED", code: "SAVE25", benefit_copy: "$25 off", source_url: "https://example.com/terms", verified_at: "2026-08-21", expires_at: null }],
});

test("coupon feed is network-neutral, strict, and machine-owned", () => {
  assert.equal(validateCouponFeed(sample()), true);
  const xentraffic = sample(); xentraffic.offers[0].network = "xentraffic";
  assert.equal(validateCouponFeed(xentraffic), true);
  const extra = sample(); extra.offers[0].invented = true;
  assert.throws(() => validateCouponFeed(extra), /coupon_offer_keys_invalid/);
});

test("only fresh verified coupons become reader-visible", () => {
  assert.equal(activeCouponMap(sample(), "2026-08-22T12:00:00Z")["provider-one"].code, "SAVE25");
  assert.deepEqual(activeCouponMap(sample(), "2026-10-20T12:00:00Z"), {});
  const held = sample(); held.offers[0] = { ...held.offers[0], status: "HELD", code: null, benefit_copy: null, source_url: null };
  assert.deepEqual(activeCouponMap(held, "2026-08-22T12:00:00Z"), {});
});

test("coupon chip carries the copy contract", () => {
  const html = renderCouponChip(activeCouponMap(sample(), "2026-08-22T12:00:00Z")["provider-one"]);
  assert.match(html, /data-coupon-copy/);
  assert.match(html, /data-coupon-code="SAVE25"/);
  assert.match(html, /Use code SAVE25 for \$25 off/);
});