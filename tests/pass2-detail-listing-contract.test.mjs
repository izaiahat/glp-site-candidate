import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/phase3-page-graph.mjs", import.meta.url), "utf8");
const detailCss = readFileSync(new URL("../assets/css-src/30-provider-detail.css", import.meta.url), "utf8");

test("PASS 2 listing/detail cards use canonical registry identity and evidence anatomy", () => {
  assert.match(source, /const detailPath = record \? `\/providers\/\$\{record\.program_id\}\/` : null;/);
  assert.doesNotMatch(source, /const detailPath = record \?[^;]+: reviewPath;/);
  assert.doesNotMatch(source, /const detailPath = record \? `\/providers\/\$\{entry\.program_id\}\/`/);
  assert.match(source, /p3-provider-identity/);
  assert.match(source, /provider-logo--wordmark/);
  assert.match(source, /p3-feature-chips/);
  assert.match(source, /No Clinic Scout patient reviews are published for this provider\./);
  assert.match(source, /data-provider-card-contract="option-c"/);
  assert.match(source, /data-dose-model=/);
  assert.match(source, /No source-backed row is available for this control/);
  assert.match(detailCss, /\.p3-provider-identity/);
  assert.match(detailCss, /\.p3-filter-chips button:disabled/);
});
