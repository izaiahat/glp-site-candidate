// Build gate — outbound-click instrumentation (BUILD-SPEC-PACK B-01, B-02).
//
// The site went from 2026-07-16 to now with ZERO outbound-click events recorded
// (SPEC-CRO §1). This gate makes an unattributable money link a build failure:
// every live affiliate anchor must carry the full CR-5 identity, and the runtime
// must carry the taxonomy that turns it into one event on both sinks.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ELEMENT_CODES } from "../src/affiliate-subid.mjs";
import { candidateExportShellFindings, releaseExportPolicy } from "../src/candidate-export-policy.mjs";
import { loadCarrierArticles, assertCarrierArticleOutput } from "../src/carrier-article-retention.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const REQUIRED_ATTRS = ["data-network", "data-provider-slug", "data-element-code", "data-rank-position", "data-page-type", "data-sub1", "data-sub2"];

async function walk(directory, prefix = "") {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(directory, entry.name), relative));
    else if (relative.endsWith(".html")) out.push(relative);
  }
  return out;
}

async function main() {
  const retainedArticles = loadCarrierArticles(ROOT);
  const findings = [];
  let anchors = 0;
  for (const relative of await walk(PUBLIC)) {
    const html = await readFile(path.join(PUBLIC, relative), "utf8");
    const retained = retainedArticles.get(relative);
    if (retained) assertCarrierArticleOutput(retained, html);
    if (html.includes("window.GCS_ANALYTICS=")) {
      findings.push(...candidateExportShellFindings(html).map(problem => `${relative}: ${problem}`));
    }
    for (const match of html.matchAll(/<a\b[^>]*data-analytics-event="affiliate_click"[^>]*>/g)) {
      const tag = match[0];
      anchors += 1;
      for (const attribute of REQUIRED_ATTRS) {
        if (!tag.includes(`${attribute}=`)) findings.push(`${relative}: missing ${attribute}`);
      }
      const code = tag.match(/data-element-code="([^"]*)"/)?.[1];
      if (code && !ELEMENT_CODES[code]) findings.push(`${relative}: unknown element code ${code}`);
      const sub1 = tag.match(/data-sub1="([^"]*)"/)?.[1];
      if (sub1 && !/^\d+[A-Z]$/.test(sub1)) findings.push(`${relative}: sub1 "${sub1}" is not <rank><element>`);
      // The moat: a monetized link is always tagged. Treat rel as an unordered
      // token set so an additional hardening token such as noreferrer cannot
      // make a compliant link fail validation.
      const relTokens = new Set((tag.match(/\brel="([^"]*)"/)?.[1] || "").split(/\s+/).filter(Boolean));
      if (!["sponsored", "nofollow", "noopener"].every((token) => relTokens.has(token))) findings.push(`${relative}: money anchor without rel tokens sponsored, nofollow, and noopener`);
    }
  }
  if (anchors === 0) findings.push("no live affiliate anchors found at all");

  const analytics = await readFile(path.join(ROOT, "assets", "analytics.js"), "utf8");
  for (const required of ["cs_click_id", "uuidv7", "decorateOutbound", "loadPostHog", "comparison_sort_change", "affiliate_click"]) {
    if (!analytics.includes(required)) findings.push(`analytics runtime missing ${required}`);
  }
  // GLP-44 operator direction: coarse progression may follow an explicit
  // analytics choice, never default-on or an answer/branch/result payload.
  const allowedEvents = analytics.match(/const allowed = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1];
  if (!allowedEvents) findings.push('event allowlist missing');
  const progression = new Set(['quiz_start','quiz_step_complete','quiz_complete','results_view']);
  for (const match of (allowedEvents || '').matchAll(/((?:quiz|scorecard)_[a-z_]*|results_view)\s*:\s*(\[[^\]]*\])/g)) {
    if (!progression.has(match[1]) || match[2].replace(/\s/g,'') !== '[]') findings.push('unreviewed quiz event or properties');
  }
  for (const guard of ["analytics_basis === 'explicit'", '!progressionAllowed(event.event)', '!progressionAllowed(name)']) {
    if (!analytics.includes(guard)) findings.push('missing explicit progression guard: '+guard);
  }
  // Health-vertical privacy contract (CRO D8): these are what keep the site's own
  // "Health quiz answers are never sent to analytics" line literally true.
  for (const required of ["autocapture: false", "disable_session_recording: true", "mask_all_text: true", "mask_all_element_attributes: true"]) {
    if (!analytics.includes(required)) findings.push(`PostHog privacy contract missing: ${required}`);
  }
  if (/scorecard_[a-z_]*:\s*\[[^\]]*answer/.test(analytics)) findings.push("a quiz event declares an answer-bearing property");

  // MOAT INVARIANT — "disclosure above results", enforced statically so it also holds
  // in the sealed tree where the browser suite cannot run. B-12's ATF reorder lifted
  // the dated-price verdict card above the affiliate disclosure on the money pages;
  // that regression was invisible to fold measurement. Byte offset in the rendered
  // source is DOM order, so this is a real ordering assertion, not a proxy.
  // W11 retired the legacy evidence-wall routes. Preserve the same disclosure
  // moat against the canonical Phase 3 money surfaces readers can reach now.
  const DISCLOSURE_ORDER_ROUTES = [
    "lp/best-providers/compounded-semaglutide/index.html",
    "self-pay/index.html",
    "wegovy/index.html",
    "3-month/index.html",
  ];
  for (const relative of DISCLOSURE_ORDER_ROUTES) {
    const html = await readFile(path.join(PUBLIC, relative), "utf8");
    const body = html.slice(html.indexOf("<body"));
    const disclosure = body.search(/class="[^"]*affiliate-(?:note|disclosure)[^"]*"/);
    if (disclosure < 0) { findings.push(`${relative}: no affiliate disclosure element`); continue; }
    const money = [
      ["$ figure", body.search(/\$\s?\d/)],
      ["sponsored link", body.search(/rel="sponsored/)],
      ["affiliate CTA", body.search(/data-analytics-event="affiliate_click"/)],
      ["verdict card", body.search(/id="quick-answer"/)],
    ];
    for (const [label, at] of money) {
      if (at >= 0 && at < disclosure) findings.push(`${relative}: affiliate disclosure sits BELOW the first ${label} (moat: disclosure above results)`);
    }
  }

  const home = await readFile(path.join(PUBLIC, "index.html"), "utf8");
  if (!new RegExp(`window\\.GCS_POSTHOG=\\{[^}]*"enabled":${releaseExportPolicy().third_party_exports}`).test(home)) findings.push("PostHog configuration does not match the declared release stage");
  if (!/"api_key":"phc_/.test(home)) findings.push("PostHog project key not rendered");

  // ANALYTICS-TRUTH 2026-08-20 — the CSP is part of the analytics contract.
  // PostHog shipped enabled, key-carrying and correctly gated, and still recorded
  // ZERO events for this host over 30 days, because the Content-Security-Policy
  // named googletagmanager / google-analytics / clarity and never named posthog:
  // script-src refused /static/array.js and connect-src refused every capture.
  // A config that cannot reach the wire is not instrumentation, so the transport
  // origins declared in data/posthog-config.json are asserted against the header.
  const headers = await readFile(path.join(PUBLIC, "_headers"), "utf8");
  const csp = headers.split("\n").find((line) => line.trim().startsWith("Content-Security-Policy:")) || "";
  const transport = JSON.parse(await readFile(path.join(ROOT, "data", "posthog-config.json"), "utf8"));
  for (const origin of transport.transport_origins?.origins || []) {
    for (const directive of ["script-src", "connect-src"]) {
      const value = csp.split(";").find((part) => part.trim().startsWith(`${directive} `)) || "";
      if (!value.includes(origin)) findings.push(`CSP ${directive} does not allow PostHog origin ${origin} — capture will be blocked in the browser`);
    }
  }
  if (!(transport.transport_origins?.origins || []).length) findings.push("posthog-config.json declares no transport_origins");

  // The suppression contract that keeps the production property honest. These are
  // the two signals that survive a UA override; the old UA-only guard did not.
  const analyticsRuntime = analytics;
  for (const required of ["navigator.webdriver === true", "ga-disable-", "localHost()", "GCS_ANALYTICS_SUPPRESSED"]) {
    if (!analyticsRuntime.includes(required)) findings.push(`localhost/automation suppression missing: ${required}`);
  }

  if (findings.length) {
    console.error(`FAIL — instrumentation: ${findings.length} finding(s)`);
    for (const finding of findings.slice(0, 30)) console.error(`  - ${finding}`);
    process.exit(1);
  }
  console.log(`PASS — staged instrumentation: ${anchors} affiliate anchors retain CR-5 identity; shared shells match ${releaseExportPolicy().stage}. No live delivery claim.`);
}

await main();
