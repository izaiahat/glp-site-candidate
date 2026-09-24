import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequest } from "../functions/go/[program].js";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";
import { manifestSha256, renderGoRuntimeManifestModule } from "../src/go-runtime-manifest.mjs";
import { redirectorTermsAllowed } from "../src/go-redirector-authority.mjs";

const root = new URL("../", import.meta.url);

test("bundled go runtime manifest exactly matches generated artifact", async () => {
  const generated = JSON.parse(await readFile(new URL("artifacts/ops/worker-manifest.staging.json", root), "utf8"));
  assert.equal(GO_RUNTIME_MANIFEST.manifest_sha256, manifestSha256(generated));
  assert.deepEqual(Object.keys(GO_RUNTIME_MANIFEST.programs).sort(), generated.programs.map((entry) => entry.route_slug || entry.program_id).sort());
  for (const entry of generated.programs) assert.deepEqual(GO_RUNTIME_MANIFEST.programs[entry.route_slug || entry.program_id], entry);
});

test("runtime manifest keys a network-owned program by its reader-facing route slug", () => {
  const rendered = renderGoRuntimeManifestModule({
    schema: "test",
    program_registry_schema: "test",
    site_profile: "test",
    internal_fallback: "https://glpclinicscout.com/providers/",
    programs: [{ program_id: "katalys-1286", route_slug: "sprout-health", route: "/go/sprout-health" }],
  });
  const payload = JSON.parse(rendered.match(/Object\.freeze\((\{.*\})\);/s)[1]);
  assert.deepEqual(Object.keys(payload.programs), ["sprout-health"]);
  assert.equal(payload.programs["sprout-health"].program_id, "katalys-1286");
});

test("every generated runtime entry is governed active or explicitly held", () => {
  const entries = Object.values(GO_RUNTIME_MANIFEST.programs);
  assert.ok(entries.length >= 32);
  const active = entries.filter((entry) => entry.live_link_allowed === true && entry.promotion_authorized === true);
  // Retain the non-empty activation gate: a held diagnostic candidate is not a
  // release even when the producer/consumer mechanics pass their fixtures.
  assert.ok(active.length > 0, "release_has_no_receipt_backed_active_entries");
  const selection=loadGoSelection(root);
  const selected=Object.values(selection.programs).filter(p=>p.status==='VERIFIED');
  assert.equal(selected.length,17);
  assert.deepEqual(active.map(p=>p.program_id).sort(),selected.map(p=>p.program_id).sort());
  for(const row of selected){const entry=GO_RUNTIME_MANIFEST.programs[row.render_id];assert.equal(entry.tracking.base_url,row.issued_link);assert.equal(entry.operator_selection_receipt_sha256,selection.selection_sha256);}
  for (const entry of active) {
    assert.equal(entry.status, "live_operator_approved", entry.program_id);
    assert.equal(entry.link_mode, "server_redirect", entry.program_id);
    assert.match(entry.operator_selection_receipt_sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.constructor_verified, true, entry.program_id);
    assert.equal(redirectorTermsAllowed(entry), true, entry.program_id);
    assert.equal(entry.candidate_gate, null, entry.program_id);
  }
  for (const entry of entries.filter((item) => !active.includes(item))) {
    assert.equal(entry.live_link_allowed, false, entry.program_id);
    assert.equal(entry.promotion_authorized, false, entry.program_id);
    assert.ok(String(entry.candidate_gate || "").length > 5, entry.program_id);
  }
});

test("runtime manifest endpoint ignores stale env manifest and exposes exact hash membership", async () => {
  const response = await onRequest({
    request: new Request("https://glpclinicscout.com/go/_manifest"),
    params: { program: "_manifest" },
    env: { AFFILIATE_PROGRAMS_JSON: JSON.stringify({ programs: [{ program_id: "stale-env-only" }] }) },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-glp-program-manifest-sha256"), GO_RUNTIME_MANIFEST.manifest_sha256);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  const body = await response.json();
  assert.equal(body.manifest_sha256, GO_RUNTIME_MANIFEST.manifest_sha256);
  assert.deepEqual(body.program_ids, Object.keys(GO_RUNTIME_MANIFEST.programs).sort());
  assert.equal(body.program_ids.includes("stale-env-only"), false);
  const selected = Object.values(loadGoSelection(root).programs).filter(row => row.status === 'VERIFIED');
  assert.ok(selected.length > 0);
  for (const required of selected.map(row => row.render_id)) {
    assert.equal(body.program_ids.includes(required), true, required);
  }
  // 2026-08-17: Katalys paused these programs and their registry rows were
  // removed, so the /go runtime must no longer route them at all.
  // S9: receipted Telos HOLD removes both canonical and identity-only alias routes.
  for (const paused of ["synergy-rx", "care-bare-rx-glp1", "breezemeds", "telos-rx", "telos-rx-review"]) {
    assert.equal(body.program_ids.includes(paused), false, `paused_program_still_routable:${paused}`);
  }
});

test("runtime manifest endpoint supports HEAD without a body", async () => {
  const response = await onRequest({ request: new Request("https://glpclinicscout.com/go/_manifest", { method: "HEAD" }), params: { program: "_manifest" }, env: {} });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("x-glp-program-manifest-sha256"), GO_RUNTIME_MANIFEST.manifest_sha256);
});

test("Pages function passes the generated internal fallback into the worker", async () => {
  const source = await readFile(new URL("functions/go/[program].js", root), "utf8");
  assert.match(source, /internal_fallback:\s*GO_RUNTIME_MANIFEST\.internal_fallback/);
});
