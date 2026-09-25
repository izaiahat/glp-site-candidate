import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, root), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("PASS 2 provider-logo atlas is complete, optimized, and source-pinned", async () => {
  const source = await readJson("assets/provider-logos/manifest.json");
  const atlas = await readJson("assets/provider-logos/pass2-lp-atlas.json");
  const atlasBytes = await readFile(new URL("assets/provider-logos/pass2-lp-atlas.webp", root));
  const sourceBytes = await readFile(new URL("assets/provider-logos/manifest.json", root));
  assert.equal(atlas.schema, "glp-provider-logo-lp-atlas-v1");
  assert.equal(atlas.status, "PASS");
  assert.equal(atlas.entry_count, source.logos.length);
  assert.equal(new Set(atlas.entries.map((entry) => entry.program_id)).size, source.logos.length);
  assert.equal(atlas.source_manifest_sha256, sha256(sourceBytes));
  assert.equal(atlas.atlas_sha256, sha256(atlasBytes));
  assert.equal(atlas.atlas_bytes, atlasBytes.length);
  assert.ok(atlasBytes.length <= 110_000, `atlas ${atlasBytes.length} exceeds the 110KB sprite sub-budget; the page-level 300KB /lp/ transfer budget in validate-lp-speed.mjs still binds independently`);
  for (const logo of source.logos) {
    const entry = atlas.entries.find((candidate) => candidate.program_id === logo.program_id);
    assert.ok(entry, logo.program_id);
    assert.equal(entry.source_sha256, logo.output_sha256);
  }
});

test("PASS 2 phase3 surfaces consume the single atlas instead of per-card image requests", async () => {
  const source = await readFile(new URL("src/phase3-page-graph.mjs", root), "utf8");
  const css = await readFile(new URL("assets/css-src/40-editorial.css", root), "utf8");
  const pkg = await readJson("package.json");
  assert.match(source, /provider-logo--sprite/);
  assert.match(source, /pass2-lp-atlas\.json/);
  assert.match(css, /pass2-lp-atlas\.webp/);
  assert.equal(pkg.scripts.build, "python3 scripts/mirror-build.py");
  assert.deepEqual(pkg.scripts["build:validated"].split(" && ").slice(0, 2), [
    "npm run generate:provider-logo-atlas",
    "npm run generate:home-imagery",
  ]);
});
