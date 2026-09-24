import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildApprovalArtifacts,
  runApprovalPipeline,
} from "../scripts/approval-pipeline-hook.mjs";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const sourceRegistry = new URL("../data/program-registry.json", import.meta.url);

const application = {
  schema: "program-approval-application-v1",
  approval_id: "approval-fixture-001",
  approval_state: "approved",
  site_profile: "glp-clinic-scout",
  vertical_fit: true,
  wired: true,
  program_id: "fixture-health",
  display_name: "Fixture Health",
  official_url: "https://fixture.invalid/glp-1",
  network: "Fixture Network",
  network_program_id: "fixture-123",
  sheet_row: 999,
  has_price: true,
  has_review_facts: true,
  approved_at: "2026-08-01T00:00:00Z",
};

test("approval artifacts are profile-keyed, held, and never auto-generate or auto-publish", async () => {
  const registry = await readJson(sourceRegistry);
  const { entry, brief } = buildApprovalArtifacts({ registry, application });
  assert.equal(entry.program_id, application.program_id);
  assert.equal(entry.commercial_state, "live");
  assert.equal(entry.profiles[application.site_profile].vertical_fit, true);
  assert.equal(entry.profiles[application.site_profile].wired, true);
  assert.equal(entry.profiles[application.site_profile].surfaces.review, false);
  assert.equal(brief.status, "SCAFFOLD_REVIEW_REQUIRED");
  assert.equal(brief.auto_generate, false);
  assert.equal(brief.auto_publish, false);
  assert.equal(brief.provider_facts.official_url, application.official_url);
});

test("approval pipeline defaults to dry-run and performs no writes or build", async () => {
  const registry = await readJson(sourceRegistry);
  let runs = 0;
  const result = await runApprovalPipeline({
    root: path.dirname(path.dirname(new URL(import.meta.url).pathname)),
    registry,
    application,
    apply: false,
    runGate: async () => { runs += 1; },
  });
  assert.equal(result.status, "DRY_RUN");
  assert.equal(result.auto_generate, false);
  assert.equal(result.auto_publish, false);
  assert.equal(runs, 0);
});

test("explicit apply writes registry plus review brief, then invokes the build coverage gate", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "gcs-approval-hook-"));
  try {
    const registry = await readJson(sourceRegistry);
    const calls = [];
    const result = await runApprovalPipeline({
      root: temp,
      registry,
      application,
      apply: true,
      runGate: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return { status: 0 };
      },
    });
    assert.equal(result.status, "APPLIED_GATE_PASS");
    assert.deepEqual(calls, [{ command: "npm", args: ["run", "build:gate"], cwd: temp }]);
    const writtenRegistry = await readJson(path.join(temp, "data", "program-registry.json"));
    const written = writtenRegistry.programs.find((program) => program.program_id === application.program_id);
    assert.ok(written);
    const brief = await readJson(path.join(temp, "data", "review-briefs", application.site_profile, `${application.program_id}.json`));
    assert.equal(brief.program_id, application.program_id);
    assert.equal(brief.status, "SCAFFOLD_REVIEW_REQUIRED");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("approval hook rejects non-approved, non-vertical-fit, and duplicate applications", async () => {
  const registry = await readJson(sourceRegistry);
  assert.throws(() => buildApprovalArtifacts({ registry, application: { ...application, approval_state: "pending" } }), /approval_state_invalid/);
  assert.throws(() => buildApprovalArtifacts({ registry, application: { ...application, vertical_fit: false } }), /approval_vertical_fit_required/);
  assert.throws(() => buildApprovalArtifacts({ registry, application: { ...application, program_id: registry.programs[0].program_id } }), /approval_program_duplicate/);
});
