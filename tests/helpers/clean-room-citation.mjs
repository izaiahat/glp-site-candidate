// Test-only classification, not a product/content permission. Authority is the
// independently merged 700b70711d462c42b9f12f32123870237d7ddeb7 acceptance;
// current manifest repins alone cannot grant a clean-room exception.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';
import { loadAcceptedGuides } from '../../src/accepted-guide-source.mjs';
const route = '/guides/is-valhalla-vitality-legit/';
const relativePage = 'public' + route + 'index.html';
const url = 'https://www.glpwinner.com/providers/valhalla-vitality';
const pins = {
  'article.json': '55d735527ec92f9dbf1a0bfafd963b66302ae44c963c3791ce77efae237753af',
  'qa.json': '7110aaff791218057bff85d2437f5a971744ee39773411fa018c1ca0ba95561c',
  'review.json': 'ea48f409e9eb3812a7ef9920995eb18f04594e69914360719a4727cf538b3bb0',
};
export function acceptedCleanRoomCitation(root, read = readFileSync) {
  for (const [name, hash] of Object.entries(pins)) {
    const bytes = read(path.join(root, 'data/blog/accepted-guides/is-valhalla-vitality-legit', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, 'original accepted citation bytes drifted');
  }
  const article = loadAcceptedGuides(root).find(a => a.canonical_path === route);
  assert.ok(article, 'accepted citation route missing');
  const matches = article.sources.filter(s => /glpwinner/i.test(s.url));
  assert.equal(matches.length, 1);
  const source = matches[0];
  assert.equal(source.url, url);
  assert.equal(source.source_id, 'S6');
  assert.equal(source.publisher, 'GLP Winner');
  assert.equal(source.verified_as_of, '2026-09-02');
  assert.equal(source.source_class, 'DIRECT_COMMUNITY_REVIEW_AGGREGATOR_OBSERVATION');
  return {article, source, index: article.sources.indexOf(source) + 1};
}
const attrs = node => Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
const children = node => node.childNodes || [];
const text = node => node.nodeName === '#text' ? node.value : children(node).map(text).join('');
const descend = node => [node, ...children(node).flatMap(descend)];
export function assertCleanRoomBytes(bytes, relative, root, authority = acceptedCleanRoomCitation) {
  if (relative !== relativePage) {
    // Original strict predicate, unchanged for every other file/context.
    assert.doesNotMatch(bytes, /glpwinner/i, `clean-room marker leaked into ${relative}`);
    return;
  }
  const {article, source, index} = authority(root);
  const nodes = descend(parse(bytes, {sourceCodeLocationInfo: true}));
  const ranges = [];
  const schemas = nodes.filter(n => n.tagName === 'script' && attrs(n).type === 'application/ld+json')
    .filter(n => /glpwinner/i.test(text(n)));
  assert.equal(schemas.length, 1, 'one source-bearing schema script required');
  const script = schemas[0];
  assert.deepEqual(Object.keys(attrs(script)), ['type']);
  const json = JSON.parse(text(script));
  const articles = (json['@graph'] || [json]).filter(n => n['@type'] === 'Article');
  assert.equal(articles.length, 1);
  if (json['@graph']) assert.equal(articles[0]['@id'], 'https://glpclinicscout.com' + route + '#article');
  else assert.equal(articles[0].url, 'https://glpclinicscout.com' + route);
  assert.deepEqual(articles[0].citation, article.sources.map(s => s.url), 'complete independent citation roster');
  const token = '"citation":' + JSON.stringify(articles[0].citation);
  assert.equal(text(script).split(token).length, 2, 'unique native citation array required');
  const offset = script.sourceCodeLocation.startTag.endOffset + text(script).indexOf(token);
  const inside = token.indexOf(url);
  assert.equal(token.split(url).length, 2);
  ranges.push([offset + inside, offset + inside + url.length]);
  const rows = nodes.filter(n => n.tagName === 'li' && attrs(n).id === `guide-source-${index}`);
  assert.equal(rows.length, 1, 'unique source-ledger row required');
  const row = rows[0], ol = row.parentNode, section = ol?.parentNode;
  assert.equal(ol?.tagName, 'ol');
  assert.equal(section?.tagName, 'section');
  assert.equal(attrs(section).id, 'sources');
  assert.equal(attrs(section).class, 'guide-sources');
  const elements = children(row).filter(n => n.tagName);
  assert.deepEqual(elements.map(n => n.tagName), ['strong','span','a','small']);
  assert.equal(text(elements[0]), source.publisher);
  assert.ok(text(elements[1]).startsWith('Supports: '));
  assert.ok([`Checked ${source.verified_as_of}`, `current as of ${source.verified_as_of}`].includes(text(elements[3])));
  const anchor = elements[2];
  assert.deepEqual(Object.keys(attrs(anchor)).sort(), ['data-citation','href','rel']);
  assert.equal(attrs(anchor).href, source.url);
  assert.equal(attrs(anchor)['data-citation'], 'guide_source_ledger');
  assert.deepEqual(attrs(anchor).rel.split(/\s+/).sort(), ['nofollow','noopener']);
  assert.ok(['Open source', 'GLP Winner — published page'].includes(text(anchor)));
  const loc = anchor.sourceCodeLocation.attrs.href;
  assert.equal(bytes.slice(loc.startOffset, loc.endOffset), `href="${url}"`);
  ranges.push([loc.startOffset + 6, loc.endOffset - 1]);
  let remainder = bytes;
  for (const [start, end] of ranges.sort((a,b) => b[0]-a[0])) {
    assert.equal(bytes.slice(start,end), url);
    remainder = remainder.slice(0,start) + '[accepted-external-source-url]' + remainder.slice(end);
  }
  // Only two authenticated URL value spans are classified. No whole node,
  // paragraph, script, route, hostname regex, asset, or source row is ignored.
  assert.doesNotMatch(remainder, /glpwinner/i, `clean-room marker leaked into ${relative}`);
}
