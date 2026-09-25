// Blocker H — DECLARED-ROUTE PROVENANCE REFRESH.
//
// `postbuild-aeo-surface.mjs` binds every indexable route to a content hash so a
// page's sitemap `lastmod` can never keep an old date after its bytes change. A
// wire-in build's whole purpose is to change content, and before this lane the
// only way past the assertion was `GLP_LASTMOD_PROVENANCE_REFRESH=1`, which does
// not refresh the changed route — it turns the assertion OFF for every route in
// the build. These tests pin the three properties that make the narrow lane a
// replacement for the blunt one:
//
//   1. a DECLARED change passes, and takes a truthful NEW lastmod;
//   2. an UNDECLARED change still throws `lastmod_provenance_stale:<route>`;
//   3. unchanged routes are untouched — including declared ones, so a
//      declaration can never bump a date on its own.
//
// (1) and (2) run the real stage over an isolated two-route TEST index. Its
// baseline pages are manifest-authenticated release bytes, not an invented
// historical publication of the current candidate output.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, cp, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCarrierArticles } from "../src/carrier-article-retention.mjs";
import { prepareLastmod, openComparisonInput } from "../scripts/build-lastmod-provenance.mjs";
import {
  DECLARED_ROUTES_SCHEMA,
  LASTMOD_ACTIONS,
  normalizedHash,
  parseDeclaredRoutes,
  readDeclaredRoutes,
  resolveRouteLastmod,
} from "../scripts/postbuild-aeo-surface.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const RELEASE = "2026-09-10"; // Pure decision examples; integration uses preparer's real UTC date.

test("lastmod hash treats versioned analytics filenames as transport-only", () => {
  const legacy = '<script src="/assets/analytics.js?v=aaaaaaaaaaaaaaaa"></script><main>same content</main>';
  const versioned = '<script src="/assets/analytics.b76e4da4f953494a.js"></script><main>same content</main>';
  assert.equal(normalizedHash(versioned), normalizedHash(legacy));
});

// ---------------------------------------------------------------------------
// The decision, in isolation
// ---------------------------------------------------------------------------

test("declared change: refreshed to the release date, which is the date it moved", () => {
  const result = resolveRouteLastmod({
    route: "/", hash: HASH_B, recorded: { content_sha256: HASH_A, lastmod: "2026-08-19" },
    declared: true, releaseDate: RELEASE,
  });
  assert.deepEqual(result, { lastmod: RELEASE, action: LASTMOD_ACTIONS.DECLARED });
});

test("declared NEW route with no provenance record at all is admitted, not 'missing'", () => {
  const result = resolveRouteLastmod({
    route: "/reviews/nu-image-medical-review/", hash: HASH_B, recorded: undefined,
    declared: true, releaseDate: RELEASE,
  });
  assert.deepEqual(result, { lastmod: RELEASE, action: LASTMOD_ACTIONS.DECLARED });
});

test("undeclared change still throws — the declaration is the ONLY thing that moved", () => {
  assert.throws(() => resolveRouteLastmod({
    route: "/guides/mounjaro-cost-without-insurance/", hash: HASH_B,
    recorded: { content_sha256: HASH_A, lastmod: "2026-08-19" },
    declared: false, releaseDate: RELEASE,
  }), /^Error: lastmod_provenance_stale:\/guides\/mounjaro-cost-without-insurance\/$/);
});

test("undeclared route with no record still throws lastmod_provenance_missing", () => {
  assert.throws(() => resolveRouteLastmod({
    route: "/reviews/never-declared/", hash: HASH_B, recorded: undefined,
    declared: false, releaseDate: RELEASE,
  }), /^Error: lastmod_provenance_missing:\/reviews\/never-declared\/$/);
});

test("an UNCHANGED route keeps its recorded lastmod even when declared", () => {
  for (const declared of [false, true]) {
    const result = resolveRouteLastmod({
      route: "/reviews/orderlymeds/", hash: HASH_A,
      recorded: { content_sha256: HASH_A, lastmod: "2026-07-30" },
      declared, releaseDate: RELEASE,
    });
    assert.deepEqual(result, { lastmod: "2026-07-30", action: LASTMOD_ACTIONS.UNCHANGED },
      `declared=${declared} moved a date on an unchanged route`);
  }
});

test("the blanket refresh lane is unchanged, and outranks the declaration", () => {
  assert.deepEqual(resolveRouteLastmod({
    route: "/", hash: HASH_B, recorded: { content_sha256: HASH_A, lastmod: "2026-08-19" },
    refresh: true, declared: false, releaseDate: RELEASE,
  }), { lastmod: RELEASE, action: LASTMOD_ACTIONS.BLANKET });
});

test("a byte-frozen route still takes the date the page itself publishes", () => {
  assert.deepEqual(resolveRouteLastmod({
    route: "/glp-1-price-index/", hash: HASH_B, recorded: { content_sha256: HASH_A, lastmod: "2026-08-19" },
    frozenDate: "2026-08-18", declared: false, releaseDate: RELEASE,
  }), { lastmod: "2026-08-18", action: LASTMOD_ACTIONS.FROZEN });
  assert.throws(() => resolveRouteLastmod({
    route: "/glp-1-price-index/", hash: HASH_B, recorded: undefined,
    frozenDate: "", declared: true, releaseDate: RELEASE,
  }), /frozen_route_declares_no_date_modified/);
});

// ---------------------------------------------------------------------------
// The declaration itself
// ---------------------------------------------------------------------------

test("declared routes parse from a whitespace/comma list and refuse non-routes", () => {
  assert.deepEqual([...parseDeclaredRoutes("/ , /reviews/x/\n/best/y/")], ["/", "/reviews/x/", "/best/y/"]);
  assert.deepEqual([...parseDeclaredRoutes("")], []);
  for (const bad of ["reviews/x/", "https://glpclinicscout.com/", "*", "/a b/"]) {
    assert.throws(() => parseDeclaredRoutes(bad), /lastmod_declared_route_invalid/, `accepted ${bad}`);
  }
});

test("a declaration FILE must carry the right schema, and env+file together is refused", async () => {
  const good = JSON.stringify({ schema: DECLARED_ROUTES_SCHEMA, routes: ["/", "/reviews/x/"] });
  const read = async () => good;
  assert.deepEqual(
    [...(await readDeclaredRoutes({ GLP_LASTMOD_DECLARED_ROUTES_FILE: "/d.json" }, read)).routes],
    ["/", "/reviews/x/"]);
  await assert.rejects(
    () => readDeclaredRoutes({ GLP_LASTMOD_DECLARED_ROUTES_FILE: "/d.json" }, async () => JSON.stringify({ schema: "other", routes: [] })),
    /lastmod_declared_routes_schema_invalid/);
  await assert.rejects(
    () => readDeclaredRoutes({ GLP_LASTMOD_DECLARED_ROUTES: "/", GLP_LASTMOD_DECLARED_ROUTES_FILE: "/d.json" }, read),
    /lastmod_declared_routes_conflict/);
  assert.deepEqual(await readDeclaredRoutes({}, read), { routes: new Set(), source: null });
});

// ---------------------------------------------------------------------------
// End to end, over this release's own rendered tree
// ---------------------------------------------------------------------------

const PROBE_ROUTE = "/how-we-rate/";
const UNTOUCHED_ROUTE = "/reviews/orderlymeds/";
const BASE_POINTER = path.resolve(ROOT, "../../../../reports/glp-clinic-scout/seo-machine/current-content-base.json");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const work = path.join(ROOT, "artifacts", "test-work");
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(path.join(work, "aeo-declared-"));
  await mkdir(path.join(root, "data"), { recursive: true });
  await mkdir(path.join(root, "artifacts", "ops"), { recursive: true });
  for (const directory of ["scripts", "src", "data"]) {
    await cp(path.join(ROOT, directory), path.join(root, directory), { recursive: true });
  }
  for (const file of ["page-content-provenance.json", "llms-priority.json", "page-seo-copy.json"]) {
    await cp(path.join(ROOT, "data", file), path.join(root, "data", file));
  }
  // Copy the rendered tree; add authenticated carrier dependencies below.
  await cp(path.join(ROOT, "public"), path.join(root, "public"), {
    recursive: true,
    filter: (source) => !source.startsWith(path.join(ROOT, "public", "assets")),
  });
  for (const { manifest } of loadCarrierArticles(ROOT).values()) {
    for (const relative of [manifest.snapshot, ...manifest.bindings.map(binding => binding.path), ...manifest.files.map(file => file.path)]) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await cp(path.join(ROOT, relative), path.join(root, relative), { recursive: true });
    }
  }
  // Use manifest-authenticated predecessor page bytes, not a current tree
  // relabelled with a fictional historical date. prepareLastmod verifies the
  // receipt, manifest and provenance again before every comparison.
  const pointer = JSON.parse(await readFile(BASE_POINTER, "utf8"));
  const manifestBytes = await readFile(pointer.manifest.path);
  assert.equal(sha256(manifestBytes), pointer.manifest.sha256);
  const rows = new Map(JSON.parse(manifestBytes).release_rows.map(row => [row.path, row.sha256]));
  for (const route of [PROBE_ROUTE, UNTOUCHED_ROUTE]) {
    const relative = `public/${route.slice(1)}index.html`;
    const bytes = await readFile(path.join(pointer.release_root, relative));
    assert.equal(sha256(bytes), rows.get(relative), `unauthenticated predecessor: ${route}`);
    await writeFile(path.join(root, relative), bytes);
  }
  // The other copied pages supply real codemod/llms dependencies, but are not
  // indexable in this isolated two-route TEST fixture.
  await writeFile(path.join(root, "public/sitemap.xml"), `<urlset>${[PROBE_ROUTE, UNTOUCHED_ROUTE].map(route => `<url><loc>https://glpclinicscout.com${route}</loc></url>`).join("")}</urlset>`);
  const llmsFile = path.join(root, "data/llms-priority.json");
  const llms = JSON.parse(await readFile(llmsFile, "utf8"));
  llms.sections = llms.sections.map(section => ({ ...section,
    links: section.links.filter(link => [PROBE_ROUTE, UNTOUCHED_ROUTE].includes(link.route)),
  })).filter(section => section.links.length);
  await writeFile(llmsFile, JSON.stringify(llms)); // Explicitly scoped TEST indexability, not a production edit.
  // A sealed release is 0444. cp preserves that mode, but this isolated fixture
  // is intentionally mutated by the postbuild stage under test.
  const writable = spawnSync("chmod", ["-R", "u+w", path.join(root, "public")], { encoding: "utf8" });
  assert.equal(writable.status, 0, writable.stderr);
  return root;
}

function runStage(root, env = {}) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "postbuild-aeo-surface.mjs")], {
    encoding: "utf8",
    env: { ...process.env, GCS_RELEASE_STAGE: "production-seal", GLP_LASTMOD_PROVENANCE_REFRESH: "", GLP_LASTMOD_DECLARED_ROUTES: "", GLP_LASTMOD_DECLARED_ROUTES_FILE: "", ...env },
  });
}

async function preparedStage(root, { preserveHardlink = false } = {}) {
  const prepared = await prepareLastmod(root);
  // Recreate the registered caller's cache handoff inside the isolated fixture.
  // This is preparer output, never a hand-minted production baseline.
  const provenanceFile = path.join(root, "data/page-content-provenance.json");
  if (preserveHardlink) {
    const existing = JSON.parse(await readFile(provenanceFile, "utf8"));
    for (const route of [PROBE_ROUTE, UNTOUCHED_ROUTE])
      assert.deepEqual(existing.pages[route], prepared.provenance.pages[route]);
    assert.equal((await stat(provenanceFile)).nlink, 2, "preparer lost the hardlink before the stage");
  } else {
    await rm(provenanceFile, { force: true });
    await writeFile(provenanceFile, JSON.stringify(prepared.provenance) + "\n");
  }
  const input = await openComparisonInput(root, prepared.input);
  try {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/postbuild-aeo-surface.mjs")], {
      encoding: "utf8", cwd: root,
      env: { ...prepared.env, GCS_RELEASE_STAGE: "production-seal" },
      stdio: [input.fd, "pipe", "pipe"],
    });
    return { ...result, prepared };
  } finally { await input.close(); }
}

const provenanceOf = async (root) =>
  JSON.parse(await readFile(path.join(root, "data", "page-content-provenance.json"), "utf8")).pages;

test("end to end: a declared change ships a new truthful lastmod; an undeclared one kills the build", async (t) => {
  t.diagnostic("runs the real post-build stage over the real rendered tree");
  const root = await fixture();

  // The pinned predecessor supplies the baseline; no blanket refresh or
  // fictitious historical production publication is minted in this test.
  const clean = await preparedStage(root);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.prepared.comparison.changed, 0);
  const baseline = await provenanceOf(root);
  assert.ok(baseline[PROBE_ROUTE] && baseline[UNTOUCHED_ROUTE]);
  const releaseDate = clean.prepared.env.GLP_RELEASE_DATE;
  assert.ok(releaseDate > baseline[PROBE_ROUTE].lastmod, "predecessor must predate the same TEST transition");

  // A real content change on one indexable route.
  const page = path.join(root, "public", `${PROBE_ROUTE.replace(/^\//, "")}index.html`);
  const before = await readFile(page, "utf8");
  await writeFile(page, before.replace("</body>", "<p>declared-route provenance probe</p></body>"));

  const undeclared = runStage(root, { GLP_RELEASE_DATE: releaseDate });
  assert.equal(undeclared.status, 1, "an undeclared content change was allowed through");
  assert.match(undeclared.stderr, new RegExp(`lastmod_provenance_stale:${PROBE_ROUTE}`));

  // Declaring a DIFFERENT route does not buy the changed one a pass.
  const misdeclared = runStage(root, { GLP_RELEASE_DATE: releaseDate, GLP_LASTMOD_DECLARED_ROUTES: UNTOUCHED_ROUTE });
  assert.equal(misdeclared.status, 1, "a declaration of an unrelated route covered the changed one");
  assert.match(misdeclared.stderr, new RegExp(`lastmod_provenance_stale:${PROBE_ROUTE}`));

  // The registered preparer declares only the changed page; the untouched
  // control retains its authenticated predecessor record without a claim.
  const declared = await preparedStage(root);
  assert.equal(declared.status, 0, declared.stderr);
  const receipt = JSON.parse(declared.stdout.trim().split("\n").at(-1));
  assert.deepEqual(receipt.declared_routes_refreshed, [PROBE_ROUTE]);
  assert.deepEqual(JSON.parse(declared.prepared.input).routes, [PROBE_ROUTE]);
  assert.equal(receipt.provenance_refresh, false);
  assert.equal(receipt.provenance_written, true);

  const after = await provenanceOf(root);
  const moved = Object.keys(after).filter((route) =>
    JSON.stringify(after[route]) !== JSON.stringify(baseline[route]));
  assert.deepEqual(moved, [PROBE_ROUTE], "provenance moved on a route that was not declared-and-changed");
  assert.equal(after[PROBE_ROUTE].lastmod, releaseDate);
  assert.ok(after[PROBE_ROUTE].lastmod > baseline[PROBE_ROUTE].lastmod);
  assert.notEqual(after[PROBE_ROUTE].content_sha256, baseline[PROBE_ROUTE].content_sha256);
  assert.deepEqual(after[UNTOUCHED_ROUTE], baseline[UNTOUCHED_ROUTE]);

  const sitemap = await readFile(path.join(root, "public", "sitemap.xml"), "utf8");
  assert.ok(sitemap.includes(`<loc>https://glpclinicscout.com${PROBE_ROUTE}</loc><lastmod>${releaseDate}</lastmod>`));
  assert.ok(sitemap.includes(`<loc>https://glpclinicscout.com${UNTOUCHED_ROUTE}</loc><lastmod>${baseline[UNTOUCHED_ROUTE].lastmod}</lastmod>`));
});

test("end to end: the provenance file is DETACHED, not written through a predecessor hardlink", async () => {
  // Reproduces the machine's own materialization: a candidate is hardlinked from
  // an immutable sealed release, so a file this build has not itself rewritten is
  // still the predecessor's read-only inode. Observed live 2026-08-20T21:15Z as
  // `EACCES: permission denied, open '…/data/page-content-provenance.json'` on
  // the first machine build that ever refreshed a declared route.
  const root = await fixture();
  const clean = await preparedStage(root);
  assert.equal(clean.status, 0, clean.stderr);

  const provenance = path.join(root, "data", "page-content-provenance.json");
  const sealed = path.join(root, "sealed-predecessor-provenance.json");
  await cp(provenance, sealed);
  await rm(provenance);
  await link(sealed, provenance);          // the hardlink the materializer makes
  await chmod(sealed, 0o444);              // …to an immutable sealed inode
  const sealedBytesBefore = await readFile(sealed, "utf8");
  assert.equal((await stat(provenance)).nlink, 2, "fixture did not create a hardlink");

  const page = path.join(root, "public", `${PROBE_ROUTE.replace(/^\//, "")}index.html`);
  await writeFile(page, (await readFile(page, "utf8")).replace("</body>", "<p>detach probe</p></body>"));

  const declared = await preparedStage(root, { preserveHardlink: true });
  assert.equal(declared.status, 0, declared.stderr);
  // Written, on a NEW inode…
  assert.equal((await stat(provenance)).nlink, 1, "provenance was written through the shared inode");
  assert.equal(JSON.parse(await readFile(provenance, "utf8")).pages[PROBE_ROUTE].lastmod, declared.prepared.env.GLP_RELEASE_DATE);
  // …and the sealed predecessor's bytes are untouched.
  assert.equal(await readFile(sealed, "utf8"), sealedBytesBefore);
});

test("end to end: declaring routes while the blanket refresh is on is refused, not merged", async () => {
  const root = await fixture();
  const clean = await preparedStage(root);
  assert.equal(clean.status, 0, clean.stderr);
  const both = runStage(root, {
    GLP_RELEASE_DATE: clean.prepared.env.GLP_RELEASE_DATE, GLP_LASTMOD_PROVENANCE_REFRESH: "1", GLP_LASTMOD_DECLARED_ROUTES: PROBE_ROUTE,
  });
  assert.equal(both.status, 1);
  assert.match(both.stderr, /lastmod_declared_routes_with_blanket_refresh/);
});
