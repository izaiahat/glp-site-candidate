import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { onRequestGet as resolveRetiredProviderRoute } from "../../functions/best/online-glp-1-providers/index.js";
import { parseRedirects, redirectLocation } from "../../scripts/review-redirects.mjs";
import { onRequestGet as resolveConsentRegion } from "../../functions/api/geo-state.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = process.env.GLP_REVIEW_PUBLIC_ROOT || path.join(ROOT, "public");
const PRODUCTION_ORIGIN = "https://glpclinicscout.com";
// The registered build binds the stage to the served snapshot, not to a page flag.
const BUILD_REPORT = JSON.parse(await readFile(path.join(ROOT, "artifacts/ops/build-report.json"), "utf8"));
const BUILD_STAGE = BUILD_REPORT.release_stage;
if (!["candidate", "production-seal"].includes(BUILD_STAGE)) throw new Error(`invalid GCS_RELEASE_STAGE: ${BUILD_STAGE}`);
if (process.env.GCS_RELEASE_STAGE && process.env.GCS_RELEASE_STAGE !== BUILD_STAGE)
  throw new Error("hermetic_stage_build_input_mismatch");
const EMITTED_POLICY = {
  schema: "glp-release-export-policy-v2",
  stage: BUILD_STAGE,
  third_party_exports: BUILD_STAGE === "production-seal",
  reason: BUILD_STAGE === "production-seal" ? "explicit-consent-production-seal" : "local-candidate-export-hold",
};
const ANALYTICS_HOST = /(?:^|\.)(?:posthog\.com|googletagmanager\.com|google-analytics\.com|clarity\.ms)$/i;
const POSTHOG_INGEST = /\/i\/v\d+\/e\/?$|\/e\/?$|\/batch\/?$/;
const AFFILIATE_ALLOWLIST = new Set([
  "program",
  "merchant",
  "page_slug",
  "link_position",
  "variant",
  "subid",
  "provider_slug",
  "network",
  "rank_position",
  "element_code",
  "page_type",
  "page_path",
  "cs_click_id",
  "sub1",
]);
const SENSITIVE_KEYS = /quiz_answers|bmi_range|medication_preference|current_meds|insurance|timeline|email|phone|address|free.?text|search.?query/i;
const MIME = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

async function productionCsp() {
  const headers = await readFile(path.join(PUBLIC, "_headers"), "utf8");
  const line = headers.split("\n").find((row) => row.trim().startsWith("Content-Security-Policy:"));
  expect(line, "production CSP is missing").toBeTruthy();
  return line.trim().replace(/^Content-Security-Policy:\s*/, "");
}

function directive(csp, name) {
  return csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) || "";
}

async function localAsset(pathname) {
  let relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!relative || relative.endsWith("/")) relative += "index.html";
  let target = path.resolve(PUBLIC, relative);
  const publicPrefix = `${path.resolve(PUBLIC)}${path.sep}`;
  if (!target.startsWith(publicPrefix)) return null;
  try {
    if ((await stat(target)).isDirectory()) target = path.join(target, "index.html");
    return { target, body: await readFile(target) };
  } catch {
    try {
      target = path.join(target, "index.html");
      return { target, body: await readFile(target) };
    } catch {
      return null;
    }
  }
}

const POSTHOG_STUB = `(() => {
  let options = {};
  window.posthog = {
    __loaded: true,
    __captures: [],
    __optOuts: 0,
    opt_out_capturing() { this.__optOuts += 1; },
    init(apiKey, nextOptions) { options = { ...nextOptions, api_key: apiKey }; this.__config = options; },
    capture(event, properties, captureOptions) {
      this.__captures.push({ event, properties });
      const payload = JSON.stringify({ api_key: options.api_key, event, properties, options: captureOptions || null });
      const endpoint = String(options.api_host || "https://us.i.posthog.com").replace(/\\/$/, "") + "/i/v0/e/";
      if (captureOptions && captureOptions.transport === "sendBeacon" && navigator.sendBeacon) navigator.sendBeacon(endpoint, payload);
      else fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true });
    },
    set_config(next) { options = { ...options, ...next }; },
  };
})();`;

test("hermetic analytics captures allow-listed affiliate payload with zero external bytes", async ({ page, context }) => {
  const csp = await productionCsp();
  const redirects = parseRedirects(await readFile(path.join(PUBLIC, "_redirects"), "utf8"));
  const intentDestinations = [
    ["compounded-semaglutide-injection", "/lp/best-providers/compounded-semaglutide/"],
    ["compounded-tirzepatide-injection", "/lp/best-providers/compounded-tirzepatide/"],
    ["brand-ozempic", "/ozempic/"],
    ["brand-wegovy", "/wegovy/"],
    ["brand-mounjaro", "/mounjaro/"],
    ["brand-zepbound", "/zepbound/"],
    ["not-a-supported-intent", "/providers/"],
  ];
  for (const [drug, destination] of intentDestinations) {
    const request = new Request(`${PRODUCTION_ORIGIN}/best/online-glp-1-providers/?drug=${drug}`);
    const response = await resolveRetiredProviderRoute({ request });
    expect(response.status, `retired intent status: ${drug}`).toBe(301);
    expect(response.headers.get("location"), `retired intent destination: ${drug}`).toBe(`${PRODUCTION_ORIGIN}${destination}`);
  }
  const scriptSrc = directive(csp, "script-src");
  const connectSrc = directive(csp, "connect-src");
  for (const origin of ["https://us.i.posthog.com", "https://us-assets.i.posthog.com"]) {
    expect(scriptSrc, `script-src must allow ${origin}`).toContain(origin);
    expect(connectSrc, `connect-src must allow ${origin}`).toContain(origin);
  }
  for (const destination of ["https://www.googletagmanager.com", "https://www.google-analytics.com", "https://www.clarity.ms"]) {
    expect(scriptSrc, `script-src must allow ${destination}`).toContain(destination);
    expect(connectSrc, `connect-src must allow ${destination}`).toContain(destination);
  }

  // Candidate builds stay held in their emitted bytes. Only the candidate branch uses a
  // page-local positive-path stand-in; production-seal must run its real emitted policy.
  await page.addInitScript(function hermeticProductionSealStandIn({ origin, candidate }) {
    if (window !== window.top || location.origin !== origin || location.pathname !== "/providers/") return;
    if (candidate) {
      const inputs = [];
      const policy = Object.freeze({
        schema: "glp-release-export-policy-v2",
        stage: "production-seal",
        third_party_exports: true,
        reason: "hermetic-test-only-production-seal-stand-in",
      });
      Object.defineProperty(window, "GCS_HERMETIC_POLICY_INPUTS", { value: inputs });
      Object.defineProperty(window, "GCS_EXPORT_POLICY", {
        configurable: false,
        get: () => policy,
        set: (value) => inputs.push(value),
      });
    }
    Object.defineProperty(navigator, "webdriver", { get: () => false, configurable: true });
    const plugins = [{ name: "PDF Viewer" }, { name: "Chrome PDF Viewer" }, { name: "Chromium PDF Viewer" }];
    plugins.item = (index) => plugins[index];
    plugins.namedItem = (name) => plugins.find((plugin) => plugin.name === name);
    plugins.refresh = () => {};
    Object.defineProperty(navigator, "plugins", { get: () => plugins, configurable: true });
  }, { origin: PRODUCTION_ORIGIN, candidate: BUILD_STAGE === "candidate" });

  const intercepted = [];
  const unexpected = [];
  const observedRequests = new Set();
  const fulfilledRequests = new Set();
  context.on("request", (request) => {
    if (["http:", "https:"].includes(new URL(request.url()).protocol)) observedRequests.add(request);
  });
  // WebKit speculative fonts can bypass route.fulfill but travel through the
  // exact-target loopback TLS proxy. Count them only after verifying actual bytes.
  context.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.origin !== PRODUCTION_ORIGIN || !url.pathname.startsWith("/assets/fonts/") || response.status() !== 200) return;
    try {
      const local = await localAsset(url.pathname);
      if (local && (await response.body()).equals(local.body)
          && response.headers()["content-security-policy"] === csp) fulfilledRequests.add(response.request());
    } catch { /* Missing or unreadable bytes stay unaccounted and fail below. */ }
  });
  async function fulfillLocally(route, response) {
    await route.fulfill(response);
    fulfilledRequests.add(route.request());
  }
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === PRODUCTION_ORIGIN) {
      if (url.pathname === "/api/geo-state" && url.searchParams.get("purpose") === "consent") {
        const response = await resolveConsentRegion({ request: new Request(request.url(), { headers: { "cf-ipcountry": "US" } }) });
        return fulfillLocally(route, { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      }
      // Receipted retirements (public/_redirects rows and the query-aware Pages Function) are 301s in
      // production. Chromium's request interception cannot fulfil a redirect status, so a modelled
      // retirement is answered here with a 204 carrying its real Location header: the test asserts the
      // status/location contract on the Function above and traverses the real 301 in the review-server
      // suite (wave2-idempotent-pages); this hermetic page never lands on a retired URL.
      let modelled;
      if (url.pathname === "/best/online-glp-1-providers/") {
        modelled = await resolveRetiredProviderRoute({ request: new Request(request.url(), { method: request.method(), headers: request.headers() }) });
      } else {
        const redirect = redirects.get(url.pathname);
        if (redirect) modelled = new Response(null, { status: redirect.status, headers: { location: redirectLocation(redirect.to, request.url()) } });
      }
      if (modelled) {
        return fulfillLocally(route, { status: 204, headers: { location: modelled.headers.get("location"), "x-modelled-status": String(modelled.status), "content-security-policy": csp }, body: "" });
      }
      const asset = await localAsset(url.pathname);
      if (!asset) return fulfillLocally(route, { status: 404, body: "not found", headers: { "content-type": "text/plain", "content-security-policy": csp } });
      return fulfillLocally(route, {
        status: 200,
        body: asset.body,
        headers: { "content-type": MIME[path.extname(asset.target).toLowerCase()] || "application/octet-stream", "content-security-policy": csp },
      });
    }

    if (ANALYTICS_HOST.test(url.hostname)) {
      const record = { method: request.method(), url: request.url(), body: request.postData() || null, disposition: "PENDING_LOCAL_FULFILLMENT" };
      intercepted.push(record);
      if (url.hostname === "us.i.posthog.com" && url.pathname === "/static/array.js") {
        await fulfillLocally(route, { status: 200, contentType: "text/javascript", body: POSTHOG_STUB });
      } else {
        const contentType = request.resourceType() === "script" ? "text/javascript" : "text/plain";
        await fulfillLocally(route, { status: 204, contentType, body: request.resourceType() === "script" ? "/* hermetic analytics stub */" : "" });
      }
      record.disposition = "FULFILLED_LOCALLY_ZERO_EXTERNAL_BYTES";
      return;
    }

    if (!["data:", "blob:"].includes(url.protocol)) {
      unexpected.push({ method: request.method(), url: request.url(), body: request.postData() || null, disposition: "ABORTED_UNEXPECTED_EXTERNAL_ATTEMPT" });
    }
    return route.abort("blockedbyclient");
  });


  // The retired comparison URL resolves (asserted above via the Function) to /providers/; land there.
  const localLanding = await localAsset("/providers/");
  expect(localLanding, "candidate providers HTML exists").toBeTruthy();
  expect(createHash("sha256").update(localLanding.body).digest("hex"), "served snapshot matches the build-stage receipt")
    .toBe(BUILD_REPORT.export_policy_surface_sha256);
  const landing = await page.goto(`${PRODUCTION_ORIGIN}/providers/`, { waitUntil: "domcontentloaded" });
  expect(landing?.status(), "providers landing response").toBe(200);
  expect(landing.request().redirectedFrom(), "hermetic landing must not follow a network redirect").toBeNull();
  expect(await landing.body(), "landing is the unmodified local candidate HTML").toEqual(localLanding.body);
  expect(landing.headers()["content-security-policy"]).toBe(csp);
  expect(new URL(page.url()).pathname).toBe("/providers/");
  expect(await page.evaluate(() => location.origin)).toBe(PRODUCTION_ORIGIN);
  const forbiddenConnect = "https://blocked-csp-canary.invalid/analytics-probe";
  await page.evaluate(async (url) => {
    window.__gcsCspCanary = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.blockedURI.includes("blocked-csp-canary.invalid")) window.__gcsCspCanary.push(event.violatedDirective);
    });
    try { await fetch(url, { mode: "no-cors" }); } catch { /* CSP rejection is expected */ }
  }, forbiddenConnect);
  await expect.poll(() => page.evaluate(() => window.__gcsCspCanary.length)).toBeGreaterThan(0);
  expect(unexpected.filter((entry) => entry.url === forbiddenConnect).length, "forbidden connect must not reach interception").toBe(0);
  expect(await page.evaluate(() => window.GCS_ANALYTICS_SUPPRESSED)).toBeFalsy();
  await page.waitForFunction(() => Boolean(window.GCSConsent));

  expect(await page.locator("script[data-candidate-export-policy]")).toHaveCount(1);
  if (BUILD_STAGE === "candidate") {
    expect(await page.evaluate(() => window.GCS_HERMETIC_POLICY_INPUTS), "candidate policy was emitted exactly once").toEqual([EMITTED_POLICY]);
    expect(await page.evaluate(() => window.GCS_EXPORT_POLICY)).toEqual({
      schema: "glp-release-export-policy-v2",
      stage: "production-seal",
      third_party_exports: true,
      reason: "hermetic-test-only-production-seal-stand-in",
    });
  } else {
    expect(await page.evaluate(() => window.GCS_HERMETIC_POLICY_INPUTS)).toBeUndefined();
    expect(await page.evaluate(() => window.GCS_EXPORT_POLICY)).toEqual(EMITTED_POLICY);
  }
  expect(await page.evaluate(() => ({
    analytics: window.GCS_ANALYTICS.enabled,
    posthog: window.GCS_POSTHOG.enabled,
    clarity: window.GCS_CLARITY.enabled,
    consent: window.GCS_ANALYTICS.consent,
  })), "consumer configuration follows the declared build stage").toEqual({
    analytics: EMITTED_POLICY.third_party_exports, posthog: EMITTED_POLICY.third_party_exports,
    clarity: false, consent: BUILD_STAGE === "candidate" ? "denied" : "granted",
  });
  // The US preference is produced by the real regional bootstrap, not an acknowledgment
  // or a fixture-written record. Candidate consumer flags still prevent SDK requests.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gcs_tracking_consent_v1")))).toMatchObject({
    version: "gcs-cookie-v4-distinct-purposes", record_type: "preference_only",
    analytics: "granted", advertising: "denied", analytics_basis: "us_default", notice_acknowledged: false,
  });
  expect(await page.evaluate(() => window.GCSConsent.allowsExports("analytics"))).toBe(true);
  if (BUILD_STAGE === "candidate") {
    expect(await page.evaluate(() => typeof window.posthog)).toBe("undefined");
    expect(intercepted, "held consumer configuration must not load a vendor SDK").toEqual([]);
  }
  await expect(page.locator("#gcs-consent input")).toHaveCount(0);
  await expect(page.locator("#gcs-consent button")).toHaveCount(1);
  await expect(page.locator('[data-consent="acknowledge"]')).toHaveText("Got it");
  // These two stage flags are independent of the policy. Refresh the existing default
  // without manufacturing consent, identifiers, SDK readiness or captures.
  if (BUILD_STAGE === "candidate") {
    await page.evaluate(function enableHermeticProductionSealConsumers() {
      window.GCS_ANALYTICS.enabled = true;
      window.GCS_POSTHOG.enabled = true;
      window.GCSConsent.refresh();
    });
  }
  if (process.env.GLP_HERMETIC_DEBUG) {
    await page.waitForTimeout(3000);
    console.log("hermetic debug:", JSON.stringify(await page.evaluate(() => ({ loaded: window.GCS_POSTHOG_LOADED, posthog: typeof window.posthog, cfg: window.GCS_ANALYTICS, policy: window.GCS_EXPORT_POLICY, consent: localStorage.getItem("gcs_tracking_consent_v1"), suppressed: window.GCS_ANALYTICS_SUPPRESSED, scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 12) }))), JSON.stringify(intercepted.map((e) => [e.url, e.disposition]).slice(0, 20)));
  }
  expect(await page.evaluate(() => window.GCSConsent.allowsExports("analytics"))).toBe(true);
  expect(await page.evaluate(() => window.GCS_ANALYTICS.consent)).toBe("granted");
  await page.waitForFunction(() => window.GCS_POSTHOG_LOADED === true && typeof window.posthog?.capture === "function"
    && window.posthog.__config?.api_key === window.GCS_POSTHOG.api_key);

  expect(await page.evaluate(() => window.GCSConsent.read().notice_acknowledged), "SDK initializes before acknowledgment").toBe(false);
  const poisonResult = await page.evaluate(() => {
    const properties = { quiz_answers: { medication: "P27_ANSWER_CANARY" }, email: "P27_ANSWER_CANARY", step_number: 99 };
    return {
      accepted: window.GCSAnalytics.event("quiz_complete", properties),
      scrubbed: window.posthog.__config.before_send({ event: "quiz_complete", properties, distinct_id: "P27_ANSWER_CANARY" }),
    };
  });
  expect(poisonResult).toEqual({ accepted: true, scrubbed: { event: "quiz_complete", properties: {} } });
  await expect.poll(() => intercepted.some((entry) => {
    try { return JSON.parse(entry.body)?.event === "quiz_complete"; } catch { return false; }
  })).toBe(true);
  await page.locator('[data-consent="acknowledge"]').click();
  await expect(page.locator("#gcs-consent")).toHaveCount(0);
  expect(await page.evaluate(() => window.GCSConsent.read()), "P27 acknowledgment retains US-default basis").toMatchObject({ analytics: "granted", advertising: "denied", analytics_basis: "us_default", notice_acknowledged: true });

  await page.evaluate(() => window.addEventListener("click", (event) => event.preventDefault(), false));
  const anchor = page.locator('a[data-analytics-event="affiliate_click"]').first();
  await expect(anchor).toBeVisible();
  await anchor.scrollIntoViewIfNeeded();
  expect(await anchor.evaluate((node) => localStorage.getItem("cs_click_id:last:" + (node.dataset.providerSlug || node.dataset.program || "unknown"))), "click identity is not minted before the click").toBeNull();
  await anchor.click({ noWaitAfter: true });
  // Engagement events (e.g. scroll_75) may legitimately reach the ingest sink before the click; the
  // contract under test is the affiliate_click payload itself, so select that event rather than the
  // first ingest request. Every ingest request is still intercepted and denied external bytes.
  const affiliateIngest = () => intercepted.find((entry) => {
    const url = new URL(entry.url);
    if (!(url.hostname === "us.i.posthog.com" && POSTHOG_INGEST.test(url.pathname) && entry.body)) return false;
    try {
      const parsed = JSON.parse(entry.body);
      const events = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.batch) ? parsed.batch : [parsed];
      return events.some((event) => event?.event === "affiliate_click");
    } catch { return false; }
  });
  const affiliateEvent = (entry) => {
    const parsed = JSON.parse(entry.body);
    const events = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.batch) ? parsed.batch : [parsed];
    return events.find((event) => event?.event === "affiliate_click");
  };
  await expect.poll(() => Boolean(affiliateIngest())).toBe(true);

  const ingest = affiliateIngest();
  if (process.env.GLP_HERMETIC_DEBUG) console.log("hermetic ingest bodies:", JSON.stringify(intercepted.filter((e) => e.body).map((e) => [e.url, String(e.body).slice(0, 200)])));
  expect(ingest, "affiliate click did not attempt a PostHog ingest request").toBeTruthy();
  for (const entry of intercepted) {
    const url = new URL(entry.url);
    if (url.hostname !== "us.i.posthog.com" || !POSTHOG_INGEST.test(url.pathname) || !entry.body) continue;
    const parsed = JSON.parse(entry.body);
    const events = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.batch) ? parsed.batch : [parsed];
    for (const event of events) {
      expect(event.properties, "hermetic ingest properties must be empty").toEqual({});
      expect(Object.keys(event.properties).every((key) => AFFILIATE_ALLOWLIST.has(key))).toBe(true);
      expect(Object.keys(event.properties).some((key) => SENSITIVE_KEYS.test(key))).toBe(false);
      expect(JSON.stringify(event.properties)).not.toMatch(SENSITIVE_KEYS);
    }
  }
  const payload = affiliateEvent(ingest);
  expect(payload.event).toBe("affiliate_click");
  expect(Object.keys(payload.properties).every((key) => AFFILIATE_ALLOWLIST.has(key))).toBe(true);
  expect(Object.keys(payload.properties).some((key) => SENSITIVE_KEYS.test(key))).toBe(false);
  expect(JSON.stringify(payload.properties)).not.toMatch(SENSITIVE_KEYS);
  // D2i reviewed schema (assets/analytics.js `allowed`): affiliate_click exports NO properties to the
  // analytics sink - not provider identity, not the click id. The first-party click identity is
  // observable where the contract puts it: on the decorated outbound href (cs_click_id on a /go route,
  // or the network's sub parameter for a transparent-direct anchor), minted at click time.
  const UUIDV7 = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/;
  expect(Object.keys(payload.properties), "affiliate_click must export no unreviewed property").toEqual([]);
  const decoratedHref = await anchor.evaluate((node) => node.href);
  expect(decoratedHref, "outbound href carries the first-party click id after the click").toMatch(UUIDV7);
  const linkMode = await anchor.getAttribute("data-link-mode");
  if (linkMode === "server-redirect") expect(new URL(decoratedHref).searchParams.get("cs_click_id")).toMatch(UUIDV7);
  const storedClick = await anchor.evaluate((node) => {
    const providerSlug = node.dataset.providerSlug || node.dataset.program || "unknown";
    return { providerSlug, record: JSON.parse(localStorage.getItem("cs_click_id:last:" + providerSlug)) };
  });
  expect(storedClick.record, "the click identity is persisted first-party").toMatchObject({ providerSlug: storedClick.providerSlug });
  expect(storedClick.record.clickId).toMatch(new RegExp(`^${UUIDV7.source}$`));
  expect([...new URL(decoratedHref).searchParams.values()], "href uses the persisted click identity").toContain(storedClick.record.clickId);
  if (linkMode === "server-redirect") expect(new URL(decoratedHref).searchParams.get("cs_click_id")).toBe(storedClick.record.clickId);

  // The existing footer link must invoke real withdrawal, not navigate away or merely hide UI.
  await page.locator('footer a[href^="/privacy/cookies/"]').first().click();
  await expect(page.locator('[data-consent="denied"]')).toBeVisible();
  const controls = await page.locator('#gcs-consent button').evaluateAll((buttons) => buttons.map((button) => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, color: style.color, border: style.border, height: button.getBoundingClientRect().height };
  }));
  expect(controls).toHaveLength(2);
  expect(controls[0]).toEqual(controls[1]);
  expect(controls[0].height).toBeGreaterThanOrEqual(44);
  const capturedBeforeWithdrawal = await page.evaluate(() => window.posthog.__captures.length);
  await page.locator('[data-consent="denied"]').click();
  expect(await page.evaluate(() => ({
    record: window.GCSConsent.read(), allowed: window.GCSConsent.allowsExports(),
    accepted: window.GCSAnalytics.event("quiz_complete", { quiz_answers: "P27_ANSWER_CANARY" }),
    beforeSend: window.posthog.__config.before_send({ event: "quiz_complete", properties: {} }),
    optedOut: window.posthog.__optOuts > 0, captures: window.posthog.__captures.length,
  }))).toMatchObject({ record: { analytics: "denied", advertising: "denied" }, allowed: false, accepted: false, beforeSend: null, optedOut: true, captures: capturedBeforeWithdrawal });

  // A fresh preference store with GPC must be denied before any UI action; consumer
  // flags are then enabled so the GPC assertion is not masked by the candidate hold.
  const loadersBeforeGpc = intercepted.filter((entry) => new URL(entry.url).pathname === "/static/array.js").length;
  await page.evaluate(() => localStorage.removeItem("gcs_tracking_consent_v1"));
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true, configurable: true }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.GCSConsent));
  expect(await page.evaluate(() => window.GCSConsent.read()), "GPC first-load preference must already be denied").toMatchObject({ analytics: "denied", advertising: "denied", record_type: "preference_only", notice_acknowledged: false });
  await page.evaluate(() => { window.GCS_ANALYTICS.enabled = true; window.GCS_POSTHOG.enabled = true; });
  await expect(page.locator("#gcs-consent input")).toHaveCount(0);
  await page.evaluate(() => window.GCSConsent.refresh());
  expect(await page.evaluate(() => window.GCSConsent.read())).toMatchObject({ analytics: "denied", advertising: "denied", notice_acknowledged: false });
  await expect(page.locator('[data-consent="acknowledge"]')).toBeVisible();
  await page.locator('[data-consent="acknowledge"]').click();
  expect(await page.evaluate(() => window.GCSConsent.read())).toMatchObject({ analytics: "denied", advertising: "denied", notice_acknowledged: true });
  await page.locator('footer a[href^="/privacy/cookies/"]').first().click();
  await expect(page.locator('[data-consent="granted"]')).toBeDisabled();
  expect(await page.evaluate(() => window.GCSConsent.apply("granted").analytics)).toBe("denied");
  expect(await page.evaluate(() => window.GCSAnalytics.event("quiz_complete", { quiz_answers: "P27_ANSWER_CANARY" }))).toBe(false);
  expect(await page.evaluate(() => typeof window.posthog)).toBe("undefined");
  expect(intercepted.filter((entry) => new URL(entry.url).pathname === "/static/array.js")).toHaveLength(loadersBeforeGpc);
  expect(await page.evaluate(() => window.dataLayer.filter((entry) => entry[0] === "consent").every((entry) => Object.values(entry[2]).every((value) => value === "denied")))).toBe(true);

  // A pre-labelled disposition is not proof: every HTTP request, including the document
  // and same-origin assets, must have completed the local fulfill operation.
  await expect.poll(() => [...observedRequests].filter((request) => !fulfilledRequests.has(request)).map((request) => request.url()), {
    message: "every HTTP request must be fulfilled locally",
  }).toEqual([]);
  await expect.poll(() => intercepted.every((entry) => entry.disposition === "FULFILLED_LOCALLY_ZERO_EXTERNAL_BYTES")).toBe(true);

  const unexpectedWrites = unexpected.filter((entry) => !["GET", "HEAD", "OPTIONS"].includes(entry.method));
  expect(unexpected, `unexpected external attempt: ${JSON.stringify(unexpected)}`).toEqual([]);
  expect(unexpectedWrites).toEqual([]);
  expect(intercepted.every((entry) => entry.disposition === "FULFILLED_LOCALLY_ZERO_EXTERNAL_BYTES")).toBe(true);
});
