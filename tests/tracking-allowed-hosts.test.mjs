import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
// Blocker F (2026-08-20): the review renderer's tracking-host allowlist is now
// DERIVED from the canonical rails module instead of a frozen literal.
//
// What these tests pin, in the order the contract asked for them:
//   (a) the three rails that are already earning render exactly as before;
//   (b) a Trackdesk provider — the rail the literal had never heard of —
//       resolves its host through the canonical module and renders a monetized
//       rel=sponsored CTA;
//   (c) a host the derivation does not name still throws
//       review_direct_link_host_invalid.
//
// Nothing here hand-writes an allowed host. Every host asserted below is either
// read out of the shipped derived document or produced by running the CANONICAL
// resolver (`scripts/emit-tracking-allowed-hosts.py` ->
// `glp_affiliate_link_rails.program_allowed_hosts`) over fixture spec bytes.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderReviewSpecs, renderProviderReviewPage } from "../src/provider-review.mjs";
import {
  loadTrackingAllowedHosts,
  resetTrackingAllowedHostsCache,
  trackingAllowedHosts,
} from "../src/tracking-allowed-hosts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));

const registry = await readJson("../data/program-registry.json");
const money = await readJson("../data/money-page-specs.json");
const providerPages = await readJson("../data/provider-page-contracts.json");
const providerFastpath = await readJson("../data/provider-fastpath-contract.json");
const identity = await readJson("../data/identity-registry.json");
const specs = buildProviderReviewSpecs(money.pages, providerPages, providerFastpath, registry, "glp-clinic-scout");
const byId = new Map(specs.map((spec) => [spec.program_id, spec]));

// --------------------------------------------------------------------------
// the derived document is a projection of the canonical module, not a copy
// --------------------------------------------------------------------------
test("the shipped document is byte-identical to a fresh derivation from the rails module", () => {
  const out = execFileSync("python3", [path.join(ROOT, "scripts/emit-tracking-allowed-hosts.py"), "--check"],
    { cwd: ROOT, encoding: "utf8" });
  const receipt = JSON.parse(out.trim().split("\n").pop());
  assert.equal(receipt.status, "PASS");
  assert.ok(receipt.program_count > 0);
});

test("the document names the module it was derived from", () => {
  const document = loadTrackingAllowedHosts();
  assert.equal(document.schema, "glp.tracking_allowed_hosts.v1");
  assert.match(document.rails_module.path, /glp_affiliate_link_rails\.py$/);
  assert.match(document.rails_module.sha256, /^[a-f0-9]{64}$/);
});

// --------------------------------------------------------------------------
// (a) the rails that are already earning render unchanged
// --------------------------------------------------------------------------
// One live provider per rail shape the literal used to cover: a network
// redirector with one host (Katalys), a network redirector with an estate of
// them (CJ), and a merchant-hosted advertiser (Direct affiliate).
const LIVE_REGRESSION = [
  ["mademed", "Katalys", "track.revoffers.com"],
  // NOT `measured`: its Awin terms were operator-rejected 2026-08-12, so its
  // review page is deliberately link-dark and renders no affiliate anchor.
  ["drhouse", "Awin", "www.awin1.com"],
  ["trt-nation", "CJ Affiliate", "www.tkqlhce.com"],
  ["orderlymeds", "Direct affiliate", "orderlymeds.com"],
  ["gobymeds", "Direct website-publisher application / manual review", "my.gobymeds.com"],
];

for (const [programId, network, expectedHost] of LIVE_REGRESSION) {
  test(`${programId} still renders its monetized CTA on ${expectedHost}`, () => {
    const review = byId.get(programId);
    assert.ok(review, `${programId} review spec missing`);
    assert.equal(review.row.affiliate_network, network);
    const html = renderProviderReviewPage(review, identity);
    const match = html.match(/<a class="cta primary affiliate" href="([^"]+)"[^>]*rel="sponsored nofollow noopener"/);
    assert.ok(match, `no monetized CTA rendered for ${programId}`);
    const pointer=match[1].replaceAll('&amp;','&');
    const selected=Object.values(loadGoSelection().programs).find(p=>p.render_id===programId&&p.status==='VERIFIED');
    if(selected){assert.equal(pointer,selected.route+'?s=reviews.rv2&v=a');assert.equal(GO_RUNTIME_MANIFEST.programs[programId].tracking.base_url,selected.issued_link);}
    const url = new URL(selected ? GO_RUNTIME_MANIFEST.programs[programId].tracking.base_url : pointer);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, selected ? new URL(selected.issued_link).hostname : expectedHost);
    // Raw input still passes its original per-program host validation before overlay.
    assert.ok(trackingAllowedHosts(programId, network).has(expectedHost));
  });
}

test("the allowlist is now per PROGRAM, not per network", () => {
  // Under the old literal both direct-affiliate providers shared one host set,
  // so orderlymeds' host authorized a link on any other direct program. It no
  // longer does.
  assert.ok(!trackingAllowedHosts("gobymeds", "Direct website-publisher application / manual review").has("orderlymeds.com"));
  assert.ok(!trackingAllowedHosts("orderlymeds", "Direct affiliate").has("my.gobymeds.com"));
});

// --------------------------------------------------------------------------
// (c) an unknown host is still refused, by the same name as before
// --------------------------------------------------------------------------
test("a host the derivation does not name is refused, not rendered", () => {
  const orderly = byId.get("orderlymeds");
  const rogue = { ...orderly, row: { ...orderly.row, affiliate_href: "https://orderlymeds.example.com/?oid=2&affid=2608" } };
  assert.throws(() => renderProviderReviewPage(rogue, identity), /review_direct_link_host_invalid:orderlymeds/);
});

test("a non-https href on an allowed host is still refused", () => {
  const orderly = byId.get("orderlymeds");
  const insecure = { ...orderly, row: { ...orderly.row, affiliate_href: "http://orderlymeds.com/?oid=2&affid=2608" } };
  assert.throws(() => renderProviderReviewPage(insecure, identity), /review_direct_link_host_invalid:orderlymeds/);
});

test("an underived program fails the host resolver and cannot render an unsealed link", () => {
  const orderly = byId.get("orderlymeds");
  const unknown = { ...orderly, row: { ...orderly.row, program_id: "not-a-derived-program" } };
  assert.throws(() => trackingAllowedHosts("not-a-derived-program", orderly.row.affiliate_network), /tracking_allowed_hosts_underived:not-a-derived-program/);
  assert.ok(!/rel="sponsored/.test(renderProviderReviewPage(unknown, identity)), "authority-absent program must not render a commercial anchor");
});

test("a program whose rail changed under a stale document throws rather than using the old rail's hosts", () => {
  const orderly = byId.get("orderlymeds");
  const drifted = { ...orderly, row: { ...orderly.row, affiliate_network: "Katalys" } };
  assert.throws(() => renderProviderReviewPage(drifted, identity), /tracking_allowed_hosts_network_drift:orderlymeds/);
});

// --------------------------------------------------------------------------
// (b) Trackdesk — the rail the literal had never heard of
// --------------------------------------------------------------------------
// The fixture supplies only what a program spec really carries: the network and
// the independently authored official URL. The HOST is not asserted into the
// fixture — the canonical resolver produces it, and the test then requires the
// renderer to accept exactly that host and refuse anything else.
function deriveTrackdeskDocument() {
  const scratch = mkdtempSync(path.join(tmpdir(), "glp-trackdesk-derive-"));
  mkdirSync(path.join(scratch, "data"), { recursive: true });
  writeFileSync(path.join(scratch, "data/provider-page-contracts.json"), JSON.stringify({
    schema: "glp-provider-fastpath-contracts-v1",
    providers: [{
      program_id: "trackdesk-fixture",
      official_url: "https://nuimagemedical.com/weight-loss-medications",
      network_contract: { network: "Trackdesk" },
      row_contract: {
        affiliate_href: "https://nuimagemedical.com/?linkId=lp_716390&sourceId=glp-clinic-scout&tenantId=nu-image-medical",
        live_link_allowed: true,
        promotion_authorized: true,
      },
    }],
  }));
  writeFileSync(path.join(scratch, "data/money-page-specs.json"), JSON.stringify({ pages: [] }));
  const output = path.join(scratch, "tracking-allowed-hosts.json");
  execFileSync("python3", [
    path.join(ROOT, "scripts/emit-tracking-allowed-hosts.py"),
    "--root", scratch, "--output", output,
  ], { cwd: ROOT, encoding: "utf8" });
  return { output, document: JSON.parse(readFileSync(output, "utf8")) };
}

test("a Trackdesk program resolves its host through the canonical rails module", () => {
  const { document } = deriveTrackdeskDocument();
  const entry = document.programs["trackdesk-fixture"];
  assert.ok(entry, "Trackdesk program absent from the derivation");
  assert.equal(entry.network, "Trackdesk");
  assert.equal(entry.host_class, "merchant_host");
  // Derived from the spec's own official_url, exactly as spec_allowed_host does.
  assert.deepEqual(entry.allowed_hosts, ["nuimagemedical.com"]);
  assert.equal(entry.resolution, "official_url_derived");
});

test("a Trackdesk host resolves, but a provider without sealed authority stays link-dark", () => {
  const { output, document } = deriveTrackdeskDocument();
  const host = document.programs["trackdesk-fixture"].allowed_hosts[0];
  const template = byId.get("orderlymeds");
  const review = {
    ...template,
    program_id: "trackdesk-fixture",
    path: "/reviews/trackdesk-fixture/",
    row: {
      ...template.row,
      program_id: "trackdesk-fixture",
      affiliate_network: "Trackdesk",
      affiliate_href: `https://${host}/?linkId=lp_716390&sourceId=glp-clinic-scout&tenantId=nu-image-medical`,
    },
  };
  process.env.GLP_TRACKING_ALLOWED_HOSTS_DOCUMENT = output;
  resetTrackingAllowedHostsCache();
  try {
    // The host resolver knows Trackdesk; the separate promotion gate has no
    // authority row for this synthetic identity and must not monetize it.
    assert.ok(trackingAllowedHosts("trackdesk-fixture", "Trackdesk").has(host));
    const html = renderProviderReviewPage(review, identity);
    assert.ok(!/rel="sponsored|data-analytics-event="affiliate_click"/.test(html), "unsealed Trackdesk fixture must stay link-dark");
    // The per-program host gate still rejects another domain independently.
    const rogue = { ...review, row: { ...review.row, affiliate_href: "https://nuimagemedical.example.com/?tenantId=nu-image-medical" } };
    assert.equal(trackingAllowedHosts("trackdesk-fixture", "Trackdesk").has(new URL(rogue.row.affiliate_href).hostname), false);
    assert.ok(!/rel="sponsored/.test(renderProviderReviewPage(rogue, identity)), "rogue host must not bypass promotion authority");
  } finally {
    delete process.env.GLP_TRACKING_ALLOWED_HOSTS_DOCUMENT;
    resetTrackingAllowedHostsCache();
  }
});

test("a declared tracking host outside the advertiser's own domain is refused by the resolver", () => {
  // The one check the derivation ADDS. A declared host may narrow the gate to a
  // subdomain the advertiser issued (my.gobymeds.com); it may never move it to a
  // domain we do not control, which is the job the literal was doing.
  const scratch = mkdtempSync(path.join(tmpdir(), "glp-declared-host-"));
  mkdirSync(path.join(scratch, "data"), { recursive: true });
  writeFileSync(path.join(scratch, "data/provider-page-contracts.json"), JSON.stringify({
    schema: "glp-provider-fastpath-contracts-v1",
    providers: [{
      program_id: "rogue-declared",
      official_url: "https://nuimagemedical.com/weight-loss-medications",
      tracking_host: "attacker.example.com",
      network_contract: { network: "Trackdesk" },
      row_contract: { affiliate_href: "https://attacker.example.com/", live_link_allowed: true, promotion_authorized: true },
    }],
  }));
  writeFileSync(path.join(scratch, "data/money-page-specs.json"), JSON.stringify({ pages: [] }));
  assert.throws(() => execFileSync("python3", [
    path.join(ROOT, "scripts/emit-tracking-allowed-hosts.py"),
    "--root", scratch, "--output", path.join(scratch, "doc.json"),
  ], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }), /declared_tracking_host_off_official_domain/);
});

test("Nu Image host derivation uses the currently approved Trackdesk rail", async () => {
  const approvals = await readJson("../data/affiliate-wire-in-approvals.json");
  const issued = approvals.programs.find(row => row.existing_release_alias === "nu-image-medical-review");
  assert.equal(issued.approval_state, "approved_active");
  assert.equal(issued.network, "Trackdesk");
  assert.ok(trackingAllowedHosts("nu-image-medical-review", issued.network).has(new URL(issued.tracking.provider_issued_url).hostname));
});

test("approved eMed directory anchors use the canonical Partnerize host derivation", async () => {
  const approved = await readJson("../data/approved-program-registry.json");
  const issued = approved.programs.find(row => row.registry_id === "partnerize-1011l6645");
  assert.equal(issued.enumeration_class, "provider_joined_or_approved_exact_id");
  assert.ok(trackingAllowedHosts(issued.registry_id, issued.network).has(new URL(issued.tracking.provider_issued_url).hostname));
});
