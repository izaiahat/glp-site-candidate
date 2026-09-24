// Codemod — AEO citation/schema defect batch (BUILD-SPEC-PACK B-08).
//
// This is the mechanical remediation lane for the ~68 legacy pages measured in
// SPEC-AEO-20260819 §0. It runs as a build stage over the RENDERED tree, never
// as a hand-edit, so:
//   * every future build re-applies it (persistence doctrine),
//   * the 36 golden article fixtures keep re-rendering byte-identically, because
//     the article renderer itself is untouched (AEO §3 preamble).
//
// Five defect classes closed here:
//   1. duplicate `Article` JSON-LD nodes (68 pages measured)
//   2. split Organization identity / empty `sameAs` (P0-C)
//   3. literal "Open source" citation anchors (68 pages, 323 anchors)
//   4. empty `<time datetime="">` elements (57 pages)
//   5. visible dateline that does not equal JSON-LD `dateModified` (P0-D)
//
// Defect class 5 is applied by `stampDateline()`, which the post-build stage
// calls with a lastmod resolved from content-hash provenance — never from build
// time, so a date can only move when content actually moved.

import { canonicalOrganizationNode, normalizeEntityNode, ORGANIZATION_ID, PUBLISHER_ALIASES } from "../src/aeo-entity.mjs";
import { normalizeCitationRels } from "../src/citation-attribution.mjs";

const LD_BLOCK = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const MONTHS = Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);

export function humanDate(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  if (!year || !month || !day) throw new Error(`aeo_dateline_iso_invalid:${iso}`);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function serialize(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function parseBlocks(html) {
  const blocks = [];
  LD_BLOCK.lastIndex = 0;
  let match;
  while ((match = LD_BLOCK.exec(html)) !== null) {
    let data = null;
    try { data = JSON.parse(match[1]); } catch { data = null; }
    blocks.push({ raw: match[0], body: match[1], start: match.index, end: match.index + match[0].length, data });
  }
  return blocks;
}

function nodesOf(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data["@graph"])) return data["@graph"];
  return [data];
}

function hasType(node, type) {
  const value = node?.["@type"];
  return Array.isArray(value) ? value.includes(type) : value === type;
}

function replaceBlocks(html, blocks, rendered) {
  // Rebuild right-to-left so earlier offsets stay valid.
  let out = html;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const replacement = rendered[index];
    if (replacement === undefined) continue;
    out = out.slice(0, blocks[index].start) + replacement + out.slice(blocks[index].end);
  }
  return out;
}

/**
 * Defect 1 + 2: one Article node per page, one Organization identity.
 */
function organizationScript() {
  return `<script type="application/ld+json">${serialize({ "@context": "https://schema.org", ...canonicalOrganizationNode() })}</script>`;
}

export function remediateStructuredData(html, state) {
  const blocks = parseBlocks(html);
  if (blocks.length === 0) {
    // A page with no structured data at all still needs the publisher entity —
    // that is the whole point of "one entity, resolvable from any page".
    if (!html.includes("</head>")) return html;
    state.organizationNodesAdded += 1;
    return html.replace("</head>", `${organizationScript()}</head>`);
  }
  const rendered = new Array(blocks.length);

  // --- defect 1: duplicate Article nodes -----------------------------------
  const articleBlocks = blocks
    .map((block, index) => ({ index, block, articles: nodesOf(block.data).filter((node) => hasType(node, "Article")) }))
    .filter((entry) => entry.articles.length > 0);
  const dropped = new Set();
  if (articleBlocks.length > 1) {
    // The canonical article is the one that lives inside an `@graph` with an
    // `@id` — it is the modern renderer's node and carries breadcrumbs, author
    // identity references and citations. The bare legacy duplicate is dropped.
    const canonical = articleBlocks.find((entry) => Array.isArray(entry.block.data?.["@graph"]) && entry.articles.some((node) => node["@id"]))
      || articleBlocks[articleBlocks.length - 1];
    for (const entry of articleBlocks) {
      if (entry.index === canonical.index) continue;
      const others = nodesOf(entry.block.data).filter((node) => !hasType(node, "Article"));
      if (others.length === 0) {
        rendered[entry.index] = "";
        dropped.add(entry.index);
        state.duplicateArticles += 1;
      } else {
        const kept = others.length === 1 ? { "@context": "https://schema.org", ...others[0] } : { "@context": "https://schema.org", "@graph": others };
        entry.block.data = kept;
        state.duplicateArticles += 1;
      }
    }
    // The surviving Article inherits the dropped node's citation list when it
    // has none of its own — dedupe must never lose evidence.
    const survivor = nodesOf(canonical.block.data).find((node) => hasType(node, "Article"));
    // The legacy node was the one carrying `publisher`. Dedupe must not cost the
    // page its publisher edge — that is the whole entity contract.
    if (survivor && !survivor.publisher) survivor.publisher = { "@id": ORGANIZATION_ID };
    if (survivor && !Array.isArray(survivor.citation)) {
      for (const entry of articleBlocks) {
        if (entry.index === canonical.index) continue;
        const donor = entry.articles.find((node) => Array.isArray(node.citation) && node.citation.length > 0);
        if (donor) { survivor.citation = donor.citation; break; }
      }
    }
  }

  // --- defect 2: one Organization identity ---------------------------------
  let touched = false;
  for (let index = 0; index < blocks.length; index += 1) {
    if (dropped.has(index) || !blocks[index].data) continue;
    for (const node of nodesOf(blocks[index].data)) {
      if (!node || typeof node !== "object") continue;
      if (!["Article", "NewsArticle", "BlogPosting", "Review", "Dataset"].some((type) => hasType(node, type))) continue;
      if (!node.publisher) { node.publisher = { "@id": ORGANIZATION_ID }; touched = true; }
    }
  }
  for (const block of blocks) {
    if (!block.data) continue;
    const local = { publisherRefs: 0, emptySameAs: 0 };
    if (normalizeEntityNode(block.data, local)) touched = true;
    state.publisherRefs += local.publisherRefs;
    state.emptySameAs += local.emptySameAs;
  }
  // An existing node already claiming the canonical @id (or claiming to BE our
  // organization by name) is rewritten in place to the canonical field set — two
  // spellings of the same entity is exactly the defect being closed.
  let definesOrganization = false;
  for (let index = 0; index < blocks.length; index += 1) {
    if (dropped.has(index)) continue;
    for (const node of nodesOf(blocks[index].data)) {
      if (!node || typeof node !== "object") continue;
      const isOrganization = hasType(node, "Organization");
      const claimsCanonical = node["@id"] === ORGANIZATION_ID
        || (isOrganization && !node["@id"] && PUBLISHER_ALIASES.includes(String(node.name || "").trim()));
      if (!claimsCanonical) continue;
      Object.assign(node, canonicalOrganizationNode());
      definesOrganization = true;
      touched = true;
    }
  }
  let organizationBlock = "";
  if (!definesOrganization) {
    organizationBlock = organizationScript();
    state.organizationNodesAdded += 1;
    touched = true;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    if (rendered[index] !== undefined) continue;
    if (!blocks[index].data) continue;
    const next = `<script type="application/ld+json">${serialize(blocks[index].data)}</script>`;
    if (next !== blocks[index].raw) rendered[index] = next;
  }
  if (!touched && rendered.every((value) => value === undefined)) return html;
  let out = replaceBlocks(html, blocks, rendered);
  if (organizationBlock) out = out.replace("</head>", `${organizationBlock}</head>`);
  return out;
}

const SOURCE_LI = /<li id="(?:guide-)?source-?\d+"[\s\S]*?<\/li>/g;
const GUIDE_SOURCE_LI = /<li id="guide-source-\d+">([\s\S]*?)<\/li>/g;

function documentKind(url) {
  const lower = String(url).toLowerCase();
  if (lower.endsWith(".pdf") || lower.includes(".pdf?")) return "PDF document";
  if (/fda\.gov|accessdata/.test(lower)) return "regulatory document";
  if (/\bpricing|price|cost\b/.test(lower)) return "published pricing page";
  if (/terms|policy|legal/.test(lower)) return "published terms page";
  return "published page";
}

/**
 * Defect 3: descriptive citation anchor labels.
 * `<Issuer> — <document type>, <YYYY-MM>` (AEO P0-B) built from the ledger row
 * the anchor already lives inside — publisher `<strong>` + `Checked <date>`.
 */
export function remediateCitationAnchors(html, state) {
  if (!html.includes(">Open source</a>")) return html;
  GUIDE_SOURCE_LI.lastIndex = 0;
  return html.replace(GUIDE_SOURCE_LI, (block) => {
    if (!block.includes(">Open source</a>")) return block;
    const publisher = block.match(/<strong>([^<]+)<\/strong>/)?.[1]?.trim();
    const checked = block.match(/Checked (\d{4}-\d{2})-\d{2}/)?.[1];
    const href = block.match(/<a href="(https?:\/\/[^"]+)"[^>]*data-citation=/)?.[1];
    if (!publisher || !href) return block;
    const label = `${publisher} — ${documentKind(href)}${checked ? `, ${checked}` : ""}`;
    state.citationAnchors += 1;
    return block.replace(">Open source</a>", `>${label}</a>`);
  });
}

/**
 * Defect 4: no empty `<time datetime="">` ever ships. A page with no priced
 * content omits the "Prices checked" fragment entirely rather than rendering an
 * empty element (AEO P0-D).
 */
export function remediateEmptyTime(html, state) {
  if (!html.includes('datetime=""')) return html;
  let out = html.replace(/\s*·\s*Prices checked <time datetime="" [^>]*><\/time>/g, () => { state.emptyTime += 1; return ""; });
  out = out.replace(/<time datetime=""[^>]*>([\s\S]*?)<\/time>/g, (match, inner) => {
    state.emptyTime += 1;
    return inner.trim() ? `<span>${inner}</span>` : "";
  });
  return out;
}

/**
 * Defect 5: visible dateline == JSON-LD `dateModified`.
 *
 * `lastmod` comes from content-hash provenance, so this stamps the date the page
 * genuinely last changed. The separate "Sources checked" / "Prices checked"
 * evidence stamps are NOT touched — they are claims about verification, not about
 * publication, and overwriting them would be the exact fake-freshness move the
 * moat depends on us never making.
 */
export function stampDateline(html, lastmod, state) {
  let out = html;
  const human = humanDate(lastmod);
  const before = out;

  // Guide byline: "By <a>the Clinic Scout Editorial Team</a> · Updated 2026-07-23"
  out = out.replace(/(<p class="guide-byline">[\s\S]*?· Updated )((?:<time datetime="\d{4}-\d{2}-\d{2}">[^<]*<\/time>)|[^<]*?)(<\/p>)/g,
    (_match, head, _old, tail) => `${head}<time datetime="${lastmod}">${human}</time>${tail}`);
  // Any already-marked-up dateline elsewhere on the site.
  out = out.replace(/<time datetime="\d{4}-\d{2}-\d{2}" data-page-updated>[^<]*<\/time>/g,
    `<time datetime="${lastmod}" data-page-updated>${human}</time>`);

  // If this page's visible date could NOT be rewritten here, its schema date is
  // left exactly where it is. Money and comparison surfaces derive their visible
  // "Updated" from the evidence-refresh date their own freshness validator
  // guards; silently advancing `dateModified` past it would print a freshness
  // claim the evidence does not support — the one thing the moat cannot survive.
  // The sitemap lastmod still moves, because the PAGE moved; the two statements
  // mean different things and stay separately true.
  if (out === before) return out;

  const blocks = parseBlocks(out);
  const rendered = new Array(blocks.length);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block.data) continue;
    let changed = false;
    for (const node of nodesOf(block.data)) {
      if (!node || typeof node !== "object") continue;
      if (typeof node.dateModified === "string" && node.dateModified !== lastmod) { node.dateModified = lastmod; changed = true; }
      if (typeof node.datePublished === "string" && node.datePublished > lastmod) { node.datePublished = lastmod; changed = true; }
    }
    if (changed) rendered[index] = `<script type="application/ld+json">${serialize(block.data)}</script>`;
  }
  out = replaceBlocks(out, blocks, rendered);
  if (out !== before) state.datelines += 1;
  return out;
}

export function newState() {
  return { pages: 0, changed: 0, duplicateArticles: 0, publisherRefs: 0, emptySameAs: 0, organizationNodesAdded: 0, citationAnchors: 0, emptyTime: 0, datelines: 0 };
}

/** Structural pass (defects 1-4). Dates are stamped separately, after hashing. */
export function remediatePage(html, state) {
  let out = remediateStructuredData(html, state);
  out = remediateCitationAnchors(out, state);
  out = remediateEmptyTime(out, state);
  out = normalizeCitationRels(out);
  return out;
}
