import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUSINESS = "/home/ubuntu/business";
const REPORT = path.join(BUSINESS, "reports/glp-clinic-scout/operator-national-wow-20260723");
const PACKET_DIR = path.join(REPORT, "money-template-p0-fable-packet");
const PACKET = path.join(REPORT, "glp-money-template-p0-fable-review-20260724.zip");
const MANIFEST = path.join(REPORT, "money-template-p0-fable-packet-manifest.json");

const members = [
  "reports/glp-clinic-scout/operator-national-wow-20260723/MONEY-TEMPLATE-P0-REBUILD-20260724.md",
  "reports/glp-clinic-scout/operator-national-wow-20260723/money-template-p0-validation.json",
  "reports/glp-clinic-scout/operator-national-wow-20260723/money-template-p0-playwright-final.log",
  "reports/glp-clinic-scout/TEMPLATE-EMULATION-SPEC-fable-20260723.md",
  "reports/glp-clinic-scout/phase2-batch6-20260723/cross-device-renders/chromium-money-1440.png",
  "reports/glp-clinic-scout/phase2-batch6-20260723/cross-device-renders/chromium-money-390.png",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/src/money-page.mjs",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/data/money-page-specs.json",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/scripts/enrich-p0-money-template-data.mjs",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/scripts/validate-money-template-p0.mjs",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/scripts/build-staging.mjs",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/scripts/freeze-money-template-p0-packet.mjs",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/package.json",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/tests/playbook.test.mjs",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/tests/browser/cross-device.spec.mjs",
  "scripts/request_glp_money_template_p0_fable_acceptance.py",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/public/best/online-glp-1-providers/index.html",
  "site-system/flagship-v2/staging/glp-consumer-national-wow-20260723/public/compare/synergy-rx-vs-carebarerx/index.html",
];

function sha(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const validation = JSON.parse(await readFile(path.join(REPORT, "money-template-p0-validation.json"), "utf8"));
  if (validation.status !== "PASS" || validation.failures?.length || validation.pages !== 13 || validation.provider_cards !== 57 || validation.intent_cards !== 39) {
    throw new Error("rendered_page_validation_not_pass");
  }
  const browserLog = await readFile(path.join(REPORT, "money-template-p0-playwright-final.log"), "utf8");
  if (!/272 passed/.test(browserLog) || /\bfailed\b/i.test(browserLog)) {
    throw new Error("full_browser_matrix_not_272_pass");
  }
  const report = await readFile(path.join(REPORT, "MONEY-TEMPLATE-P0-REBUILD-20260724.md"), "utf8");
  if (!report.includes("Final full 272-case cross-device matrix: **272/272 PASS**")) {
    throw new Error("review_report_not_finalized");
  }

  await mkdir(PACKET_DIR, { recursive: true });
  const files = [];
  for (const relative of members) {
    const absolute = path.join(BUSINESS, relative);
    const buffer = await readFile(absolute);
    files.push({ path: relative, bytes: buffer.length, sha256: sha(buffer) });
  }

  const python = `
import json, pathlib, zipfile
business=pathlib.Path(${JSON.stringify(BUSINESS)})
packet=pathlib.Path(${JSON.stringify(PACKET)})
members=json.loads(${JSON.stringify(JSON.stringify(members))})
with zipfile.ZipFile(packet, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for rel in members:
        data=(business/rel).read_bytes()
        info=zipfile.ZipInfo(rel, date_time=(2026,7,24,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o644 << 16
        archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
`;
  execFileSync("python3", ["-c", python], { stdio: "inherit" });
  const packetBuffer = await readFile(PACKET);
  const manifest = {
    schema: "glp-money-template-p0-fable-packet-v1",
    status: "FROZEN_READY_FOR_FABLE_DESIGN_REVIEW",
    scope: "13 money pages; cloneable money-page-p0-v2 template; staging/link-dark/noindex only",
    packet: path.relative(BUSINESS, PACKET),
    packet_bytes: packetBuffer.length,
    packet_sha256: sha(packetBuffer),
    qa: {
      build: "PASS_BUILD_HELD_RELEASE",
      unit_adversarial: "64/64 PASS",
      focused_money_browser: "12/12 PASS",
      full_cross_device_browser: "272/272 PASS",
      rendered_page_validator: "PASS",
      pages: 13,
      provider_cards: 57,
      intent_cards: 39,
    },
    effects: {
      deployments: 0,
      indexing_actions: 0,
      affiliate_activations: 0,
      lead_shares_or_provider_contacts: 0,
      email_sends: 0,
      analytics_mutations: 0,
      domain_actions: 0,
      spend_usd: 0,
    },
    launch_authorized: false,
    files,
  };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: manifest.status, packet: PACKET, sha256: manifest.packet_sha256, bytes: manifest.packet_bytes, manifest: MANIFEST, files: files.length }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
