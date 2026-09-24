import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { addP1ContentUpgradeSurface } from "../src/wave2-p1-surfaces.mjs";

const root = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, root), "utf8");

const frame = (route) => `<!doctype html><html><head><link rel="canonical" href="https://glpclinicscout.com${route}"></head><body><main><section class="qz-result-shell"><h2>Results</h2></section></main></body></html>`;

test("Pass 5 content-upgrade forms load bounded keepalive retry without persisting email locally", async () => {
  const html = addP1ContentUpgradeSurface(frame("/quiz/provider-fit/"));
  const runtime = await read("assets/content-capture-resilient.js");
  assert.match(html, /src="\/assets\/content-capture-resilient\.js"[^>]*data-p1-capture-resilience/);
  assert.match(runtime, /const MAX_ATTEMPTS = 3/);
  assert.match(runtime, /keepalive: true/);
  assert.match(runtime, /RETRIABLE_STATUS/);
  assert.match(runtime, /event\.stopImmediatePropagation\(\)/);
  assert.match(runtime, /Your email is still here/);
  assert.doesNotMatch(runtime, /localStorage|sessionStorage/);
  const handler = await read("src/content-upgrade.mjs");
  assert.match(handler, /contactSyncFailureResponse: "nonfatal_warning_after_email_acceptance"/);
  assert.match(handler, /return json\(emailAccepted \? 202 : 502, body\)/);
});

test("Pass 5 motion keeps fast-jump content painted and leaves touch scroll native", async () => {
  const motion = await read("assets/motion.js");
  const variants = motion.slice(motion.indexOf("var VARIANTS"), motion.indexOf("var CLEAR"));
  assert.doesNotMatch(variants, /opacity:\s*0\s*[,}]/);
  assert.match(motion, /\(pointer: fine\) and \(min-width: 901px\)/);
  assert.match(motion, /if \(!reduced && !lenis && smoothPointer && window\.Lenis && gsap && ST\)/);
  assert.match(motion, /vars\.immediateRender = false/);
  assert.match(motion, /nativeMobile: !smoothPointer/);
});

test("Pass 5 destination labels resolve to their described route families", async () => {
  const build = await read("scripts/build-staging.mjs");
  const logistics = build.slice(build.indexOf("const logistics ="), build.indexOf("const verdictItems ="));
  assert.equal((logistics.match(/href="\$\{PASS5_MEDICATION_DESTINATIONS\.allProviders\}">Find a provider/g) || []).length, 2);
  assert.doesNotMatch(logistics, /href="\/quiz\/provider-fit\/">Find a provider/);
  assert.match(build, /href="\/self-pay\/">Compare both paths/);
  assert.match(build, /href="\/reviews\/">Read every verdict/);
});
