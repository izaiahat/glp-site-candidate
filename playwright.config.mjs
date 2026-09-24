import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const remoteBaseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
const port = Number(process.env.PLAYWRIGHT_PORT || "4187");
const baseURL = remoteBaseURL || `http://127.0.0.1:${port}`;
if (!remoteBaseURL) process.env.PLAYWRIGHT_BASE_URL = baseURL;
const noWriteProxy = process.env.PLAYWRIGHT_NOWRITE_PROXY;

// Playwright CLEARS `outputDir` before every run. Pointed inside the tree it wiped
// `artifacts/qa/playwright-output/**` out of the candidate, which reads as deleted paths
// against the predecessor release and fails the zero-deletions deploy contract.
// Scratch outputs therefore live OUTSIDE the tree, keyed by tree identity so parallel
// candidates never collide. Overridable, but never defaulted back into the release.
const treeRoot = path.dirname(new URL(import.meta.url).pathname);
const treeKey = crypto.createHash("sha256").update(treeRoot).digest("hex").slice(0, 12);
const scratchRoot = process.env.PLAYWRIGHT_SCRATCH_ROOT
  || path.join(os.tmpdir(), `glp-playwright-${treeKey}`);
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || path.join(scratchRoot, "playwright-output");
const jsonOutputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || path.join(scratchRoot, "playwright.json");

if (path.resolve(outputDir).startsWith(path.resolve(treeRoot) + path.sep)) {
  throw new Error(`playwright_output_dir_inside_release_tree: ${outputDir}`);
}
if (path.resolve(jsonOutputFile).startsWith(path.resolve(treeRoot) + path.sep)) {
  throw new Error(`playwright_json_output_inside_release_tree: ${jsonOutputFile}`);
}

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  outputDir,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"], ["json", { outputFile: jsonOutputFile }]],
  use: {
    baseURL,
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    serviceWorkers: "block",
    ...(noWriteProxy ? { proxy: { server: noWriteProxy, bypass: "127.0.0.1,localhost,[::1]" } } : {}),
  },
  // R1 (orchestrator ruling 2026-09-17): the registered browser suite is served by the candidate's own review server,
  // which models public/_redirects (real 301s), the query-aware /best/online-glp-1-providers/ Pages Function and the
  // /go/<program> resolver. A bare static server recorded receipted retirements as 404 findings (313 cases on the
  // 2026-09-17 final pass). GLP_REVIEW_PUBLIC_ROOT may point the server at a reader's snapshot of public/.
  webServer: remoteBaseURL ? undefined : {
    command: "node scripts/serve-review.mjs",
    env: {
      PORT: String(port),
      HOST: "127.0.0.1",
      GLP_LOCAL_REVIEW_DB: process.env.GLP_LOCAL_REVIEW_DB || path.join(os.tmpdir(), `glp-review-capture-${process.pid}.sqlite3`),
      ...(process.env.GLP_REVIEW_PUBLIC_ROOT ? { GLP_REVIEW_PUBLIC_ROOT: process.env.GLP_REVIEW_PUBLIC_ROOT } : {}),
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, browserName: "chromium" } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, browserName: "webkit" } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
