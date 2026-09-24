import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APPLICATION_SCHEMA = "program-approval-application-v1";
const REGISTRY_SCHEMA = "site-program-registry-v1";

function assertApplication(registry, application) {
  if (registry?.schema !== REGISTRY_SCHEMA || !Array.isArray(registry.programs)) throw new Error("approval_registry_invalid");
  if (application?.schema !== APPLICATION_SCHEMA) throw new Error("approval_application_schema_invalid");
  if (application.approval_state !== "approved") throw new Error("approval_state_invalid");
  if (application.vertical_fit !== true) throw new Error("approval_vertical_fit_required");
  if (application.wired !== true) throw new Error("approval_wired_required");
  if (!registry.site_profiles?.[application.site_profile]) throw new Error(`approval_site_profile_unknown:${application.site_profile}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(application.program_id || "")) throw new Error("approval_program_id_invalid");
  if (registry.programs.some((program) => program.program_id === application.program_id)) throw new Error(`approval_program_duplicate:${application.program_id}`);
  if (!application.display_name || !/^https:\/\//.test(application.official_url || "")) throw new Error("approval_identity_invalid");
  if (!application.approval_id || !application.approved_at || !Number.isInteger(application.sheet_row)) throw new Error("approval_provenance_invalid");
}

export function buildApprovalArtifacts({ registry, application }) {
  assertApplication(registry, application);
  const profileId = application.site_profile;
  const entry = {
    program_id: application.program_id,
    display_name: application.display_name,
    commercial_state: "live",
    source_kind: "approval_pipeline",
    review_path: `/reviews/${application.program_id}/`,
    go: { route: `/go/${application.program_id}`, entry_state: "pending_surface_completion" },
    approval: {
      approval_id: application.approval_id,
      approved_at: application.approved_at,
      sheet_row: application.sheet_row,
      network: application.network || null,
      network_program_id: application.network_program_id || null,
    },
    profiles: {
      [profileId]: {
        vertical_fit: true,
        wired: true,
        data_profile: {
          has_price: application.has_price === true,
          has_review_facts: application.has_review_facts === true,
        },
        surfaces: { compare: false, quiz: false, calculator: false, review: false, go: false, sitemap: false },
        exceptions: {},
      },
    },
  };
  const brief = {
    schema: "provider-review-brief-v1",
    status: "SCAFFOLD_REVIEW_REQUIRED",
    site_profile: profileId,
    program_id: application.program_id,
    display_name: application.display_name,
    approval_id: application.approval_id,
    approved_at: application.approved_at,
    auto_generate: false,
    auto_publish: false,
    provider_facts: {
      official_url: application.official_url,
      network: application.network || null,
      network_program_id: application.network_program_id || null,
      sheet_row: application.sheet_row,
      published_price: null,
      price_source_url: null,
      medications: null,
      insurance: null,
      shipping: null,
      cancellation: null,
    },
    required_review: {
      source_checked_through: null,
      evidence_sources: [],
      reviewer_status: "PENDING",
      compare_row_status: application.has_review_facts === true ? "REQUIRED" : "NOT_YET_REQUIRED",
      quiz_candidate_status: application.has_review_facts === true ? "REQUIRED" : "NOT_YET_REQUIRED",
      calculator_status: application.has_price === true ? "REQUIRED" : "NOT_REQUIRED_WITHOUT_USABLE_PRICE",
      review_page_status: "REQUIRED",
      go_entry_status: "REQUIRED",
      sitemap_status: "REQUIRED",
    },
  };
  return { entry, brief };
}

async function defaultRunGate(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (status, signal) => resolve({ status: status ?? 1, signal }));
  });
}

async function atomicJsonWrite(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runApprovalPipeline({ root, registry, application, apply = false, runGate = defaultRunGate }) {
  const { entry, brief } = buildApprovalArtifacts({ registry, application });
  const base = path.resolve(root);
  const summary = {
    program_id: entry.program_id,
    site_profile: application.site_profile,
    auto_generate: false,
    auto_publish: false,
    network_calls: 0,
  };
  if (!apply) return { status: "DRY_RUN", ...summary, entry, brief };

  const nextRegistry = structuredClone(registry);
  nextRegistry.updated_at = application.approved_at.slice(0, 10);
  nextRegistry.programs.push(entry);
  nextRegistry.programs.sort((left, right) => left.program_id.localeCompare(right.program_id));
  const registryPath = path.join(base, "data", "program-registry.json");
  const briefPath = path.join(base, "data", "review-briefs", application.site_profile, `${application.program_id}.json`);
  await atomicJsonWrite(registryPath, nextRegistry);
  await atomicJsonWrite(briefPath, brief);
  const gate = await runGate("npm", ["run", "build:gate"], { cwd: base });
  if (gate?.status !== 0) {
    const error = new Error(`approval_build_gate_failed:${entry.program_id}:${gate?.status ?? "unknown"}`);
    error.result = { status: "APPLIED_GATE_FAIL", ...summary, registry_path: registryPath, review_brief_path: briefPath, gate_status: gate?.status ?? null };
    throw error;
  }
  return { status: "APPLIED_GATE_PASS", ...summary, registry_path: registryPath, review_brief_path: briefPath, gate_status: gate.status };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  if (inputIndex < 0 || !args[inputIndex + 1]) throw new Error("usage: node scripts/approval-pipeline-hook.mjs --input application.json [--apply]");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [registry, application] = await Promise.all([
    readFile(path.join(root, "data", "program-registry.json"), "utf8").then(JSON.parse),
    readFile(path.resolve(args[inputIndex + 1]), "utf8").then(JSON.parse),
  ]);
  const result = await runApprovalPipeline({ root, registry, application, apply: args.includes("--apply") });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
