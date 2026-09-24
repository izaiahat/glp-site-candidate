import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"], ["json", { outputFile: "/home/ubuntu/business/reports/glp-affiliate-expansion-20260725/17-wave0-live-browser-qa-playwright.json" }]],
  use: {
    baseURL: "https://glpclinicscout.com",
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    serviceWorkers: "block",
    extraHTTPHeaders: { "Cache-Control": "no-cache" },
  },
  projects: [
    { name: "chromium-live", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-live", use: { ...devices["Desktop Safari"] } },
  ],
});
