import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";

// W3 supersedes only the obsolete assumption that regeneration must restore an
// active pixel ID. Static endpoints still regenerate, but are inert compatibility
// entry points. This does not certify the other client/server exporters.
const root = new URL("..", import.meta.url).pathname;
const read = (relative) => readFile(path.join(root, relative), "utf8");

for (const name of ["meta-pixel.js", "meta-lead.js"]) {
  test(`${name}: source and regenerated public bytes agree and cannot export`, async () => {
    const source = await read(`assets/${name}`);
    assert.equal(await read(`public/${name}`), source);
    const effects = [];
    const context = { window: { fbq: (...args) => effects.push(args) } };
    vm.runInNewContext(source, context);
    assert.equal(context.window.glpMetaTrackLead("guide_optin", "offline"), "");
    assert.deepEqual(effects, []);
    assert.doesNotMatch(source, /PIXEL_ID|new Image|fetch\(|sendBeacon|replaceState|fbevents|\.queue/);
  });
}

test("homepage versioned compatibility reference is bound to source assets", async () => {
  assert.match(await read("public/index.html"), /<script\s+defer\s+src="\/meta-pixel\.js\?v=[a-f0-9]{16}"/);
  const builder = await read("scripts/build-staging.mjs");
  for (const name of ["meta-pixel.js", "meta-lead.js"]) {
    assert.ok(builder.includes(`readFile(path.join(ROOT, "assets", "${name}"))`));
    assert.ok(builder.includes(`path.join(PUBLIC, "${name}")`));
  }
});
