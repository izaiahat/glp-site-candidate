import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";
import { approvedDirectoryLinks } from "../src/phase3-page-graph.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(root, "public");
const registry = JSON.parse(readFileSync(path.join(root, "data/program-registry.json"), "utf8"));
const renderIds = new Map(registry.programs.map((program) => [program.review_slug || program.program_id, program.program_id]));

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(file);
    else if (entry.name.endsWith(".html")) yield file;
  }
}

test("network-approved GLP providers have sponsored anchors while explicit exclusions stay dark", () => {
  const authority = loadGoPromotionAuthority().programs;
  const unauthorized = [];
  const byProgram = new Map();
  let sponsored = 0;
  for (const file of htmlFiles(publicRoot)) {
    const html = readFileSync(file, "utf8");
    for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
      const anchor = match[0];
      if (!/\bdata-analytics-event=["']affiliate_click["']|\brel=["'][^"']*\bsponsored\b/i.test(anchor)) continue;
      sponsored += 1;
      const renderId = anchor.match(/\bdata-program=["']([^"']+)["']/i)?.[1];
      if (renderId) byProgram.set(renderId, (byProgram.get(renderId) || 0) + 1);
      const row = authority[renderIds.get(renderId) || renderId] || authority[renderId];
      if (!renderId || row?.status !== "VERIFIED" || row.promotion_authorized !== true) {
        unauthorized.push(`${path.relative(publicRoot, file)}:${renderId || "missing-program"}`);
      }
    }
  }
  assert.ok(sponsored > 0, "authorized partner actions remain present");
  assert.deepEqual(unauthorized, [], "registered producer must materialize authority for each approved live anchor");
  for (const program of ["curex-glp-1", "enhanced-tirzepatide-funnel-b", "g-plan", "joinskinny-semaglutide-glp-1-us", "novi-weight-loss-glp-1", "refills", "trimrx-xentraffic-offer-3014"]) {
    assert.equal(authority[program]?.redirector_tos_basis, "operator_risk_acceptance", `${program}: operator receipt bound`);
    assert.ok((byProgram.get(program) || 0) > 0, `${program}: approved XenTraffic anchor retained`);
  }
  for (const program of ["try-ageless", "altrx-glp1-us-cps", "futurhealth-wegovy-pillform"]) {
    assert.equal(authority[program]?.status, "WITHHELD", `${program}: paused offer stays held`);
    assert.equal(byProgram.get(program) || 0, 0, `${program}: paused offer has no sponsored anchor`);
  }
  for (const program of ["trt-nation", "shedrx", "measured", "mydrhank", "nu-image-medical-review", "longevity-meds-glp-1-review"]) {
    assert.equal(authority[program]?.status, "VERIFIED", `${program}: approved GLP source needs registered promotion authority`);
    assert.ok((byProgram.get(program) || 0) > 0, `${program}: network-approved GLP provider needs a sponsored anchor`);
  }
  assert.equal(authority["katalys-1516"]?.status, "VERIFIED", "Shed offer 1516 has approved offer-specific authority");
  const emed = JSON.parse(readFileSync(path.join(root, 'data/approved-program-registry.json'), 'utf8')).programs
    .find((row) => row.registry_id === 'partnerize-1011l6645');
  assert.equal(emed.enumeration_class, 'provider_joined_or_approved_exact_id');
  assert.ok((byProgram.get(emed.registry_id) || 0) > 0, 'approved eMed issued link is rendered');
  const directory = readFileSync(path.join(publicRoot, 'providers/index.html'), 'utf8');
  const emedSection = directory.match(/<section[^>]+data-approved-directory-provider="partnerize-1011l6645"[\s\S]*?<\/section>/)?.[0];
  assert.ok(emedSection?.includes(`href="${emed.tracking.provider_issued_url}"`));
  assert.doesNotMatch(emedSection, /\$\d|data-go-promoted|ratingValue/);
  assert.equal(byProgram.get("telos-rx") || 0, 0, "operator-held Telos stays dark");
  assert.equal(byProgram.get("fella-health") || 0, 0, "permanently excluded Fella stays dark");
  const detail = readFileSync(path.join(publicRoot, "providers/altrx-glp1-us-cps/index.html"), "utf8");
  assert.match(detail, /href="\/reviews\/altrx-glp1-us-cps\/"/, "held provider retains first-party editorial review access");
});

test("four issuer-bound ClickDealer directory links render without promoting paused or unsourced profiles", () => {
  const expected = new Map([
    ["clickdealer-178335-251864", ["ReadyRx", "6d488c238b84b7d4d2073a19954507aec0a98e8231a8efac12106ccfa9136a6c"]],
    ["clickdealer-181687-255411", ["FMmeds", "0011b689116241f6f8aa9dbc3bb2a18882f42d612f41241667c70266c6a76eed"]],
    ["clickdealer-176223-249142", ["Zevay", "c11c7303c8ebad842d8521139a78567e847b83c6c3f851c4b4165c743029f4a1"]],
    ["clickdealer-181731-255455", ["AbundRX", "79e5645e0c121f24b25d2c3b1d7365e1f3e64473aba2c1ba505980b6a3f67138"]],
  ]);
  const approved = JSON.parse(readFileSync(path.join(root, "data/approved-program-registry.json"), "utf8"));
  const authority = loadGoPromotionAuthority().programs;
  const html = approvedDirectoryLinks(); // Source renderer; no full-site build or network request.
  assert.equal(approved.programs.length, 53, "frozen approved cohort unchanged");
  assert.equal(approved.approved_directory_programs?.length, 4);
  assert.equal((html.match(/data-approved-directory-provider="clickdealer-/g) || []).length, 4);
  for (const row of approved.approved_directory_programs) {
    const [name, digest] = expected.get(row.registry_id) || [];
    assert.ok(name, `${row.registry_id}: exact requested identity`);
    assert.equal(row.display_name, name);
    assert.equal(row.directory_only, true);
    assert.equal(row.tracking.issued_link_type, "default_tracking_link");
    assert.equal(createHash("sha256").update(row.tracking.provider_issued_url).digest("hex"), digest);
    assert.equal(authority[row.registry_id]?.issued_link_sha256, digest);
    assert.equal(authority[row.registry_id]?.status, "VERIFIED");
    const section = html.match(new RegExp(`<section[^>]+data-approved-directory-provider="${row.registry_id}"[\\s\\S]*?<\\/section>`))?.[0];
    assert.ok(section?.includes(`href="${row.tracking.provider_issued_url.replaceAll("&", "&amp;")}"`), `${name}: exact issuer href`);
    assert.match(section, /rel="sponsored noopener noreferrer"/);
    assert.match(section, /data-network="ClickDealer"/);
    assert.doesNotMatch(section, /\$\d|data-go-promoted|ratingValue|data-comparison-card|data-card-review/);
  }
  for (const id of ["try-ageless", "altrx-glp1-us-cps", "futurhealth-wegovy-pillform"]) {
    assert.equal(authority[id]?.status, "WITHHELD", `${id}: offer-specific pause remains`);
    assert.doesNotMatch(html, new RegExp(`data-program="${id}"`));
  }
  for (const id of ["telos-rx", "fella-health"]) assert.doesNotMatch(html, new RegExp(`data-program="${id}"`));
});
