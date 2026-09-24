import { renderProductComparisonPicture } from "./pass2-product-visuals.mjs";
import { renderProviderEvidencePicture } from "./pass2-provider-visuals.mjs";

function wrapHeroWithVisual(html, heroClass, visual, extraClass) {
  const marker = `<section class="${heroClass}`;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`pass2_visual_hero_missing:${heroClass}`);
  const openEnd = html.indexOf(">", start);
  const close = html.indexOf("</section>", openEnd);
  if (openEnd < 0 || close < 0) throw new Error(`pass2_visual_hero_malformed:${heroClass}`);
  const opening = html.slice(start, openEnd + 1).replace(`class="${heroClass}`, `class="${heroClass} ${extraClass}`);
  if (opening.includes('d3-profile-hero')) {
    // Keep the source-bound prices as the second grid child. Wrapping the
    // entire hero in the copy column silently undoes the approved layout.
    const content = html.slice(openEnd + 1, close);
    const pricesStart = content.indexOf('<div class="d3-hero-prices"');
    if (pricesStart < 0) throw new Error('d3_visual_hero_prices_missing');
    return `${html.slice(0, start)}${opening}<div class="p3-visual-hero__copy">${content.slice(0, pricesStart)}${visual}</div>${content.slice(pricesStart)}${html.slice(close)}`;
  }
  return `${html.slice(0, start)}${opening}<div class="p3-visual-hero__copy">${html.slice(openEnd + 1, close)}</div>${visual}${html.slice(close)}`;
}

export function upgradePhase3PageVisuals(html, { family, route, graph, registry }) {
  if (typeof html !== "string" || !family || !route) throw new Error("pass2_visual_upgrade_input_invalid");
  if (family === "provider-detail") {
    const programId = route.match(/^\/providers\/([a-z0-9-]+)\/$/)?.[1];
    const program = [...(registry?.programs || []), ...(graph?.provider_work_order_additions || [])].find((row) => row.program_id === programId);
    if (!program) throw new Error(`pass2_provider_visual_program_missing:${programId || route}`);
    return wrapHeroWithVisual(html, "p3-index-hero", renderProviderEvidencePicture(program), "p3-index-hero--visual");
  }
  if (family === "brand-product") {
    const page = (graph?.brand_pages || []).find((row) => row.route === route);
    if (!page) throw new Error(`pass2_brand_visual_route_missing:${route}`);
    const visual = renderProductComparisonPicture(page, "brand");
    if (!/<picture class="p3-product-float"[\s\S]*?<\/picture>/.test(html)) throw new Error(`pass2_brand_visual_placeholder_missing:${route}`);
    return html.replace(/<picture class="p3-product-float"[\s\S]*?<\/picture>/, visual);
  }
  if (family === "compounded-category") {
    const page = (graph?.compounded_pages || []).find((row) => row.route === route);
    if (!page) throw new Error(`pass2_compounded_visual_route_missing:${route}`);
    const visual = renderProductComparisonPicture(page, "compounded");
    if (/<div class="p3-category-orb"[^>]*>[\s\S]*?<\/div>/.test(html)) return html.replace(/<div class="p3-category-orb"[^>]*>[\s\S]*?<\/div>/, visual);
    return wrapHeroWithVisual(html, "p3-category-hero", visual, "p3-category-hero--visual");
  }
  if (family === "bulk-intent") {
    const page = (graph?.bulk_pages || []).find((row) => row.route === route);
    if (!page) throw new Error(`pass2_bulk_visual_route_missing:${route}`);
    const marker = '<header class="listing__intro">';
    if (!html.includes(marker)) throw new Error(`pass2_bulk_visual_hero_missing:${route}`);
    return html.replace(/<header class="listing__intro">([\s\S]*?)<\/header>/, (_, content) =>
      `<header class="listing__intro listing__intro--bulk-visual">${content}${renderProductComparisonPicture(page, "bulk")}</header>`);
  }
  return html;
}
