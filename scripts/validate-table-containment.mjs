// No table anywhere in the built tree may ship without containment.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator): "some of the text is truncated and falls off the side
// of the screen" — /reviews/dudemeds-review/ shipped two bare tables and the
// page scrolled sideways. The renderer-level fix is src/table-containment.mjs;
// this is the gate that keeps it fixed, because the pass that INJECTED those
// tables (scripts/wave2-repairs.mjs) writes files directly and any future pass
// could do the same.
//
// Static check over the built bytes: every <table> must sit inside a
// `.table-wrap` container, and every prose table must carry the `data-label`
// attributes the stacked mobile layout reads. Cheap, deterministic, no browser.
//
// Exit 0 = PASS, 1 = uncontained tables.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function walk(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const publicDir = path.join(ROOT, "public");
const violations = [];
let tables = 0;
let contained = 0;
let stacked = 0;
for (const file of await walk(publicDir)) {
  const route = `/${path.relative(publicDir, file).replace(/index\.html$/, "")}`;
  const html = await readFile(file, "utf8");
  for (const match of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    tables += 1;
    const before = html.slice(Math.max(0, match.index - 500), match.index);
    // Containment is either the shared `.table-wrap` class or an inline
    // `overflow` style — the clean-room dataset route uses the latter, and it
    // contains its table just as well.
    const wrapAt = Math.max(before.lastIndexOf("table-wrap"), before.lastIndexOf("overflow"));
    const closeAt = before.lastIndexOf("</div>");
    if (wrapAt === -1 || wrapAt < closeAt) {
      violations.push({ route, code: "table_without_containment",
        why: "an uncontained table sets its own intrinsic width and scrolls the whole page sideways",
        excerpt: match[0].slice(0, 90) });
      continue;
    }
    contained += 1;
    // Read the wrapper's own class list, not a byte window around it: a nearby
    // earlier wrapper would otherwise make a data table look stacked.
    const wrappers = [...before.matchAll(/<div class="([^"]*table-wrap[^"]*)"/g)];
    const wrapperClasses = wrappers.length ? wrappers[wrappers.length - 1][1] : "";
    const responsive = /\bresponsive-table\b/.test(wrapperClasses);
    if (responsive) {
      stacked += 1;
      if (/<tbody/i.test(match[0]) && !/data-label=/i.test(match[0])) {
        violations.push({ route, code: "stacked_table_without_cell_labels",
          why: "the stacked mobile layout renders each cell's column header from data-label; "
            + "without it the card shows values with no labels" });
      }
    }
  }
}

const report = {
  status: violations.length ? "FAIL" : "PASS",
  tables_found: tables,
  tables_contained: contained,
  tables_stacked_on_mobile: stacked,
  violations,
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(violations.length ? 1 : 0);
