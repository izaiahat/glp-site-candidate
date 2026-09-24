import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("O-38 publish pipeline generates route masters before derivatives and audit", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["generate:article-route-masters"], "python3 scripts/pass2-generate-route-images.py --workers 3");
  assert.equal(
    pkg.scripts["publish:article-imagery"],
    "npm run generate:article-route-masters && npm run generate:article-imagery && python3 scripts/pass2-image-derivative-audit.py",
  );
  assert.doesNotMatch(pkg.scripts.build, /generate:article-route-masters/, "ordinary candidate builds must not create paid provider jobs");
});

test("route-master generator is resumable, subject-specific, and fail-closed on dimensions", async () => {
  const source = await read("scripts/pass2-generate-route-images.py");
  assert.match(source, /STATE_PATH = REPORT_DIR \/ "state\.json"/);
  assert.match(source, /if previous\.get\("status"\) == "PASS"/);
  assert.match(source, /route = record\["route"\]/);
  assert.match(source, /title = slug_title\(route\)/);
  assert.match(source, /scene_for\(route\)/);
  assert.match(source, /Negative prompt:/);
  assert.match(source, /--resolution",\s*"4k"/);
  assert.match(source, /width < 2_400 or height < 1_200/);
  assert.match(source, /higgsfield exited/);
  assert.match(source, /atomic_json\(STATE_PATH, state\)/);
});

test("article renderer switches only when all route masters pass exact hash and dimension gates", async () => {
  const source = await read("scripts/generate-article-imagery.py");
  assert.match(source, /if set\(passed\) != expected:\s*return \{\}/s);
  assert.match(source, /article_route_master_hash_mismatch/);
  assert.match(source, /image\.width < 2400 or image\.height < 1200/);
  assert.match(source, /generated_from_gpt_image_2_route_master/);
  assert.match(source, /glp-article-image-system-v3/);
  assert.match(source, /article_route_master_state_lineage_stale/);
});
