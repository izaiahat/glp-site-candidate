import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONEY_SPECS = path.join(ROOT, "data", "money-page-specs.json");
const CRITERION_LABELS = Object.freeze({
  price_transparency: "price transparency",
  medical_oversight: "care-process visibility",
  insurance_support: "insurance-support visibility",
  public_reviews: "comparable public-review evidence",
  shipping_transparency: "shipping transparency",
});
const GENERIC_LIMITS = Object.freeze([
  "No comparable independent public-review dataset was verified.",
  "Eligibility, state availability, and final cost require direct confirmation.",
]);

function highestCriterion(scores = {}) {
  return Object.keys(CRITERION_LABELS).sort((left, right) => {
    const delta = Number(scores[right] ?? -1) - Number(scores[left] ?? -1);
    return delta || left.localeCompare(right);
  })[0];
}

function dedupe(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function enrichRow(row, page) {
  const provider = row.provider || row.display_name;
  if (!provider) throw new Error(`provider_identity_missing:${row.program_id}`);
  const criterion = highestCriterion(row.criteria_scores);
  const bestFor = row.best_for || `Stronger published ${CRITERION_LABELS[criterion]} evidence in this comparison`;
  const pros = dedupe(row.pros || [
    `Published price evidence: ${row.starting_price}`,
    `Payment and coverage evidence: ${row.insurance}`,
    row.average_wait && row.average_wait !== "Not stated"
      ? `Process evidence: ${row.average_wait}`
      : "Missing process timing stays labeled Not stated instead of being estimated.",
  ]).slice(0, 4);
  const limits = Array.isArray(row.limitations) ? row.limitations : [];
  const compoundedLimit = /compound/i.test(row.meds_offered || "")
    ? ["Compounded products are not FDA-approved."]
    : [];
  const cons = dedupe(row.cons || [...limits, ...compoundedLimit, ...GENERIC_LIMITS]).slice(0, 3);
  while (cons.length < 2) cons.push(GENERIC_LIMITS[cons.length]);
  const bottomLine = !row.bottom_line || /^undefined stands out/.test(row.bottom_line)
    ? `${provider} stands out here for ${bestFor.toLowerCase()}, based on dated commercial evidence—not medical outcomes or individual suitability.`
    : row.bottom_line;
  const socialProof = row.social_proof || {
    status: "NOT_VERIFIED_COMPARABLE",
    label: "Independent public reviews",
    explanation: "No comparable independent public-review dataset was verified for this comparison.",
    methodology_path: "/how-we-rate/",
    verified_as_of: page.source_checked_through || page.date_modified,
  };
  return { ...row, provider, best_for: bestFor, pros, cons, bottom_line: bottomLine, social_proof: socialProof };
}

function enrichPage(page) {
  const rows = page.rows.map((row) => enrichRow(row, page));
  const ranked = [...rows].sort((left, right) => {
    const scoreDelta = Number(right.score ?? -1) - Number(left.score ?? -1);
    return scoreDelta || left.provider.localeCompare(right.provider);
  });
  const rowMap = new Map(rows.map((row) => [row.program_id, row]));
  const existingBestForValid = Array.isArray(page.best_for) && page.best_for.length >= 2 && page.best_for.length <= 4 && page.best_for.every((item) => item.provider && rowMap.get(item.program_id)?.provider === item.provider && item.intent_label && item.one_line);
  const bestFor = existingBestForValid ? page.best_for : ranked.slice(0, Math.min(3, ranked.length)).map((row) => ({
    intent_label: row.best_for,
    program_id: row.program_id,
    provider: row.provider,
    one_line: row.bottom_line,
  }));
  return { ...page, template_revision: "money-page-p0-v2", best_for: bestFor, rows };
}

const document = JSON.parse(await readFile(MONEY_SPECS, "utf8"));
const enriched = { ...document, template_revision: "money-page-p0-v2", pages: document.pages.map(enrichPage) };
await writeFile(MONEY_SPECS, `${JSON.stringify(enriched, null, 2)}\n`);
console.log(JSON.stringify({
  status: "PASS",
  template_revision: enriched.template_revision,
  pages: enriched.pages.length,
  provider_cards: enriched.pages.reduce((total, page) => total + page.rows.length, 0),
  intent_cards: enriched.pages.reduce((total, page) => total + page.best_for.length, 0),
}));
