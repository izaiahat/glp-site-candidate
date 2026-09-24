import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const reports = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass3";
const masterPath = path.join(reports, "ANIMATION-LIBRARY-INVENTORY.md");
const lanePaths = [
  "PHASE0-BEAUTIFULUI-BEUI.md",
  "PHASE0-RAREUI.md",
  "PHASE0-TRANSITIONSDEV.md",
  "PHASE0-SHADCN.md",
  "PHASE0-REUI.md",
  "PHASE0-COSS-UI.md",
  "PHASE0-THREEUI.md",
  "PHASE0-UI-SKILLS.md",
  "PHASE0-MOTION-DOCTRINE-CHECKLIST.md",
].map((name) => path.join(reports, "lanes", name));
const outputPath = path.join(reports, "PHASE0-INVENTORY-RECEIPT.json");
const failures = [];
const checks = [];

const check = (id, ok, detail) => {
  checks.push({ id, status: ok ? "PASS" : "FAIL", detail });
  if (!ok) failures.push({ id, detail });
};
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

const [master, pkg, notices, lenisRuntime, motionBaselineRaw, safetyRaw, uiSkillsRaw, closeoutRaw] = await Promise.all([
  fs.readFile(masterPath, "utf8"),
  fs.readFile(path.join(root, "package.json"), "utf8"),
  fs.readFile(path.join(root, "assets/vendor/THIRD-PARTY-NOTICES.md"), "utf8"),
  fs.readFile(path.join(root, "assets/vendor/lenis/lenis.min.js"), "utf8"),
  fs.readFile(path.join(reports, "phase0-served-motion-baseline.json"), "utf8"),
  fs.readFile(path.join(reports, "phase0-motion-safety-baseline.json"), "utf8"),
  fs.readFile(path.join(reports, "ui-skills-bank", "manifest.json"), "utf8"),
  fs.readFile(path.join(reports, "PHASE0-RESOURCE-BANK-CLOSEOUT-READBACK.json"), "utf8"),
]);
const laneReports = [];
for (const lanePath of lanePaths) {
  try {
    const text = await fs.readFile(lanePath, "utf8");
    laneReports.push({ path: lanePath, text, sha256: sha(text) });
  } catch (error) {
    failures.push({ id: "lane_report_missing", detail: `${lanePath}: ${error.message}` });
  }
}

check("master_final", master.includes("**Status:** FINAL — expanded 11-source blocking Phase 0 complete") && !master.includes("DRAFT —"), master.split("\n").slice(0, 5).join(" | "));
check("lane_count", laneReports.length === 9, `${laneReports.length}/9 report artifacts present`);
for (const library of [
  "Beautiful UI",
  "beUI",
  "Rare UI",
  "Transitions.dev",
  "shadcn/ui",
  "UI Skills registry",
  "ReUI",
  "COSS UI",
  "ThreeUI",
  "Motion restraint doctrine",
  "Design System Checklist",
]) {
  check(`library_${library.toLowerCase().replace(/\W+/g, "_")}`, master.includes(library), `${library} present in master`);
}
for (const phrase of [
  "Beautiful gallery primitives plus helper/atoms",
  "110 public registry entries",
  "14 visible components plus the unlisted Family Drawer",
  "all 43 live catalog entries: 32 free and 11 Pro",
  "MIT source",
  "74 named families and 1,101 examples",
  "508 public particles across 54 exact slug families",
  "All 346 live cards are accounted for: 164 Community and 182 Pro",
  "all 14 required skills loaded successfully",
  "232 accessible Design System Checklist items",
  "strictly under 300ms",
  "keyboard state is instant",
  "prefers-reduced-motion",
  "one smooth-scroll system",
  "no CDN",
  "JS-off",
]) check(`master_${phrase.toLowerCase().replace(/\W+/g, "_").slice(0, 44)}`, master.toLowerCase().includes(phrase.toLowerCase()), phrase);

const uiSkills = JSON.parse(uiSkillsRaw);
check("ui_skills_14", uiSkills.skills?.length === 14, `skills=${uiSkills.skills?.length}`);
check("ui_skills_loaded", uiSkills.skills?.every((entry) => entry.exit_code === 0 && entry.sha256 && entry.bytes > 0), "all 14 required skills have exit_code=0, bytes, and SHA-256");

const closeout = JSON.parse(closeoutRaw);
check("resource_closeouts", closeout.status === "PASS" && closeout.unique_closeouts === 4, `status=${closeout.status}, unique_closeouts=${closeout.unique_closeouts}`);
check("resource_closeout_readback", closeout.reports?.every((entry) => entry.http_status === 200 && entry.author_bot === true && entry.closeout_prefix_verified === true), "all expanded-bank closeouts have live HTTP 200 bot readback");

const packageJson = JSON.parse(pkg);
check("no_runtime_dependencies", Object.keys(packageJson.dependencies || {}).length === 0, JSON.stringify(packageJson.dependencies || {}));
check("notices_gsap", notices.includes("GSAP 3.13.0") && notices.includes("GSAP Standard"), "GSAP notice and license link present");
check("notices_lenis", notices.includes("## Lenis 1.3.11") && notices.includes("The MIT License"), "Lenis 1.3.11 MIT notice present");
check("runtime_lenis_1_3_11", sha(lenisRuntime) === "804047c1d9399736983bb38d5a841f96feb743f46a5090a252ede2ca1bfe1f19", `sha256=${sha(lenisRuntime)}`);

const motionBaseline = JSON.parse(motionBaselineRaw);
check("served_inventory_230", motionBaseline.totals?.routes === 230, `routes=${motionBaseline.totals?.routes}`);
check("served_inventory_http", motionBaseline.totals?.httpFailures === 0 && motionBaseline.totals?.navigationFailures === 0, JSON.stringify({ httpFailures: motionBaseline.totals?.httpFailures, navigationFailures: motionBaseline.totals?.navigationFailures }));
check("served_inventory_overflow", motionBaseline.totals?.horizontalOverflowRoutes === 0, `overflow=${motionBaseline.totals?.horizontalOverflowRoutes}`);

const safety = JSON.parse(safetyRaw);
check("safety_modes", Array.isArray(safety.summaries) && safety.summaries.length === 3, `modes=${safety.summaries?.length}`);
check("safety_http", safety.summaries?.every((entry) => entry.httpFailures === 0 && entry.navigationFailures === 0), "all safety modes have zero HTTP/navigation failures");
check("safety_readable", safety.summaries?.every((entry) => entry.emptyMainRoutes.length === 0 && entry.emptyH1Routes.length === 0), "all representative routes have readable main and H1");
check("safety_overflow", safety.summaries?.every((entry) => entry.overflowRoutes.length === 0), "all representative routes have zero horizontal overflow");
check("reduced_motion_lenis_off", safety.summaries?.filter((entry) => entry.mode.includes("reduced")).every((entry) => entry.lenisRoutes.length === 0), "Lenis absent in both reduced-motion modes");

const receipt = {
  schema: "glp-pass3-phase0-inventory-receipt-v2",
  generated_at: new Date().toISOString(),
  status: failures.length ? "FAIL" : "PASS",
  candidate: root,
  master: { path: masterPath, sha256: sha(master) },
  lane_reports: laneReports.map(({ path: lanePath, sha256 }) => ({ path: lanePath, sha256 })),
  checks,
  failures,
};
await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, checks: checks.length, failures, output: outputPath }, null, 2));
if (failures.length) process.exitCode = 1;
