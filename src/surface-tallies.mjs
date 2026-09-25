// Every tally a reader sees is derived, and the build proves it page by page.
//
// WHY THIS EXISTS
// ---------------
// The 2026-08-06 surface unification made ONE number derived: the live provider
// count, carried through copy as {{LIVE_PROVIDER_COUNT}}. Every other total a
// reader can see - how many comparisons the site publishes, how many research
// guides, how many rows a given comparison page holds - was still whatever the
// renderer happened to pass in, with nothing checking it against the tree that
// actually shipped. A homepage that said "13 comparisons, 41 research guides"
// was right by luck, not by construction, and the labels beside those numbers
// ("Providers compared 29 / Comparisons 13") did not say what they counted.
//
// WHAT THIS DOES
// --------------
// Substitutes the derived tokens, then re-reads the rendered bytes of every
// machine-assembled surface and refuses to ship a tally that the shipped tree
// cannot reproduce. A number typed into copy by hand fails the build.

export const TALLY_TOKENS = Object.freeze([
  "LIVE_PROVIDER_COUNT",     // distinct live merchants, after identity dedup
  "COMPARISON_CARD_COUNT",  // evidence-qualified cards on /providers/
  "PRICED_PROVIDER_COUNT",
  "CALCULATOR_COMPARABLE_PROVIDER_COUNT",
  "CURRENT_PRICE_ROW_COUNT",
  "MATRIX_PRICED_PROVIDER_COUNT",
  "BASELINE_PRICE_ROW_COUNT",
  "BASELINE_PRICED_PROVIDER_COUNT",
  "COMPARISON_PAGE_COUNT",   // /best, /cost, /compare pages carrying a table
  "RESEARCH_GUIDE_COUNT",    // GLP-1 guides in the research library
]);

export const PROVIDER_REVEAL_BATCH_SIZE = 12;
const TALLY_CLASSES = Object.freeze({
  provider: ["providers", "program profiles", "programs", "clinics"],
  comparison: ["comparisons", "comparison pages", "comparison guides"],
  guide: ["research guides", "evidence guides", "guides"],
});

//: closed modifier vocabulary — an open one reads "$99 starting price. Both
//: programs..." as a claim that the site covers 99 programs.
const MODIFIER = "(?:online|curated|additional|more|other|source-bound|in-depth|"
  + "independent|ranked|live|research|evidence|comparison|GLP[-‑]?1)\\s+";
const NOUNS = Object.values(TALLY_CLASSES).flat().sort((a, b) => b.length - a.length);
const TALLY_COPY = new RegExp(`(?<![-‑\\d])(\\d{1,4})\\s+((?:${MODIFIER}){0,3})(${NOUNS.join("|")})\\b`, "gi");
const METRIC_PAIR = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
const TAGS = /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>|<[^>]+>/g;
const BLOCK_END = /<\/(?:p|div|section|li|dd|dt|dl|td|th|tr|h[1-6]|small|figcaption|aside|nav|article|header|footer|main|span|a|strong|em|b)\s*>/gi;

/** Public routes whose visible provider counts must match current registry truth. */
export function isTallyGatedRoute(relative) {
  return relative === "index.html" || relative === "glp-1-price-index/index.html" || relative.startsWith("guides/")
    || /^(?:best|cost|compare|reviews|tools|quiz|how-we-rate|semaglutide|tirzepatide|providers|lp\/quiz)\//.test(relative);
}

function blockText(html) {
  return html.replace(BLOCK_END, " ¶ ").replace(TAGS, " ").replace(/\s+/g, " ").trim();
}

function classify(noun) {
  const key = String(noun || "").trim().toLowerCase();
  for (const [klass, nouns] of Object.entries(TALLY_CLASSES)) {
    if (nouns.includes(key) || nouns.includes(`${key.replace(/s$/, "")}s`)) return klass;
  }
  return null;
}

/**
 * Values each tally class may legitimately state on THIS page: the site-wide
 * derivation, plus whatever this page itself rendered.
 */
export function allowedTallies(html, derived, relative = "") {
  const rows = new Set([...html.matchAll(/data-program="([a-z0-9-]+)"/g)].map((match) => match[1])).size;
  const options = [...html.matchAll(/<option value="[a-z0-9-]+"/g)].length;
  // Responsive table/card twins count as one canonical category profile.
  const categoryRows = new Set([...html.matchAll(/data-g08-provider-id="([a-z0-9-]+)"/g)].map(match => match[1])).size;
  const guides = new Set([...html.matchAll(/href="(\/guides\/[a-z0-9-]+\/)"/g)].map((match) => match[1])).size;
  return {
    provider: new Set([derived.LIVE_PROVIDER_COUNT, relative === "index.html" ? derived.COMPARISON_CARD_COUNT : null, rows || null, options || null, categoryRows || null].filter((value) => value != null)),
    comparison: new Set([derived.COMPARISON_PAGE_COUNT]),
    guide: new Set([derived.RESEARCH_GUIDE_COUNT, guides || null].filter((value) => value !== null)),
  };
}

/**
 * Re-derive tallies inside FROZEN bytes.
 *
 * Three legacy-vertical review pages and one guide are carried forward verbatim
 * from an earlier release rather than re-rendered, and they embed link cards
 * whose titles were themselves built from a derived token ("29 online GLP-1
 * programs, compared by..."). Frozen bytes cannot re-derive themselves, so the
 * substituted number silently rots. Rather than exempt them from the gate -
 * which is how the stale number survived in the first place - the number is
 * rewritten to the current derivation and the rewrite is recorded in the build
 * report. Anything the rewrite cannot reach still fails the gate below.
 */
export function redriveTallies(relative, html, derived) {
  const allowed = allowedTallies(html, derived, relative);
  const target = { provider: derived.LIVE_PROVIDER_COUNT, comparison: derived.COMPARISON_PAGE_COUNT, guide: derived.RESEARCH_GUIDE_COUNT };
  const rewrites = [];
  const updated = html.replace(new RegExp(TALLY_COPY.source, "gi"), (match, number, modifiers, noun) => {
    const klass = classify(noun);
    if (!klass || allowed[klass].has(Number(number))) return match;
    rewrites.push(`${relative}:${number}->${target[klass]}:${noun}`);
    return `${target[klass]} ${modifiers}${noun}`;
  });
  return { html: updated, rewrites };
}

/**
 * The build gate. Throws on any reader-visible tally the shipped tree cannot
 * reproduce, in prose or in a labelled metric tile.
 */
export function assertTalliesDerived(relative, html, derived) {
  const allowed = allowedTallies(html, derived, relative);
  const fail = (phrase, klass, value) => {
    throw new Error(`surface_tally_not_derived:${relative}:${phrase.replace(/\s+/g, "_")}:${klass}:${value}:allowed:${[...allowed[klass]].sort().join("|")}`);
  };
  // Reveal counts have their own derivation, not a general prose exemption.
  const countHtml = html.replace(/<button\b[^>]*\bdata-provider-load-more(?:\s[^>]*)?>[\s\S]*?<\/button>/g, button => {
    const total = new Set([...html.matchAll(/data-program="([a-z0-9-]+)"/g)].map(m=>m[1])).size;
    const initial = Number(html.match(/data-initial-visible="(\d+)"/)?.[1]);
    const shown = button.match(/Show (\d+) more providers?/);
    const expected = Math.min(PROVIDER_REVEAL_BATCH_SIZE, Math.max(0,total-initial));
    if (!Number.isInteger(initial) || !shown || Number(shown[1]) !== expected) throw new Error(`provider_reveal_count_mismatch:${relative}`);
    return '';
  });
  for (const match of blockText(countHtml).matchAll(TALLY_COPY)) {
    const klass = classify(match[3]);
    if (!klass) continue;
    const value = Number(match[1]);
    if (!allowed[klass].has(value)) fail(match[0], klass, value);
    if (/^(?:semaglutide|tirzepatide)\//.test(relative) && match[3].toLowerCase() === 'program profiles') {
      const category = new Set([...html.matchAll(/data-g08-provider-id="([a-z0-9-]+)"/g)].map(m=>m[1])).size;
      if (category !== value) fail(match[0], klass, value);
    }
  }
  for (const match of html.matchAll(METRIC_PAIR)) {
    const label = match[1].replace(TAGS, " ").replace(/\s+/g, " ").trim();
    const valueText = match[2].replace(TAGS, " ").replace(/\s+/g, " ").trim();
    if (!/^\d+$/.test(valueText)) continue;
    const klass = label.split(/\s+/).map((word) => classify(word.replace(/[.,·]/g, ""))).find(Boolean);
    if (!klass) continue;
    if (!allowed[klass].has(Number(valueText))) fail(`${label}=${valueText}`, klass, Number(valueText));
  }
  return true;
}
