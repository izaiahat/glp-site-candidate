import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveIdentityGroups } from "../src/provider-identity.mjs";
import { optionCProgramIds } from "./helpers/d2w-s9-contracts.mjs";
import { currentComparisonPrograms } from './helpers/current-comparison-cohort.mjs';
import { assertExtraProfileMembership } from './helpers/current-extra-profiles.mjs';
import { javascriptProviderMarkup } from "./helpers/d2p-noscript.mjs";
import { buildRobotsTxt, isAllowed } from "../src/robots.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, ROOT), "utf8");
// Independent pre-candidate source baseline: reports/k6-baseline-20260910/stage/base/
// data/program-registry.json plus tests/phase3-page-graph.test.mjs (six detail-only IDs).
// Pin the seven here: today's registry projection must not shrink the expected set.
const EXTRA_PROFILE_BASELINE = [
  'katalys-647', 'mydrhank', 'breeze-meds-review', 'care-bare-rx-glp1-review',
  'g-plan', 'jrnys-review', 'medvi-review',
].sort();

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
  return currentComparisonPrograms(registry)
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
  const [registry, matrix] = await Promise.all([
    read("data/program-registry.json").then(JSON.parse),
    read("data/provider-pricing-matrix.json").then(JSON.parse),
  ]);
  // A3: the comparison set is evidence-qualified AND registry-eligible. Never
  // parse a membership teaser (e.g. $39) out of prose as a medication price.
  const identities = new Map(registry.programs.flatMap((row) =>
    [row.program_id, row.review_slug].filter(Boolean).map((id) => [id, row])));
  const prices = new Map(Object.values(matrix.providers).map((row) => [row.program_id,
    Math.min(...(row.medications || []).filter((med) => Number.isFinite(med.ongoing_usd))
      .map((med) => med.ongoing_usd))]));
  return optionCProgramIds(registry).map((id) => {
    const record = identities.get(id);
    assert.ok(record, `no canonical registry identity for ${id}`);
    assert.equal(record.profiles?.["glp-clinic-scout"]?.canonical_identity?.role === "alias", false, id);
    // GLP-233 removes only this unsupported public-name superlative; the
    // frozen evidence name remains unchanged in the source registry.
    const name = record.display_name === 'SkinnyRx - #1 GLP Weight Loss Provider' ? 'SkinnyRx' : record.display_name;
    return { id, name, review: record.review_path || `/providers/${record.program_id}/`,
      price: prices.get(id) ?? Infinity };
  }).sort((left, right) => left.price - right.price || left.id.localeCompare(right.id) || left.name.localeCompare(right.name));
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
  assert.deepEqual(itemList.itemListElement.map((entry) => entry.item.name), programs.map((program) => program.name));
  assert.deepEqual(itemList.itemListElement.map((entry) => entry.item.url),
    programs.map((program) => `https://glpclinicscout.com${program.review}`));
  // Match the physical comparison-card order and primary first-party review action,
  // not merely a schema cardinality that could survive a missing/held/alias card.
  const body = javascriptProviderMarkup(html);
  const grid = body.slice(body.indexOf('data-phase3-provider-grid'), body.indexOf('data-provider-card-payloads'));
  const cards = [...grid.matchAll(/<article\b[^>]*\bdata-phase3-provider(?=[\s>])[^>]*>[\s\S]*?<\/article>/g)];
  assert.deepEqual(cards.map((match) => match[0].match(/\bdata-program="([^"]+)"/)?.[1]), programs.map((program) => program.id));
  const noscriptCards = new Map([...html.matchAll(/<noscript>\s*(<article\b[^>]*\bdata-provider-noscript-card[^>]*>[\s\S]*?<\/article>)\s*<\/noscript>/g)]
    .map((match) => [match[1].match(/\bdata-program="([^"]+)"/)?.[1], match[1]]));
  for (const [index, match] of cards.entries()) {
    const card = noscriptCards.get(programs[index].id) || match[0];
    const review = card.match(/<a\b[^>]*\bdata-card-review(?:[\s>]|=[^>]*>)/)?.[0] || "";
    assert.ok(review.includes(`href="${programs[index].review}"`), `${programs[index].id}: card review destination differs from ItemList`);
  }
  assert.ok(programs.length >= 35, `expected at least 35 evidence-qualified provider cards, saw ${programs.length}`);
  assert.match(html, new RegExp(`<span data-live-provider-count>${livePrograms.length}<\\/span>`));
  assert.ok(html.includes(`${programs.length} meet the comparison-card evidence rules; ${livePrograms.length - programs.length} additional provider profiles have their own first-party pages outside this comparison.`));
  const comparisonIds = new Set(programs.map((program) => program.id));
  const extraProfiles = livePrograms.filter((program) => !comparisonIds.has(program.review_slug || program.program_id));
  await assertExtraProfileMembership(extraProfiles, EXTRA_PROFILE_BASELINE, read);
  assert.equal(extraProfiles.length, livePrograms.length - programs.length);
  for (const program of extraProfiles) {
    const route = `/providers/${program.program_id}/`;
    const detail = await read(`public${route}index.html`);
    assert.match(detail, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com/providers/${program.program_id}/">`));
    assert.ok(html.includes(`href="${program.review_path || route}"`), `${program.program_id}: extra profile not discoverable`);
    assert.ok(!itemList.itemListElement.some((entry) => entry.item.url === `https://glpclinicscout.com${program.review_path || route}`), `${program.program_id}: profile promoted into ItemList`);
  }
  assert.equal(programs.some((program) => ["telos-rx", "shed", "fella-health"].includes(program.id)), false);
  assert.equal(JSON.stringify(itemList).includes("AggregateRating"), false);
});
