import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import lighthouse, { desktopConfig } from "lighthouse";

import { createReviewServer } from "./serve-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "artifacts", "ultracode", "lighthouse-design-pass5.json");
const ROUTE_MATRIX = Object.freeze([
  { family: "home", route: "/" },
  { family: "comparison-router", route: "/compare/" },
  { family: "provider-directory", route: "/providers/" },
  { family: "medication", route: "/wegovy/?drug=wegovy&form=brand_name" },
  { family: "pharmacy-directory", route: "/pharmacies/" },
  { family: "guide", route: "/guides/what-is-glp-1/" },
  { family: "quiz", route: "/quiz/provider-fit/" },
  { family: "reviews", route: "/reviews/" },
  { family: "calculator", route: "/tools/glp-1-cost-calculator/" },
]);
const routeFilter = String(process.env.PASS5_LIGHTHOUSE_ROUTE || "").trim();
const ROUTES = routeFilter
  ? ROUTE_MATRIX.filter(({ route }) => route === routeFilter)
  : ROUTE_MATRIX;
if (routeFilter && ROUTES.length !== 1) throw new Error(`unknown_lighthouse_route:${routeFilter}`);
const MODES = Object.freeze([
  { name: "mobile", config: undefined },
  { name: "desktop", config: desktopConfig },
]);
const MINIMUM_SCORE = 0.95;
const CATEGORIES = Object.freeze(["performance", "accessibility", "best-practices", "seo"]);

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("unable_to_allocate_loopback_port");
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForChrome(port, process) {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`chromium_exited_before_cdp_ready:${process.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = new Error(`cdp_status_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`chromium_cdp_timeout:${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function stopProcess(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => process.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

function traceLongTasks(trace) {
  const events = Array.isArray(trace?.traceEvents) ? trace.traceEvents : [];
  const rendererThreads = new Set(events
    .filter((event) => event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain")
    .map((event) => `${event.pid}:${event.tid}`));
  return events
    .filter((event) => event.ph === "X" && event.name === "RunTask" && Number(event.dur) >= 50_000 && rendererThreads.has(`${event.pid}:${event.tid}`))
    .map((task) => {
      const end = Number(task.ts) + Number(task.dur);
      const contributors = events
        .filter((event) => event.ph === "X"
          && event.pid === task.pid
          && event.tid === task.tid
          && Number(event.ts) >= Number(task.ts)
          && Number(event.ts) + Number(event.dur || 0) <= end
          && event.name !== "RunTask")
        .sort((left, right) => Number(right.dur || 0) - Number(left.dur || 0))
        .slice(0, 12)
        .map((event) => ({
          name: event.name,
          duration_ms: Number((Number(event.dur || 0) / 1000).toFixed(3)),
          url: event.args?.data?.url || event.args?.data?.scriptName || null,
          details: event.args?.beginData || event.args?.data || null,
        }));
      return { duration_ms: Number((Number(task.dur) / 1000).toFixed(3)), contributors };
    })
    .sort((left, right) => right.duration_ms - left.duration_ms);
}

const server = await createReviewServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const serverAddress = server.address();
if (!serverAddress || typeof serverAddress === "string") throw new Error("review_server_address_unavailable");
const origin = `http://127.0.0.1:${serverAddress.port}`;

const chromePort = await freePort();
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "glp-lighthouse-pass5-"));
const chrome = spawn(chromium.executablePath(), [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-first-run",
  "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: "ignore" });

const runs = [];
let fatalError = null;
try {
  await waitForChrome(chromePort, chrome);
  for (const mode of MODES) {
    for (const representative of ROUTES) {
      const url = `${origin}${representative.route}`;
      const result = await lighthouse(url, {
        port: chromePort,
        logLevel: "error",
        output: "json",
        onlyCategories: [...CATEGORIES],
        maxWaitForLoad: 45_000,
      }, mode.config);
      if (!result) throw new Error(`lighthouse_no_result:${mode.name}:${representative.route}`);
      const scores = Object.fromEntries(CATEGORIES.map((category) => [category, result.lhr.categories[category]?.score ?? null]));
      const checks = Object.fromEntries(CATEGORIES.map((category) => [
        `${category}_at_least_${Math.round(MINIMUM_SCORE * 100)}`,
        Number.isFinite(scores[category]) && scores[category] >= MINIMUM_SCORE,
      ]));
      const performanceAudits = (result.lhr.categories.performance?.auditRefs || [])
        .filter((reference) => reference.weight > 0)
        .map((reference) => {
          const audit = result.lhr.audits[reference.id];
          return {
            id: reference.id,
            weight: reference.weight,
            score: audit?.score ?? null,
            numeric_value: audit?.numericValue ?? null,
            display_value: audit?.displayValue ?? null,
          };
        });
      const opportunities = Object.values(result.lhr.audits)
        .filter((audit) => audit.details?.type === "opportunity" && Number(audit.numericValue) > 0)
        .map((audit) => ({ id: audit.id, title: audit.title, score: audit.score, numeric_value: audit.numericValue, display_value: audit.displayValue }))
        .sort((left, right) => Number(right.numeric_value) - Number(left.numeric_value))
        .slice(0, 12);
      const accessibilityFailures = (result.lhr.categories.accessibility?.auditRefs || [])
        .map((reference) => result.lhr.audits[reference.id])
        .filter((audit) => audit && audit.score !== null && audit.score < 1)
        .map((audit) => ({ id: audit.id, title: audit.title, score: audit.score, display_value: audit.displayValue ?? null, details: audit.details || null }));
      const lcpDiagnostics = ["largest-contentful-paint", "lcp-breakdown-insight", "lcp-discovery-insight", "cumulative-layout-shift", "interaction-to-next-paint"]
        .map((id) => result.lhr.audits[id])
        .filter(Boolean)
        .map((audit) => ({ id: audit.id, title: audit.title, score: audit.score, numeric_value: audit.numericValue ?? null, display_value: audit.displayValue ?? null, details: audit.details || null }));
      const diagnostics = ["bootup-time", "diagnostics", "mainthread-work-breakdown", "network-requests", "long-tasks-insight", "third-parties-insight"]
        .map((id) => result.lhr.audits[id])
        .filter(Boolean)
        .map((audit) => ({ id: audit.id, title: audit.title, score: audit.score, numeric_value: audit.numericValue ?? null, display_value: audit.displayValue ?? null, details: audit.details || null }));
      const traceLongTaskSummary = traceLongTasks(result.artifacts.Trace);
      runs.push({
        family: representative.family,
        route: representative.route,
        mode: mode.name,
        requested_url: url,
        final_url: result.lhr.finalDisplayedUrl,
        lighthouse_version: result.lhr.lighthouseVersion,
        fetch_time: result.lhr.fetchTime,
        scores,
        checks,
        performance_audits: performanceAudits,
        accessibility_failures: accessibilityFailures,
        opportunities,
        vitals: lcpDiagnostics,
        diagnostics,
        trace_long_tasks: traceLongTaskSummary,
        run_warnings: result.lhr.runWarnings,
        "PASS/FAIL": Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      });
    }
  }
} catch (error) {
  fatalError = error;
} finally {
  await stopProcess(chrome);
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  await rm(userDataDir, { recursive: true, force: true });
}

const report = {
  schema: "glp-design-pass-5-lighthouse-v1",
  generated_at: new Date().toISOString(),
  candidate: ROOT,
  local_only: true,
  minimum_score: MINIMUM_SCORE,
  categories: CATEGORIES,
  run_count: runs.length,
  expected_run_count: ROUTES.length * MODES.length,
  runs,
  fatal_error: fatalError instanceof Error ? fatalError.stack || fatalError.message : fatalError ? String(fatalError) : null,
  status: !fatalError && runs.length === ROUTES.length * MODES.length && runs.every((run) => run["PASS/FAIL"] === "PASS") ? "PASS" : "FAIL",
};
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: report.status, output: OUTPUT, runs: runs.map(({ route, mode, scores, "PASS/FAIL": verdict }) => ({ route, mode, scores, verdict })) }, null, 2)}\n`);
if (report.status !== "PASS") process.exitCode = 1;
