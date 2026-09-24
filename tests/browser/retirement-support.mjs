import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPORTS_ROOT = "/home/ubuntu/business/reports";
const DEFAULT_ROOT = `${REPORTS_ROOT}/ops/glp41-20260918/retirements`;
const CANDIDATE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RETIREMENTS = {
  "RR-1": {
    group: "G04", spec: "tests/browser/pass2-work-order-detail.spec.mjs",
    retired: ["exactly-35-intent-cards", "alphabetical-intent-backlog"],
  },
  "RR-2": {
    group: "G12", spec: "tests/browser/phase3-gap-acceptance.spec.mjs",
    retired: ["desktop-width-ratio-minimum"],
  },
  "RR-3": {
    group: "G18", spec: "tests/browser/pass2-work-order-detail.spec.mjs",
    retired: ["in-page-three-card-reveal"],
  },
  "RR-4": {
    group: "G22", spec: "tests/browser/phase3-page-graph.spec.mjs",
    retired: ["outer-mobile-sheet-layering"],
  },
  "RR-5": {
    group: "G25", spec: "tests/browser/phase3-page-graph.spec.mjs",
    retired: ["outer-dialog-choreography"],
  },
  "RR-6": {
    group: "R-P1", spec: "tests/browser/cross-device.spec.mjs",
    retired: ["legacy-sticky-jump-nav-presentation"],
  },
  "RR-7": {
    group: "R-LOCAL", spec: "tests/browser/cross-device.spec.mjs",
    retired: ["pairwise-four-row-table-no-global-controls"],
  },
};

function beneath(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// This records a retirement, never a passed assertion, skip, or default approval.
export async function approvedRetirement(id, testInfo) {
  let file;
  let bytes;
  let receipt;
  try {
    assert.ok(Object.hasOwn(RETIREMENTS, id), "unknown retirement ID");
    const expected = RETIREMENTS[id];
    assert.equal(typeof testInfo?.file, "string", "testInfo.file required");
    assert.equal(resolve(testInfo.file), resolve(CANDIDATE_ROOT, expected.spec), "calling spec mismatch");
    assert.ok(Array.isArray(testInfo.annotations), "testInfo.annotations required");
    assert.equal(typeof testInfo.attach, "function", "testInfo.attach required");
    const declaredRoot = process.env.RETIREMENT_ROOT ?? DEFAULT_ROOT;
    assert.ok(isAbsolute(declaredRoot), "RETIREMENT_ROOT must be absolute");
    const root = realpathSync(declaredRoot);
    assert.ok(beneath(REPORTS_ROOT, root), "RETIREMENT_ROOT must resolve inside persistent reports");
    file = realpathSync(resolve(root, `${id}.json`));
    assert.ok(beneath(root, file), "receipt must resolve inside RETIREMENT_ROOT");
    bytes = readFileSync(file);
    receipt = JSON.parse(bytes.toString("utf8"));
    assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt), "receipt must be an object");
    assert.equal(receipt.schema, "glp-retirement-receipt-v1", "schema mismatch");
    assert.equal(receipt.receipt, id, "receipt ID mismatch");
    assert.equal(receipt.group, expected.group, "group mismatch");
    assert.equal(receipt.spec, expected.spec, "receipt spec mismatch");
    assert.deepEqual(receipt.retired, expected.retired, "retired assertion set mismatch");
    for (const key of ["description", "basis", "approved_by", "approved_at", "source"]) {
      assert.ok(typeof receipt[key] === "string" && receipt[key].trim().length > 0, `${key} required`);
    }
    assert.ok(Number.isFinite(Date.parse(receipt.approved_at)), "approved_at invalid");
  } catch (cause) {
    throw new Error(`retirement:${id}:${cause.message}`, { cause });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await testInfo.attach(`${id}-retirement-receipt`, { body: bytes, contentType: "application/json" });
  for (const assertion of receipt.retired) testInfo.annotations.push({
    type: "GLP_RETIRED",
    description: `${id}:${assertion}; ${receipt.group}; ${receipt.approved_by}; ${receipt.approved_at}; ${receipt.source}; ${file}; sha256=${sha256}`,
  });
  return receipt;
}
