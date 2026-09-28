// Generate a view-only excerpt from a captured /providers/ page, never from
// invented provider fixtures. Input must be an unauthenticated site capture.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { renderSponsorPlacementCandidate } from "../src/sponsor-placement-candidate.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: node scripts/glp327-preview.mjs <captured-providers.html> <output.html>");
const source = readFileSync(resolve(input), "utf8");
if (!source.includes('<link rel="canonical" href="https://glpclinicscout.com/providers/">') || !source.includes('data-phase3-route="/providers/"')) throw new Error("not_a_captured_providers_page");
const slice = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`captured_markup_missing:${start}`);
  return source.slice(a, b + end.length);
};
const intro = slice('<header class="listing__intro', '</header>');
const gridStart = source.indexOf('<div class="listing-grid p3-provider-grid" data-phase3-provider-grid>');
if (gridStart < 0) throw new Error("organic_grid_missing");
const cards = [...source.slice(gridStart).matchAll(/<article class="p3-provider-card cs-card"[\s\S]*?<\/article>/g)].slice(0, 2).map(match => match[0]);
if (cards.length !== 2) throw new Error("two_organic_cards_required");
const ids = cards.map(card => card.match(/data-program="([^"]+)"/)?.[1]);
if (ids.some(id => !id) || new Set(ids).size !== 2) throw new Error("organic_identity_missing");
// Neutralize all controls and destinations in the resulting static exhibit.
const safe = text => text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<a\b[^>]*>/gi, "<span>").replace(/<\/a>/gi, "</span>")
  .replace(/<button\b[^>]*>/gi, "<span>").replace(/<\/button>/gi, "</span>")
  .replace(/<input\b[^>]*>/gi, "")
  .replace(/\s(?:on\w+|href|formaction|action|tabindex)="[^"]*"/gi, "");
const sponsor = renderSponsorPlacementCandidate("/providers/", { preview: true });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>GLP-327 · internal sponsorship placement proposal</title><link rel="stylesheet" href="../../assets/site-p3.css"><style>body{margin:0}.glp327-preview-banner{position:relative;z-index:1;padding:12px 20px;background:#eef6ee;color:#173526;font:700 13px/1.5 Manrope,system-ui,sans-serif;text-align:center}.glp327-preview-banner small{display:block;font-weight:400}.glp327-preview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.glp327-preview-grid article{min-width:0}@media(max-width:700px){.glp327-preview-grid{grid-template-columns:1fr}}</style></head><body><div class="glp327-preview-banner">VIEW-ONLY INTERNAL PROPOSAL · NO LIVE SPONSOR OR WORKING LINKS<small>Organic card excerpt from a captured /providers/ page; ${ids.join(" then ")} remain in captured order. Not a full directory or launch preview.</small></div><main class="p3-page listing" data-phase3-route="/providers/" data-listing-archetype="E">${safe(intro)}${sponsor}<section id="provider-results" class="listing-results p3-provider-section" aria-labelledby="listing-results-heading"><h2 id="listing-results-heading">Organic provider comparisons</h2><p>First two captured organic cards, in their original order. The sponsor panel is outside this results grid.</p><div class="listing-grid p3-provider-grid glp327-preview-grid" data-phase3-provider-grid>${safe(cards.join(""))}</div></section></main></body></html>`;
if (/<a\b|<button\b|<form\b|<script\b|<iframe\b|<input\b/i.test(html)) throw new Error("preview_interactive_element");
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), html);
console.log(JSON.stringify({ output: resolve(output), captured_organic_ids: ids, bytes: Buffer.byteLength(html), sponsor_count: (html.match(/data-sponsor-placement-candidate/g) || []).length }));
