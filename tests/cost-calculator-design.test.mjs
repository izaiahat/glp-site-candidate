import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "src", "cost-calculator.mjs");
const PUBLIC = path.join(ROOT, "public", "tools", "glp-1-cost-calculator", "index.html");
const FALSE_ROUTE = path.join(ROOT, "public", "calculator", "index.html");

test("owned cost calculator served output carries the house design without a false emulation route", async () => {
  const html = await readFile(PUBLIC, "utf8");
  assert.match(html, /data-page="cost-calculator"/);
  assert.match(html, /<style data-preserve data-pass2-calculator>/);
  assert.match(html, /body\[data-cs-template="calculator"\]>main\{padding-top:0!important\}/);
  assert.match(html, /\.cost-workspace\{display:grid;align-items:center;min-height:calc\(100svh - 76px\)/);
  assert.match(html, /@media\(max-width:860px\)\{\.cost-workspace\{display:block;min-height:0/);
  assert.match(html, /<main id="main"[^>]*class="cost-calculator-page"[^>]*data-cs-template="calculator">/);
  assert.match(html, /<section class="gcs-section cost-workspace"/);
  assert.ok((html.match(/cs-palette-action/g) || []).length >= 2);
  assert.match(html, /site-tools\.css/);
  assert.match(html, /id="cost-form"/);
  assert.match(html, /id="cost-result"/);
  await assert.rejects(access(FALSE_ROUTE), { code: "ENOENT" });

  const [sourceStat, publicStat] = await Promise.all([stat(SOURCE), stat(PUBLIC)]);
  assert.ok(publicStat.mtimeMs >= sourceStat.mtimeMs, "public calculator must not predate its renderer source");
});
