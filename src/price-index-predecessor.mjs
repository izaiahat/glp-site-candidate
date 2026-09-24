import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);

export function validatePriceIndexPredecessor(html, manifestBytes) {
  const manifest = JSON.parse(String(manifestBytes));
  if (manifest.schema !== "glp-clinic-scout-price-index-build-v1" || manifest.route !== "/glp-1-price-index/") {
    throw new Error("price_index_predecessor_manifest_invalid");
  }
  const { payload_sha256, ...payload } = manifest;
  if (hash(canonical(payload)) !== payload_sha256) throw new Error("price_index_predecessor_manifest_hash_mismatch");
  if (hash(html) !== manifest.html_sha256) throw new Error("price_index_predecessor_html_manifest_mismatch");
  return manifest;
}

/**
 * A preserved document and its manifest are one generation, never independent
 * fallback files. Callers must detach writable checkpoint paths before build.
 * Interrupted checkpoint writes fail closed on the next read; they cannot turn
 * a mixed pair into price-preservation authority.
 */
export async function readPriceIndexPredecessor({ htmlPath, manifestPath, snapshotRoot }, io = { readFile, mkdir, writeFile }) {
  const paths = [htmlPath, manifestPath];
  const snapshots = [path.join(snapshotRoot, "glp-1-price-index/index.html"), path.join(snapshotRoot, "ops/price-index-manifest.json")];
  const readOptional = async (file) => {
    try { return await io.readFile(file); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const primary = await Promise.all(paths.map(readOptional));
  let selected = primary;
  let origin = "primary-pair";
  if (primary.some((value) => value === null)) {
    selected = await Promise.all(snapshots.map((file) => io.readFile(file)));
    validatePriceIndexPredecessor(...selected);
    for (let index = 0; index < primary.length; index += 1) {
      if (primary[index] !== null && !Buffer.from(primary[index]).equals(Buffer.from(selected[index]))) {
        throw new Error("price_index_predecessor_partial_source_conflict");
      }
    }
    origin = "verified-checkpoint-pair";
  }
  const manifest = validatePriceIndexPredecessor(...selected);
  if (origin === "primary-pair") {
    for (let index = 0; index < snapshots.length; index += 1) {
      await io.mkdir(path.dirname(snapshots[index]), { recursive: true });
      await io.writeFile(snapshots[index], selected[index]);
    }
  }
  return { html: selected[0], manifestBytes: selected[1], manifest, origin };
}
