import assert from "node:assert/strict";
import test from "node:test";

import { addArticleShareControls } from "../src/pass2-editorial-share.mjs";

test("article share upgrade adds native, email, X, and copy controls from canonical identity", () => {
  const source = '<!doctype html><html><head><link rel="canonical" href="https://glpclinicscout.com/guides/source-checked/"></head><body><main><h1>Source checked &amp; current</h1><nav class="p3-article-share" aria-label="Share this guide"><span>Share</span><a href="mailto:test">Email</a></nav><p>Guide.</p></main></body></html>';
  const html = addArticleShareControls(source);
  assert.match(html, /data-share-native/);
  assert.match(html, /mailto:\?subject=Source%20checked%20%26%20current/);
  assert.match(html, /https:\/\/x\.com\/intent\/post\?/);
  assert.match(html, /data-share-copy/);
  assert.match(html, /data-share-status role="status" aria-live="polite"/);
  assert.match(html, /\/assets\/editorial-share\.js/);
  assert.equal((html.match(/p3-article-share/g) || []).length, 1);
  assert.doesNotMatch(html, /mailto:test/);
  assert.equal(addArticleShareControls(html), html);
});

test("article share upgrade fails closed without canonical page identity", () => {
  assert.throws(() => addArticleShareControls('<main><h1>Missing canonical</h1></main>'), /identity_missing/);
});
