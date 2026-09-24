import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = process.cwd();
const VERDICT_PATH = `${ROOT}/artifacts/ultracode/copy-preservation-verdict.json`;
const AFTER_PATH = `${ROOT}/artifacts/ultracode/copy-preservation-after.json`;
const MAP_PATH = `${ROOT}/artifacts/ultracode/copy-equivalence-map.json`;
const OUTPUT_PATH = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/design-pass-copy-delta-receipt-20260826.json";
const read = (path) => readFileSync(path);
const json = (path) => JSON.parse(read(path));
const sha256 = (path) => createHash("sha256").update(read(path)).digest("hex");

const verdict = json(VERDICT_PATH);
const after = json(AFTER_PATH);
const map = json(MAP_PATH);
const currentRoutesByText = new Map();
for (const row of after.rows) {
  if (!currentRoutesByText.has(row.text)) currentRoutesByText.set(row.text, new Set());
  currentRoutesByText.get(row.text).add(row.route);
}
const lostByRoute = new Map();
let sameTextElsewhere = 0;
let absentGlobally = 0;
for (const row of verdict.lost) {
  lostByRoute.set(row.route, (lostByRoute.get(row.route) || 0) + 1);
  if (currentRoutesByText.has(row.text)) sameTextElsewhere += 1;
  else absentGlobally += 1;
}
const receipt = {
  schema: "glp.design-pass-copy-delta-receipt.v1",
  generated_at_utc: new Date().toISOString(),
  status: "BLOCKED_UNBLESSED_LOSS",
  policy: "Only explicit route-scoped deltas demonstrated visible by the established validator are accepted. Lost rows are not mapped or blessed.",
  baseline_total: verdict.baseline_total,
  current_total: verdict.current_total,
  default_visible: verdict.default_visible,
  recovered_via_disclosure: verdict.recovered_via_disclosure.length,
  generator_map_entries: map.mappings.length,
  accepted_delta_count: verdict.equivalence_mapped.length,
  accepted_deltas: verdict.equivalence_mapped,
  unaccepted_loss: {
    count: verdict.lost.length,
    same_text_present_on_another_current_route: sameTextElsewhere,
    absent_from_all_current_routes: absentGlobally,
    route_count_shrink: verdict.route_count_shrink,
    counts_by_route: [...lostByRoute].map(([route, count]) => ({ route, count })).sort((left, right) => right.count - left.count || left.route.localeCompare(right.route)),
    exact_ledger: "site-system/flagship-v2/candidates/glp-visual-ultracode-20260821/artifacts/ultracode/copy-preservation-verdict.json",
    disposition: "Fable decision required. No equivalence entries were invented for these rows.",
  },
  source_artifacts: {
    equivalence_map: { path: "site-system/flagship-v2/candidates/glp-visual-ultracode-20260821/artifacts/ultracode/copy-equivalence-map.json", sha256: sha256(MAP_PATH) },
    after_inventory: { path: "site-system/flagship-v2/candidates/glp-visual-ultracode-20260821/artifacts/ultracode/copy-preservation-after.json", sha256: sha256(AFTER_PATH) },
    verdict: { path: "site-system/flagship-v2/candidates/glp-visual-ultracode-20260821/artifacts/ultracode/copy-preservation-verdict.json", sha256: sha256(VERDICT_PATH) },
  },
  external_effects: { deployments: 0, tracking_links_clicked: 0, provider_writes: 0 },
};
writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, output: OUTPUT_PATH, accepted: receipt.accepted_delta_count, lost: receipt.unaccepted_loss.count }));
