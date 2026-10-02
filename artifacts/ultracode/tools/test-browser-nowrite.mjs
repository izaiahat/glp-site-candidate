import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACTS,
  LOGS,
  ROOT,
  assertCandidateRoot,
  ensure,
  spawnLogged,
  startDenyProxy,
  writeJson,
} from "./qa-common.mjs";

assertCandidateRoot();

// Optional D1 selection; the legacy full-suite command remains unchanged.
const selection = process.env.GLP_RELEASE_SELECTION
  ? JSON.parse(readFileSync(process.env.GLP_RELEASE_SELECTION, "utf8")).browser : null;
if (selection) ensure(Array.isArray(selection.cases) && selection.cases.length > 0, "release_selection_empty");
const selectionArgs = selection ? [
  ...new Set(selection.cases.map(row => row.file)),
  "--grep", selection.cases.map(row => `(?:${row.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})$`).join("|"),
  "--retries=0", "--trace=on",
] : [];

const truthSpec = path.join(ROOT, "tests", "browser", "analytics-truth.spec.mjs");
const truthSource = readFileSync(truthSpec, "utf8");
const titleMatch = truthSource.match(/test\(["']([^"']*BOTH sinks through the production CSP)["']/);
ensure(titleMatch, "live_posthog_test_title_not_found");
const heldTitle = titleMatch[1];
ensure(heldTitle === "a real visitor reaches BOTH sinks through the production CSP", `live_posthog_test_title_changed:${heldTitle}`);
ensure((truthSource.match(new RegExp(heldTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length === 1, "live_posthog_test_title_not_unique");

const sideEffectAudit = {
  schema: "ultracode.side-effect-audit.v1",
  updated_at: new Date().toISOString(),
  scope: "candidate-local final QA; no deploy and no external provider write",
  network_policy: "loopback/data/blob only; deny by default",
  source_candidate: {
    path: "/home/ubuntu/business/site-system/flagship-v2/candidates/glp-rebuild-20260820/public",
    access: "READ_ONLY_SERVE_PERMITTED",
  },
  held_tests: [{
    file: "tests/browser/analytics-truth.spec.mjs",
    title: heldTitle,
    status: "HELD_EXTERNAL_WRITE",
    reason: "The original proof sends a real PostHog ingest request and is explicitly excluded from this no-external-write suite.",
  }],
  replacement_tests: [{
    file: "tests/browser/analytics-hermetic.spec.mjs",
    title: "hermetic analytics captures allow-listed affiliate payload with zero external bytes",
    status: "REQUIRED_HERMETIC_REPLACEMENT",
  }],
  excluded_effectful_commands: [
    "observe:price-index",
    "approval:program",
    "seal:promotion-candidate",
    "preview:plan",
    "render:price-watch-sample",
    "validate:price-watch-worker",
    "wrangler deploy",
    "deployment commands",
  ],
  external_attempts: [],
};
writeJson("side-effect-audit.json", sideEffectAudit);

// The outer final-suite proxy is still default-deny, but cannot know this
// browser gate's snapshot. Give this child a narrower exact-target mapping;
// every other authority stays denied and production is never in NO_PROXY.
const inheritedProxy = process.env.PLAYWRIGHT_NOWRITE_PROXY || null;
const snapshotDirectory = process.env.GLP_REVIEW_PUBLIC_ROOT || path.join(ROOT, "public");
const proxy = await startDenyProxy({ snapshotDirectory });
const proxyUrl = proxy.url;
const scratch = path.join(os.tmpdir(), `glp-ultracode-browser-nowrite-${process.pid}`);
const jsonOutput = path.join(scratch, "playwright.json");
const log = path.join(LOGS, "browser-nowrite.log");
const discoveryOutput = path.join(scratch, "discovery.json");
const discovery = await spawnLogged("npx", ["playwright", "test", ...selectionArgs, "--list", "--reporter=json", "--update-snapshots=none"], {
  cwd: ROOT,
  log: path.join(LOGS, "browser-nowrite-discovery.log"),
  tee: false,
  env: {
    PLAYWRIGHT_NOWRITE_PROXY: proxyUrl,
    P19_APPROVAL_ROOT: "/home/ubuntu/business/reports/ops/glp38-20260915/p19-rulings",
    PLAYWRIGHT_SCRATCH_ROOT: scratch,
    PLAYWRIGHT_JSON_OUTPUT_FILE: discoveryOutput,
  },
});
if (discovery.exit !== 0 || !existsSync(discoveryOutput)) {
  await proxy.close();
  throw new Error("browser_full_denominator_discovery_failed");
}
const discoveredReport = JSON.parse(readFileSync(discoveryOutput, "utf8"));
const command = await spawnLogged("npx", ["playwright", "test", ...selectionArgs, "--workers", process.env.PLAYWRIGHT_WORKERS || "6", "--update-snapshots=none", "--grep-invert", heldTitle], {
  cwd: ROOT,
  log,
  env: {
    PLAYWRIGHT_NOWRITE_PROXY: proxyUrl,
    P19_APPROVAL_ROOT: "/home/ubuntu/business/reports/ops/glp38-20260915/p19-rulings",
    PLAYWRIGHT_SCRATCH_ROOT: scratch,
    PLAYWRIGHT_JSON_OUTPUT_FILE: jsonOutput,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NO_PROXY: "127.0.0.1,localhost,::1",
  },
});

const proxyAttempts = proxy.attempts;
const mappedTunnels = proxy.mappedTunnels;
await proxy.close();
let playwrightReport = null;
let parseError = null;
if (existsSync(jsonOutput)) {
  try { playwrightReport = JSON.parse(readFileSync(jsonOutput, "utf8")); }
  catch (error) { parseError = String(error?.message || error); }
}
const testTitles = [];
function collectTitles(node) {
  if (!node || typeof node !== "object") return;
  if (typeof node.title === "string") testTitles.push(node.title);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(collectTitles);
    else if (value && typeof value === "object") collectTitles(value);
  }
}
collectTitles(playwrightReport);
function casesOf(report) {
  const rows = [];
  function visit(suite) {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      rows.push({ key: `${spec.id}:${test.projectName}`, file: spec.file, title: spec.title,
        project: test.projectName, status: test.status });
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report?.suites || []) visit(suite);
  return rows;
}
const allCases = casesOf(discoveredReport);
const actualCases = casesOf(playwrightReport);
const declaredHeldCases = allCases.filter(row => row.file === "analytics-truth.spec.mjs" && row.title === heldTitle);
const expectedCases = allCases.filter(row => !declaredHeldCases.includes(row));
const actualKeys = new Set(actualCases.map(row => row.key));
const expectedKeys = new Set(expectedCases.map(row => row.key));
const missingCases = expectedCases.filter(row => !actualKeys.has(row.key));
const unexpectedCases = actualCases.filter(row => !expectedKeys.has(row.key));
const denominatorIntact = (selection ? allCases.length > 0 : declaredHeldCases.length > 0) && missingCases.length === 0 && unexpectedCases.length === 0
  && actualCases.length === expectedCases.length && actualKeys.size === actualCases.length;
const snapshotWritesDisabled = playwrightReport?.config?.updateSnapshots === "none";
if (existsSync(jsonOutput) && process.env.GLP_BROWSER_REPORT_PATH) copyFileSync(jsonOutput, process.env.GLP_BROWSER_REPORT_PATH);
rmSync(scratch, { recursive: true, force: true });
const hermeticTitle = "hermetic analytics captures allow-listed affiliate payload with zero external bytes";
const heldWasExcluded = !testTitles.includes(heldTitle);
const hermeticWasRun = testTitles.includes(hermeticTitle);
const status = command.exit === 0 && proxyAttempts.length === 0 && playwrightReport && heldWasExcluded && hermeticWasRun
  && denominatorIntact && snapshotWritesDisabled ? "PASS" : "FAIL";

sideEffectAudit.updated_at = new Date().toISOString();
sideEffectAudit.external_attempts = proxyAttempts;
sideEffectAudit.browser_nowrite = {
  status,
  command: `npx playwright test --grep-invert ${JSON.stringify(heldTitle)}`,
  inherited_proxy: Boolean(inheritedProxy),
  local_proxy_attempt_count: proxyAttempts.length,
  mapped_local_tunnel_count: mappedTunnels.length,
  held_test_excluded: heldWasExcluded,
  hermetic_test_run: hermeticWasRun,
  process_exit: command.exit,
};
writeJson("side-effect-audit.json", sideEffectAudit);

const report = {
  schema: "ultracode.browser-nowrite.v1",
  generated_at: new Date().toISOString(),
  status,
  exact_held_title_confirmed_from_source: heldTitle,
  held_status: "HELD_EXTERNAL_WRITE",
  command: { ...command, command: `npx playwright test --grep-invert ${JSON.stringify(heldTitle)}` },
  deny_by_default: {
    proxy: "candidate harness exact-target snapshot proxy (outer default-deny proxy not bypassed for other gates)",
    attempts: proxyAttempts,
    mapped_local_tunnels: mappedTunnels,
  },
  assertions: {
    held_test_excluded: heldWasExcluded,
    hermetic_test_run: hermeticWasRun,
    playwright_json_parsed: Boolean(playwrightReport),
    zero_proxy_attempts: proxyAttempts.length === 0,
    mapped_local_tunnels_separate_from_denials: mappedTunnels.every((entry) => entry.target === "glpclinicscout.com:443"),
  },
  playwright_summary: playwrightReport?.stats || null,
  denominator: { discovered: allCases.length, approved_safe_cases: expectedCases.length, reported: actualCases.length,
    declared_external_write_hold: declaredHeldCases, missing: missingCases, unexpected: unexpectedCases, intact: denominatorIntact },
  snapshot_writes_disabled: snapshotWritesDisabled,
  playwright_json_parse_error: parseError,
  log: path.relative(ROOT, log).split(path.sep).join("/"),
};
writeJson("browser-nowrite-report.json", report);
console.log(`browser no-write: ${status}; held=${JSON.stringify(heldTitle)}; exit=${command.exit}; proxy_attempts=${proxyAttempts.length}; ${ARTIFACTS}/browser-nowrite-report.json`);
process.exitCode = status === "PASS" ? 0 : 1;
