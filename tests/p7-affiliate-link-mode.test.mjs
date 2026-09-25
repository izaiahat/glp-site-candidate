import test from "node:test";
import assert from "node:assert/strict";
import { affiliateLinkMode, subidAttributes } from "../src/affiliate-subid.mjs";

const assignment = { programId: "gobymeds", network: "direct", position: "provider-card", rankPosition: 1, pageSlug: "providers", pageType: "provider-listing", providerSlug: "example" };

test("rendered destination determines the mode, not a /go/ substring", () => {
  assert.equal(affiliateLinkMode("/go/example?s=providers.pc1&v=a"), "server-redirect");
  assert.equal(affiliateLinkMode("https://glpclinicscout.com/go/example?s=providers.pc1&v=a"), "server-redirect");
  assert.equal(affiliateLinkMode("https://merchant.example/"), "transparent-direct");
  assert.equal(affiliateLinkMode("https://merchant.example/go/example"), "transparent-direct");
  assert.equal(affiliateLinkMode("https://glpclinicscout.com.evil.example/go/example"), "transparent-direct");
  assert.equal(affiliateLinkMode("http://glpclinicscout.com/go/example"), "transparent-direct");
  assert.throws(() => affiliateLinkMode(""), /affiliate_rendered_href_missing/);
});

test("shared attributes emit one mode from the rendered href without changing attribution", () => {
  for (const [renderedHref, mode] of [["/go/example?s=providers.pc1&v=a", "server-redirect"], ["https://merchant.example/", "transparent-direct"]]) {
    const original = subidAttributes({ ...assignment, href: "https://merchant.example/" });
    const actual = subidAttributes({ ...assignment, href: "https://merchant.example/", renderedHref });
    assert.equal(actual, `data-link-mode="${mode}" ${original}`);
    assert.equal((actual.match(/data-link-mode=/g) || []).length, 1);
  }
  // Existing renderers owning their explicit mode are not given a duplicate.
  assert.doesNotMatch(subidAttributes(assignment), /data-link-mode=/);
});
