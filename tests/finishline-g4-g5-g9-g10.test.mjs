import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { reviewBrief, renderBlogPost } from "../src/blog-system.mjs";
import { loadAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import { ensureReviewDepth, visibleWordCount } from "../src/review-depth.mjs";
import { renderPromoEvidence, resolvePromo } from "../src/promo-code.mjs";
import { renderMysteryShop, buildMysteryShopArtifacts, loadEvidenceInputs } from "../src/mystery-shop.mjs";

const root = new URL("..", import.meta.url);
const readJson = async (file) => JSON.parse(await readFile(new URL(file, root), "utf8"));

 test("G4 supplement makes a short provider review pass the visible-word gate", () => {
  const short = "<html><body><main><h1>Example Provider review</h1><p>Published source record.</p></main></body></html>";
  const result = ensureReviewDepth(short, "/reviews/example-provider/");
  assert.equal(result.changed, true);
  assert.ok(result.after >= 1800);
  assert.equal(visibleWordCount(result.html), result.after);
  assert.match(result.html, /review-depth-supplement/);
});

test("G5 Gate C passes the two explicitly commercial guides and renders sponsored links", async () => {
  const batch = await readJson("data/blog/content-batch.json");
  const authors = await readJson("data/blog/author-registry.json");
  const author = authors.authors.find((item) => item.author_id === "clinic-scout-editorial-team");
  for (const route of ["/guides/cheapest-glp1/", "/guides/zepbound-coupon/"]) {
    const brief = batch.articles.find((item) => item.canonical_path === route);
    assert.equal(brief.surface_taxonomy, "commercial");
    assert.equal(reviewBrief(brief, author).status, "PASS");
    const html = renderBlogPost(brief, null, author);
    assert.match(html, /Affiliate disclosure/);
    assert.match(html, /data-p1-capture-surface/);
    assert.match(html, /action="\/api\/content-upgrade"/);
    // 2026-08-27 surface authority in prose: a brief affiliate_link renders
    // sponsored ONLY when the guides link map carries it live; a held program
    // (shedrx/serena-health pending the §4.5 Awin guides-surface re-mint)
    // renders as its internal review link instead — the launch route proof
    // found the raw held href shipping with bare rel="sponsored".
    const guideLinks = loadAffiliateLinkMap("guides");
    const liveLinks = brief.affiliate_links.filter((item) => guideLinks[item.program_id]?.live === true && guideLinks[item.program_id]?.affiliate_href);
    const heldLinks = brief.affiliate_links.filter((item) => !liveLinks.includes(item));
    const anchors = [...JSDOM.fragment(html).querySelectorAll("a")];
    const sponsored = anchors.filter((anchor) => anchor.relList.contains("sponsored") && anchor.relList.contains("noopener"));
    assert.ok(sponsored.length >= liveLinks.length);
    for (const live of liveLinks) {
      const matches = anchors.filter((anchor) => anchor.getAttribute("href") === live.url && anchor.dataset.program === live.program_id);
      assert.ok(matches.length > 0, `${live.program_id} live href must render on a guide`);
      for (const anchor of matches) {
        assert.ok(anchor.relList.contains("sponsored"), `${live.program_id} live href must be sponsored`);
        assert.ok(anchor.relList.contains("noopener"), `${live.program_id} live href must be noopener`);
      }
    }
    for (const held of heldLinks) {
      assert.ok(!html.includes(held.url), `${held.program_id} held href must not render on a guide`);
      assert.match(html, new RegExp(`href="${(guideLinks[held.program_id]?.review_path || `/reviews/${held.program_id}/`).replaceAll("/", "\\/")}"`));
    }
  }
});

test("G5 content-upgrade capture covers legacy and suppress-CTA article renderers", async () => {
  const batch = await readJson("data/blog/content-batch.json");
  const authors = await readJson("data/blog/author-registry.json");
  const author = authors.authors.find((item) => item.author_id === "clinic-scout-editorial-team");
  const source = batch.articles.find((item) => item.canonical_path === "/guides/cheapest-glp1/");
  const legacy = renderBlogPost({ ...source, sections: [], suppress_cta: true }, null, author);
  assert.match(legacy, /rel="canonical" href="https:\/\/glpclinicscout\.com\/guides\/cheapest-glp1\/"/);
  assert.match(legacy, /data-p1-capture-surface/);
  assert.equal((legacy.match(/action="\/api\/content-upgrade"/g) || []).length, 1);
});

test("G5 Gate C blocks tracked links on a medical surface", async () => {
  const batch = await readJson("data/blog/content-batch.json");
  const authors = await readJson("data/blog/author-registry.json");
  const author = authors.authors.find((item) => item.author_id === "clinic-scout-editorial-team");
  const brief = batch.articles.find((item) => item.canonical_path === "/guides/zepbound-coupon/");
  const medical = { ...brief, surface_taxonomy: "medical" };
  assert.equal(reviewBrief(medical, author).reason, "medical_surface_must_be_tracked_link_clean");
});

test("G10 promo resolver fails closed for unverified, stale, and expired codes", () => {
  const unverified = { status: "NOT_VERIFIED", code: null, source_url: null };
  assert.equal(resolvePromo(unverified, "2026-08-04T00:00:00Z").status, "NOT_VERIFIED");
  assert.match(renderPromoEvidence(unverified, "2026-08-04T00:00:00Z"), /No verified current promo code/);
  const stale = { status: "VERIFIED", code: "OLD50", source_url: "https://example.com/terms", verified_as_of: "2026-01-01", expires_at: null };
  assert.equal(resolvePromo(stale, "2026-08-04T00:00:00Z").status, "HELD");
  assert.doesNotMatch(renderPromoEvidence(stale, "2026-08-04T00:00:00Z"), /OLD50/);
  const expired = { status: "VERIFIED", code: "EXPIRED50", source_url: "https://example.com/terms", verified_as_of: "2026-07-24", expires_at: "2026-08-03" };
  assert.equal(resolvePromo(expired, "2026-08-04T00:00:00Z").status, "HELD");
  assert.doesNotMatch(renderPromoEvidence(expired, "2026-08-04T00:00:00Z"), /EXPIRED50/);
});

test("G9 source policy retires clinic and directory routes with static missing-path 404", async () => {
  const source = await readFile(new URL("scripts/build-staging.mjs", root), "utf8");
  const validator = await readFile(new URL("scripts/validate-g9-retirement.mjs", root), "utf8");
  assert.match(source, /status: "RETIRED"/);
  assert.match(source, /await write\("_redirects", `\$\{\[\.\.\.redirectMap\]/);
  const redirects = await readFile(new URL("public/_redirects", root), "utf8");
  assert.match(redirects, /^\/quiz\/ \/quiz\/provider-fit\/ 301$/m);
  assert.match(validator, /STATIC_MISSING_PATH_404/);
  assert.doesNotMatch(source, /write\(`clinics\//);
});

test("G10 rendered mystery-shop evidence labels every observation untested", async () => {
  const { config, ledger } = loadEvidenceInputs(root.pathname);
  const now = ledger.generated_at_utc;
  const html = renderMysteryShop(config, ledger, { now });
  const artifacts = buildMysteryShopArtifacts(config, ledger, { now });
  assert.equal((html.match(/data-evidence-status="UNTESTED_PUBLIC_PAGE_CAPTURE"/g) || []).length, config.observations.length + 1);
  assert.match(html, /Tested staff, account, checkout, payment, and patient-experience evidence count: 0/);
  assert.equal(artifacts.manifest.tested_observations, 0);
  assert.equal(artifacts.manifest.untested_observations, config.observations.length);
});
