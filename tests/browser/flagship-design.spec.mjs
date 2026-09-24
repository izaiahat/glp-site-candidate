import { test, expect } from "@playwright/test";
import { loadGoSelection } from "../../src/go-runtime-selection.mjs";
import { isAllowedTrackingHost } from "../../src/tracking-allowed-hosts.mjs";

const ROUTES = [
  { key: "home", path: "/", surface: ".cs-home2-hero", image: ".cs-home2-cluster__main img", stylesheet: "site-home.css" },
  { key: "review-orderlymeds", path: "/reviews/orderlymeds/", surface: "#bottom-line", image: ".review-logo img", stylesheet: "site-review.css" },
  { key: "review-shed", path: "/reviews/shedrx/", surface: "#bottom-line", image: ".review-logo img", stylesheet: "site-review.css" },
  { key: "money", path: "/compare/found-vs-yourera/", redirect: "/providers/", surface: 'main.listing[data-listing-archetype="E"] > .listing__intro', image: null, stylesheet: "site-p3.css" },
  { key: "guide", path: "/pharmacies/", surface: 'main[data-listing-archetype="D"][data-phase3-route="/pharmacies/"] > .listing__intro', image: null, stylesheet: "site-p3.css" },
  { key: "library", path: "/guides/", redirect: "/insights/", surface: ".p3-insights-hero", image: "[data-insights-feature]:visible img", stylesheet: "site-editorial.css" },
  { key: "quiz", path: "/quiz/provider-fit/", surface: ".qz-intro", image: null, stylesheet: "site-tools.css" },
  { key: "trust", path: "/how-we-rate/", surface: "main", image: null, stylesheet: "site-trust.css" },
];
const WIDTHS = [1440, 390];

test.beforeEach(async ({ page }) => {
  // Keep browser validation hermetic while preserving observable vendor-request behavior.
  await page.route(/https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms)\//i, (route) => route.fulfill({ status: 204, contentType: "application/javascript", body: "" }));
});

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`${route.key} ${width}px satisfies the shared flagship shell`, async ({ page, request }) => {
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console:${message.text()}`);
      });
      page.on("pageerror", (error) => errors.push(`page:${error.message}`));
      await page.setViewportSize({ width, height: 900 });
      if (route.redirect) {
        const redirect = await request.get(route.path, { maxRedirects: 0 });
        expect(redirect.status()).toBe(301);
        const location = redirect.headers().location;
        expect(location).toBeTruthy();
        expect(new URL(location, redirect.url()).href).toBe(new URL(route.redirect, redirect.url()).href);
      }
      const response = await page.goto(route.path, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(route.redirect || route.path);
      await page.evaluate(() => document.fonts.ready);

      await expect(page.locator("body > .skip-link")).toHaveCount(1);
      await expect(page.locator(".gcs-utility")).toHaveCount(0);
      await expect(page.locator(".gcs-nav")).toHaveCount(1);
      await expect(page.locator("main#main")).toHaveCount(1);
      await expect(page.locator(".gcs-footer")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index,follow/);
      const stylesheet = page.locator(`link[rel="stylesheet"][href^="/assets/${route.stylesheet}"]`);
      await expect(stylesheet).toHaveCount(1);
      await expect(stylesheet).toHaveAttribute("href", new RegExp(`^/assets/${route.stylesheet.replace(".", "\\.")}\\?v=[a-f0-9]{16}$`));
      const runtimeStyles = page.locator("head > style");
      const runtimeStyleTexts = await runtimeStyles.allTextContents();
      // Head styles are exactly the reviewed set: the runtime consent style, the preserved pass-2 shell style
      // (pinned verbatim by tests/wave2-regression.test.mjs, data-preserve).
      // Phase 4 quiz controls use the reviewed site-tools.css, not legacy #quiz-questions CSS.
      // Any other inline style is still a failure - the count is a ceiling AND each member is named.
      expect(runtimeStyleTexts.length).toBeLessThanOrEqual(2);
      expect(runtimeStyleTexts.some((style) => style.includes("#gcs-consent"))).toBe(true);
      await expect(page.locator("head > style[data-preserve][data-pass2-shell]")).toHaveCount(1);
      expect(runtimeStyleTexts.filter((style) => !style.includes("#gcs-consent") && !style.includes("main:not(.p3-page)"))).toEqual([]);
      if (route.key === "quiz") {
        await expect(page.locator("[data-phase4-quiz] [data-quiz-position]:visible")).toHaveCount(1);
        await expect(page.locator("#health-consent-gate")).toHaveCount(0);
      }
      const paidLinks = await page.locator('a[data-link-mode], a[data-analytics-event="affiliate_click"], a[href^="/go/"], a[rel~="sponsored"]').evaluateAll((links) => links.map((link) => ({
        href: link.getAttribute("href"),
        mode: link.getAttribute("data-link-mode"),
        rel: (link.getAttribute("rel") || "").split(/\s+/).filter(Boolean),
        event: link.getAttribute("data-analytics-event"),
        program: link.getAttribute("data-program"),
        network: link.getAttribute("data-network"),
      })));
      const selectedPrograms = Object.values(loadGoSelection()?.programs || {});
      for (const link of paidLinks) {
        expect(["server-redirect", "transparent-direct"]).toContain(link.mode);
        expect(link.rel).toEqual(expect.arrayContaining(["sponsored", "nofollow", "noopener"]));
        expect(link.event).toBe("affiliate_click");
        expect(link.href).toBeTruthy();
        const target = new URL(link.href, page.url());
        if (link.mode === "server-redirect") {
          const selected = selectedPrograms.filter((program) => program.program_id === link.program || program.render_id === link.program);
          expect(selected).toHaveLength(1);
          expect(selected[0].disposition).toBe("ADOPT");
          expect(link.href).toMatch(/^\/go\//);
          expect(target.pathname).toBe(selected[0].route);
          expect(target.hash).toBe("");
          expect([...target.searchParams.keys()].sort()).toEqual(["s", "v"]);
          expect(target.searchParams.get("s")).toMatch(/^[a-z0-9][a-z0-9-]{0,79}\.[a-z0-9][a-z0-9-]{0,11}$/);
          if (route.key.startsWith("review-")) expect(target.searchParams.get("s")).toBe("reviews.rv2");
          expect(target.searchParams.get("v")).toBe("a");
        } else {
          expect(link.href).toMatch(/^https:\/\//);
          expect(target.protocol).toBe("https:");
          expect(isAllowedTrackingHost(link.program, link.network, target.hostname)).toBe(true);
        }
      }

      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Source Sans 3");
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily)).toContain("Manrope");

      const layout = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        duplicateIds: [...document.querySelectorAll("[id]")].map((node) => node.id).filter((id, index, ids) => ids.indexOf(id) !== index),
      }));
      expect(layout.scroll - layout.client).toBeLessThanOrEqual(1);
      expect(layout.duplicateIds).toEqual([]);
      expect(errors).toEqual([]);

      const approvedSurface = page.locator(route.surface).first();
      await expect(approvedSurface).toBeVisible();
      if (route.image) {
        const image = page.locator(route.image).first();
        await expect(image).toBeVisible();
        await image.evaluate((node) => node.decode());
        expect(await image.evaluate((node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0)).toBe(true);
      } else {
        await expect(approvedSurface.locator("img")).toHaveCount(0);
      }

      if (route.key === "money") {
        await expect(page.locator(".social-proof, [data-proof-status]")).toHaveCount(0);
        const disclosure = page.locator(".affiliate-note").first();
        await expect(disclosure).toBeVisible();
        await expect(disclosure).toContainText(/may earn a commission.*never changes a score/i);
        const schemaText = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
        expect(schemaText).not.toMatch(/AggregateRating|"@type"\s*:\s*"Review"|"(?:ratingCount|reviewCount)"\s*:/);
      }

      if (route.key === "library") {
        const index = page.locator('.library-index[aria-label="Research library sections"]');
        await expect(index).toBeVisible();
        await expect(index.locator('a[href^="#guides-"]')).toHaveCount(1);
        await expect(page.locator("#guides-glp-1")).toHaveText("GLP-1");
        await expect(page.locator("#guides-wellness")).toHaveCount(0);
      }

      if (width === 390) {
        const menuButton = page.locator("[data-menu-toggle]");
        await expect(menuButton).toBeVisible();
        await expect(page.locator("[data-menu]")).toBeHidden();
        await menuButton.click();
        await expect(menuButton).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator("[data-menu]")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menuButton).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator("[data-menu]")).toBeHidden();
      }
    });
  }
}

test("homepage follows the accepted task-first chapter order", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("Find a GLP-1 plan that fits.");
  const headings = await page.locator("main h2").allTextContents();
  const expected = [
    "What you can check about Clinic Scout",
    "Every GLP‑1 route, with what it actually costs.",
    "Two ways to pay, priced side by side.",
    "Care you can actually check.",
    "What gets a program left off the list.",
    "Cash price, checked and cited.",
    "What we found, and when we found it.",
    "Today's three strongest programs, with the date on every price.",
    "Know your real monthly cost before you sign up.",
    "We don't sell these medications. We don't prescribe them.",
    "Answers to the questions that cost you money.",
    "Why trust Clinic Scout",
    "Get the 7-point provider terms checklist",
  ];
  let cursor = -1;
  for (const heading of expected) {
    const next = headings.indexOf(heading);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
});

test("national directory remains retired with no stale search surface", async ({ page }) => {
  const response = await page.goto("/directory/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("[data-city-card], [data-city-search], [data-city-tier-filter]")).toHaveCount(0);
});

test("city directory remains retired with no stale clinic controls", async ({ page }) => {
  const response = await page.goto("/clinics/portland-or/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("[data-directory-results], [data-directory-sort], [data-directory-taxonomy]")).toHaveCount(0);
});

test("analytics stays held in the candidate, suppresses synthetic runs, and persists opt-out", async ({ page }) => {
  const vendorRequests = [];
  page.on("request", (request) => {
    if (/google-analytics\.com|googletagmanager\.com|clarity\.ms|posthog\.com/i.test(request.url())) vendorRequests.push(request.url());
  });
  await page.route((url) => url.pathname === "/api/geo-state" && url.searchParams.get("purpose") === "consent", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ schema: "glp-consent-region-v1", model: "us-default-on" }),
  }));
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.GCSConsentReady);
  expect(await page.evaluate(() => window.GCS_ANALYTICS)).toEqual({
    enabled: false,
    consent: "denied",
    measurement_id: "G-2WQ42JY0WK",
    debug_measurement_id: "G-PY9P5CW2EM",
    operator_gate: "explicit-consent-v3",
    gtm_container_id: "GTM-PWR49VVK",
  });
  expect(await page.evaluate(() => window.GCS_EXPORT_POLICY)).toEqual({
    schema: "glp-release-export-policy-v2",
    stage: "candidate",
    third_party_exports: false,
    reason: "local-candidate-export-hold",
  });
  expect(await page.evaluate(() => window.GCSConsent.purposes())).toEqual({ analytics: "granted", advertising: "denied" });
  expect(await page.evaluate(() => window.GCSConsent.allowsExports())).toBe(false);
  await expect(page.locator("#gcs-consent input[type=checkbox]")).toHaveCount(0);
  await expect(page.locator('#gcs-consent [data-consent-open]')).toBeVisible();
  await expect(page.locator('[data-consent="denied"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  expect(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("gcs_tracking_consent_v1"));
    return { analytics: saved.analytics, advertising: saved.advertising, record_type: saved.record_type, version: saved.version };
  })).toEqual({ analytics: "granted", advertising: "denied", record_type: "preference_only", version: "gcs-cookie-v4-distinct-purposes" });
  expect(await page.evaluate(() => window.GCSConsent.effective())).toBe("granted");
  expect(await page.evaluate(() => window.GCSConsent.allowsExports())).toBe(false);
  expect(await page.evaluate(() => window.GCS_ANALYTICS.enabled)).toBe(false);
  expect(await page.evaluate(() => window.GCS_ANALYTICS.consent)).toBe("denied");
  expect(vendorRequests).toEqual([]);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => window.GCSConsentReady);
  expect(await page.evaluate(() => window.GCSConsent.effective())).toBe("granted");
  expect(await page.evaluate(() => window.GCSConsent.allowsExports())).toBe(false);
  expect(await page.evaluate(() => window.GCS_ANALYTICS.consent)).toBe("denied");
  expect(vendorRequests).toEqual([]);
  await page.evaluate(() => window.GCSConsent.open());
  await expect(page.locator('[data-consent="denied"]')).toBeVisible();
  // ANALYTICS-TRUTH 2026-08-20 — this assertion used to read
  //   expect(vendorRequests.some((u) => u.includes("gtag/js?id=G-PY9P5CW2EM"))).toBe(true)
  // i.e. the gate REQUIRED that a Playwright run on 127.0.0.1 start GA4 collection.
  // That is the defect Cogny's audit found: 20,617 of 20,958 sessions in production
  // property 541440529 came from hostName 127.0.0.1, 15,889 of them through this very
  // debug stream, because this test asserted the leak was correct. The contract now is
  // the one the test title always claimed: a synthetic run may still FETCH the vendor
  // library (consent.js appends it a script-tag earlier and a pending fetch cannot be
  // recalled), but it must send ZERO measurement hits. `/g/collect` is the hit.
  expect(vendorRequests.filter((url) => /\/g\/collect|\/collect\?|\/j\/collect/.test(url))).toEqual([]);
  expect(vendorRequests.some((url) => url.includes("G-2WQ42JY0WK"))).toBe(false);
  expect(await page.evaluate(() => window.GCS_ANALYTICS_SUPPRESSED)).toBe(true);
  await page.locator('[data-consent="denied"]').click();
  expect(await page.evaluate(() => window.GCS_ANALYTICS.consent)).toBe("denied");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gcs_tracking_consent_v1"))?.analytics)).toBe("denied");
  vendorRequests.length = 0;
  await page.reload({ waitUntil: "networkidle" });
  expect(await page.evaluate(() => window.GCS_ANALYTICS.consent)).toBe("denied");
  expect(vendorRequests).toEqual([]);
  const probe = await page.evaluate(() => {
    const calls = [];
    window.gtag = (...args) => calls.push(args);
    window.GCS_ANALYTICS = { ...window.GCS_ANALYTICS, enabled: true, consent: "granted" };
    const allowed = window.GCSAnalytics.event("quiz_complete", {
      page_slug: "/quiz/provider-fit/",
      email: "must-not-pass@example.com",
      quiz_answers: "must-not-pass",
      unknown: "must-not-pass",
    });
    const unknown = window.GCSAnalytics.event("eligibility_quiz_complete", { result_count: 3 });
    return { allowed, unknown, calls };
  });
  // Under automation emit() is now closed end-to-end: not "allow-listed then sent",
  // but refused before a transport is touched. The allow-list / PII-scrubbing proof
  // that used to live here now runs where it is actually meaningful — against a
  // NON-suppressed, production-hostname context — in analytics-truth.spec.mjs.
  expect(probe.allowed).toBe(false);
  expect(probe.unknown).toBe(false);
  expect(probe.calls).toEqual([]);
});
