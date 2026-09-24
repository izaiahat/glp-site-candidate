import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_ROOT = path.join(ROOT, "assets", "derivatives", "provider-review-pass2");
const LOGO_ROOT = path.join(ROOT, "assets", "provider-logos");
const SCENE_EXTENSIONS = Object.freeze([
  "640.avif", "1280.avif", "640.webp", "1280.webp", "640.jpg", "1280.jpg",
]);

let logoManifestCache;
function logoManifest() {
  if (logoManifestCache !== undefined) return logoManifestCache;
  const manifestPath = path.join(LOGO_ROOT, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("provider_visual_logo_manifest_missing");
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!parsed || !Array.isArray(parsed.logos)) throw new Error("provider_visual_logo_manifest_invalid");
  logoManifestCache = parsed;
  return logoManifestCache;
}

function verifiedLogo(id, { allowMissing = false } = {}) {
  const rows = logoManifest().logos.filter((row) => row?.program_id === id);
  if (rows.length === 0 && allowMissing) return null;
  if (rows.length !== 1) throw new Error(`provider_visual_logo_manifest_invalid:${id}`);
  const row = rows[0];
  if (row.output_file !== `${id}.webp` || row.runtime_remote_load !== false
      || !/^[a-f0-9]{64}$/.test(String(row.output_sha256 || ""))
      || !Number.isInteger(row.width) || row.width < 1
      || !Number.isInteger(row.height) || row.height < 1) {
    throw new Error(`provider_visual_logo_contract_invalid:${id}`);
  }
  const logoPath = path.join(LOGO_ROOT, row.output_file);
  if (!existsSync(logoPath)) throw new Error(`provider_visual_logo_missing:${id}`);
  const observed = createHash("sha256").update(readFileSync(logoPath)).digest("hex");
  if (observed !== row.output_sha256) throw new Error(`provider_visual_logo_hash_drift:${id}`);
  return row;
}

export function providerVisualKind(program) {
  const id = String(program?.program_id || "").trim();
  const name = String(program?.display_name || program?.provider || "").trim();
  if (!/^[a-z0-9-]+$/.test(id) || !name) throw new Error("provider_visual_identity_invalid");
  const present = SCENE_EXTENSIONS.filter((extension) =>
    existsSync(path.join(SCENE_ROOT, `${id}-${extension}`)));
  if (present.length === SCENE_EXTENSIONS.length) return { kind: "editorial-scene", id, name };
  if (present.length !== 0) throw new Error(`provider_visual_scene_family_partial:${id}`);
  const logo = verifiedLogo(id, { allowMissing: true });
  if (!logo) return { kind: "editorial-scene", id, name };
  return { kind: "provider-logo-fallback", id, name, logo };
}

export function renderProviderEvidencePicture(program, { eager = true, className = "p3-provider-visual" } = {}) {
  const visual = providerVisualKind(program);
  if (visual.kind === "provider-logo-fallback") {
    const logo = visual.logo;
    return `<picture class="${esc(className)}" data-provider-visual="${esc(visual.id)}" data-provider-visual-kind="provider-logo-fallback"><img src="/assets/provider-logos/${esc(logo.output_file)}" width="${esc(logo.width)}" height="${esc(logo.height)}" loading="${eager ? "eager" : "lazy"}"${eager ? ' fetchpriority="high"' : ""} decoding="async" alt="First-party ${esc(visual.name)} provider logo; editorial scene unavailable"></picture>`;
  }
  const base = `/assets/images/provider-review-pass2/${visual.id}`;
  return `<picture class="${esc(className)}" data-provider-visual="${esc(visual.id)}" data-provider-visual-kind="editorial-scene"><source srcset="${base}-640.avif 640w, ${base}-1280.avif 1280w" sizes="(max-width:760px) calc(100vw - 32px), 720px" type="image/avif"><source srcset="${base}-640.webp 640w, ${base}-1280.webp 1280w" sizes="(max-width:760px) calc(100vw - 32px), 720px" type="image/webp"><img src="${base}-1280.jpg" srcset="${base}-640.jpg 640w, ${base}-1280.jpg 1280w" sizes="(max-width:760px) calc(100vw - 32px), 720px" width="1280" height="720" loading="${eager ? "eager" : "lazy"}"${eager ? ' fetchpriority="high"' : ""} decoding="async" alt="Original editorial evidence scene for the ${esc(visual.name)} provider profile"></picture>`;
}
