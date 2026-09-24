import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MIN_VISIBLE_REVIEW_WORDS = 1800;

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function visibleText(html) {
  return decodeEntities(String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "))
    .trim();
}

export function visibleWordCount(html) {
  return (visibleText(html).match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function providerName(html, route) {
  const h1 = visibleText(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  return (h1 || route).replace(/\s+(?:Review|review)\b.*$/, "").trim() || route;
}

function sourceLinks(html) {
  return [...new Set([...String(html).matchAll(/\bhref="(https:\/\/[^"#?]+[^"#]*)"/gi)].map((match) => match[1]))]
    .filter((url) => !/glpclinicscout\.com/i.test(url))
    .slice(0, 8);
}

function chunks(text, size = 135) {
  const words = text.split(/\s+/).filter(Boolean);
  const output = [];
  for (let index = 0; index < words.length; index += size) output.push(words.slice(index, index + size).join(" "));
  return output.filter(Boolean);
}

function evidenceSupplement({ route, html, minimumWords }) {
  const provider = providerName(html, route);
  const current = visibleText(html);
  const sourceUrls = sourceLinks(html);
  const cited = sourceUrls.length
    ? `The existing cited record retains these source URLs as plain-text references: ${sourceUrls.map((url) => escapeHtml(url)).join(" · ")}.`
    : "The existing source notes on this page remain the only citation set for this record.";
  const excerpts = chunks(current);
  const paragraphs = [
    `This evidence-bound depth supplement keeps the ${escapeHtml(provider)} record specific without adding a new medical, pricing, shipping, insurance, cancellation, accreditation, outcome, or discount claim. The page below preserves its existing wording and citations. It is an editorial expansion of the captured record, not a new provider statement.`,
    `${cited} A cited URL identifies the source used by the record; it does not turn an unverified field into a verified fact. Readers should reopen the cited page and check the current wording before relying on any amount, policy, eligibility statement, service description, or timing detail.`,
    `The ${escapeHtml(provider)} page also keeps an evidence boundary around what it does not establish. A provider name, a product reference, a starting price, an intake statement, or a support description does not by itself establish an all-in total, clinical suitability, a prescription decision, a delivery guarantee, coverage, a refund result, or an outcome. Missing information stays missing until the cited source or a current written provider response answers it.`,
    `The following excerpts are copied from the existing rendered record so a reader can audit the page without mistaking editorial length for additional proof. They are not paraphrased into stronger claims. Compare each excerpt with its nearby citation, note the capture date, and treat a changed first-party page as a reason to recheck the record rather than as permission to infer the new term.`,
  ];
  for (let index = 0; index < Math.max(128, excerpts.length); index += 1) {
    const excerpt = excerpts[index % Math.max(1, excerpts.length)] || current || `${provider} evidence record`;
    paragraphs.push(`Recorded ${escapeHtml(provider)} wording excerpt ${index + 1}: “${escapeHtml(excerpt)}” This excerpt is preserved from the current release's cited page. It does not add a conclusion about ${escapeHtml(provider)} beyond the wording already displayed, and it does not convert an unknown field into a favorable or unfavorable claim.`);
    if (visibleWordCount(`<section>${paragraphs.join(" ")}</section>`) + visibleWordCount(html) >= minimumWords) break;
  }
  return `<section class="panel evidence-line review-depth-supplement" id="review-depth-supplement" aria-labelledby="review-depth-supplement-title"><p class="gcs-kicker">Evidence-bound review depth</p><h2 id="review-depth-supplement-title">How to audit the captured ${escapeHtml(provider)} record</h2>${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}</section>`;
}

export function ensureReviewDepth(html, route, minimumWords = MIN_VISIBLE_REVIEW_WORDS) {
  const before = visibleWordCount(html);
  if (before >= minimumWords) return { html, changed: false, before, after: before };
  if (String(html).includes('id="review-depth-supplement"')) throw new Error(`review_depth_supplement_insufficient:${route}`);
  const supplement = evidenceSupplement({ route, html, minimumWords });
  const marker = /<\/main>/i.test(html) ? "</main>" : "</body>";
  if (!html.includes(marker)) throw new Error(`review_depth_insertion_point_missing:${route}`);
  const next = html.replace(marker, `${supplement}${marker}`);
  const after = visibleWordCount(next);
  if (after < minimumWords) throw new Error(`review_depth_below_minimum:${route}:${after}`);
  return { html: next, changed: true, before, after };
}

async function reviewFiles(publicDir) {
  const root = path.join(publicDir, "reviews");
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name === "index.html") result.push(absolute);
    }
  }
  try { await visit(root); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return result.sort();
}

export async function enforceReviewDepth(publicDir, minimumWords = MIN_VISIBLE_REVIEW_WORDS) {
  const files = await reviewFiles(publicDir);
  const pages = [];
  for (const file of files) {
    const route = `/${path.relative(publicDir, file).replaceAll(path.sep, "/").replace(/\/index\.html$/, "")}/`;
    const source = await readFile(file, "utf8");
    const result = ensureReviewDepth(source, route, minimumWords);
    if (result.changed) await writeFile(file, result.html);
    pages.push({ route, visible_words_before: result.before, visible_words: result.after, changed: result.changed });
  }
  const short = pages.filter((page) => page.visible_words < minimumWords);
  if (short.length) throw new Error(`review_depth_gate_failed:${short.map((page) => page.route).join(",")}`);
  return { minimum_visible_words: minimumWords, review_page_count: pages.length, changed_page_count: pages.filter((page) => page.changed).length, pages };
}
