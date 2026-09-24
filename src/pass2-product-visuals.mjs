const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export function productVisualId(page, family) {
  if (family === "brand") return `brand-${page.slug}`;
  if (family === "compounded") return `compounded-${page.medication_id}`;
  if (family === "bulk") return `bulk-${page.duration_months}-month`;
  throw new Error(`product_visual_family_invalid:${family}`);
}

export function renderProductComparisonPicture(page, family, { eager = true } = {}) {
  const stem = productVisualId(page, family);
  const title = String(page?.name || "").trim();
  if (!/^[a-z0-9-]+$/.test(stem) || !title) throw new Error("product_visual_identity_invalid");
  const base = `/assets/images/product-comparison-pass2/${stem}`;
  const mobileWidth = stem === "brand-wegovy" ? 384 : 640;
  return `<picture class="p3-product-visual" data-product-visual="${esc(stem)}"><source media="(max-width:760px)" srcset="${base}-${mobileWidth}.webp" type="image/webp"><source media="(max-width:760px)" srcset="${base}-${mobileWidth}.avif" type="image/avif"><source srcset="${base}-640.avif 640w, ${base}-1280.avif 1280w" sizes="720px" type="image/avif"><source srcset="${base}-640.webp 640w, ${base}-1280.webp 1280w" sizes="720px" type="image/webp"><img src="${base}-1280.jpg" srcset="${base}-640.jpg 640w, ${base}-1280.jpg 1280w" sizes="(max-width:760px) calc(100vw - 32px), 720px" width="1280" height="720" loading="${eager ? "eager" : "lazy"}"${eager ? ' fetchpriority="high"' : ""} decoding="async" alt="Original editorial comparison scene for the ${esc(title)} evidence route"></picture>`;
}
