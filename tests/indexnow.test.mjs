import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));

test("IndexNow config is host-bound, root-keyed, and route-scoped", async () => {
  const config = await readJson("../data/indexnow.json");
  assert.equal(config.schema, "glp-indexnow-v1");
  assert.equal(config.host, "glpclinicscout.com");
  assert.match(config.key, /^[A-Za-z0-9-]{8,128}$/);
  assert.equal(config.key_location, `https://${config.host}/${config.key}.txt`);
  assert.equal(config.endpoint, "https://api.indexnow.org/indexnow");
  assert.deepEqual(config.notify_urls, ["https://glpclinicscout.com/glp-1-price-index/"]);
});

test("deterministic build emits the exact root key file and a redacted manifest", async () => {
  const config = await readJson("../data/indexnow.json");
  const keyFile = await readFile(new URL(`../public/${config.key}.txt`, import.meta.url), "utf8");
  assert.equal(keyFile, `${config.key}\n`);

  const manifest = await readJson("../artifacts/ops/indexnow-manifest.json");
  assert.equal(manifest.status, "PASS_KEY_FILE_EMITTED");
  assert.equal(manifest.host, config.host);
  assert.equal(manifest.key_location, config.key_location);
  assert.equal(manifest.key_sha256, createHash("sha256").update(config.key).digest("hex"));
  assert.equal(manifest.key_value_recorded_in_manifest, false);
  assert.equal(Object.hasOwn(manifest, "key"), false);
  assert.deepEqual(manifest.notify_urls, config.notify_urls);
});
