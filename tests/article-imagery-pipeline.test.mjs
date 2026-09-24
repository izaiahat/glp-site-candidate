import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifestUrl = new URL("../artifacts/ultracode/article-image-manifest.json", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function expectedOutputs(stem) {
  return new Map([
    [`${stem}-800.avif`, [800, 450]],
    [`${stem}-800.webp`, [800, 450]],
    [`${stem}-800.jpg`, [800, 450]],
    [`${stem}-1600.avif`, [1600, 900]],
    [`${stem}-1600.webp`, [1600, 900]],
    [`${stem}-1600.jpg`, [1600, 900]],
    [`${stem}-og.jpg`, [1200, 630]],
  ]);
}

async function corpusRoutes() {
  const sources = ["content-batch.json", "content-national-wow-additions.json"];
  const routes = [];
  for (const source of sources) {
    const payload = JSON.parse(await readFile(new URL(`../data/blog/${source}`, import.meta.url), "utf8"));
    routes.push(...payload.articles.map((article) => article.canonical_path));
  }
  return routes.sort();
}

test("D42 article imagery covers every current article with a complete original family", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const routes = await corpusRoutes();
  const masterProvenanceUrl = new URL(`../${manifest.master_provenance.path}`, import.meta.url);
  const masterProvenanceBytes = await readFile(masterProvenanceUrl);
  const masterProvenance = JSON.parse(masterProvenanceBytes);
  const routeStateBytes = await readFile(manifest.route_master_state.path);
  const routeState = JSON.parse(routeStateBytes);
  const releaseRecords = Object.values(routeState.records).filter((record) => record.generation_lane === "article_release_pipeline");
  const releaseRoutes = new Set(releaseRecords.map((record) => record.route));
  const inheritedRoutes = routes.filter((route) => !releaseRoutes.has(route));
  const visualQaPath = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-image-generation/VISUAL-QA-20260825.json";
  const visualQa = JSON.parse(await readFile(visualQaPath, "utf8"));
  const contactSheetManifest = JSON.parse(await readFile(visualQa.contact_sheet_manifest, "utf8"));
  const masterPaths = new Set();
  const masterHashes = new Set();
  const outputHashes = new Set();

  assert.equal(manifest.schema, "glp-article-image-system-v3");
  assert.equal(manifest.status, "PASS");
  assert.equal(manifest.article_count, routes.length);
  assert.equal(manifest.records.length, routes.length);
  assert.equal(manifest.output_count, routes.length * 7);
  assert.equal(manifest.route_master_count, routes.length);
  assert.equal(manifest.external_generation_services_used, manifest.route_master_count);
  assert.equal(manifest.generation_model, "gpt_image_2");
  assert.equal(manifest.master_count, masterProvenance.masters.length);
  assert.match(manifest.master_provenance.path, /article-masters\/provenance\.json$/);
  assert.equal(manifest.master_provenance.sha256, sha256(masterProvenanceBytes));
  assert.equal(manifest.route_master_state.path, "artifacts/ultracode/article-route-master-state.json");
  assert.equal(manifest.route_master_state.sha256, sha256(routeStateBytes));
  assert.equal(routeState.schema, "glp-pass2-route-image-generation-v1");
  assert.equal(routeState.job_set_type, "gpt_image_2");
  assert.equal(routeState.model, "GPT Image 2");
  assert.equal(routeState.quality, "high");
  assert.equal(routeState.resolution, "4k");
  assert.equal(Object.keys(routeState.records).length, routes.length);
  assert.equal(manifest.competitor_assets_used, 0);
  assert.deepEqual(manifest.records.map((record) => record.route).sort(), routes);
  assert.equal(manifest.source_files.length, 2);
  for (const source of manifest.source_files) {
    assert.equal(source.sha256, sha256(await readFile(new URL(`../${source.path}`, import.meta.url))), source.path);
  }
  assert.equal(visualQa.schema, "glp-pass2-route-image-visual-qa-v1");
  assert.equal(visualQa.status, "PASS");
  assert.equal(visualQa.route_master_count, inheritedRoutes.length);
  // Contact-sheet count is a monotonic floor: it grows with the article set.
  assert.ok(visualQa.sheet_count >= 9, `expected at least 9 visual QA sheets, saw ${visualQa.sheet_count}`); // 2026-08-27 live-head merge: sheet 9 = 4 new guides
  assert.deepEqual(visualQa.regeneration_required, []);
  assert.equal(visualQa.deploy_count, 0);
  assert.equal(contactSheetManifest.schema, "glp-pass2-route-image-contact-sheets-v1");
  assert.equal(contactSheetManifest.status, "PASS");
  assert.equal(contactSheetManifest.route_master_count, inheritedRoutes.length);
  assert.equal(contactSheetManifest.unique_route_master_hashes, inheritedRoutes.length);
  // Contact-sheet count is a monotonic floor: it grows with the article set.
  assert.ok(contactSheetManifest.sheets.length >= 9, `expected at least 9 contact sheets, saw ${contactSheetManifest.sheets.length}`); // 2026-08-27
  const contactRoutes = contactSheetManifest.sheets.flatMap((sheet) => sheet.routes);
  assert.equal(contactRoutes.length, inheritedRoutes.length);
  assert.equal(new Set(contactRoutes).size, inheritedRoutes.length);
  assert.deepEqual(contactRoutes.sort(), inheritedRoutes);
  for (const sheet of contactSheetManifest.sheets) {
    assert.equal(sheet.sha256, sha256(await readFile(sheet.path)), sheet.path);
  }
  for (const generated of releaseRecords) {
    assert.equal(generated.status, "PASS", generated.route);
    assert.equal(generated.output_path, `assets/source/article-masters-pass2/${generated.stem}.webp`, generated.route);
    assert.match(generated.source_sha256, /^[a-f0-9]{64}$/, generated.route);
    const lineage = generated.release_pipeline_receipt;
    assert.match(lineage.path, /^artifacts\/ultracode\/article-release-image-receipts\/guide-[a-z0-9-]+\.json$/);
    const receiptBytes = await readFile(new URL(`../${lineage.path}`, import.meta.url));
    assert.equal(sha256(receiptBytes), lineage.sha256, generated.route);
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.schema, "glp-article-hero-image-v1", generated.route);
    assert.equal(receipt.status, "GENERATED", generated.route);
    assert.ok(["higgsfield", "gpt_image_2_native"].includes(generated.provider || "higgsfield"), generated.route);
    assert.equal(receipt.model, generated.provider === "gpt_image_2_native" ? "gpt-image-2" : "gpt_image_2", generated.route);
    assert.equal(receipt.provider || "higgsfield", generated.provider || "higgsfield", generated.route);
    assert.equal(receipt.route, generated.route, generated.route);
    assert.equal(receipt.h1, generated.h1, generated.route);
    assert.equal(receipt.visual_key, generated.stem, generated.route);
    assert.equal(receipt.prompt_sha256, generated.prompt_sha256, generated.route);
    assert.equal(receipt.selected_candidate.source.sha256, generated.source_sha256, generated.route);
    const manifestRecord = manifest.records.find((record) => record.route === generated.route);
    assert.ok(manifestRecord, `release manifest record missing: ${generated.route}`);
    const receiptOutputs = receipt.files.map(({ name, width, height, sha256: outputSha }) => ({ name, width, height, sha256: outputSha })).sort((a, b) => a.name.localeCompare(b.name));
    const manifestOutputs = manifestRecord.outputs.map(({ name, width, height, sha256: outputSha }) => ({ name, width, height, sha256: outputSha })).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(manifestOutputs, receiptOutputs, generated.route);
  }
  for (const record of manifest.records) {
    const outputs = expectedOutputs(record.stem);
    assert.equal(record.outputs.length, 7);
    assert.match(record.art_direction, /no burned-in text/);
    assert.doesNotMatch(record.art_direction, /magnifying/i);
    assert.equal(record.disposition, "generated_from_gpt_image_2_route_master");
    assert.equal(record.generation_model, "gpt_image_2");
    assert.equal(record.master_path, `assets/source/article-masters-pass2/${record.stem}.webp`);
    assert.match(record.master_sha256, /^[a-f0-9]{64}$/);
    assert.match(record.prompt_sha256, /^[a-f0-9]{64}$/);
    assert.match(record.seed_sha256, /^[a-f0-9]{64}$/);
    assert.match(record.title_sha256, /^[a-f0-9]{64}$/);
    const generated = routeState.records[record.route];
    assert.ok(generated, `state record missing: ${record.route}`);
    assert.equal(generated.status, "PASS", record.route);
    assert.equal(generated.route, record.route, record.route);
    assert.equal(generated.stem, record.stem, record.route);
    assert.equal(generated.subject, record.subject, record.route);
    assert.equal(generated.output_sha256, record.master_sha256, record.route);
    assert.equal(generated.prompt_sha256, record.prompt_sha256, record.route);
    assert.equal(sha256(await readFile(new URL(`../${record.master_path}`, import.meta.url))), record.master_sha256, record.route);
    masterPaths.add(record.master_path);
    masterHashes.add(record.master_sha256);
    for (const output of record.outputs) {
      const dimensions = outputs.get(output.name);
      assert.ok(dimensions, `unexpected output name for ${record.route}: ${output.name}`);
      assert.deepEqual([output.width, output.height], dimensions, output.name);
      assert.match(output.sha256, /^[a-f0-9]{64}$/);
      for (const prefix of ["assets/derivatives", "public/assets/images"]) {
        const relative = `${prefix}/${output.name}`;
        assert.equal(sha256(await readFile(new URL(`../${relative}`, import.meta.url))), output.sha256, relative);
      }
      outputHashes.add(output.sha256);
    }
  }
  assert.equal(masterPaths.size, routes.length, "route masters are not one-per-route");
  assert.equal(masterHashes.size, routes.length, "route master bytes are duplicated across routes");
  assert.equal(outputHashes.size, manifest.output_count, "article derivative bytes are duplicated across routes");
});

test("D42 future-article image gate verifies hashes, dimensions, EXIF, and corpus lineage", () => {
  const output = execFileSync("python3", ["scripts/generate-article-imagery.py", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(output, /"status": "PASS"/);
});

test("D42 hero derivatives fit the mobile transfer budget the cross-device matrix enforces", async () => {
  // GLP-38 / W18: at <=390 CSS px and deviceScaleFactor >= 2 the hero srcset
  // resolves to the -1600 rung, and tests/browser/cross-device.spec.mjs holds
  // that fetch to 120,000 transfer bytes. The producer owns the fit; the spec is
  // never loosened. avif and webp are the two rungs a phone negotiates out of
  // the <picture>, so both carry the budget.
  const BROWSER_BUDGET = 120_000;
  const PRODUCER_BUDGET = 118_000; // margin for response headers (~300 bytes measured)
  const producer = await readFile(new URL("../scripts/generate-article-imagery.py", import.meta.url), "utf8");
  assert.match(producer, /MOBILE_HERO_TRANSFER_BUDGET = 120_000/);
  assert.match(producer, /HEADER_MARGIN = 2_000/);
  assert.match(producer, /"avif": MOBILE_HERO_TRANSFER_BUDGET - HEADER_MARGIN/);
  assert.match(producer, /"webp": MOBILE_HERO_TRANSFER_BUDGET - HEADER_MARGIN/);
  assert.ok(PRODUCER_BUDGET < BROWSER_BUDGET, "the producer must encode below the browser budget, not to it");

  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const budgeted = [];
  for (const record of manifest.records) {
    for (const output of record.outputs) {
      if (!/-1600\.(avif|webp)$/.test(output.name)) continue;
      budgeted.push(output.name);
      assert.ok(output.bytes <= PRODUCER_BUDGET,
        `${output.name} is ${output.bytes} bytes, over the ${PRODUCER_BUDGET}-byte producer budget`);
      for (const prefix of ["assets/derivatives", "public/assets/images"]) {
        const bytes = await readFile(new URL(`../${prefix}/${output.name}`, import.meta.url));
        assert.equal(bytes.length, output.bytes, `${prefix}/${output.name}`);
        assert.ok(bytes.length < BROWSER_BUDGET, `${prefix}/${output.name} exceeds the browser budget`);
      }
    }
  }
  assert.equal(budgeted.length, manifest.records.length * 2, "every route carries one -1600 avif and one -1600 webp");

  // The hero that failed the matrix at DPR 3 (125,918 transfer / 125,618 on disk).
  const ed = manifest.records.find((record) => record.route === "/guides/erectile-dysfunction-evidence-overview/");
  assert.ok(ed, "ed-evidence record missing");
  for (const suffix of ["avif", "webp"]) {
    const output = ed.outputs.find((row) => row.name === `guide-erectile-dysfunction-evidence-overview-1600.${suffix}`);
    assert.ok(output.bytes <= PRODUCER_BUDGET, `${output.name} is ${output.bytes} bytes`);
    assert.deepEqual([output.width, output.height], [1600, 900], "the hero's dimensions are unchanged");
  }

  // The budget is enforced by the build's own gate, not only by these bytes:
  // an inflated record must make `--check` refuse.
  const refusal = spawnSync("python3", ["-c", `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("article_images", "scripts/generate-article-imagery.py")
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
manifest = json.loads(open("artifacts/ultracode/article-image-manifest.json").read())
for record in manifest["records"]:
    for output in record["outputs"]:
        if output["name"].endswith("-1600.avif"):
            output["bytes"] = 125618
try:
    module.check(manifest)
except RuntimeError as error:
    print(str(error)); sys.exit(0)
sys.exit(1)
`], { cwd: root, encoding: "utf8" });
  assert.equal(refusal.status, 0, `the gate did not refuse an over-budget record: ${refusal.stderr}`);
  assert.match(refusal.stdout, /^article_image_byte_budget_exceeded:[a-z0-9-]+-1600\.avif:125618>118000$/m);
});
