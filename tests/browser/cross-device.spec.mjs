import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAffiliateLinkMap } from "../../src/affiliate-link-map.mjs";
import { approvedRetirement } from "./retirement-support.mjs";
import { expectSurveyHandoff, retakeSurvey, quizAudit } from "./round5-quiz-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BROWSER_ARTIFACTS = path.join(process.env.PLAYWRIGHT_SCRATCH_ROOT || path.join(ROOT, "artifacts", "ultracode"), "browser-existing");
const CWV_RECEIPT = path.join(BROWSER_ARTIFACTS, "cwv-lab-chromium.jsonl");
const REPORT = path.join(BROWSER_ARTIFACTS, "cross-device-renders");
mkdirSync(REPORT, { recursive: true });
const widths = [1440, 1280, 768, 390, 375];
const quizTrackingHosts = new Set(Object.values(loadAffiliateLinkMap("quiz"))
  .filter((link) => link.live && link.affiliate_href)
  .map((link) => new URL(link.affiliate_href).hostname));
const pages = [
  { key: "money", url: "/cost/online-glp-1-programs/", hero: ".money-hero img", table: true, sticky: true },
  { key: "quiz", url: "/quiz/provider-fit/", hero: ".hero img", quiz: true },
  { key: "blog", url: "/pharmacies/", hero: ".hero img" },
  { key: "review-orderlymeds", url: "/reviews/orderlymeds/", hero: ".review-logo img" },
  { key: "review-shed", url: "/reviews/shedrx/", hero: ".review-logo img" },
  { key: "found-yourera", url: "/compare/found-vs-yourera/", hero: ".money-hero img", table: true, sticky: true },
  { key: "trimi-shed", url: "/compare/trimi-vs-shed/", hero: ".money-hero img", table: true, sticky: true },
  { key: "savings-cards", url: "/guides/zepbound-wegovy-savings-card-terms/", hero: ".hero img" },
  { key: "tirzepatide-online", url: "/guides/tirzepatide-online-verification-checklist/", hero: ".hero img" },
  { key: "online-prescription", url: "/guides/how-to-get-glp-1-prescription-online/", hero: ".hero img" },
  { key: "subscriptions", url: "/guides/glp-1-subscription-cancellation-terms/", hero: ".hero img" },
  { key: "healthrx-agelessrx", url: "/compare/healthrx-vs-agelessrx/", hero: ".money-hero img", table: true, sticky: true },
  { key: "wellorithm-enhancemd", url: "/compare/wellorithm-vs-enhance-md/", hero: ".money-hero img", table: true, sticky: true },
  { key: "cost-without-insurance", url: "/guides/zepbound-wegovy-cost-without-insurance/", hero: ".hero img" },
  { key: "semaglutide-online", url: "/guides/semaglutide-online-safety-verification/", hero: ".hero img" },
  { key: "prior-authorization", url: "/guides/glp-1-prior-authorization-appeals/", hero: ".hero img" },
  { key: "shortage-check", url: "/guides/glp-1-shortage-availability-check/", hero: ".hero img" },
  { key: "ozempic-cost", url: "/guides/ozempic-cost-without-insurance/", hero: ".hero img" },
  { key: "mounjaro-cost", url: "/guides/mounjaro-cost-without-insurance/", hero: ".hero img" },
  { key: "mounjaro-zepbound", url: "/guides/mounjaro-vs-zepbound-label-and-cost/", hero: ".hero img" },
  { key: "ozempic-wegovy", url: "/guides/ozempic-vs-wegovy-label-and-cost/", hero: ".hero img" },
  { key: "medicare-bridge", url: "/guides/medicare-glp-1-bridge-eligibility/", hero: ".hero img" },
  { key: "novo-pap", url: "/guides/novo-nordisk-patient-assistance-vs-savings/", hero: ".hero img" },
  { key: "lilly-assistance", url: "/guides/lilly-patient-assistance-vs-savings/", hero: ".hero img" },
  { key: "counterfeit-ozempic", url: "/guides/counterfeit-ozempic-verification-reporting/", hero: ".hero img" },
  { key: "plan-commitment", url: "/compare/month-to-month-vs-annual-glp-1-programs/", hero: ".money-hero img", table: true, sticky: true },
  { key: "shipping-review", url: "/compare/glp-1-program-shipping-and-clinician-review/", hero: ".money-hero img", table: true, sticky: true },
  { key: "guide-library", url: "/guides/", hero: ".gcs-home-hero img" },
  { key: "ed-evidence", url: "/guides/erectile-dysfunction-evidence-overview/", hero: ".hero img" },
  { key: "peptide-evidence", url: "/guides/peptide-therapy-regulatory-status/", hero: ".hero img" },
  { key: "hair-evidence", url: "/guides/minoxidil-evidence-and-options/", hero: ".hero img" },
  { key: "trt-evidence", url: "/guides/trt-evidence-overview/", hero: ".hero img" },
  { key: "wellness-evidence", url: "/guides/metabolic-health-evidence-overview/", hero: ".hero img" },
];

const MONEY_PAGE_KEYS = new Set([
  "money",
  "found-yourera",
  "trimi-shed",
  "healthrx-agelessrx",
  "wellorithm-enhancemd",
  "plan-commitment",
  "shipping-review",
]);

function approvedSurface(spec) {
  if (MONEY_PAGE_KEYS.has(spec.key)) {
    // P67 / R32: the bulk intent hub is not an archetype-A result listing.
    if (spec.key === "plan-commitment") return { selector: 'main[data-phase3-route="/bulk/"] > .p3-index-hero', image: null, route: "/bulk/", intentHub: true };
    const route = "/providers/";
    const main = `main[data-listing-archetype="E"][data-phase3-route="${route}"]`;
    return { selector: `${main} > .listing__intro`, image: null, route, providerMark: `${main} [data-phase3-provider]:not([hidden]) .provider-logo[role="img"]` };
  }
  if (spec.key === "quiz") return { selector: "[data-phase4-quiz] .qz-intro", image: null };
  if (spec.key === "guide-library") return { selector: 'main[data-phase3-route="/insights/"] > .p3-insights-hero', image: 'main[data-phase3-route="/insights/"] [data-insights-feature] img', responsiveDerivative: true, route: "/insights/" };
  if (spec.url === "/pharmacies/") return { selector: 'main[data-listing-archetype="D"][data-phase3-route="/pharmacies/"] > .listing__intro', image: null };
  if (spec.url.startsWith("/guides/")) return { selector: ".guide-hero", image: ".guide-hero img", responsiveDerivative: true };
  if (spec.url.startsWith("/reviews/")) return { selector: "#bottom-line", image: ".review-logo img", responsiveDerivative: false };
  return { selector: ".hero", image: ".hero img", responsiveDerivative: true };
}

function expectQuizNetworkContract(outbound) {
  expect(outbound.filter((request) => /google-analytics|googletagmanager|clarity\.ms/i.test(request.url))).toEqual([]);
  expect(outbound.filter((request) => /\/api\/leads/i.test(request.url))).toEqual([]);
  // /api/geo-state?purpose=consent is a permitted region-model GET, not a quiz answer.
  // Examine query parameters and request bodies so sensitive values cannot leave in either.
  for (const request of outbound) {
    const target = new URL(request.url);
    const auditedPath = target.pathname === "/api/geo-state" ? "/api/geo-region" : target.pathname;
    expect(`${auditedPath}${target.search}\n${request.body || ""}`).not.toMatch(/bmi_range|current_meds|insurance|state|timeline|quiz_answers|diagnosis|medical_history/i);
  }
}

async function completeProviderFitQuiz(page) {
  // No consent gate and no start control: the quiz auto-initializes and
  // position 0 ([data-quiz-position="0"]) is shown on load without any click.
  await expect(page.locator("#begin-quiz")).toHaveCount(0);
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();
  const positions = page.locator('[data-phase4-quiz] [data-quiz-position]');
  await expect(positions).toHaveCount(7);
  expect(await positions.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-quiz-position")))).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  const route = [0, 2, 1, 4, 5, 6];
  const steps = route.length;
  expect(steps).toBeGreaterThanOrEqual(5);
  expect(steps).toBeLessThanOrEqual(7);
  for (let step = 0; step < steps; step += 1) {
    const index = route[step];
    const question = page.locator(`[data-phase4-quiz] [data-quiz-position="${index}"]`);
    await expect(question).toBeVisible();
    if (index === 0) {
      const option = question.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]');
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
    } else if (index === 2) {
      const option = question.locator('[data-single="current_use"][data-value="no"]');
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      await expect(question).toBeHidden();
      await expect(page.locator('[data-phase4-quiz] [data-quiz-position="1"]')).toBeVisible();
      continue;
    } else if (index === 5) {
      const state = question.locator('[data-quiz-select="state"]');
      await expect(state).toBeVisible();
      await state.selectOption("CA");
      await expect(state).toHaveValue("CA");
    } else if (index === 6) {
      await expect(question.locator('[data-quiz-input="first_name"]')).toHaveValue("");
      await expect(question.locator('[data-quiz-input="email"]')).toHaveValue("");
    }
    const action = question.locator(index === 6 ? "[data-quiz-finish]" : "[data-quiz-next]");
    await expect(action).toBeEnabled();
    if (index === 6) {
      const { cards } = await expectSurveyHandoff(page, () => action.click(), "CA");
      return cards;
    }
    await action.click();
    await expect(question).toBeHidden();
  }
  throw new Error("quiz_finish_step_missing");
}

for (const spec of pages) {
  for (const width of widths) {
    test(`${spec.key} ${width}px has no global overflow and preserves interaction`, async ({ page, browserName }) => {
      if (browserName === "chromium" && spec.key === "money" && width === 1440) {
        mkdirSync(new URL(".", `file://${CWV_RECEIPT}`).pathname, { recursive: true });
        rmSync(CWV_RECEIPT, { force: true });
      }
      const height = width <= 390 ? 844 : width === 768 ? 1024 : 1000;
      const outbound = [];
      if (spec.quiz) {
        page.on("request", (request) => {
          if (request.method() !== "GET" || /\/api\/|google-analytics|googletagmanager|clarity\.ms/i.test(request.url())) {
            outbound.push({ method: request.method(), url: request.url(), body: request.postData() });
          }
        });
      }
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.__gcsVitals = { lcp: 0, cls: 0, inp: 0 };
        try { new PerformanceObserver((list) => { const entries = list.getEntries(); const last = entries.at(-1); if (last) window.__gcsVitals.lcp = Math.max(window.__gcsVitals.lcp, last.startTime); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
        try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__gcsVitals.cls += entry.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
        try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.interactionId && entry.duration >= window.__gcsVitals.inp) {
          window.__gcsVitals.inp = entry.duration;
          window.__gcsVitals.interaction = { name: entry.name, interactionId: entry.interactionId, startTime: entry.startTime, processingStart: entry.processingStart, processingEnd: entry.processingEnd, duration: entry.duration, targetTag: entry.target?.tagName || null, targetId: entry.target?.id || null };
        } }).observe({ type: "event", buffered: true, durationThreshold: 16 }); } catch {}
      });
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      const response = await page.goto(spec.url, { waitUntil: "networkidle" });
      expect(response?.ok()).toBeTruthy();
      const surfaceContract = approvedSurface(spec);
      if (surfaceContract.route) {
        const redirectedFrom = response.request().redirectedFrom();
        expect(redirectedFrom).not.toBeNull();
        expect(redirectedFrom.redirectedFrom()).toBeNull();
        expect(new URL(redirectedFrom.url()).pathname).toBe(spec.url);
        const retirement = await redirectedFrom.response();
        expect(retirement?.status()).toBe(301);
        expect(new URL(page.url()).pathname).toBe(surfaceContract.route);
        expect(new URL(page.url()).origin).toBe(new URL(redirectedFrom.url()).origin);
      }
      await expect.poll(() => page.evaluate(() => window.GCSConsent?.model())).toBe('global-default-on');
      const consent = page.locator('#gcs-consent [data-consent="acknowledge"]');
      await expect(page.locator('#gcs-consent button')).toHaveCount(1);
      await expect(page.locator('#gcs-consent input')).toHaveCount(0);
      await expect(consent).toBeVisible();
      let inpProxy = 0;
      await consent.evaluate((element) => {
        window.__gcsInpProxyPromise = new Promise((resolve, reject) => {
          let started = performance.now();
          const timer = setTimeout(() => reject(new Error("consent INP proxy did not observe a click within 5s")), 5_000);
          element.addEventListener("pointerdown", () => { started = performance.now(); }, { once: true });
          element.addEventListener("click", () => requestAnimationFrame(() => {
            clearTimeout(timer);
            resolve(performance.now() - started);
          }), { once: true });
        });
      });
      await consent.click();
      inpProxy = await page.evaluate(() => window.__gcsInpProxyPromise);
      await expect(page.locator("html")).toHaveAttribute("data-release", /held|release-ready|staging|live/).catch(async () => {
        await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /(?:noindex|index)/);
      });

      const globalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(globalOverflow).toBeLessThanOrEqual(1);

      const brokenImages = await page.locator("img").evaluateAll(async (images) => {
        for (const image of images) image.loading = "eager";
        await Promise.all(images.map((image) => image.decode().catch(() => null)));
        return images
          .filter((image) => !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1)
          .map((image) => image.getAttribute("src"));
      });
      expect(brokenImages).toEqual([]);
      const surface = page.locator(surfaceContract.selector).first();
      await expect(surface).toBeVisible();
      if (surfaceContract.route) {
        await expect(page.locator(surfaceContract.selector)).toHaveCount(1);
        await expect(surface.locator("h1")).toHaveCount(1);
        await expect(surface.locator("h1")).toBeVisible();
        await expect(surface.locator("h1")).toHaveText(/\S/);
      }
      if (surfaceContract.providerMark) {
        const mark = page.locator(surfaceContract.providerMark).first();
        await expect(mark).toBeVisible();
        await expect(mark).toHaveAttribute("aria-label", /\S/);
        const box = await mark.boundingBox();
        expect(box?.width).toBeGreaterThan(0);
        expect(box?.height).toBeGreaterThan(0);
        const classes = (await mark.getAttribute("class")).split(/\s+/);
        if (classes.includes("provider-logo--sprite")) {
          const asset = await mark.evaluate(async (element) => {
            const background = getComputedStyle(element).backgroundImage;
            const match = /^url\(["']?(.*?)["']?\)$/.exec(background);
            if (!match) throw new Error("provider sprite has no single image resource");
            const image = new Image();
            image.src = new URL(match[1], document.baseURI).href;
            await image.decode();
            const resource = performance.getEntriesByName(image.src).at(-1);
            return { width: image.naturalWidth, height: image.naturalHeight, loaded: Boolean(resource), bytes: resource?.transferSize || resource?.encodedBodySize || 0 };
          });
          expect(asset.width).toBeGreaterThan(0);
          expect(asset.height).toBeGreaterThan(0);
          expect(asset.loaded).toBe(true);
          expect(asset.bytes).toBeLessThan(width <= 390 ? 120_000 : 300_000);
        } else {
          expect(classes).toContain("provider-logo--wordmark");
          await expect(mark.locator(".provider-wordmark")).toBeVisible();
          await expect(mark.locator(".provider-wordmark")).toHaveText(/\S/);
        }
      }
      if (spec.url === "/pharmacies/") {
        await expect(page.locator(surfaceContract.selector)).toHaveCount(1);
        await expect(surface.locator("h1")).toHaveCount(1);
        await expect(surface.locator("h1")).toBeVisible();
        await expect(surface.locator("h1")).toHaveText("Compare compounding pharmacies");
        for (const selector of ['input[type="search"][data-pharmacy-search]', 'input[type="hidden"][data-pharmacy-class]', 'input[type="hidden"][data-pharmacy-med]', "select[data-pharmacy-additive]", 'input[type="hidden"][data-pharmacy-state]', "[data-state-open]"]) {
          await expect(page.locator(`main ${selector}`)).toHaveCount(1);
        }
        await expect(page.locator('main [data-filter-group="data-pharmacy-class"] button')).toHaveText(["All", "503B", "503A"]);
        await expect(page.locator('main [data-filter-group="data-pharmacy-med"] button')).toHaveText(["Both", "Semaglutide", "Tirzepatide"]);
        await expect(page.locator("main [data-pharmacy-grid]")).toHaveCount(1);
      }
      if (surfaceContract.image) {
        const hero = page.locator(surfaceContract.image).first();
        await expect(hero).toBeVisible();
        expect(await hero.getAttribute("width")).toBeTruthy();
        expect(await hero.getAttribute("height")).toBeTruthy();
        expect(await hero.getAttribute("alt")).toBeTruthy();
        const deviceScaleFactor = await page.evaluate(() => window.devicePixelRatio);
        expect(deviceScaleFactor).toBeGreaterThan(0);
        const expectedWidth = [800, 1600].find((candidate) => candidate >= width * deviceScaleFactor) || 1600;
        const expectedDerivative = surfaceContract.responsiveDerivative && width <= 390 ? `-${expectedWidth}.` : null;
        if (expectedDerivative) expect(await hero.evaluate((image, expected) => image.currentSrc.includes(expected), expectedDerivative)).toBeTruthy();
        const heroResource = await hero.evaluate((image) => {
          const entry = performance.getEntriesByName(image.currentSrc).at(-1);
          return { src: image.currentSrc, transferSize: entry?.transferSize || entry?.encodedBodySize || 0 };
        });
        expect(heroResource.transferSize).toBeLessThan(width <= 390 ? 120_000 : 300_000);
      } else {
        await expect(surface.locator("img")).toHaveCount(0);
      }

      const undersized = await page.locator("button, .cta, .option, .submit, .wordmark, a.panel").evaluateAll((elements) => elements.filter((element) => {
        const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
      }).map((element) => ({ text: element.textContent?.trim().slice(0, 60), rect: element.getBoundingClientRect().toJSON() })));
      expect(undersized).toEqual([]);

      if (surfaceContract.intentHub) {
        const intents = page.locator('main[data-phase3-route="/bulk/"] .p3-intent-grid > a.p3-intent-card');
        await expect(intents).toHaveCount(4);
        const destinations = await intents.evaluateAll((nodes) => nodes.map((node) => {
          const url = new URL(node.href);
          return { origin: url.origin, destination: `${url.pathname}${url.search}` };
        }));
        expect(destinations.every((item) => item.origin === new URL(page.url()).origin)).toBe(true);
        expect(destinations.map((item) => item.destination).sort()).toEqual([
          "/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest",
          "/3-month/?drug=TIRZEPATIDE&form=COMPOUNDED&plan=3&sort=cheapest",
          "/6-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&duration=6&sort=cheapest",
          "/6-month/?drug=TIRZEPATIDE&form=COMPOUNDED&duration=6&sort=cheapest",
        ]);
        for (const intent of await intents.all()) {
          await expect(intent).toBeVisible();
          await expect(intent.locator("h2")).toHaveText(/\S/);
        }
      } else if (spec.table) {
        // RR-7 retires the old pairwise presentation, not the replacement directory checks.
        if (spec.url === "/compare/found-vs-yourera/") {
          await approvedRetirement("RR-7", test.info());
        }
        // R14: both presentations must carry the same nonempty price-row set.
        // The mobile card is not a provider-count oracle: one provider may have several prices.
        const desktopRows = page.locator('.d3-directory-table [data-directory-row]');
        const mobileCards = page.locator('.d3-mobile-cards [data-directory-price-card]');
        const desktopIds = await desktopRows.evaluateAll((nodes) => nodes.map((node) => node.dataset.directoryRow));
        expect(desktopIds.length).toBeGreaterThan(0);
        expect(new Set(desktopIds).size).toBe(desktopIds.length);
        expect(await mobileCards.evaluateAll((nodes) => nodes.map((node) => node.dataset.directoryRow))).toEqual(desktopIds);
        const presentation = page.locator(width <= 768 ? ".d3-mobile-cards" : ".d3-directory-table").first();
        await expect(presentation).toBeVisible();
        await expect(page.locator(width <= 768 ? ".d3-directory-table" : ".d3-mobile-cards").first()).toBeHidden();
        const rows = width <= 768 ? mobileCards : desktopRows;
        for (const row of await rows.all()) {
          await expect(row).toBeVisible();
          await expect(row.locator('a[data-card-review]')).toHaveCount(1);
          await expect(row.locator('a[data-card-review]')).toHaveAttribute("href", /^\/reviews\/[a-z0-9-]+\/$/);
          const dimensions = await row.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
          expect(dimensions.scroll - dimensions.client).toBeLessThanOrEqual(1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      }

      if (spec.sticky && width <= 390) {
        // R14/R32 retire the old floating verdict. Keep the actionable, unobscured 44px target contract.
        const action = page.locator(surfaceContract.intentHub
          ? 'main[data-phase3-route="/bulk/"] .p3-intent-card'
          : 'main [data-phase3-provider]:not([hidden]) a[data-analytics-event="affiliate_click"]').first();
        await expect(action).toBeVisible();
        await action.scrollIntoViewIfNeeded();
        await action.focus();
        await expect(action).toBeFocused();
        const geometry = await action.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { width: rect.width, height: rect.height, reachable: element === hit || element.contains(hit) };
        });
        expect(geometry.width).toBeGreaterThanOrEqual(44);
        expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.reachable).toBe(true);
      }

      if (spec.quiz) {
        const matchCards = await completeProviderFitQuiz(page);
        // The handoff helper asserts every ordered, source-derived eligible ID.
        // A fixed three-card ceiling must not truncate the governed result set.
        await expect(matchCards.first().locator('a[href^="/reviews/"]')).toBeVisible();
        const quizAffiliates = matchCards.locator('a[data-analytics-event="affiliate_click"]');
        expect(await quizAffiliates.count()).toBeGreaterThan(0);
        for (const link of await quizAffiliates.evaluateAll((nodes) => nodes.map((node) => ({
          host: new URL(node.href).hostname,
          rel: node.rel,
          mode: node.dataset.linkMode,
          program: node.dataset.program,
          subid: node.dataset.subid,
        })))) {
          expect(quizTrackingHosts).toContain(link.host);
          expect(link.rel).toContain("sponsored");
          expect(link.rel).toContain("nofollow");
          expect(link.mode).toBe("transparent-direct");
          expect(link.program).toMatch(/^[a-z0-9-]+$/);
          expect(link.subid).toBe(`quiz-provider-fit.results.a.${link.program}`);
        }
        await expect(page.locator("[data-matches-results]")).toContainText("Commissions never change our scores, rankings, or your match");
        await expect(page.locator("#lead-form, form[action='/api/leads']")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Email me my match checklist" })).toBeVisible();
        await expect(page.locator("[data-matches-results] [data-full-quiz-link]")).toBeVisible();
        await expect(page.locator("[data-full-quiz-link]")).toHaveAttribute("href", "/quiz/provider-fit/");
        await expect(page.locator("#health-consent-gate")).toHaveCount(0);
        const persisted = await quizAudit(() => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })));
        expect(JSON.stringify(persisted)).not.toMatch(/bmi_range|current_meds|insurance|state|timeline|quiz_answers/i);
        expectQuizNetworkContract(outbound);
        await expect(page.locator(".cs-search-panel")).toBeHidden();
        expect(await page.locator('[role="dialog"]:visible, dialog:visible, .popup:visible, .modal:visible').count()).toBe(0);
      }

      await page.waitForTimeout(150);
      if (browserName === "chromium") {
        await page.waitForFunction(() => window.__gcsVitals?.lcp > 0, null, { timeout: 5_000 });
      }
      const vitals = await page.evaluate(() => ({ ...window.__gcsVitals, nav: performance.getEntriesByType("navigation")[0]?.duration || 0 }));
      const measuredInp = vitals.inp || inpProxy;
      const inpSource = vitals.inp ? "event-timing" : "pointerdown-to-next-paint-proxy";
      if (browserName === "chromium") {
        // Attach before any budget assertion; an over-budget result must retain its provenance.
        await test.info().attach("p67-cwv-diagnostic", { body: JSON.stringify({ browser: browserName, template: spec.key, width, lcp: vitals.lcp, inp: measuredInp, inp_source: inpSource, interaction: vitals.interaction || null, cls: vitals.cls, nav: vitals.nav }), contentType: "application/json" });
      }
      expect(vitals.cls).toBeLessThan(0.1);
      if (browserName === "chromium") {
        expect(vitals.lcp).toBeGreaterThan(0);
        expect(vitals.lcp).toBeLessThan(2500);
        expect(measuredInp).toBeGreaterThan(0);
        expect(measuredInp).toBeLessThan(200);
        appendFileSync(CWV_RECEIPT, JSON.stringify({ browser: browserName, template: spec.key, width, lcp: vitals.lcp, inp: measuredInp, inp_source: inpSource, cls: vitals.cls, nav: vitals.nav }) + "\n");
      }

      expect(pageErrors).toEqual([]);
      if ([1440, 390].includes(width)) {
        const target = path.join(REPORT, `${browserName}-${spec.key}-${width}.png`);
        const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.screenshot({ path: target, fullPage: browserName === "chromium" && fullHeight <= 32_000, animations: "disabled" });
      }
    });
  }
}

test("quiz results disclose live affiliate relationships", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quiz/provider-fit/", { waitUntil: "networkidle" });
  await completeProviderFitQuiz(page);
  await expect(page.locator("[data-matches-results]")).toContainText("Commissions never change our scores, rankings, or your match");
});

test("health quiz answers remain local in requests and browser storage", async ({ page }) => {
  const outbound = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" || /\/api\/|google-analytics|googletagmanager|clarity\.ms/i.test(request.url())) {
      outbound.push({ method: request.method(), url: request.url(), body: request.postData() });
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quiz/provider-fit/", { waitUntil: "networkidle" });
  await completeProviderFitQuiz(page);
  await expect(page.locator("#lead-form, form[action='/api/leads']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Email me my match checklist" })).toBeVisible();
  const resultStorage = await quizAudit(() => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })));
  expect(JSON.stringify(resultStorage)).not.toMatch(/bmi_range|current_meds|insurance|state|timeline|quiz_answers/i);
  await retakeSurvey(page);
  const persisted = await quizAudit(() => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })));
  expect(JSON.stringify(persisted)).not.toMatch(/bmi_range|current_meds|insurance|state|timeline|quiz_answers/i);
  expectQuizNetworkContract(outbound);
});

test("P1 money template renders all eight components with transparent-direct links and no opaque routes", async ({ page }) => {
  await page.goto("/best/online-glp-1-providers/");
  await approvedRetirement("RR-6", test.info());
  await expect(page.locator("#best-for .intent-card")).toHaveCount(3);
  const providerCards = page.locator("#provider-reviews .provider-card");
  const providerCount = await providerCards.count();
  const canonicalCount = (await page.locator("[data-canonical-provider-ids]").first().getAttribute("data-canonical-provider-ids")).split(",").filter(Boolean).length;
  expect(providerCount).toBe(canonicalCount);
  await expect(providerCards.locator(".triple-cta")).toHaveCount(providerCount);
  expect(await page.locator(".provider-logo img").count()).toBeGreaterThanOrEqual(12);
  const tableHeaders = await page.locator("table[data-sortable] > thead > tr > th").allTextContents();
  expect(tableHeaders.map((header) => header.replace(/\s+/g, " ").trim())).toEqual([
    "Provider logo",
    "Provider",
    "Starting price",
    "Medications offered",
    "Insurance",
    "Average wait",
    "Evidence score",
    "Next steps",
  ]);
  await expect(providerCards.locator(".score-ten")).toHaveCount(providerCount);
  await expect(providerCards.locator(".subscore-block")).toHaveCount(providerCount);
  const closedDisclosureId = await page.locator("#provider-reviews details.provider-card:not([open])").first().getAttribute("id");
  expect(closedDisclosureId).toBeTruthy();
  const closedDisclosure = page.locator(`#${closedDisclosureId}`);
  await expect(closedDisclosure.locator(".cs-provider-deep__body")).toBeHidden();
  await closedDisclosure.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(closedDisclosure).toHaveAttribute("open", "");
  await expect(closedDisclosure.locator(".cs-provider-deep__body")).toBeVisible();
  await expect(closedDisclosure.locator(".subscore-block")).toBeVisible();
  await expect(closedDisclosure.locator(".triple-cta")).toBeVisible();
  const firstSubscore = providerCards.first().locator(".subscore-block li").first();
  const subscoreLayout = await firstSubscore.evaluate((item) => {
    const label = item.querySelector("span");
    const value = item.querySelector("strong");
    if (!label || !value) throw new Error("subscore label/value missing");
    const itemStyle = getComputedStyle(item);
    const labelStyle = getComputedStyle(label);
    const valueStyle = getComputedStyle(value);
    const labelBox = label.getBoundingClientRect();
    const valueBox = value.getBoundingClientRect();
    return {
      display: itemStyle.display,
      rowGap: itemStyle.rowGap,
      labelDisplay: labelStyle.display,
      labelFontSize: Number.parseFloat(labelStyle.fontSize),
      valueFontSize: Number.parseFloat(valueStyle.fontSize),
      renderedGap: valueBox.top - labelBox.bottom,
    };
  });
  expect(subscoreLayout.display).toBe("grid");
  expect(subscoreLayout.rowGap).toBe("5px");
  expect(subscoreLayout.labelDisplay).toBe("block");
  expect(subscoreLayout.valueFontSize).toBeGreaterThanOrEqual(15);
  expect(subscoreLayout.valueFontSize).toBeGreaterThan(subscoreLayout.labelFontSize);
  expect(subscoreLayout.renderedGap).toBeGreaterThanOrEqual(4.5);
  await expect(providerCards.locator(".pros-cons")).toHaveCount(providerCount);
  await expect(providerCards.locator("meter")).toHaveCount(providerCount * 4);
  expect(await page.locator(".inline-citation").count()).toBeGreaterThanOrEqual(20);
  expect(await page.locator(".decision-matrix-row").count()).toBeGreaterThanOrEqual(3);
  const firstDecision = page.locator(".decision-matrix-row").first();
  await expect(firstDecision).toContainText("Best for");
  await expect(firstDecision).toContainText("Choose");
  await expect(firstDecision).toContainText("Verify current price and terms at the source before enrolling.");
  await expect(page.locator("#methodology .trust-metrics")).toContainText("Providers");
  await expect(page.locator("#quick-answer .score-ten")).toContainText("/10");
  await expect(page.locator("#quick-answer .stars")).toBeVisible();
  await expect(page.locator(".social-proof, [data-proof-status]")).toHaveCount(0);
  const schemaText = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
  expect(schemaText).not.toContain("AggregateRating");
  expect(schemaText).not.toMatch(/"@type"\s*:\s*"Review"/);
  expect(schemaText).not.toMatch(/"(?:ratingCount|reviewCount)"\s*:/);
  await expect(page.locator('a[href^="/go/"]')).toHaveCount(0);
  await expect(page.locator('.affiliate[aria-disabled="true"]')).toHaveCount(0);
  expect(await page.locator('a[data-link-mode="transparent-direct"][data-subid]').count()).toBeGreaterThan(0);
  await expect(page.locator("body")).not.toContainText(/Medically reviewed by|medical reviewer/i);
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.join("\n")).not.toContain("AggregateRating");
  const schemaNodes = jsonLd.flatMap((source) => {
    const model = JSON.parse(source);
    return Array.isArray(model["@graph"]) ? model["@graph"] : [model];
  });
  const itemList = schemaNodes.find((item) => item["@type"] === "ItemList");
  expect(itemList).toBeTruthy();
  expect(itemList.numberOfItems).toBe(providerCount);
  expect(itemList.itemListElement.every((item) => item.item.url.includes("/reviews/"))).toBe(true);

  const firstCitationTarget = await page.locator(".inline-citation a").first().getAttribute("href");
  await expect(page.locator(firstCitationTarget)).toHaveCount(1);
  await page.locator(".provider-card .cta.internal").first().click();
  await expect(page).toHaveURL(/\/reviews\/[a-z0-9-]+\/$/);
  await expect(page.locator("h1")).toContainText(/review/i);
  await expect(page.locator("#source-1")).toHaveCount(1);
  await expect(page.locator('a[href^="/go/"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/held until operator go-live|link-dark|release hold/i);
  await page.goBack();

  await page.locator('[data-sort="price"]').click();
  const firstProgram = await page.locator("table[data-sortable] tbody tr").first().getAttribute("data-program");
  await expect(page.locator("[data-sticky-affiliate]")).toHaveAttribute("data-program", firstProgram);

  const inlineCapture = page.locator("[data-content-upgrade-form-inline]");
  const exitCapture = page.locator("[data-content-upgrade-form]");
  await expect(inlineCapture).toHaveCount(1);
  await expect(inlineCapture).toBeVisible();
  await expect(exitCapture).toHaveCount(1);
  await expect(page.locator("#content-upgrade-capture")).toBeHidden();
  const captureForms = page.locator("[data-content-upgrade-form-inline], [data-content-upgrade-form]");
  await expect(captureForms.locator('input[name="email_consent"][type="checkbox"]')).toHaveCount(2);
  await expect(captureForms.locator('input[name="privacy_consent"], input[name="marketing_consent"]')).toHaveCount(0);
});
