import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCoverageInputs, validateProgramCoverage } from "../src/program-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const profileId = process.env.GCS_SITE_PROFILE || "glp-clinic-scout";
// READY6 candidate review routes are additive to the registry profile's
// expected_sitemap_routes. 2026-08-17: Katalys paused offer 1518 (Breeze Meds),
// its registry row was removed and src/ready6-editorial.mjs suppresses its page,
// so the candidate lane publishes one fewer route: 11 -> 10.
const READY6_ADDITIVE_SITEMAP_ROUTES = Object.freeze({
  "glp-clinic-scout": 12,
});
const PASS2_ADDITIVE_SITEMAP_ROUTES = Object.freeze({
  // O-25: the governed review directory is indexable; moderation intake is not.
  "glp-clinic-scout": 1,
});
const PASS3_ADDITIVE_SITEMAP_ROUTES = Object.freeze({
  // Phase 4: the compact matcher is a distinct indexable entry route.
  "glp-clinic-scout": 1,
});
const LIVE_HEAD_MERGE_ADDITIVE_SITEMAP_ROUTES = Object.freeze({
  // 2026-08-27 live-head merge: four SEO articles published after the 8/21 fork
  // (rekulo-glp-1-reviews, california-glp-1-access, glp-1-cost-sensitivity,
  // oral-glp-1-availability) enter this candidate's guide set. The live tree
  // accounts them in its own flattened additive (12 -> 16); this candidate keeps
  // its layered accounting and adds them here. Nu Image's review route arrives
  // via the registry's expected_sitemap_routes (88 -> 89), not this constant.
  "glp-clinic-scout": 4,
});
const ARTICLE_CARRIER_ADDITIVE_SITEMAP_ROUTES = Object.freeze({
  // Net-new article routes published after this layered release baseline.
  "glp-clinic-scout": 4,
});
const PASS5_ADDITIVE_SITEMAP_ROUTES = Object.freeze({
  // Pass 5: /compare/ is now a canonical two-path router rather than a 404.
  // It adds no provider/program authority; only the sitemap route denominator.
  "glp-clinic-scout": 1,
});

const [registry, money, quiz, calculatorConfig, providerContracts, providerFastpath, phase3Config] = await Promise.all([
  readJson("data/program-registry.json"),
  readJson("data/money-page-specs.json"),
  readJson("data/quiz-config.json"),
  readJson("data/cost-calculator.json"),
  readJson("data/provider-page-contracts.json"),
  readJson("data/provider-fastpath-contract.json"),
  readJson("data/phase3-page-graph.json"),
]);
if (!Number.isInteger(phase3Config.expected_indexable_routes) || phase3Config.expected_indexable_routes < 1) throw new Error("coverage_phase3_expected_routes_invalid");
const phase3RedirectSources = new Set([...phase3Config.retired_evidence_wall_redirects, ...phase3Config.legacy_redirects].map(([from]) => from));
const phase3PaidLandingRoutes = new Set(phase3Config.compounded_pages.filter((page) => page.route.startsWith("/lp/")).map((page) => page.route));
const phase3NetAdditiveRoutes = phase3Config.expected_indexable_routes - phase3RedirectSources.size - phase3PaidLandingRoutes.size;
if (phase3NetAdditiveRoutes < 1) throw new Error("coverage_phase3_additive_routes_invalid");

const inputs = await collectCoverageInputs({
  root,
  registry,
  profileId,
  money,
  quiz,
  calculatorConfig,
  providerContracts,
  providerFastpath,
});
// Keep program-authority counts unchanged while projecting program surfaces.
// The candidate-only route graph affects only the final sitemap count gate.
inputs.registry = {
  ...registry,
  site_profiles: {
    ...registry.site_profiles,
    [profileId]: {
      ...registry.site_profiles[profileId],
      expected_sitemap_routes: registry.site_profiles[profileId].expected_sitemap_routes
        + (READY6_ADDITIVE_SITEMAP_ROUTES[profileId] || 0)
        + (PASS2_ADDITIVE_SITEMAP_ROUTES[profileId] || 0)
        + (PASS3_ADDITIVE_SITEMAP_ROUTES[profileId] || 0)
        + (LIVE_HEAD_MERGE_ADDITIVE_SITEMAP_ROUTES[profileId] || 0)
        + (ARTICLE_CARRIER_ADDITIVE_SITEMAP_ROUTES[profileId] || 0)
        + (PASS5_ADDITIVE_SITEMAP_ROUTES[profileId] || 0)
        + phase3NetAdditiveRoutes,
    },
  },
};
const result = validateProgramCoverage(inputs);
console.log(JSON.stringify(result));
