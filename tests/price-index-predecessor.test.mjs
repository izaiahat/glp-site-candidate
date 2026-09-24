import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { readPriceIndexPredecessor } from "../src/price-index-predecessor.mjs";
import { normalizePriceIndexBuild4Semantics } from "../src/price-index-semantic-preservation.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const canonical = (x) => Array.isArray(x) ? `[${x.map(canonical).join(",")}]` : x && typeof x === "object" ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}` : JSON.stringify(x);
function pair(label) {
  const html = Buffer.from(`<main><h1>${label}</h1><table><td>$199</td></table></main>`);
  const payload = { schema: "glp-clinic-scout-price-index-build-v1", route: "/glp-1-price-index/", html_sha256: hash(html), record_set_sha256: "a".repeat(64), live_provider_count: 7 };
  return [html, Buffer.from(JSON.stringify({ ...payload, payload_sha256: hash(canonical(payload)) }))];
}
const args = { htmlPath: "/primary/index.html", manifestPath: "/primary/manifest.json", snapshotRoot: "/checkpoint" };
const cache = ["/checkpoint/glp-1-price-index/index.html", "/checkpoint/ops/price-index-manifest.json"];
const newer = pair("current identities");
const older = pair("older identities");
function store(entries) {
  const files = new Map(entries); const writes = [];
  return { files, writes, readFile: async p => { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); }, mkdir: async () => {}, writeFile: async (p,b) => { writes.push(p); files.set(p,Buffer.from(b)); } };
}
const source = await readFile(new URL("../scripts/build-staging.mjs", import.meta.url), "utf8");
const oldReaderSource = source.slice(source.indexOf("async function readDurablePredecessorFile("),source.indexOf("async function readDurablePredecessorTree("));
const readPair = process.env.W4_PAIR_BASELINE === "1" ? async (a,io) => {
  const context = vm.createContext({ path, BUILD4_PRESERVATION:a.snapshotRoot, readFile:io.readFile, mkdir:io.mkdir, writeFile:io.writeFile });
  const read = vm.runInContext(`(${oldReaderSource.trim()})`,context);
  const html = await read(a.htmlPath,"glp-1-price-index/index.html");
  const manifestBytes = await read(a.manifestPath,"ops/price-index-manifest.json");
  return { html, manifestBytes, manifest:JSON.parse(manifestBytes), origin:"legacy" };
} : readPriceIndexPredecessor;

test("coherent primary replaces a stale checkpoint pair",async()=>{
 const io=store([[args.htmlPath,newer[0]],[args.manifestPath,newer[1]],[cache[0],older[0]],[cache[1],older[1]]]);
 const p=await readPair(args,io);assert.equal(hash(p.html),JSON.parse(p.manifestBytes).html_sha256);assert.deepEqual(cache.map(k=>hash(io.files.get(k))),newer.map(hash));
});
test("both primary files absent use only a coherent checkpoint",async()=>{
 const io=store([[cache[0],newer[0]],[cache[1],newer[1]]]);const p=await readPair(args,io);assert.equal(hash(p.html),JSON.parse(p.manifestBytes).html_sha256);
});
test("matching surviving primary member can recover from paired checkpoint",async()=>{
 const io=store([[args.manifestPath,newer[1]],[cache[0],newer[0]],[cache[1],newer[1]]]);const p=await readPair(args,io);assert.equal(hash(p.html),JSON.parse(p.manifestBytes).html_sha256);
});
test("mixed checkpoint like W3 is rejected",async()=>{
 const io=store([[cache[0],older[0]],[cache[1],newer[1]]]);await assert.rejects(readPair(args,io));assert.equal(io.writes.length,0);
});
test("incoherent primary is rejected instead of falling back",async()=>{
 const io=store([[args.htmlPath,older[0]],[args.manifestPath,newer[1]],[cache[0],newer[0]],[cache[1],newer[1]]]);await assert.rejects(readPair(args,io));assert.equal(io.writes.length,0);
});
test("conflicting partial source is rejected without mixing generations",async()=>{
 const io=store([[args.manifestPath,newer[1]],[cache[0],older[0]],[cache[1],older[1]]]);await assert.rejects(readPair(args,io));assert.equal(io.writes.length,0);
});
test("corrupt manifest payload rejected despite matching html hash",async()=>{
 const forged=JSON.parse(newer[1]);forged.live_provider_count=123;
 const io=store([[args.htmlPath,newer[0]],[args.manifestPath,Buffer.from(JSON.stringify(forged))]]);await assert.rejects(readPair(args,io));assert.equal(io.writes.length,0);
});
test("missing checkpoint counterpart fails closed",async()=>{
 const io=store([[cache[0],newer[0]]]);await assert.rejects(readPair(args,io));
});
test("non-ENOENT primary read errors do not trigger fallback",async()=>{
 const io=store([[cache[0],newer[0]],[cache[1],newer[1]]]);io.readFile=async()=>{throw Object.assign(new Error("denied"),{code:"EACCES"});};await assert.rejects(readPair(args,io),{code:"EACCES"});
});
test("coherent malicious repricing still fails the unchanged semantic comparator",async()=>{
 const original=newer[0].toString();const corrupt=original.replace("$199","$999");assert.notEqual(normalizePriceIndexBuild4Semantics(original),normalizePriceIndexBuild4Semantics(corrupt));
});
test("equal counts with different provider content remain genuine drift",async()=>{
 assert.notEqual(normalizePriceIndexBuild4Semantics(newer[0]),normalizePriceIndexBuild4Semantics(older[0]));
});
