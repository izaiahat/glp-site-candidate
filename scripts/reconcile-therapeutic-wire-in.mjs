#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { reconcileTherapeuticTaxonomyWireIn } from "../src/therapeutic-taxonomy.mjs";
import { reconcileProviderDynamicProfilesWireIn } from "../src/provider-dynamic-profiles.mjs";

function fail(message) {
  throw new Error(`therapeutic_wire_in_reconcile_${message}`);
}

const args = process.argv.slice(2);
const releaseIndex = args.indexOf("--release");
if (releaseIndex < 0 || !args[releaseIndex + 1]) fail("release_required");
const root = path.resolve(args[releaseIndex + 1]);
const checkOnly = args.includes("--check");

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, "data", relative), "utf8"));
}

const [registry, money, quiz] = await Promise.all([
  readJson("program-registry.json"),
  readJson("money-page-specs.json"),
  readJson("quiz-config.json"),
]);
const reconciled = reconcileTherapeuticTaxonomyWireIn({
  registry,
  profileId: "glp-clinic-scout",
  pages: money.pages,
  quizConfig: quiz,
});
const dynamic = reconcileProviderDynamicProfilesWireIn({
  registry,
  profileId: "glp-clinic-scout",
});
if (!checkOnly) {
  await writeFile(path.join(root, "data", "program-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
}
console.log(JSON.stringify({
  status: checkOnly ? "PASS_CHECKED" : "PASS_RECONCILED",
  release_root: root,
  active_program_ids: reconciled.activeProgramIds,
  counts: reconciled.counts,
  dynamic_profile_counts: dynamic.counts,
  canonical_provider_ids: dynamic.canonicalIds,
  external_effects: 0,
}));
