import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyMeritScores, meritScore } from "../src/merit-ranking.mjs";
import { scoreProvider } from "../src/money-page.mjs";
import { comparablePriceProviderIds } from "../src/provider-dynamic-profiles.mjs";
import { buildProviderReviewSpecs, renderProviderReviewPage } from "../src/provider-review.mjs";

const readJson = async (relative) => JSON.parse(await readFile(new URL(`../data/${relative}`, import.meta.url), "utf8"));

test("provider-add reviews bind the exact merit score their comparison rows publish", async () => {
  const [ledger, registry, money, contracts, fastpath, identity] = await Promise.all([
    readJson("program-content-ledger.json"),
    readJson("program-registry.json"),
    readJson("money-page-specs.json"),
    readJson("provider-page-contracts.json"),
    readJson("provider-fastpath-contract.json"),
    readJson("identity-registry.json"),
  ]);
  const scoredPrograms = structuredClone(ledger.programs);
  const comparablePriceIds = comparablePriceProviderIds(registry, "glp-clinic-scout", {
    asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
  });
  applyMeritScores(scoredPrograms, { comparablePriceIds });
  const ledgerById = new Map(scoredPrograms.map((entry) => [entry.program_id, entry]));
  const reviews = new Map(buildProviderReviewSpecs(
    money.pages, contracts, fastpath, registry, "glp-clinic-scout", scoredPrograms,
  ).map((review) => [review.program_id, review]));

  for (const contract of contracts.providers) {
    const id = contract.program_id;
    const entry = ledgerById.get(id);
    assert.ok(entry, `provider_add_merit_input_missing:${id}:program-content-ledger`);
    const expected = meritScore(entry);
    assert.ok(Number.isFinite(expected), `provider_add_merit_input_missing:${id}:criteria_scores`);
    const review = reviews.get(id);
    assert.ok(review, `provider_add_review_missing:${id}`);
    assert.equal(scoreProvider(review.row), expected, `provider_add_review_score_drift:${id}`);

    const comparisonRows = money.pages.flatMap((page) => page.rows || [])
      .filter((row) => row.program_id === id);
    assert.ok(comparisonRows.length > 0, `provider_add_comparison_row_missing:${id}`);
    for (const row of comparisonRows) {
      assert.equal(
        scoreProvider({ ...row, criteria_scores: entry.criteria_scores }),
        expected,
        `provider_add_comparison_score_drift:${id}`,
      );
    }

    const html = renderProviderReviewPage(review, identity);
    assert.match(html, new RegExp(`class="score">${(expected / 10).toFixed(1).replace(".", "\\.")}\\/10<\\/p>`), id);
    assert.doesNotMatch(html, /Not scored|Score pending|Pending evidence/i, id);
  }
});
