import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveIdentityGroups } from "../src/provider-identity.mjs";
import { buildRobotsTxt, isAllowed } from "../src/robots.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, ROOT), "utf8");

function schemaNodes(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap((match) => {
      const value = JSON.parse(match[1]);
      return Array.isArray(value?.["@graph"]) ? value["@graph"] : [value];
    });
}

async function liveCanonicalPrograms() {
  const [registry, ledger] = await Promise.all([
    read("data/program-registry.json").then(JSON.parse),
    read("data/program-content-ledger.json").then(JSON.parse),
  ]);
  const profileId = "glp-clinic-scout";
  const { aliasIds } = deriveIdentityGroups(registry, profileId, ledger.programs);
  return registry.programs
    .filter((program) => {
      const profile = program.profiles?.[profileId];
      return program.commercial_state === "live"
        && profile?.vertical_fit === true
        && profile?.wired === true
        && profile?.surfaces?.review === true
        && !aliasIds.has(program.program_id);
    })
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

async function optionCCardPrograms() {
  const [facts, ledger, registry] = await Promise.all([
    read("data/provider-facts-backfill-20260830.json").then(JSON.parse),
    read("data/program-content-ledger.json").then(JSON.parse),
    read("data/program-registry.json").then(JSON.parse),
  ]);
  const ledgerById = new Map(ledger.programs.map((program) => [program.program_id, program]));
  const sourceReported = (row) => row?.status === "SOURCE_REPORTED" && Boolean(String(row.value || "").trim()) && Boolean(row.source_url) && Boolean(row.capture_date);
  const price = (program) => Number.parseFloat(String(program.facts.total_monthly_cost.value).match(/\$\s*([\d,]+(?:\.\d+)?)/)?.[1]?.replaceAll(",", "") || "Infinity");
  return facts.programs
    .filter((program) => {
      const content = ledgerById.get(program.program_id);
      return Boolean(program.display_name && content?.meds_offered && content?.source_url)
        && sourceReported(program.facts?.total_monthly_cost)
        && sourceReported(program.facts?.cancellation);
    })
    .map((program) => ({
      ...program,
      route_program_id: registry.programs.find((record) => record.program_id === program.program_id)?.program_id
        || registry.programs.find((record) => String(record.review_path || "").includes(`/${program.program_id}/`))?.program_id,
    }))
    .sort((left, right) => price(left) - price(right) || left.display_name.localeCompare(right.display_name));
}

test("Pass 5 Brave crawlability keeps privacy and terms fetchable without changing their separate noindex policy", async () => {
  const [robots, privacy, terms] = await Promise.all([
    read("public/robots.txt"),
    read("public/privacy/index.html"),
    read("public/terms/index.html"),
  ]);
  assert.equal(robots, buildRobotsTxt());
  for (const route of ["/privacy/", "/terms/"]) {
    assert.equal(isAllowed(robots, "Googlebot", route), true, route);
    assert.equal(isAllowed(robots, "SomeFutureUnknownBot/1.0", route), true, route);
  }
  for (const [route, html] of [["privacy", privacy], ["terms", terms]]) {
    assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,max-image-preview:large">/);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com/${route}/">`));
  }
});

test("Pass 5 providers ItemList is an exact source-derived projection of Option C card eligibility", async () => {
  const [html, programs, livePrograms] = await Promise.all([
    read("public/providers/index.html"),
    optionCCardPrograms(),
    liveCanonicalPrograms(),
  ]);
  const itemLists = schemaNodes(html).filter((node) => node?.["@type"] === "ItemList");
  assert.equal(itemLists.length, 1);
  const itemList = itemLists[0];
  // W8 integrates the verified W7-FABLE-002 reader-facing wording. Identity,
  // cardinality, order, canonical destinations and eligibility stay exact.
  assert.equal(itemList.name, "GLP-1 provider comparison");
  assert.equal(itemList.numberOfItems, programs.length);
  assert.equal(itemList.itemListElement.length, programs.length);
  assert.deepEqual(itemList.itemListElement.map((entry) => entry.position), programs.map((_, index) => index + 1));
  assert.deepEqual(itemList.itemListElement.map((entry) => entry.item.name), programs.map((program) => program.display_name));
  assert.deepEqual(
    itemList.itemListElement.map((entry) => entry.item.url),
    programs.map((program) => `https://glpclinicscout.com/providers/${program.route_program_id}/`),
  );
  // Provider-card count is a monotonic floor: onboarding grows it.
  assert.ok(programs.length >= 35, `expected at least 35 evidence-qualified provider cards, saw ${programs.length}`);
  assert.match(html, new RegExp(`data-live-provider-count="${livePrograms.length}"`));
  assert.ok(html.includes(`${livePrograms.length} program profiles are listed in total. A profile appears as a card only when all three facts are verified; the other profiles keep their detail pages.`));
  assert.equal(html.includes("Registry scope:"), false);
  assert.equal(JSON.stringify(itemList).includes("AggregateRating"), false);
});
