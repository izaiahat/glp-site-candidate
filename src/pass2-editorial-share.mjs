const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const text = (value) => String(value ?? "")
  .replace(/<[^>]+>/g, " ")
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replace(/\s+/g, " ")
  .trim();

export function addArticleShareControls(html) {
  if (typeof html !== "string" || !html.includes("</main>")) throw new Error("article_share_main_missing");
  if (html.includes("data-article-share")) return html;
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1];
  const titleHtml = html.match(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i)?.[1];
  if (!canonical || !/^https:\/\/glpclinicscout\.com\/[a-z0-9\-/]+$/.test(canonical) || !titleHtml) throw new Error("article_share_identity_missing");
  const title = text(titleHtml);
  const encodedUrl = encodeURIComponent(canonical);
  const encodedTitle = encodeURIComponent(title);
  const controls = `<aside class="p3-article-share" data-article-share data-share-url="${esc(canonical)}" data-share-title="${esc(title)}" aria-labelledby="article-share-title"><p class="p3-kicker">Keep or share this evidence</p><h2 id="article-share-title">Send the source-checked guide, not a screenshot.</h2><div><button type="button" class="cta primary" data-share-native hidden>Share</button><a class="cta secondary" href="mailto:?subject=${encodedTitle}&amp;body=${encodedUrl}">Email</a><a class="cta secondary" href="https://x.com/intent/post?url=${encodedUrl}&amp;text=${encodedTitle}" rel="noopener noreferrer">Share on X</a><button type="button" class="cta secondary" data-share-copy>Copy link</button></div><p data-share-status role="status" aria-live="polite"></p></aside><script src="/assets/editorial-share.js" defer></script>`;
  const withoutLegacyShare = html.replace(/<nav\s+class="p3-article-share"[^>]*>[\s\S]*?<\/nav>/i, "");
  return withoutLegacyShare.replace("</main>", `${controls}</main>`);
}
