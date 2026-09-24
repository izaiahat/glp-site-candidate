import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createReviewServer,
  parseRedirects,
  publicFileForPath,
  redirectLocation,
} from "../scripts/serve-review.mjs";

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("review server parses the generated Pages redirect contract", async () => {
  const redirects = parseRedirects(await readFile(path.join(candidateRoot, "public/_redirects"), "utf8"));
  assert.deepEqual(redirects.get("/providers/coivas/"), { to: "/reviews/coivas/", status: 301 });
  assert.deepEqual(redirects.get("/providers/sprout-health/"), { to: "/reviews/sprout-health/", status: 301 });
  assert.deepEqual(redirects.get("/providers/direct-meds/"), { to: "/reviews/direct-meds/", status: 301 });
  assert.deepEqual(redirects.get("/providers/mangorx/"), { to: "/reviews/mangorx/", status: 301 });
});

test("review redirects preserve request query parameters", () => {
  assert.equal(
    redirectLocation("/reviews/coivas/", "http://127.0.0.1:4500/providers/coivas/?utm_source=review"),
    "http://127.0.0.1:4500/reviews/coivas/?utm_source=review",
  );
});

test("review static resolver stays inside public", () => {
  assert.equal(publicFileForPath("/"), path.join(candidateRoot, "public/index.html"));
  assert.equal(publicFileForPath("/%2e%2e/package.json"), null);
});

test("review runtime serves public bytes and applies Pages redirects", async (t) => {
  const server = await createReviewServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const home = await fetch(`${origin}/`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("content-encoding"), "gzip");
  assert.match(await home.text(), /Find a GLP-1 plan that fits/);

  const geo = await fetch(`${origin}/api/geo-state`, {
    headers: { "CF-IPCountry": "US", "CF-Region-Code": "OR" },
  });
  assert.equal(geo.status, 200);
  assert.equal(geo.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await geo.json(), { schema: "glp-geo-state-v1", available: true, state: "OR" });

  const alias = await fetch(`${origin}/providers/coivas/?ref=review`, { redirect: "manual" });
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get("location"), `${origin}/reviews/coivas/?ref=review`);

  const intent = await fetch(`${origin}/best/online-glp-1-providers/?drug=brand-ozempic`, { redirect: "manual" });
  assert.equal(intent.status, 301);
  assert.equal(intent.headers.get("location"), `${origin}/ozempic/`);

  const fallback = await fetch(`${origin}/best/online-glp-1-providers/?drug=unknown`, { redirect: "manual" });
  assert.equal(fallback.status, 301);
  assert.equal(fallback.headers.get("location"), `${origin}/providers/`);

  const goManifest = await fetch(`${origin}/go/_manifest`, { redirect: "manual" });
  assert.equal(goManifest.status, 200);
  const manifest = await goManifest.json();
  assert.ok(manifest.program_ids.length > 0);
});
