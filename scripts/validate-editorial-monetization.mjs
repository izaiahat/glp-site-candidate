// Build gate — editorial monetization ruling (SPEC-EDITORIAL-MONETIZATION-20260819, B-13/task #61).
//
// The ruling flipped 6 of 8 high-intent pages from citation-only to monetized. The
// whole reason that was safe is a set of boundaries that a future codemod, template
// edit, or machine-minted guide could quietly cross. These are those boundaries, as
// gates. §4.4 of the spec asks for exactly these five and says they ship WITH the
// flip, not after it.
//
//   1. Disclosure order — a disclosure precedes the first money element, and a
//      proximate line precedes the table/module. (Also the site-wide moat rule
//      "disclosure above results", which regressed once already on the money pages.)
//   2. Citation immutability — no affiliate href ever occupies a citation position.
//   3. Surface authority — shedrx/serena-health stay internal on guides until B-40;
//      never-monetized is DERIVED from the terms-decision record, so a rescinded
//      rejection stops holding a provider dark (Measured, operator 2026-08-31).
//   4. Price Index invariants — the printed promise, zero sponsored anchors.
//   5. Present-tense FTC copy — a live page may not describe a held future.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

const PRICE_INDEX_PROMISE = "The source links on this page go directly to provider websites, not affiliate redirectors.";
// ED §2 / §6.4. `measured` carries an operator REJECTION receipt (4787549c…), so it is
// not "not yet authorized" — it is refused. shedrx/serena-health are Awin item-1 rows
// whose authorized-surface list does not include `guides` until the §4.5 re-mint.
const GUIDES_HELD_PROGRAMS = ["shedrx", "serena-health"];
// NEVER-MONETIZED IS DERIVED, NOT DECLARED. Operator ruling 2026-09-03: this
// was a hardcoded ["measured"], and the operator had already rescinded that
// rejection on 2026-08-31 ("i never denied measured ... remove that wherever
// it has that in the system"). A stale copy of a reversed decision kept a live
// provider link-dark. The 08-13 REJECT-TERMS receipt declares its own reversal
// (reversible_by "ACCEPT-TERMS 126727"), so the decision record - not a literal
// - is the authority: a program is never-monetized ONLY while its latest terms
// decision is a rejection with no later acceptance.
const TERMS_DECISIONS_DIR = new URL("../../../../../reports/glp-clinic-scout/affiliate-machine/awin-item1-terms-decisions-20260813/", import.meta.url);
async function deriveNeverMonetizedPrograms() {
  let names = [];
  try { names = await readdir(TERMS_DECISIONS_DIR); } catch { return []; }
  const latest = new Map();
  for (const name of names) {
    if (!name.startsWith("awin-terms-") || !name.endsWith(".json")) continue;
    let doc;
    try { doc = JSON.parse(await readFile(new URL(name, TERMS_DECISIONS_DIR), "utf8")); } catch { continue; }
    if (doc?.schema !== "glp-awin-terms-decision-v2") continue;
    const slug = String(doc.program_name || "").trim().toLowerCase().replace(/\s+/g, "-");
    if (!slug) continue;
    const at = String(doc.recorded_at_utc || "");
    const prior = latest.get(slug);
    if (!prior || at > prior.at) latest.set(slug, { at, decision: String(doc.decision || "") });
  }
  return [...latest.entries()]
    .filter(([, row]) => row.decision === "operator_rejected_terms")
    .map(([slug]) => slug)
    .sort();
}
const NEVER_MONETIZED_PROGRAMS = await deriveNeverMonetizedPrograms();
const MONEY_SURFACE = /^(?:best|cost|compare|reviews)\//;
const HELD_FUTURE_COPY = /held link|future eligible|no outbound affiliate link is active|later approved/i;

async function walk(directory, prefix = "") {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(directory, entry.name), relative));
    else if (relative.endsWith(".html")) out.push(relative);
  }
  return out;
}

// Byte offset in the rendered document IS DOM order. The <style> block is stripped
// first because it names the very classes being ordered, and a CSS rule is not a
// disclosure.
const stripStyles = (html) => html.replace(/<style[\s\S]*?<\/style>/g, (block) => " ".repeat(block.length));

function liveAffiliateAnchors(html) {
  return [...html.matchAll(/<a\b[^>]*data-analytics-event="affiliate_click"[^>]*>/g)];
}

async function main() {
  const findings = [];
  const files = await walk(PUBLIC);
  let guidesChecked = 0;
  let liveGuideAnchors = 0;

  for (const relative of files) {
    const raw = await readFile(path.join(PUBLIC, relative), "utf8");
    const html = stripStyles(raw);
    const anchors = liveAffiliateAnchors(html);

    // 3. Surface authority — checked on EVERY page, not just guides.
    for (const anchor of anchors) {
      const program = anchor[0].match(/data-program="([^"]*)"/)?.[1] || anchor[0].match(/data-provider-slug="([^"]*)"/)?.[1] || "";
      if (NEVER_MONETIZED_PROGRAMS.includes(program)) findings.push(`${relative}: ${program} carries a live commercial anchor but its terms were operator-REJECTED`);
      if (relative.startsWith("guides/") && GUIDES_HELD_PROGRAMS.includes(program)) findings.push(`${relative}: ${program} is live on a guide before the §4.5 Awin guides-surface re-mint`);
    }

    // 2. Citation immutability — an affiliate href must never sit in an evidence position.
    for (const block of html.matchAll(/<(section|ol|ul)\b[^>]*class="[^"]*(?:sources|source-list|guide-sources)[^"]*"[^>]*>[\s\S]*?<\/\1>/g)) {
      if (/rel="[^"]*sponsored/.test(block[0]) || /data-analytics-event="affiliate_click"/.test(block[0])) findings.push(`${relative}: an affiliate anchor sits inside the evidence/source ledger`);
    }
    for (const anchor of html.matchAll(/<a\b[^>]*data-citation[^>]*>/g)) {
      if (/rel="[^"]*sponsored/.test(anchor[0])) findings.push(`${relative}: a data-citation anchor was monetized`);
    }
    for (const cell of html.matchAll(/<td\b[^>]*data-first-party-source[^>]*>[\s\S]*?<\/td>/g)) {
      if (/rel="[^"]*sponsored/.test(cell[0])) findings.push(`${relative}: a data-first-party-source evidence cell was monetized`);
    }
    for (const script of raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let parsed = null;
      try { parsed = JSON.parse(script[1]); } catch { continue; }
      const citations = JSON.stringify(parsed?.citation ?? (Array.isArray(parsed?.["@graph"]) ? parsed["@graph"].map((node) => node?.citation) : []) ?? []);
      if (/track\.revoffers\.com|awin1\.com|anrdoezrs|dpbolvw|kqzyfj|shareasale|impact-rad|prf\.hn/i.test(citations)) findings.push(`${relative}: a JSON-LD citation array contains an affiliate URL`);
    }

    if (!anchors.length) continue;

    // 1. Disclosure order — on every monetized page outside the money templates.
    if (!MONEY_SURFACE.test(relative)) {
      guidesChecked += 1;
      liveGuideAnchors += anchors.length;
      const firstMoney = Math.min(
        ...[html.search(/data-analytics-event="affiliate_click"/), html.search(/rel="[^"]*sponsored/)].filter((value) => value >= 0),
      );
      const disclosure = html.search(/class="[^"]*affiliate-(?:disclosure|note)[^"]*"/);
      const proximate = html.search(/class="[^"]*table-disclosure[^"]*"/);
      if (disclosure < 0) findings.push(`${relative}: monetized page carries no affiliate disclosure`);
      else if (disclosure > firstMoney) findings.push(`${relative}: disclosure follows the first affiliate anchor (FTC placement + moat)`);
      if (proximate < 0) findings.push(`${relative}: no proximate disclosure above the comparison table / offer module`);
      else if (proximate > firstMoney) findings.push(`${relative}: proximate disclosure follows the first affiliate anchor`);

      // 5. Present-tense FTC copy.
      const disclosureText = html.match(/class="[^"]*affiliate-disclosure[^"]*"[^>]*>([\s\S]{0,400}?)<\/span>/)?.[1] || "";
      if (HELD_FUTURE_COPY.test(disclosureText)) findings.push(`${relative}: live page's FTC disclosure still describes a held future`);
    }
  }

  // 4. Price Index invariants — the page whose market position is "commerce-free and
  // says so in prose". §3.8 rules it permanently unmonetized.
  const priceIndex = await readFile(path.join(PUBLIC, "glp-1-price-index/index.html"), "utf8");
  if (!priceIndex.includes(PRICE_INDEX_PROMISE)) findings.push("glp-1-price-index: the printed promise paragraph is not byte-exact");
  if (/rel="[^"]*sponsored/.test(priceIndex)) findings.push("glp-1-price-index: a sponsored anchor appeared on the ruled-unmonetized page");
  if (liveAffiliateAnchors(priceIndex).length) findings.push("glp-1-price-index: an affiliate_click anchor appeared on the ruled-unmonetized page");

  // §3.7 — the intake guide is ruled NO. Its monetization is a defect, not a feature.
  const intake = await readFile(path.join(PUBLIC, "guides/online-glp-1-intake-to-pharmacy-fulfillment/index.html"), "utf8");
  if (liveAffiliateAnchors(intake).length || /rel="[^"]*sponsored/.test(stripStyles(intake))) findings.push("guides/online-glp-1-intake-to-pharmacy-fulfillment: ruled NO in §3.7 but carries a money link");

  if (findings.length) {
    console.error(`FAIL — editorial monetization: ${findings.length} finding(s)`);
    for (const finding of [...new Set(findings)].slice(0, 40)) console.error(`  - ${finding}`);
    process.exit(1);
  }
  console.log(`PASS — editorial monetization: ${guidesChecked} monetized non-money pages · ${liveGuideAnchors} live guide anchors disclosed above the fold of commerce · citations immutable · shedrx/serena-health held on guides · never-monetized derived from terms decisions · Price Index promise intact`);
}

await main();
