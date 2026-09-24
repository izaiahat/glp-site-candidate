import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderBlogPost } from "../src/blog-system.mjs";

const root = new URL("..", import.meta.url);
const readJson = async (file) => JSON.parse(await readFile(new URL(file, root), "utf8"));

test("internal /go/ markdown links render with rel=sponsored nofollow noopener in paragraphs, bullets, and table cells", async () => {
  const batch = await readJson("data/blog/content-batch.json");
  const authors = await readJson("data/blog/author-registry.json");
  const author = authors.authors.find((item) => item.author_id === "clinic-scout-editorial-team");
  const base = batch.articles.find((item) => Array.isArray(item.sections) && item.sections.length > 0) || batch.articles[0];
  const brief = structuredClone(base);
  brief.comparison_required = false;
  brief.sections = [
    {
      heading: "Vetted programs",
      paragraphs: ["Start with [Trimi](/go/trimi-glp-1) or read the [methodology](/methodology/) first."],
      bullets: ["[Synergy RX](/go/synergy-rx), checked August 1, 2026"],
      tables: [{
        headers: ["Program", "Advertised floor as captured"],
        rows: [["[yourEra](/go/yourera-program), checked July 23, 2026", "Compounded tirzepatide from $169 per month"]],
      }],
    },
  ];
  const html = renderBlogPost(brief, null, author);
  const goAnchors = [...html.matchAll(/<a href="\/go\/[^"]+"([^>]*)>/g)];
  assert.equal(goAnchors.length, 3, "expected the three /go/ anchors from paragraph, bullet, and table cell");
  for (const anchor of goAnchors) {
    assert.match(anchor[1], / rel="sponsored nofollow noopener"/, `missing rel on ${anchor[0]}`);
  }
  const methodology = html.match(/<a href="\/methodology\/"([^>]*)>/);
  assert.ok(methodology, "plain internal link should render");
  assert.doesNotMatch(methodology[1], /rel=/, "plain internal links must stay rel-free");
});
