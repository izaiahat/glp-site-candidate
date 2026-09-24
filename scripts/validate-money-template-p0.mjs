import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "money-page-specs.json");
const PUBLIC = path.join(ROOT, "public");
const DEFAULT_RECEIPT = "/home/ubuntu/business/reports/glp-clinic-scout/operator-national-wow-20260723/money-template-p0-validation.json";
const RECEIPT = process.argv[2] || DEFAULT_RECEIPT;
const REVISION = "money-page-p0-v2";

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function publicPath(route) {
  return path.join(PUBLIC, route.replace(/^\//, ""), "index.html");
}

async function main() {
  const rawData = await readFile(DATA, "utf8");
  const data = JSON.parse(rawData);
  const sharedCss = await readFile(path.join(PUBLIC, "assets", "site.css"), "utf8");
  const checks = [];
  const failures = [];
  const pageReceipts = [];
  const check = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    if (!pass) failures.push({ name, detail });
  };

  check("template_revision", data.template_revision === REVISION, data.template_revision);
  check("page_count", data.pages.length === 13, data.pages.length);

  for (const page of data.pages) {
    const file = publicPath(page.path);
    const html = await readFile(file, "utf8");
    const pageChecks = {
      revision: page.template_revision === REVISION,
      intent_cards: count(html, /class="intent-card"/g) === page.best_for.length,
      provider_cards: count(html, /class="provider-card anchor-section"/g) === page.rows.length,
      triple_ctas: count(html, /class="triple-cta"/g) === page.rows.length,
      best_for_box: html.includes('id="best-for"'),
      ten_point_scores: html.includes('class="score-ten"') && html.includes("/10"),
      star_glyphs: html.includes('class="stars"') && html.includes("★★★★★"),
      quantified_trust: html.includes('id="methodology"') && html.includes('class="trust-metrics"'),
      sticky_jump_nav: html.includes('class="jump-nav"') && /\.jump-nav[^}]*position:\s*sticky/s.test(sharedCss),
      verdict_proof: /id="quick-answer"[\s\S]*?class="social-proof/.test(html),
      table_proof: /<table[\s\S]*?class="social-proof/.test(html),
      card_proof: /class="provider-card[\s\S]*?class="social-proof/.test(html),
      no_live_go_href: !/href="\/go\//.test(html),
      held_route_present: html.includes('data-held-route="/go/'),
      no_aggregate_rating: !html.includes("AggregateRating"),
      no_medical_reviewer_claim: !/Medically reviewed by|medical reviewer/i.test(html),
      noindex: /<meta name="robots" content="[^"]*noindex/.test(html),
    };
    const failed = Object.entries(pageChecks).filter(([, pass]) => !pass).map(([name]) => name);
    check(`page:${page.page_id}`, failed.length === 0, failed.length ? failed : "PASS");
    pageReceipts.push({ page_id: page.page_id, route: page.path, html_sha256: hash(html), provider_cards: page.rows.length, intent_cards: page.best_for.length, checks: pageChecks });
  }

  const providerCards = data.pages.reduce((total, page) => total + page.rows.length, 0);
  const intentCards = data.pages.reduce((total, page) => total + page.best_for.length, 0);
  const receipt = {
    status: failures.length ? "FAIL" : "PASS",
    template_revision: REVISION,
    generated_at: new Date().toISOString(),
    source_data_sha256: hash(rawData),
    pages: data.pages.length,
    provider_cards: providerCards,
    intent_cards: intentCards,
    checks,
    failures,
    page_receipts: pageReceipts,
    safety: { link_dark: true, noindex: true, clinician_reviewer_rendered: false, aggregate_rating_schema_rendered: false },
  };
  await mkdir(path.dirname(RECEIPT), { recursive: true });
  await writeFile(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: receipt.status, pages: receipt.pages, provider_cards: providerCards, intent_cards: intentCards, failures })}\n`);
  if (failures.length) process.exitCode = 1;
}

await main();
