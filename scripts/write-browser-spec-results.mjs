import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const inputPath = resolve(process.argv[2] || "/tmp/glp-design-pass-browser-results.json");
const outputDir = resolve(process.argv[3] || "/home/ubuntu/business/reports/glp-clinic-scout/rebuild");
const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const overrideRuns = process.argv.slice(4).map((path) => ({
  path: resolve(path),
  raw: JSON.parse(readFileSync(resolve(path), "utf8")),
}));
const clean = (value) => String(value || "").replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
const resultStatus = (test) => test.results?.at(-1)?.status || test.status || "unknown";
const outcome = (test) => {
  if (test.status === "expected") return "passed";
  if (test.status === "skipped") return "skipped";
  if (test.status === "flaky") return "flaky";
  return "failed";
};
const emptyCounts = () => ({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 });
const increment = (counts, status) => {
  counts.total += 1;
  counts[status] += 1;
};
const collectSpecs = (suite) => [
  ...(suite.specs || []),
  ...(suite.suites || []).flatMap(collectSpecs),
];

const overrideSuites = new Map(overrideRuns.flatMap((run) => run.raw.suites.map((suite) => [suite.file, suite])));
const effectiveSuites = raw.suites.map((suite) => overrideSuites.get(suite.file) || suite);
const specResults = effectiveSuites.map((suite) => {
  const counts = emptyCounts();
  const projects = {};
  const failures = [];
  for (const spec of collectSpecs(suite)) {
    for (const test of spec.tests || []) {
      const status = outcome(test);
      const project = test.projectName || test.projectId || "unknown";
      projects[project] ||= emptyCounts();
      increment(counts, status);
      increment(projects[project], status);
      if (status === "failed") {
        const finalResult = test.results?.at(-1) || {};
        const messages = (finalResult.errors || [])
          .map((error) => clean(error.message || error.value || error.stack))
          .filter(Boolean);
        if (!messages.length && finalResult.error) messages.push(clean(finalResult.error.message || finalResult.error.value || finalResult.error.stack));
        failures.push({
          project,
          title: spec.title,
          line: spec.line,
          result_status: resultStatus(test),
          errors: messages,
        });
      }
    }
  }
  return {
    file: `tests/browser/${suite.file || suite.title}`,
    status: counts.failed ? "FAIL" : "PASS",
    counts,
    projects,
    failures,
  };
}).sort((left, right) => left.file.localeCompare(right.file));

const excludedStaleContracts = [
  {
    file: "tests/browser/pass2-work-order-detail.spec.mjs",
    stale_scope: "G-10 quiz block",
    detail: "Pins the retired eight-intent data-pass2 question/next flow, budget step, 8/8 progress, and sort=cheapest result contract.",
  },
  {
    file: "tests/browser/pass2-late-audit-interactions.spec.mjs",
    stale_scope: "quiz interactions",
    detail: "Pins retired data-pass2 question/next, current-drug/dose branches, old result anatomy, and sort=cheapest.",
  },
  {
    file: "tests/browser/cross-device.spec.mjs",
    stale_scope: "quiz helpers and assertions",
    detail: "Pins retired .question/.option, #result, #match-cards, and old swipe/results identifiers.",
  },
  {
    file: "tests/browser/w18-mobile-parity.spec.mjs",
    stale_scope: "quiz route marker and mobile quiz section",
    detail: "Pins retired #health-consent-gate, .question, #result, 312px swipe rail, dots, and old panel selectors.",
  },
];
const knownStaleNonSpecHelper = {
  file: "tests/browser/pass2-served-item-runner.mjs",
  stale_scope: "G-10 block; not discovered by Playwright because it is not a *.spec.mjs file",
  detail: "Pins the retired eight-intent data-pass2/budget/8-of-8/sort=cheapest contract.",
};
const totals = specResults.reduce((sum, spec) => {
  for (const key of Object.keys(sum)) sum[key] += spec.counts[key];
  return sum;
}, emptyCounts());
const document = {
  schema: "glp.design-pass-browser-spec-results.v1",
  generated_at_utc: new Date().toISOString(),
  command_scope: "All tests/browser/*.spec.mjs except the four operator-listed whole-spec stale contracts; Chromium and WebKit projects, one worker per project configuration.",
  base_url: "http://127.0.0.1:4500",
  raw_playwright_stats: raw.stats,
  targeted_reruns: overrideRuns.map((run) => ({ input: run.path, stats: run.raw.stats, replaced_specs: run.raw.suites.map((suite) => `tests/browser/${suite.file}`) })),
  totals,
  files_run: specResults.length,
  files_passed: specResults.filter((spec) => spec.status === "PASS").length,
  files_failed: specResults.filter((spec) => spec.status === "FAIL").length,
  excluded_stale_contracts: excludedStaleContracts,
  known_stale_non_spec_helper: knownStaleNonSpecHelper,
  specs: specResults,
};

mkdirSync(outputDir, { recursive: true });
const jsonPath = resolve(outputDir, "design-pass-browser-spec-results-20260826.json");
const markdownPath = resolve(outputDir, "design-pass-browser-spec-results-20260826.md");
const rawPath = resolve(outputDir, "design-pass-browser-playwright-raw-20260826.json");
writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
copyFileSync(inputPath, rawPath);
for (const [index, run] of overrideRuns.entries()) {
  copyFileSync(run.path, resolve(outputDir, `design-pass-browser-targeted-rerun-${index + 1}-20260826.json`));
}
const escapeTable = (value) => String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ");
const rows = specResults.map((spec) => {
  const chromium = spec.projects.chromium || emptyCounts();
  const webkit = spec.projects.webkit || emptyCounts();
  return `| ${spec.file} | ${spec.status} | ${chromium.passed}/${chromium.total} | ${webkit.passed}/${webkit.total} | ${spec.counts.failed} |`;
}).join("\n");
const failureSections = specResults.filter((spec) => spec.status === "FAIL").map((spec) => {
  const grouped = new Map();
  for (const failure of spec.failures) {
    const key = failure.title;
    const value = grouped.get(key) || { projects: [], statuses: [], errors: [] };
    value.projects.push(failure.project);
    value.statuses.push(failure.result_status);
    for (const error of failure.errors) if (!value.errors.includes(error)) value.errors.push(error);
    grouped.set(key, value);
  }
  const bullets = [...grouped.entries()].map(([title, value]) => {
    const firstError = value.errors[0] ? ` — ${escapeTable(value.errors[0]).slice(0, 700)}` : "";
    return `- ${escapeTable(title)} [${[...new Set(value.projects)].join(", ")}; ${[...new Set(value.statuses)].join(", ")}]${firstError}`;
  }).join("\n");
  return `### ${spec.file}\n\n${bullets}`;
}).join("\n\n");
const excludedRows = excludedStaleContracts.map((item) => `- ${item.file}: ${item.stale_scope}. ${item.detail}`).join("\n");
const markdown = `# Design-pass browser results by spec\n\nGenerated: ${document.generated_at_utc}\n\nScope: ${document.files_run} non-excluded spec files across Chromium and WebKit. Final reconciled totals: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped, ${totals.flaky} flaky (${totals.total} total). Files: ${document.files_passed} PASS, ${document.files_failed} FAIL. ${overrideRuns.length ? `${overrideRuns.length} targeted post-repair run(s) replaced the matching original spec results.` : "No targeted reruns were applied."}\n\n| Spec | Verdict | Chromium pass/total | WebKit pass/total | Failed tests |\n|---|---|---:|---:|---:|\n${rows}\n\n## Operator-listed stale contracts excluded from execution\n\n${excludedRows}\n- ${knownStaleNonSpecHelper.file}: ${knownStaleNonSpecHelper.stale_scope}. ${knownStaleNonSpecHelper.detail}\n\n## Failure inventory\n\nEvery final project-level failure and complete error text is retained in \`${basename(jsonPath)}\`. The original raw Playwright output is retained in \`${basename(rawPath)}\`; targeted rerun JSON files are retained alongside it.\n\n${failureSections || "None."}\n`;
writeFileSync(markdownPath, markdown);
console.log(JSON.stringify({ status: totals.failed ? "FAIL" : "PASS", totals, files_run: document.files_run, files_passed: document.files_passed, files_failed: document.files_failed, json: jsonPath, markdown: markdownPath, raw: rawPath }));
