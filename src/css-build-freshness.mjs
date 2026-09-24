import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const COMMON = ["00-foundation.css", "01-primitives.css", "02-shell.css"];
const ACTION_AURORA = "99-action-aurora.css";

export const CSS_BUNDLE_LAYERS = Object.freeze({
  "site-home.css": [...COMMON, "10-home.css", "31-review-intake.css", ACTION_AURORA],
  "site-money.css": [...COMMON, "20-money.css", ACTION_AURORA],
  "site-review.css": [...COMMON, "30-review.css", "31-review-intake.css", ACTION_AURORA],
  // Paid landing pages use the editorial shell but render the shared Funnel V2
  // decision module. Keep its component layer in this bundle as well as p3.
  "site-editorial.css": [...COMMON, "40-editorial.css", "11-phase3.css", "12-phase3-closure.css", "47-funnel-v2.css", ACTION_AURORA],
  "site-tools.css": [...COMMON, "50-tools.css", "55-quiz.css", ACTION_AURORA],
  "site-trust.css": [...COMMON, "80-trust.css", ACTION_AURORA],
  // Phase-4 gate remediation 2026-08-27: p3 revenue-family bundle (GATES-PRELIM
  // issue #3). Must mirror artifacts/ultracode/tools/assemble-css.mjs.
  "site-p3.css": [...COMMON, "11-phase3.css", "12-phase3-closure.css", "30-provider-detail.css", "47-funnel-v2.css", "90-compat.css", ACTION_AURORA],
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function assertSourcesNotNewer(root, bundle, layers) {
  const bundlePath = path.join(root, "assets", bundle);
  const bundleStat = await stat(bundlePath, { bigint: true });
  for (const layer of layers) {
    const sourcePath = path.join(root, "assets", "css-src", layer);
    const sourceStat = await stat(sourcePath, { bigint: true });
    if (sourceStat.mtimeNs > bundleStat.mtimeNs) {
      throw new Error(`css_bundle_stale:${bundle}:${layer}`);
    }
  }
  return bundlePath;
}

export async function validateCssBuildFreshness(root, { requirePublic = true } = {}) {
  const sourceDir = path.join(root, "assets", "css-src");
  const allLayers = (await readdir(sourceDir)).filter((name) => name.endsWith(".css")).sort();
  const bundlePaths = new Map();
  bundlePaths.set("site.css", await assertSourcesNotNewer(root, "site.css", allLayers));
  for (const [bundle, layers] of Object.entries(CSS_BUNDLE_LAYERS)) {
    bundlePaths.set(bundle, await assertSourcesNotNewer(root, bundle, layers));
  }

  const hashes = {};
  for (const [bundle, sourcePath] of bundlePaths) {
    const sourceBytes = await readFile(sourcePath);
    const sourceHash = sha256(sourceBytes);
    hashes[bundle] = sourceHash;
    if (!requirePublic) continue;
    const publicPath = path.join(root, "public", "assets", bundle);
    const publicBytes = await readFile(publicPath);
    const publicHash = sha256(publicBytes);
    if (sourceHash !== publicHash) throw new Error(`public_css_drift:${bundle}`);
    const publicStat = await stat(publicPath, { bigint: true });
    const sourceStat = await stat(sourcePath, { bigint: true });
    if (sourceStat.mtimeNs > publicStat.mtimeNs) throw new Error(`public_css_stale:${bundle}`);
  }

  return {
    status: "PASS",
    source_layers: allLayers.length,
    bundles: [...bundlePaths.keys()],
    hashes,
    public_verified: requirePublic,
  };
}
