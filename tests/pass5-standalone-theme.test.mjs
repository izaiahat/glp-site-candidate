import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { adsLandingContract } from "../src/ads-landing.mjs";
import { selectedFamilyStyles } from "../src/selected-family-styles.mjs";
import { STANDALONE_DARK_THEME_MARKER, applyStandaloneDarkTheme } from "../src/standalone-dark-theme.mjs";
import { loadGoSelection } from "../src/go-runtime-selection.mjs";

const publicHtml = (relativePath) => readFile(new URL(`../public/${relativePath}`, import.meta.url), "utf8");
const readProject = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const styleCspSource = (css) => `'sha256-${createHash("sha256").update(css).digest("base64")}'`;

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssHex(css, name) {
  const match = css.match(new RegExp(`${name}:(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `missing CSS color ${name}`);
  return match[1];
}

const inlineStyles = (html) => [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
const headerBlock = (headers, route) => {
  const marker = `\n${route}*\n`;
  const start = headers.indexOf(marker);
  assert.ok(start >= 0, `missing header block for ${route}`);
  const blockStart = start + 1;
  const blockEnd = headers.indexOf("\n\n", blockStart);
  return headers.slice(blockStart, blockEnd < 0 ? headers.length : blockEnd);
};

const standaloneRoutes = [
  { route: "/research/original-data/public-glp-1-program-pricing-sample/", relative: "research/original-data/public-glp-1-program-pricing-sample/index.html", variant: "original-data", manifest: "artifacts/ops/wave4-original-data-manifest.json", hashKey: "route_sha256" },
  { route: "/research/public-funnel-evidence/", relative: "research/public-funnel-evidence/index.html", variant: "public-funnel-evidence", manifest: "artifacts/ops/wave4-mystery-shop-manifest.json", hashKey: "rendered_html_sha256" },
  { route: "/tools/glp-1-price-tracker/", relative: "tools/glp-1-price-tracker/index.html", variant: "price-tracker", manifest: "artifacts/ops/wave4-price-tracker-manifest.json", hashKey: "html_sha256" },
  { route: "/tools/glp-1-savings-offer-monitor/", relative: "tools/glp-1-savings-offer-monitor/index.html", variant: "savings-monitor", manifest: null, hashKey: null },
];

test("standalone theme helper replaces light CSS with one route-specific dark style", () => {
  const styled = applyStandaloneDarkTheme("<!doctype html><html><head><style>body{background:#fff}</style></head><body></body></html>", "public-funnel-evidence");
  assert.equal((styled.match(new RegExp(STANDALONE_DARK_THEME_MARKER, "g")) || []).length, 1);
  assert.doesNotMatch(styled, /background:#fff/);
  assert.equal(inlineStyles(styled).length, 1);
  assert.equal(applyStandaloneDarkTheme(styled, "public-funnel-evidence"), styled);
  assert.throws(() => applyStandaloneDarkTheme("<main>fragment</main>", "price-tracker"), /standalone_theme_document_invalid/);
  assert.throws(() => applyStandaloneDarkTheme("<!doctype html><html><head></head></html>", "unknown"), /standalone_theme_variant_invalid/);
});

for (const spec of standaloneRoutes) {
  test(`${spec.route} is byte-bound, intrinsically dark, and permitted by an exact style hash`, async () => {
    const [html, headers, buildReportText] = await Promise.all([
      publicHtml(spec.relative),
      publicHtml("_headers"),
      readProject("artifacts/ops/build-report.json"),
    ]);
    const styles = inlineStyles(html);
    assert.equal(styles.length, 1);
    const css = styles[0];
    assert.match(css, new RegExp(`${STANDALONE_DARK_THEME_MARKER}:${spec.variant}`));
    assert.match(css, /color-scheme:dark/);
    assert.match(css, /--cs-ground:#07100d/);
    assert.match(css, /--cs-surface:#101d18/);
    assert.match(css, /--cs-text:#f2f8f4/);
    assert.match(css, /--cs-muted:#a7bfb5/);
    assert.match(css, /--cs-mint:#3fd9a4/);
    assert.match(css, /--cs-cyan:#6fd8ff/);
    assert.doesNotMatch(css, /color-scheme:light|background:#fff(?:[;}])|#f7f4ed|#f6f4ef/);
    assert.ok(contrastRatio(cssHex(css, "--cs-text"), cssHex(css, "--cs-ground")) >= 4.5);
    assert.ok(contrastRatio(cssHex(css, "--cs-text"), cssHex(css, "--cs-surface")) >= 4.5);
    assert.ok(contrastRatio(cssHex(css, "--cs-muted"), cssHex(css, "--cs-surface")) >= 4.5);
    assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i);
    assert.doesNotMatch(html, /\sstyle\s*=/i);

    const block = headerBlock(headers, spec.route);
    const expectedStyleSource = styleCspSource(css);
    assert.match(block, new RegExp(`style-src ${expectedStyleSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(block, /style-src (?:'none'|'unsafe-inline')/);
    for (const directive of ["default-src", "script-src", "connect-src", "img-src", "font-src", "object-src", "base-uri", "form-action", "frame-ancestors"]) {
      assert.match(block, new RegExp(`${directive} 'none'`), `${spec.route} ${directive}`);
    }

    const buildReport = JSON.parse(buildReportText);
    const row = buildReport.surface_derivations.standalone_clean_room.routes.find((item) => item.relative === spec.relative);
    assert.equal(buildReport.surface_derivations.standalone_clean_room.status, "PASS_FINAL_BYTE_PARITY_AND_EXACT_STYLE_CSP");
    assert.equal(row.html_sha256, sha256(html));
    assert.equal(row.style_csp_source, expectedStyleSource);
    if (spec.manifest) {
      const manifest = JSON.parse(await readProject(spec.manifest));
      assert.equal(manifest[spec.hashKey], sha256(html));
    }
  });
}

test("clean-room standalone routes preserve their action and runtime boundaries", async () => {
  const [originalData, evidence, tracker, offers] = await Promise.all(standaloneRoutes.map((spec) => publicHtml(spec.relative)));
  assert.equal((originalData.match(/<script\b/gi) || []).length, 1);
  assert.match(originalData, /<script type="application\/ld\+json">/);
  assert.doesNotMatch(originalData, /<script\b[^>]*src=|<form\b|<a\b[^>]*href=["']https?:/i);
  for (const html of [evidence, tracker, offers]) {
    assert.doesNotMatch(html, /<script\b|<form\b|<a\b|\/go\/|googletagmanager|analytics\.js/i);
  }
});

test("paid OrderlyMeds landing owns one dark critical style and preserves selected-route commerce", async () => {
  const html = await publicHtml("lp/r/orderlymeds/index.html");
  const styles = inlineStyles(html);
  // D2k: one critical dark block PLUS the exact preserved selected-family module.
  const criticalStyles = styles.filter((css) => css.includes("pass5-paid-landing-dark"));
  assert.equal(criticalStyles.length, 1);
  assert.equal(styles.length, 2);
  const preserved = [...html.matchAll(/<style\b[^>]*data-d3-selected-family[^>]*>[\s\S]*?<\/style>/gi)].map((match) => match[0]);
  assert.deepEqual(preserved, [selectedFamilyStyles("/lp/r/orderlymeds/")]);
  const css = criticalStyles[0];
  assert.match(css, /pass5-paid-landing-dark/);
  assert.match(css, /color-scheme:dark/);
  assert.match(css, /--paper:#07100d/);
  assert.match(css, /--card:#101d18/);
  assert.match(css, /--blue:#6fd8ff/);
  assert.match(css, /--on-accent:#04120e/);
  assert.match(css, /\.cta\{[^}]*color:var\(--on-accent\)!important/);
  assert.match(css, /\.caveat\{[^}]*background:rgba\(240,178,63,.14\)/);
  assert.doesNotMatch(css, /--paper:#f7f5ef|--card:#fff|background:#fff8ec|color:#fff!important/);
  const onAccent = cssHex(css, "--on-accent");
  const gradientStops = css.match(/--grad:linear-gradient\([^;]+/)[0].match(/#[0-9a-f]{6}/gi);
  assert.equal(gradientStops.length, 4);
  for (const stop of gradientStops) assert.ok(contrastRatio(onAccent, stop) >= 4.5, `${onAccent} on ${stop}`);

  const body = html.slice(html.indexOf("<body"));
  const disclosure = body.indexOf('class="disc affiliate-note"');
  const proximate = body.indexOf('class="table-disclosure"');
  const commerce = Math.min(...[
    body.indexOf('data-analytics-event="affiliate_click"'),
    body.search(/rel="[^"]*\bsponsored\b/),
  ].filter((index) => index >= 0));
  assert.ok(disclosure >= 0 && disclosure < proximate);
  assert.ok(proximate < commerce);

  const affiliateAnchors = [...html.matchAll(/<a\b[^>]*data-analytics-event="affiliate_click"[^>]*>/g)].map((match) => match[0]);
  const affiliatePositions = affiliateAnchors.map((anchor) => anchor.match(/data-link-position="([^"]+)"/)?.[1]);
  assert.equal(affiliatePositions.filter((position) => position === "lp-hero").length, 1);
  assert.equal(affiliatePositions.filter((position) => position === "lp-sticky").length, 1);
  assert.ok(affiliatePositions.filter((position) => position === "lp-rail").length >= 1);
  const railBody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || "";
  const renderedRailRows = [...railBody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
  assert.ok(renderedRailRows.length >= 3);
  for (const row of renderedRailRows) {
    assert.match(row, /data-link-position="lp-rail"/);
    const live = /data-analytics-event="affiliate_click"[^>]*data-affiliate-state="live"/.test(row);
    const unavailable = /data-affiliate-state="unavailable"/.test(row);
    assert.notEqual(live, unavailable, "each ranked rail row must be exactly live or unavailable");
  }
  assert.doesNotMatch(html, /UNKNOWN_NO_SOURCE|>Not published<|<tr>\s*<\/tr>/);
  for (const anchor of affiliateAnchors) {
    assert.match(anchor, /rel="sponsored nofollow noopener"/);
    const id = anchor.match(/data-program="([^"]+)"/)?.[1];
    const selected = Object.values(loadGoSelection().programs).find((row) => row.render_id === id);
    if (selected?.status === "VERIFIED") {
      assert.ok(anchor.includes(`href="${selected.route}?s=`), id);
      assert.match(anchor, /data-link-mode="server-redirect"/);
    } else {
      assert.match(anchor, /href="https:\/\//);
      assert.match(anchor, /data-link-mode="transparent-direct"/);
    }
    for (const attribute of ["data-network", "data-provider-slug", "data-element-code", "data-rank-position", "data-page-type", "data-sub1", "data-sub2"]) assert.match(anchor, new RegExp(`${attribute}="[^"]+"`));
  }

  assert.match(html, /<meta name="robots" content="noindex,follow,max-image-preview:large">/);
  assert.equal((html.match(/<link\b[^>]*rel=["']stylesheet["']/gi) || []).length, 0);
  assert.equal((html.match(/<script\b[^>]*src=/gi) || []).length, 2);
});

test("paid landing ranking remains rubric-derived and never payout-derived", async () => {
  const source = await readProject("scripts/build-staging.mjs");
  const start = source.indexOf("const lpRanked");
  const end = source.indexOf("const lpRow", start);
  assert.ok(start >= 0 && end > start);
  const rankingBlock = source.slice(start, end);
  assert.match(rankingBlock, /scoreProvider\(right\)/);
  assert.match(rankingBlock, /scoreProvider\(left\)/);
  assert.doesNotMatch(rankingBlock, /commission|payout|epc/i);
  assert.equal(adsLandingContract.rankOrder, "published_rubric_never_payout");
});
