import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReviewServer } from "./serve-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUSINESS = path.resolve(ROOT, "../../../..");
const ENV_PATH = path.join(process.env.HOME || "/home/ubuntu", ".hermes", ".env");
const RECEIPT = path.join(BUSINESS, "reports", "glp-clinic-scout", "rebuild", "PASS2-O25-D1-E2E-20260824.json");
const EXPECTED_ACCOUNT = "f860943dff399ffb1db0a28dcd3dadfd";
const PROJECT = "glp-clinic-scout";
const API = "https://api.cloudflare.com/client/v4";

function parseEnv(source) {
  const values = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

const values = parseEnv(await readFile(ENV_PATH, "utf8"));
const account = values.CLOUDFLARE_ACCOUNT_ID;
const token = values.CLOUDFLARE_API_TOKEN || values.CF_API_TOKEN || values.CLOUDFLARE_TOKEN;
if (account !== EXPECTED_ACCOUNT) throw new Error("cloudflare_account_identity_mismatch");
if (!token) throw new Error("cloudflare_token_missing");

async function cf(method, pathname, payload) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "GLP-PASS2-O25-E2E/1.0" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`cloudflare_api_${response.status}:${JSON.stringify(body.errors || [])}`);
  return body.result;
}

const accountReadback = await cf("GET", `/accounts/${account}`);
const project = await cf("GET", `/accounts/${account}/pages/projects/${PROJECT}`);
if (accountReadback.id !== EXPECTED_ACCOUNT || project.name !== PROJECT) throw new Error("cloudflare_provider_identity_mismatch");
const production = project.deployment_configs?.production || {};
const latestId = project.latest_deployment?.id;
const deployment = latestId ? await cf("GET", `/accounts/${account}/pages/projects/${PROJECT}/deployments/${latestId}`) : {};
const bindings = [production.d1_databases, deployment.d1_databases, project.d1_databases].filter(Boolean);
let binding;
for (const group of bindings) {
  for (const name of ["REVIEWS_DB", "GLP_DB"]) {
    const candidate = group[name];
    const databaseId = candidate?.id || candidate?.database_id;
    if (databaseId) { binding = { name, databaseId }; break; }
  }
  if (binding) break;
}
if (!binding) throw new Error("review_d1_binding_missing");

async function query(sql, params = []) {
  const result = await cf("POST", `/accounts/${account}/d1/database/${binding.databaseId}/query`, { sql, params });
  return Array.isArray(result) ? result[0] : result;
}

const remoteD1 = {
  prepare(sql) {
    return {
      bind(...params) {
        return {
          async run() {
            const result = await query(sql, params);
            return { success: result?.success !== false, meta: result?.meta || {} };
          },
        };
      },
    };
  },
};

const server = await createReviewServer({ REVIEW_CAPTURE_MODE: "local_test", GLP_DB: remoteD1 });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const endpoint = `http://127.0.0.1:${address.port}/api/review-capture`;
const payload = {
  subject_name: "OrderlyMeds",
  experience_type: "provider",
  rating: 4,
  headline: "Synthetic O25 storage verification",
  review: "This is a synthetic PASS2 O25 end to end storage verification row. It is not a customer review and must never be published.",
  first_name: "PASS2",
  email: "pass2-o25@example.invalid",
  occurred_month: new Date().toISOString().slice(0, 7),
  truthful_attestation: true,
  moderation_consent: true,
  company: "",
};
let capture;
try {
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  capture = { status: response.status, body: await response.json() };
} finally {
  await new Promise((resolve) => server.close(resolve));
}
if (capture.status !== 202 || capture.body?.status !== "CAPTURED_HELD_MANUAL_REVIEW" || !capture.body?.review_id) {
  throw new Error(`review_capture_failed:${JSON.stringify(capture)}`);
}
const reviewId = capture.body.review_id;
const landed = await query("SELECT review_id, moderation_status, publish_approved, subject_name, verification_email FROM review_submissions WHERE review_id = ?", [reviewId]);
const landedRow = landed?.results?.[0];
if (!landedRow || landedRow.moderation_status !== "held_manual_review" || Number(landedRow.publish_approved) !== 0) throw new Error("review_readback_failed");
await query("UPDATE review_submissions SET moderation_status = 'rejected', moderation_notes = ?, rejected_at = ?, updated_at = ? WHERE review_id = ? AND publish_approved = 0", ["Synthetic PASS2 O-25 end-to-end verification; never eligible for publication.", new Date().toISOString(), new Date().toISOString(), reviewId]);
const moderated = await query("SELECT review_id, moderation_status, publish_approved, moderation_notes FROM review_submissions WHERE review_id = ?", [reviewId]);
const moderatedRow = moderated?.results?.[0];
if (!moderatedRow || moderatedRow.moderation_status !== "rejected" || Number(moderatedRow.publish_approved) !== 0) throw new Error("moderation_readback_failed");

const receipt = {
  checked_at: new Date().toISOString(),
  account_id: EXPECTED_ACCOUNT,
  account_provider_match: true,
  project: PROJECT,
  project_provider_match: true,
  latest_deployment_id: latestId,
  binding: binding.name,
  database_id: binding.databaseId,
  transport: "candidate HTTP POST /api/review-capture -> production-shaped handler -> verified Cloudflare D1 binding",
  http_status: capture.status,
  capture_status: capture.body.status,
  review_id: reviewId,
  landed_readback: { moderation_status: landedRow.moderation_status, publish_approved: Number(landedRow.publish_approved), synthetic: true },
  moderation_readback: { moderation_status: moderatedRow.moderation_status, publish_approved: Number(moderatedRow.publish_approved), notes_present: Boolean(moderatedRow.moderation_notes) },
  production_mode_present: Object.hasOwn(production.env_vars || {}, "REVIEW_CAPTURE_MODE"),
  synthetic_row_policy: "Rejected, publish_approved=0, retained solely as O-25 durable-store evidence.",
  deployments: 0,
  external_mutations: 2
};
await writeFile(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ receipt: RECEIPT, http_status: receipt.http_status, capture_status: receipt.capture_status, readback: receipt.landed_readback, moderation: receipt.moderation_readback, production_mode_present: receipt.production_mode_present, deployments: 0, external_mutations: 2 }, null, 2)}\n`);
