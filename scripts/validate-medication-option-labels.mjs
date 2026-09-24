// No surface may offer the reader two selectable options it labels identically.
//
// WHY THIS EXISTS (operator defect, 2026-08-18)
// ---------------------------------------------
// The cost calculator listed "Compounded tirzepatide (injection)" TWICE for
// enhance-md. Two real, separately evidenced tiers ($180-then-$280 "GLP-1
// Advanced" and $169-flat "Microdosing Tirzepatide") both map to one closed-list
// medication_id, and the dropdown rendered the medication_id's label for both.
// Worse, the page looked the row up BY medication_id, so both options resolved
// to the first match: picking the microdosing tier showed the other tier's
// price, quote and capture date. The $169 row could not be reached at all.
//
// WHAT THIS GATE ASSERTS
// ----------------------
//  1. DATA: every provider's matrix rows can be told apart from their own
//     evidence - src/medication-options.mjs derives a qualifier from each row's
//     own quote (or its own published price basis), and this fails if any
//     provider is left with two identical display labels or two identical
//     entry keys.
//  2. SHIPPED BYTES, every built page: no <select> ships two options with the
//     same visible text or the same value, and no embedded runtime payload
//     ships two selectable medication entries with the same rendered label or
//     entry key.
//
// This is a build gate, not a lint: a duplicate label is a wrong price shown to
// a reader who is deciding where to spend money.
//
// Exit 0 = PASS, 1 = violations.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditMedicationOptionLabels, scanRenderedDuplicates } from "../src/medication-options.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, "public");

const violations = [];

// ---------------------------------------------------------------- 1. the data
const matrix = JSON.parse(await readFile(path.join(ROOT, "data/provider-pricing-matrix.json"), "utf8"));
const audit = auditMedicationOptionLabels(matrix);
for (const violation of audit.violations) violations.push(`matrix_entries_indistinguishable:${violation}`);

// ------------------------------------------------------- 2. the shipped bytes
async function* htmlFiles(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield full;
  }
}

let pagesScanned = 0;
let selectsScanned = 0;
let payloadListsScanned = 0;

for await (const file of htmlFiles(PUBLIC)) {
  const route = `/${path.relative(PUBLIC, file).split(path.sep).join("/")}`;
  const scan = scanRenderedDuplicates(await readFile(file, "utf8"), route);
  pagesScanned += 1;
  selectsScanned += scan.selects;
  payloadListsScanned += scan.lists;
  violations.push(...scan.violations);
}

const report = {
  status: violations.length ? "FAIL" : "PASS",
  pages_scanned: pagesScanned,
  selects_scanned: selectsScanned,
  embedded_medication_lists_scanned: payloadListsScanned,
  providers_needing_a_derived_qualifier: audit.qualified,
  violations,
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(violations.length ? 1 : 0);
