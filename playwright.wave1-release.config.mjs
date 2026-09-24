import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// Same rule as playwright.config.mjs: Playwright wipes outputDir, so it must never
// point inside the release tree (default would be `<tree>/test-results`).
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR
  || path.join(os.tmpdir(), "glp-playwright-wave1-release");

export default defineConfig({
  testDir: "./tests/browser",
  outputDir,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    serviceWorkers: "block",
  },
  webServer: {
    command: "python3 -m http.server 4175 --bind 127.0.0.1 --directory /home/ubuntu/business/site-system/flagship-v2/releases/glp-wave1-20260725/public",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
