// robots.txt composite (BUILD-SPEC-PACK CR-6 / B-06).
//
// Four specs compose here:
//  (1) AEO P1-K — the `/clinics/` and `/directory/` disallows are DELETED. They
//      matched nothing in the tree, and they were a live trap: the pharmacy
//      entity layer would have been born invisible to every crawler if it had
//      shipped under either path. The pharmacy layer ships under `/pharmacies/`,
//      which stays crawlable.
//  (2) LAY §3.2 — faceted param tails are disallowed so the filter system cannot
//      mint an infinite crawl space out of one comparison page. Only the
//      enumerated facet params are covered; content routes are untouched.
//  (3) ADS R9 — `AdsBot-Google` does NOT obey the `User-agent: *` group, so the
//      paid-LP tree needs its own explicit allow group. This is a policy
//      requirement for ad serving, not a per-bot enumeration.
//  (4) AEO [S1] — NO per-AI-bot groups. The wildcard already governs every AI
//      token; enumerating them adds drift risk and nothing else. The regression
//      test asserts effective access for the 14 baseline tokens plus an unknown
//      token, forever.
//  (5) Pass 5 Brave review — public privacy and terms documents stay fetchable
//      through the wildcard group. Their page-level index policy remains a
//      separate decision; robots.txt must not prevent crawler/platform review.

export const FACET_PARAMS = Object.freeze(["therapeutic", "treatment", "sort", "state", "filter", "page"]);
export const CRAWLER_TOKENS = Object.freeze([
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  "PerplexityBot", "Perplexity-User",
  "Googlebot", "Bingbot", "Applebot-Extended", "CCBot", "Amazonbot",
]);
export const DISALLOWED_PREFIXES = Object.freeze(["/google-ads-api/"]);

export function buildRobotsTxt() {
  const lines = ["User-agent: *", "Allow: /"];
  for (const prefix of DISALLOWED_PREFIXES) lines.push(`Disallow: ${prefix}`);
  for (const param of FACET_PARAMS) lines.push(`Disallow: /*?*${param}=`);
  lines.push("", "# AdsBot-Google ignores the wildcard group; the paid landing tree must stay", "# fetchable for ad-destination review (SPEC-ADS R9).", "User-agent: AdsBot-Google", "Allow: /", "", "Sitemap: https://glpclinicscout.com/sitemap.xml");
  return `${lines.join("\n")}\n`;
}

/**
 * Minimal robots.txt evaluator used by the regression test: returns true when
 * `token` may fetch `pathWithQuery`. Group selection follows the real precedence
 * rule — an exact user-agent group wins, otherwise the `*` group applies.
 */
export function isAllowed(robotsTxt, token, pathWithQuery) {
  const groups = new Map();
  let current = [];
  let pendingAgents = [];
  let lastWasAgent = false;
  for (const raw of robotsTxt.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const key = field.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!lastWasAgent) { pendingAgents = []; current = []; }
      pendingAgents.push(value);
      for (const agent of pendingAgents) groups.set(agent.toLowerCase(), current);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "allow" || key === "disallow") current.push({ type: key, value });
  }
  const rules = groups.get(token.toLowerCase()) || groups.get("*") || [];
  let best = { length: -1, type: "allow" };
  for (const rule of rules) {
    if (!rule.value) continue;
    if (!matches(rule.value, pathWithQuery)) continue;
    if (rule.value.length > best.length || (rule.value.length === best.length && rule.type === "allow")) {
      best = { length: rule.value.length, type: rule.type };
    }
  }
  return best.type === "allow";
}

function matches(pattern, target) {
  const anchoredEnd = pattern.endsWith("$");
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const expression = body.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*");
  return new RegExp(`^${expression}${anchoredEnd ? "$" : ""}`).test(target);
}
