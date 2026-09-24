import assert from "node:assert/strict";
import test from "node:test";
import { normalizePriceIndexBuild4Semantics as normalize } from "../src/price-index-semantic-preservation.mjs";
const pairs = [
 ["non-runtime evidence version", '<a href="https://evidence.invalid/report?v=aaaaaaaaaaaaaaaa">Evidence</a>', '<a href="https://evidence.invalid/report?v=bbbbbbbbbbbbbbbb">Evidence</a>', false],
 ["external guides", '<a href="https://evidence.invalid/guides/a/">Evidence</a>', '<a href="https://evidence.invalid/insights/a/">Evidence</a>', false],
 ["external retired route", '<a href="https://evidence.invalid/best/online-glp-1-providers/">Evidence</a>', '<a href="https://evidence.invalid/providers/">Evidence</a>', false],
 ["asset anchor remains evidence", '<a href="/assets/site.js?v=aaaaaaaaaaaaaaaa">Source</a>', '<a href="/assets/site.js?v=bbbbbbbbbbbbbbbb">Source</a>', false],
 ["external runtime path", '<script src="https://evidence.invalid/assets/site.js?v=aaaaaaaaaaaaaaaa"></script>', '<script src="https://evidence.invalid/assets/site.js?v=bbbbbbbbbbbbbbbb"></script>', false],
 ["unknown asset", '<script src="/assets/unknown.js?v=aaaaaaaaaaaaaaaa"></script>', '<script src="/assets/unknown.js?v=bbbbbbbbbbbbbbbb"></script>', false],
 ["malformed version", '<script src="/assets/site.js?v=aaaaaaaaaaaaaaaaEXTRA"></script>', '<script src="/assets/site.js?v=bbbbbbbbbbbbbbbbEXTRA"></script>', false],
 ["script runtime version", '<script src="/assets/site.js?v=aaaaaaaaaaaaaaaa"></script>', '<script src="/assets/site.js?v=bbbbbbbbbbbbbbbb"></script>', true],
 ["stylesheet runtime version", '<link rel="stylesheet" href="/assets/site.css?v=aaaaaaaaaaaaaaaa">', '<link rel="stylesheet" href="/assets/site.css?v=bbbbbbbbbbbbbbbb">', true],
 ["stylesheet evidence preload is strict", '<link rel="alternate" href="/assets/site.css?v=aaaaaaaaaaaaaaaa">', '<link rel="alternate" href="/assets/site.css?v=bbbbbbbbbbbbbbbb">', false],
 ["unlisted child migration is not inferred", '<a href="https://glpclinicscout.com/guides/a/">Research</a>', '<a href="https://glpclinicscout.com/insights/a/">Research</a>', false],
 ["unknown URL text", 'evidence:/guides/a/?v=aaaaaaaaaaaaaaaa', 'evidence:/insights/a/?v=bbbbbbbbbbbbbbbb', false],
 ["price strict", '<p>$199</p>', '<p>$299</p>', false],
 ["date strict", '<p>2026-08-06</p>', '<p>2026-08-07</p>', false],
];
for (const [label,before,after,equal] of pairs) test(label,()=>assert.equal(normalize(before)===normalize(after),equal));
