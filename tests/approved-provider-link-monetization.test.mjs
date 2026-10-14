import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTree } from "../scripts/validate-approved-provider-link-monetization.mjs";
import { CITATION_REASONS, isCitationReason, isNonPublicSourceUrl, renderCitationAnchor } from "../src/citation-attribution.mjs";
import { loadApprovedProviderDomainMap, lookupProviderDomain } from "../src/approved-provider-domains.mjs";
import { assertApprovedMapCoverage, assertCitationCoverage, loadHistoricalS9DomainMap } from './helpers/d2w-s9-citation-canary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX_FIXTURE = path.join(ROOT, "tests/fixtures/approved-provider-link-sweep-prefix");

// The invariant, stated once: every approved-provider link the site ships is
// either monetized or explicitly marked with a reason. The pre-fix tree is kept
// as a fixture precisely so this gate can never be quietly satisfied by a
// validator that has stopped detecting anything.

test("pre-fix fixture FAILS the gate — the state the operator directive was written about", () => {
  const report = auditTree(PREFIX_FIXTURE);
  assert.equal(report.status, "FAIL");
  const byClass = report.findings.reduce((acc, finding) => ({ ...acc, [finding.class]: (acc[finding.class] || 0) + 1 }), {});
  // 12 bare approved-provider links across five representative pre-fix pages,
  // plus one public link into our own Katalys publisher portal.
  assert.equal(byClass.unmarked_bare_approved_provider_link, 12);
  assert.equal(byClass.partner_portal_link_public, 1);
  assert.equal(report.findings.length, 13);
  // Every bare link in the fixture belongs to a provider we ALREADY monetize
  // somewhere else on the site — that is what made it a money question.
  for (const finding of report.findings.filter((item) => item.class === "unmarked_bare_approved_provider_link")) {
    assert.equal(finding.monetized_form_available, true, `${finding.href} should map to a monetizable program`);
    assert.ok(finding.program_ids.length >= 1);
  }
});

test("the price index's own first-party-source marker counts as a recorded decision", () => {
  const historicalMap = loadHistoricalS9DomainMap();
  const report = auditTree(PREFIX_FIXTURE, { map: historicalMap });
  const priceIndexFindings = report.findings.filter((finding) => finding.file.startsWith("glp-1-price-index"));
  assert.deepEqual(priceIndexFindings, []);
  assertApprovedMapCoverage(historicalMap);
  assertCitationCoverage(report);
});

test("built tree PASSES — no unmarked bare approved-provider link ships", () => {
  const report = auditTree(path.join(ROOT, "public"));
  assert.deepEqual(report.findings, [], JSON.stringify(report.findings.slice(0, 5), null, 2));
  assert.equal(report.status, "PASS");
  assert.ok(report.counts.monetized > 0, `expected the site to keep at least one governed monetized link, got ${report.counts.monetized}`);
  assert.ok(report.counts.marked_citation > 250, `expected every citation marked, got ${report.counts.marked_citation}`);
});

test("every monetized anchor discloses itself with rel=sponsored", () => {
  const report = auditTree(path.join(ROOT, "public"));
  assert.equal(report.findings.filter((finding) => finding.class === "affiliate_link_missing_sponsored_rel").length, 0);
  for (const entry of report.ledger.monetized) assert.match(entry.rel || "", /sponsored/);
});

test("no partner-portal account URL ships in a public page", () => {
  const report = auditTree(path.join(ROOT, "public"));
  assert.equal(report.findings.filter((finding) => finding.class === "partner_portal_link_public").length, 0);
});

test("citation markers only carry allowlisted reasons", () => {
  const report = auditTree(path.join(ROOT, "public"));
  for (const entry of report.ledger.marked_citation) assert.ok(isCitationReason(entry.reason), `unknown reason ${entry.reason}`);
});

test("a partner-portal source renders de-linked but still named", () => {
  const html = renderCitationAnchor({
    url: "https://app.katalys.com/pub/deadbeef/explore/1632",
    label: "CoreAge Rx GLP-1",
    reason: CITATION_REASONS.REVIEW_SOURCE_LEDGER,
  });
  assert.ok(isNonPublicSourceUrl("https://app.katalys.com/pub/deadbeef/explore/1632"));
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /CoreAge Rx GLP-1/);
  assert.match(html, /data-source-access="partner_portal_not_public"/);
});

test("the Nu Image Trackdesk portal is de-linked as private account evidence", () => {
  const url = "https://nu-image-medical.trackdesk.com/affiliate/program/terms";
  const html = renderCitationAnchor({
    url,
    label: "Nu Image Medical program terms",
    reason: CITATION_REASONS.REVIEW_SOURCE_LEDGER,
  });
  assert.equal(isNonPublicSourceUrl(url), true);
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /Nu Image Medical program terms/);
  assert.match(html, /data-source-access="partner_portal_not_public"/);
});

test("an unknown citation reason throws rather than shipping an unmarked link", () => {
  assert.throws(() => renderCitationAnchor({ url: "https://healthrx.com/", label: "HealthRX", reason: "because" }), /citation_reason_unknown/);
});

test("the approved-provider domain map is derived from the governed registry, not hand-listed", () => {
  const { domains, programs } = loadApprovedProviderDomainMap();
  assert.ok(domains.size >= 35, `expected the live provider estate, got ${domains.size}`);
  assert.ok(programs.size >= 30);
  // Every live wired program resolves to at least one domain, or the gate would
  // be blind to that provider's links everywhere on the site.
  const unmapped = [...programs.values()].filter((program) => program.hosts.length === 0).map((program) => program.program_id);
  assert.deepEqual(unmapped, []);
  // A subdomain nobody captured still resolves to its owner.
  assert.equal(lookupProviderDomain(domains, "checkout.healthrx.com")?.program_ids?.[0], "healthrx");
  assert.equal(lookupProviderDomain(domains, "example.org"), null);
});

test("programs held link-dark record WHY, so bare is a decision and not a gap", () => {
  const { programs } = loadApprovedProviderDomainMap();
  const measured = programs.get("measured");
  assert.ok(measured, "measured must stay in the registry as a live editorial program");
  assert.equal(measured.go_route, null);
  assert.match(measured.suppression?.surface_restriction_basis || "", /operator_rejected_terms/);
});
