import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { approvedRetirement } from "./browser/retirement-support.mjs";

const CASES = [
  ["RR-1", "G04", "pass2-work-order-detail.spec.mjs", ["exactly-35-intent-cards", "alphabetical-intent-backlog"]],
  ["RR-2", "G12", "phase3-gap-acceptance.spec.mjs", ["desktop-width-ratio-minimum"]],
  ["RR-3", "G18", "pass2-work-order-detail.spec.mjs", ["in-page-three-card-reveal"]],
  ["RR-4", "G22", "phase3-page-graph.spec.mjs", ["outer-mobile-sheet-layering"]],
  ["RR-5", "G25", "phase3-page-graph.spec.mjs", ["outer-dialog-choreography"]],
];

function fixture([receipt, group, spec, retired]) {
  return {
    schema: "glp-retirement-receipt-v1", receipt, group,
    spec: `tests/browser/${spec}`, retired,
    description: "Test fixture only", basis: "Test fixture; not an operator approval",
    approved_by: "fixture", approved_at: "2026-09-18T23:50:04Z", source: "unit fixture",
  };
}

function report(spec) {
  const attachments = [];
  return {
    file: fileURLToPath(new URL(`./browser/${spec}`, import.meta.url)),
    annotations: [], attachments,
    async attach(name, options) { attachments.push({ name, ...options }); },
  };
}

// Exercise the production path policy, not a /tmp bypass. Never edit real receipts.
test("retirement receipts fail closed and preserve report evidence", async (t) => {
  const parent = "/home/ubuntu/business/reports/ops/glp41-20260918";
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, "p72-helper-fixtures-"));
  const root = join(scratch, "receipts");
  mkdirSync(root);
  const previousRoot = process.env.RETIREMENT_ROOT;
  process.env.RETIREMENT_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.RETIREMENT_ROOT;
    else process.env.RETIREMENT_ROOT = previousRoot;
    rmSync(scratch, { recursive: true, force: true });
  });

  for (const entry of CASES) {
    const [id, , spec] = entry;
    const file = join(root, `${id}.json`);
    const valid = fixture(entry);
    await t.test(`${id}: valid receipt attaches exact bytes and continues`, async () => {
      const bytes = Buffer.from(`${JSON.stringify(valid, null, 1)}\n`);
      writeFileSync(file, bytes);
      const info = report(spec);
      assert.deepEqual(await approvedRetirement(id, info), valid);
      assert.equal(info.attachments.length, 1);
      assert.equal(info.attachments[0].name, `${id}-retirement-receipt`);
      assert.equal(info.attachments[0].contentType, "application/json");
      assert.deepEqual(info.attachments[0].body, bytes);
      assert.deepEqual(info.annotations.map((item) => item.type), valid.retired.map(() => "GLP_RETIRED"));
      assert.deepEqual(info.annotations.map((item) => item.description.split(";")[0]), valid.retired.map((item) => `${id}:${item}`));
      assert.ok(info.annotations.every((item) => item.description.includes(`${file}; sha256=`)));
      assert.deepEqual(readFileSync(file), bytes);
    });
    await t.test(`${id}: missing receipt fails without a report annotation`, async () => {
      rmSync(file);
      const info = report(spec);
      await assert.rejects(approvedRetirement(id, info), /ENOENT/);
      assert.deepEqual(info.annotations, []);
      assert.deepEqual(info.attachments, []);
    });
    await t.test(`${id}: wrong schema fails without a report annotation`, async () => {
      writeFileSync(file, JSON.stringify({ ...valid, schema: "wrong-schema" }));
      const info = report(spec);
      await assert.rejects(approvedRetirement(id, info), /schema mismatch/);
      assert.deepEqual(info.annotations, []);
      assert.deepEqual(info.attachments, []);
    });
  }

  const valid = fixture(CASES[0]);
  const file = join(root, "RR-1.json");
  for (const [key, value] of [
    ["receipt", "RR-2"], ["group", "G12"], ["spec", "tests/browser/phase3-page-graph.spec.mjs"],
    ["retired", []], ["retired", [...valid.retired, "retained-check"]],
    ["description", " "], ["basis", ""], ["approved_by", ""], ["approved_at", "not-a-date"], ["source", ""],
  ]) {
    await t.test(`invalid ${key}: ${JSON.stringify(value)}`, async () => {
      writeFileSync(file, JSON.stringify({ ...valid, [key]: value }));
      await assert.rejects(approvedRetirement("RR-1", report(CASES[0][2])), /retirement:RR-1:/);
    });
  }
  await t.test("invalid JSON, unknown ID, and wrong caller fail closed", async () => {
    writeFileSync(file, "{");
    await assert.rejects(approvedRetirement("RR-1", report(CASES[0][2])), /retirement:RR-1:/);
    await assert.rejects(approvedRetirement("../RR-1", report(CASES[0][2])), /unknown retirement ID/);
    writeFileSync(file, JSON.stringify(valid));
    await assert.rejects(approvedRetirement("RR-1", report(CASES[1][2])), /calling spec mismatch/);
  });
  await t.test("relative root and receipt symlink escape are rejected", async () => {
    process.env.RETIREMENT_ROOT = "relative-receipts";
    try {
      await assert.rejects(approvedRetirement("RR-1", report(CASES[0][2])), /must be absolute/);
    } finally {
      process.env.RETIREMENT_ROOT = root;
    }
    const outside = join(scratch, "outside.json");
    writeFileSync(outside, JSON.stringify(valid));
    rmSync(file);
    symlinkSync(outside, file);
    await assert.rejects(approvedRetirement("RR-1", report(CASES[0][2])), /inside RETIREMENT_ROOT/);
    rmSync(file);
  });
  await t.test("attachment failure is not converted into retirement success", async () => {
    writeFileSync(file, JSON.stringify(valid));
    const info = report(CASES[0][2]);
    info.attach = async () => { throw new Error("attachment unavailable"); };
    await assert.rejects(approvedRetirement("RR-1", info), /attachment unavailable/);
    assert.deepEqual(info.annotations, []);
  });
});
