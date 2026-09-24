import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCssBuildFreshness } from "../src/css-build-freshness.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, ROOT), "utf8");
const classTokens = (css) => new Set(
  [...css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((match) => match[1]),
);

test("served CSS is byte-current with every assembled authoring bundle", async () => {
  const result = await validateCssBuildFreshness(new URL("../", import.meta.url).pathname, { requirePublic: true });
  assert.equal(result.status, "PASS");
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #3): site-p3.css
  // joins the bundle roster — the p3 revenue family's dedicated render-blocking
  // bundle replacing the site.css monolith on those routes.
  assert.deepEqual(result.bundles, ["site.css", "site-home.css", "site-money.css", "site-review.css", "site-editorial.css", "site-tools.css", "site-trust.css", "site-p3.css"]);
});

test("served homepage bundle contains every authored shell and home class selector", async () => {
  const [shell, home, served] = await Promise.all([
    read("assets/css-src/02-shell.css"),
    read("assets/css-src/10-home.css"),
    read("public/assets/site-home.css"),
  ]);
  const servedTokens = classTokens(served);
  for (const source of [shell, home]) {
    for (const token of classTokens(source)) assert.ok(servedTokens.has(token), `served homepage CSS missing .${token}`);
  }
});

test("served homepage carries the Phase 1-2 interaction hooks and wired D44 trigger", async () => {
  const [html, runtime] = await Promise.all([
    read("public/index.html"),
    read("public/assets/site.js"),
  ]);
  assert.match(html, /data-newsletter-open/);
  assert.match(html, /data-subscribe-layer/);
  assert.match(html, /\/assets\/site-home\.css\?v=/);
  assert.match(runtime, /closest\('\[data-subscribe-open\],\[data-newsletter-open\]'\)/);
  assert.match(runtime, /fetch\('\/api\/newsletter-subscribe'/);
});
