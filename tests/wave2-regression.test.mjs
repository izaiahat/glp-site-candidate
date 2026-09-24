import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveRetiredComparisonIntent } from "../functions/best/online-glp-1-providers/index.js";

const ROOT = new URL("../", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);
const READY6_ROUTES = new Set(["/reviews/coivas/", "/reviews/sprout-health/", "/reviews/mangorx/", "/reviews/direct-meds/", "/reviews/shed/", "/reviews/breezemeds/"]);
const PASS2_SHELL_STYLE = '<style data-preserve data-pass2-shell>body[data-cs-template]:not([data-cs-template="home"]):not([data-cs-template="calculator"])>main:not(.p3-page){padding-top:clamp(20px,3vw,42px)!important}</style>';

async function readJson(relative) {
  return JSON.parse(await readFile(new URL(relative, ROOT), "utf8"));
}

async function readPublic(route) {
  const relative = route === "/" ? "index.html" : `${route.replace(/^\//, "")}index.html`;
  return readFile(new URL(relative, PUBLIC), "utf8");
}

function schemas(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

function schemaTypes(html) {
  return new Set(schemas(html).flatMap((schema) => {
    const nodes = Array.isArray(schema?.["@graph"]) ? schema["@graph"] : [schema];
    return nodes.flatMap((node) => Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]]).filter(Boolean);
  }));
}

function allSchemaTypes(value, found = new Set()) {
  if (Array.isArray(value)) for (const item of value) allSchemaTypes(item, found);
  else if (value && typeof value === "object") {
    const type = value["@type"];
    for (const item of Array.isArray(type) ? type : type ? [type] : []) found.add(item);
    for (const child of Object.values(value)) allSchemaTypes(child, found);
  }
  return found;
}

function allSchemaNodes(value, found = []) {
  if (Array.isArray(value)) for (const item of value) allSchemaNodes(item, found);
  else if (value && typeof value === "object") {
    found.push(value);
    for (const child of Object.values(value)) allSchemaNodes(child, found);
  }
  return found;
}

function visibleMainWordCount(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || "";
  const visible = main.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(?:[a-z]+|#\d+);/gi, " ");
  return visible.match(/\b[\w'-]+\b/g)?.length || 0;
}

function articleVertical(article) {
  const route = String(article.canonical_path || "");
  if (/(erectile|viagra|cialis|sildenafil|tadalafil|online-ed)/.test(route)) return "ED";
  if (/(peptide|bpc-157|cjc-1295|ipamorelin)/.test(route)) return "Peptides";
  if (/(hair-loss|minoxidil|finasteride)/.test(route)) return "Hair loss";
  if (/(trt|testosterone)/.test(route)) return "TRT";
  if (/(metabolic-health|metabolic-syndrome|insulin-resistance|continuous-glucose)/.test(route)) return "Wellness";
  return "GLP-1";
}

test("all 57 guide rewrites keep the live typo closed and emit canonical metadata plus schema", async () => {
  const content = await readJson("data/blog/content-batch.json");
  const national = await readJson("data/blog/content-national-wow-additions.json");
  const articles = [...content.articles, ...national.articles];
  const redirected = new Set((await readFile(new URL("_redirects", PUBLIC), "utf8"))
    .trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/)[0]));
  assert.ok(articles.length >= 57);

  for (const article of articles) {
    if (redirected.has(article.canonical_path)) continue;
    const html = await readPublic(article.canonical_path);
    assert.doesNotMatch(html, /\ba evidence limit\b/i, article.canonical_path);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${article.canonical_path}">`), article.canonical_path);
    assert.match(html, /<meta name="description" content="[^\"]{40,}">/, article.canonical_path);
    assert.match(html, /href="\/authors\/clinic-scout-editorial-team\/">the Clinic Scout Editorial Team<\/a>/, article.canonical_path);
    assert.match(html, /class="breadcrumbs"/, article.canonical_path);
    if (articleVertical(article) !== "GLP-1") {
      assert.match(html, /class="guide-toc"/, article.canonical_path);
      assert.doesNotMatch(html, /data-phase3-article="true"/, article.canonical_path);
    } else {
      assert.doesNotMatch(html, /class="guide-toc"/, article.canonical_path);
      assert.match(html, /data-phase3-article="true"/, article.canonical_path);
      assert.match(html, /href="\/insights\/">Insights<\/a>/, article.canonical_path);
    }
    assert.match(html, /class="inline-citation"/, article.canonical_path);
    assert.match(html, /class="gcs-nav"/, article.canonical_path);
    assert.match(html, /class="gcs-footer"/, article.canonical_path);
    const types = schemaTypes(html);
    assert.ok(types.has("Article"), `${article.canonical_path}: Article schema`);
    assert.ok(types.has("BreadcrumbList"), `${article.canonical_path}: BreadcrumbList schema`);
    assert.equal(types.has("AggregateRating"), false, article.canonical_path);
  }

  const whatIs = articles.find((article) => article.canonical_path === "/guides/what-is-glp-1/");
  assert.ok(whatIs);
  assert.doesNotMatch(JSON.stringify(whatIs), /\ba evidence limit\b/i);
});

test("all 11 Sheet-selected provider reviews use the shared shell and shared score lockup", async () => {
  const selection = await readJson("data/affiliate-activation-selection.json");
  // 13 -> 11 on 2026-08-17: Katalys paused Synergy Rx and Care Bare Rx GLP1.
  assert.equal(selection.programs.length, selection.program_count);

  for (const program of selection.programs) {
    const route = `/reviews/${program.program_id}/`;
    const html = await readPublic(route);
    assert.match(html, /href="\/assets\/site-review\.css\?v=[a-f0-9]{16}"/, route);
    assert.match(html, /class="gcs-nav"/, route);
    assert.match(html, /class="gcs-footer"/, route);
    assert.deepEqual(html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [], [PASS2_SHELL_STYLE], `${route}: only the bounded Pass 2 shell style is allowed`);
    assert.match(html, /class="score-lockup"/, route);
    assert.match(html, /class="score-ten"/, route);
    assert.match(html, /class="stars"/, route);
    assert.match(html, /class="stars-fill"/, route);
    assert.match(html, /id="pricing"/, route);
    assert.match(html, /id="cancellation"/, route);
    assert.doesNotMatch(html, /No verified promo code|0\/100/, route);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${route}">`), route);
    assert.doesNotMatch(html, /href="\/go\//, route);
    const types = schemaTypes(html);
    assert.ok(types.has("Article"), `${route}: Article schema`);
    assert.ok(types.has("BreadcrumbList"), `${route}: BreadcrumbList schema`);
  }
});

test("homepage metadata, absolute social images, quiz step copy, and storage-only CTAs are truthful", async () => {
  const home = await readPublic("/");
  assert.match(home, /<meta name="description" content="[^"]+">/);
  assert.match(home, /<link rel="canonical" href="https:\/\/glpclinicscout\.com\/">/);
  assert.ok(schemaTypes(home).has("Organization"));
  assert.ok(schemaTypes(home).has("WebSite"));

  const graph = await readJson("data/phase3-page-graph.json");
  const captureRoutes = ["/providers/", "/self-pay/", "/bulk/", ...graph.brand_pages.map((page) => page.route), ...graph.bulk_pages.map((page) => page.route)];
  for (const route of captureRoutes) {
    const html = await readPublic(route);
    // The rebuilt physical money graph carries one opt-in capture contract and no health-data fields. Paid LPs are intentionally excluded.
    assert.match(html, /consent_version" value="glp-content-upgrade-v2-20260801"/, route);
    for (const form of html.match(/<form[^>]+action="\/api\/content-upgrade"[\s\S]*?<\/form>/g) || []) {
      assert.equal((form.match(/type="checkbox"/g) || []).length, 0, route);
      assert.doesNotMatch(form, /name="(?:email_consent|privacy_consent|marketing_consent)"/, route);
      assert.match(form, /class="capture-consent-note">By submitting your email, you agree to receive this resource and occasional provider-comparison research under the <a href="\/privacy\/">Privacy Policy<\/a>\. Unsubscribe anytime\.<\/p>/, route);
      assert.ok(form.indexOf('class="capture-consent-note"') < form.indexOf('type="submit"'), `${route}: consent notice must precede submit`);
    }
    assert.match(html, /payload\.email_consent='true'/, route);
    assert.doesNotMatch(html, /name="(?:bmi|weight|current_med\w*|diagnosis|medical_history|quiz_answers)"/i, route);
    assert.doesNotMatch(html, />Send the checklist<\/button>/, route);
    assert.doesNotMatch(html, /(?:property="og:image"|name="twitter:image") content="\//, route);
  }

  const quiz = await readPublic("/quiz/provider-fit/");
  assert.match(quiz, /Answer seven quick questions/);
  assert.doesNotMatch(quiz, /(?:five|six) quick questions/i);
  assert.equal((quiz.match(/type="checkbox"/g) || []).length, 0);
  assert.doesNotMatch(quiz, /id="health-consent"|name="(?:privacy_consent|marketing_consent|contact_consent)"/i);
  assert.match(quiz, /In-progress answers stay on this device/);
  assert.match(quiz, /Never sent to analytics/);
  assert.doesNotMatch(quiz, /data-analytics-[^=]*(?:answer|health)|analytics_answer_values[^<]*true/i);
  assert.match(quiz, /data-explore-providers[^>]+href="\/providers\/"/);
});

test("Phase-6 asset inventory is local-only, complete, mirrored, and QA-clean", async () => {
  const provenance = await readJson("artifacts/ultracode/asset-provenance.json");
  assert.equal(provenance.status, "PASS");
  assert.equal(provenance.network_services_used, 0);
  assert.equal(provenance.external_generation_services_used, 0);
  assert.deepEqual(provenance.public_action_counts, { RECROP: 24, REGENERATE_LOCAL: 56, REPROCESS: 53 });
  assert.equal(provenance.public_assets_touched, 133);
  assert.equal(provenance.source_derivative_mirrors_touched, 133);
  assert.equal(provenance.touched_files_total, 266);
  assert.equal(provenance.keep_public_assets_verified_unchanged, 635);
  assert.equal(provenance.unreferenced_retained_count, 238);
  assert.equal(provenance.qa.status, "PASS");
  assert.equal(provenance.qa.full_resolution_outputs_reopened, 266);
  assert.equal(provenance.qa.public_source_mirrors_byte_identical, 133);
  for (const failures of Object.values(provenance.qa.failures)) assert.deepEqual(failures, []);

  const publicOutputs = provenance.assets.filter((asset) => asset.role === "public-output");
  assert.equal(publicOutputs.length, 133);
  for (const asset of publicOutputs) {
    assert.equal(asset.qa.status, "PASS", asset.path);
    assert.equal(asset.qa.exif_entries, 0, asset.path);
  }
  const regenerated = publicOutputs.filter((asset) => asset.action === "REGENERATE_LOCAL");
  assert.equal(new Set(regenerated.map((asset) => asset.sha256_after)).size, 56, "every regenerated derivative must be byte-distinct");

  const content = await readJson("data/blog/content-batch.json");
  const national = await readJson("data/blog/content-national-wow-additions.json");
  const redirected = new Set((await readFile(new URL("_redirects", PUBLIC), "utf8"))
    .trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/)[0]));
  for (const article of [...content.articles, ...national.articles]) {
    if (redirected.has(article.canonical_path)) continue;
    const key = `guide-${article.canonical_path.replace(/\/$/, "").split("/").at(-1)}`;
    assert.match(await readPublic(article.canonical_path), new RegExp(`/assets/images/${key}-1600\\.jpg`), article.canonical_path);
  }

  const selection = await readJson("data/affiliate-activation-selection.json");
  for (const program of selection.programs) {
    const route = `/reviews/${program.program_id}/`;
    assert.match(await readPublic(route), new RegExp(`/assets/images/review-${program.program_id}-og\\.jpg`), route);
  }

  const pageSpecs = await readJson("data/money-page-specs.json");
  const redirects = await readFile(new URL("_redirects", PUBLIC), "utf8");
  for (const page of pageSpecs.pages) {
    const key = `money-${page.path.replace(/\/$/, "").split("/").at(-1)}`;
    try {
      assert.match(await readPublic(page.path), new RegExp(`/assets/images/${key}-og\\.jpg`), page.path);
    } catch (error) {
      assert.match(String(error), /ENOENT/, page.path);
      if (page.path === "/best/online-glp-1-providers/") {
        const escaped = page.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.doesNotMatch(redirects, new RegExp(`^${escaped}\s`, "m"), "query-aware Function route must not be flattened into a static redirect");
        assert.equal(resolveRetiredComparisonIntent(`https://glpclinicscout.com${page.path}?drug=brand-ozempic`), "/ozempic/");
      } else {
        assert.match(redirects, new RegExp(`^${page.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \/(?:providers|self-pay|bulk)\/ 301$`, "m"), page.path);
      }
    }
  }

  const trust = new Map([
    ["/authors/izaiah-tilton/", "author-izaiah-tilton"],
    ["/authors/clinic-scout-editorial-team/", "author-editorial-team"],
    ["/how-we-rate/", "trust-how-we-rate"],
    ["/review-standards/", "trust-review-standards"],
    ["/how-we-make-money/", "trust-how-we-make-money"],
    ["/editorial-guidelines/", "trust-editorial-guidelines"],
  ]);
  for (const [route, key] of trust) {
    assert.match(await readPublic(route), new RegExp(`/assets/images/${key}-og\\.jpg`), route);
  }
  assert.match(await readPublic("/"), /\/assets\/images\/home-evidence-og\.jpg/);
});

test("both author pages are canonical, accountable, and linked to their authored work", async () => {
  const authors = [
    { route: "/authors/izaiah-tilton/", type: "Person" },
    { route: "/authors/clinic-scout-editorial-team/", type: "Organization" },
  ];

  for (const author of authors) {
    const html = await readPublic(author.route);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${author.route}">`), author.route);
    assert.match(html, /class="authored-pages"/, author.route);
    assert.match(html, /class="authored-pages"[\s\S]*?<li><a href="\/guides\//, author.route);
    assert.match(html, /class="gcs-nav"/, author.route);
    assert.match(html, /href="\/quiz\/provider-fit\/">Find your fit/, author.route);
    assert.match(html, /class="gcs-footer"/, author.route);
    assert.ok(schemaTypes(html).has(author.type), `${author.route}: ${author.type} schema`);
    assert.doesNotMatch(html, /Medically reviewed by|hasCredential/i, author.route);
  }
});

test("Wave-2 commercial routes have a balanced ten-source internal-link floor", async () => {
  const sitemap = await readFile(new URL("sitemap.xml", PUBLIC), "utf8");
  const routes = [...sitemap.matchAll(/<loc>https:\/\/glpclinicscout\.com([^<]*)<\/loc>/g)].map((match) => match[1] || "/");
  assert.ok(routes.length >= 88);
  const commercial = routes.filter((route) => /^\/(?:reviews|compare|best)\//.test(route) && !READY6_ROUTES.has(route));
  const sources = new Map(commercial.map((route) => [route, new Set()]));
  for (const source of routes) {
    const html = await readPublic(source);
    const links = new Set([...html.matchAll(/href="([^"#?]+)(?:[?#][^"]*)?"/g)].map((match) => match[1]).filter((href) => href.startsWith("/")));
    for (const target of commercial) if (source !== target && links.has(target)) sources.get(target).add(source);
  }
  for (const [route, incoming] of sources) assert.ok(incoming.size >= 10, `${route}: only ${incoming.size} distinct source routes`);
});

test("all 54 legacy review pages retain the evidence-safe 2026 SERP template and conditional rating schema", async () => {
  const { pageSeoCopy } = await import("../src/page-seo-copy.mjs");
  const sitemap = await readFile(new URL("sitemap.xml", PUBLIC), "utf8");
  const routes = [...sitemap.matchAll(/<loc>https:\/\/glpclinicscout\.com(\/reviews\/[^<]+)<\/loc>/g)].map((match) => match[1]).filter((route) => !READY6_ROUTES.has(route));
  // 32 -> 30 on 2026-08-17: the Synergy RX and CareBareRX review pages were
  // removed when Katalys paused those programs (Breeze Meds is a READY6 route
  // and was already excluded from this set).
  // 32 -> 29 on 2026-08-18: the three niche-fit review pages (Paternity Lab,
  // Advanced Trichology, LyfeFuel) came off this site by operator ruling.
  assert.equal(routes.length, 54); // 2026-08-27 live-head merge: +nu-image
  let rated = 0;
  let pending = 0;
  for (const route of routes) {
    const html = await readPublic(route);
    assert.ok(visibleMainWordCount(html) >= 1800, `${route}: ${visibleMainWordCount(html)} visible main words`);
    const parsed = schemas(html);
    const types = allSchemaTypes(parsed);
    assert.ok(types.has("Product"), `${route}: Product schema`);
    assert.ok(types.has("Review"), `${route}: Review schema`);
    assert.ok(types.has("FAQPage"), `${route}: FAQPage schema`);
    assert.equal(types.has("AggregateRating"), false, route);
    assert.equal(types.has("MedicalWebPage"), false, route);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
    // D2f S4: mapped title/H1 ownership moved to page-seo-copy.test.mjs.
    // Preserve the non-SEO anatomy and conditional-rating assertions here.
    if (!pageSeoCopy(route)) {
      assert.equal(title, h1, route);
      assert.match(title, /Review 2026/);
      assert.ok(title.length <= 60, `${route}: ${title.length}`);
    }
    assert.match(html, /class="review-pricing-evidence"/);
    // 2026-08-18: table containment adds `data-label` to every cell of a prose
    // table (it is what the stacked mobile layout reads), so a cell tag is no
    // longer bare. The assertion is unchanged in substance - the pricing-evidence
    // record still has to carry a real date or the named no-date state.
    assert.match(html, /class="review-pricing-evidence"[\s\S]*?<td[^>]*>(?:\d{4}-\d{2}-\d{2}|Verification date not established)<\/td>/, route);
    assert.doesNotMatch(html, /the date printed in the source notes/i, route);
    assert.match(html, /class="review-alternatives"/);
    assert.equal((html.match(/<div class="review-faq">[\s\S]*?<\/div>/)?.[0].match(/<details>/g) || []).length, 6, route);
    const faq = allSchemaNodes(parsed).find((node) => node["@type"] === "FAQPage");
    assert.equal(faq.mainEntity.length, 6, route);
    const review = allSchemaNodes(parsed).find((node) => node["@type"] === "Review");
    const published = html.match(/<strong class="score-ten">([0-9]+(?:\.[0-9]+)?)<span>\/10<\/span>/);
    if (published) {
      rated += 1;
      assert.equal(review.reviewRating?.["@type"], "Rating", route);
      assert.equal(Number(review.reviewRating.ratingValue), Number(published[1]), route);
      assert.equal(review.reviewRating.bestRating, 10, route);
      assert.equal(review.reviewRating.worstRating, 0, route);
    } else {
      pending += 1;
      assert.equal(review.reviewRating, undefined, route);
    }
  }
  // 2026-08-06 cluster 1: was 13 rated / 14 pending. The 14 "pending" were not
  // providers without evidence - they were fast-path review pages that never
  // bound the merit score their own comparison rows already published.
  // 2026-08-18: the last unscored pages in this (non-READY6) set were the three
  // frozen legacy-vertical pages, which came off the site entirely by operator
  // ruling. Every remaining page in this set now binds a real rating, so an
  // unscored page here is a regression rather than a known exception. The four
  // still-unscored READY6 routes are excluded from `routes` above.
  assert.equal(rated + pending, routes.length);
  assert.ok(rated > 0);
  assert.equal(pending, 0);
  for (const route of routes) {
    const html = await readPublic(route);
    assert.doesNotMatch(html, /Score pending evidence|pending score/i, `${route}: placeholder score`);
  }
});

test("calculator capture requests and serializes the exact displayed cost breakdown", async () => {
  const html = await readPublic("/tools/glp-1-cost-calculator/");
  const result = html.match(/<aside id="cost-result"[\s\S]*?<\/aside>/)?.[0] || "";
  assert.match(result, /Email this cost breakdown/);
  assert.match(result, /Email me this cost breakdown/);
  assert.match(result, /tools-glp-1-cost-calculator-cost-breakdown/);
  for (const name of ["cost_provider_id", "cost_provider_name", "cost_first_month_usd", "cost_recurring_month_usd", "cost_months", "cost_total_usd", "cost_price_context", "cost_checked_as_of"]) assert.match(result, new RegExp(`name="${name}"`), name);
  assert.match(html, /cost_total_usd:displayedMoney\('#result-period'\)/);
  assert.match(html, /cost_provider_name:selected\?\.textContent/);
});

test("Wave-2 title/meta repairs and Synergy RX Weight Loss evidence are current and explicit about unknowns", async () => {
  for (const route of ["/providers/", "/self-pay/"]) {
    const html = await readPublic(route);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
    assert.ok(title.length >= 20 && title.length <= 70, route);
    assert.ok(h1.length >= 20, route);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${route}">`), route);
  }
  const guide = await readPublic("/guides/what-is-glp-1/");
  const guideTitle = guide.match(/<title>([^<]+)<\/title>/)?.[1];
  const guideH1 = guide.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
  const guideMeta = guide.match(/<meta name="description" content="([^"]+)"/)?.[1];
  assert.equal(guideTitle, guideH1);
  assert.ok(guideTitle.length >= 40 && guideTitle.length <= 60);
  assert.ok(guideMeta.length >= 150 && guideMeta.length <= 160);
  await assert.rejects(readPublic("/best-online-glp-1-programs/"), /ENOENT/);
  await assert.rejects(readPublic("/best-compounded-semaglutide-providers/"), /ENOENT/);
  // The Synergy RX Weight Loss evidence assertions lived here. Katalys paused the
  // program on 2026-08-17, so the page is gone and the guarantee that replaces
  // them is that it is really gone: unbuilt, 301'd, and never linked.
  await assert.rejects(readPublic("/reviews/synergy-rx/"), /ENOENT/);
  await assert.rejects(readPublic("/reviews/care-bare-rx-glp1/"), /ENOENT/);
  const redirects = await readFile(new URL("_redirects", PUBLIC), "utf8");
  for (const route of ["/reviews/synergy-rx/", "/reviews/care-bare-rx-glp1/", "/reviews/breezemeds/"]) {
    assert.ok(redirects.includes(`${route} /providers/ 301`), route);
  }
});
