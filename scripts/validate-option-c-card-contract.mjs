#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const count = (text, pattern) => [...text.matchAll(pattern)].length;
const articleBodies = (html, marker) => [...html.matchAll(new RegExp(`<article\\b[^>]*${marker}[^>]*>([\\s\\S]*?)<\\/article>`, "gi"))].map((match) => match[1]);

const findings = [];
const check = (condition, code, detail = {}) => {
  if (!condition) findings.push({ code, ...detail });
};

const providers = read("public/providers/index.html");
const providerOpenTags = [...providers.matchAll(/<article\b[^>]*\bdata-phase3-provider(?:\s|>)[^>]*>/gi)].map((match) => match[0]);
const providerIds = providerOpenTags.map((tag) => tag.match(/\bdata-program="([^"]+)"/i)?.[1] || "");
const providerInitialBodies = articleBodies(providers, "data-phase3-provider");
const payloadScript = providers.match(/<script\b[^>]*data-provider-card-payloads[^>]*>[\s\S]*?<\/script>/i)?.[0] || "";
const payloadInline = payloadScript.match(/>([\s\S]*?)<\/script>/i)?.[1]?.trim() || "[]";
const payloadSource = payloadScript.match(/\bdata-src="([^"]+)"/i)?.[1] || "";
const payloadText = payloadSource && payloadInline === "[]"
  ? fs.readFileSync(path.join(PUBLIC, payloadSource.replace(/^\//, "")), "utf8")
  : payloadInline;
let providerDeferredBodies = [];
try {
  providerDeferredBodies = JSON.parse(payloadText);
} catch (error) {
  findings.push({ code: "PROVIDER_PAYLOAD_INVALID_JSON", error: error.message });
}
const providerBodies = [...providerInitialBodies.filter((body) => !/data-provider-lazy-placeholder/.test(body)), ...providerDeferredBodies];
const excludedProviders = ["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review"];

check(providerOpenTags.length === 35, "PROVIDER_CARD_COUNT", { expected: 35, actual: providerOpenTags.length });
check(new Set(providerIds).size === 35 && providerIds.every(Boolean), "PROVIDER_CARD_IDS", { actual_unique: new Set(providerIds).size });
check(excludedProviders.every((id) => !providerIds.includes(id)), "PROVIDER_EXCLUSION", { rendered: excludedProviders.filter((id) => providerIds.includes(id)) });
check(providerBodies.length === 35, "PROVIDER_BODY_COUNT", { expected: 35, actual: providerBodies.length });
for (const [index, body] of providerBodies.entries()) {
  const labels = [...body.matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1]);
  check(body.includes('data-provider-card-contract="option-c"'), "PROVIDER_CONTRACT_MARKER", { index });
  check(JSON.stringify(labels) === JSON.stringify(["Medications offered", "Total monthly cost", "Cancellation"]), "PROVIDER_FIELD_CONTRACT", { index, labels });
  check(count(body, /data-citation="inline_fact_source"/g) >= 4, "PROVIDER_SOURCES", { index });
  check(count(body, /<time\b[^>]*datetime="\d{4}-\d{2}-\d{2}"/g) >= 4, "PROVIDER_CAPTURE_DATES", { index });
  check(count(body, /class="p3-provenance"/g) >= 1, "PROVIDER_NUMERIC_PROVENANCE", { index });
  check(!/p3-dose-grid|p3-feature-chips|UNKNOWN_NO_SOURCE|Not published|Insurance<\/dt>|Eligibility<\/dt>|Included costs<\/dt>|Shipping<\/dt>|State coverage<\/dt>|Average wait<\/dt>/i.test(body), "PROVIDER_FORBIDDEN_CARD_CONTENT", { index });
  check(!/<(?:dt|dd|span)>\s*<\/(?:dt|dd|span)>/i.test(body), "PROVIDER_BLANK_CARD_NODE", { index });
}

const pharmacies = read("public/pharmacies/index.html");
const pharmacyBodies = articleBodies(pharmacies, "data-pharmacy-card");
check(pharmacyBodies.length === 75, "PHARMACY_CARD_COUNT", { expected: 75, actual: pharmacyBodies.length });
for (const [index, body] of pharmacyBodies.entries()) {
  const labels = [...body.matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1]);
  check(body.includes('data-pharmacy-card-contract="option-c"'), "PHARMACY_CONTRACT_MARKER", { index });
  check(JSON.stringify(labels) === JSON.stringify(["Facility location", "Published services"]), "PHARMACY_FIELD_CONTRACT", { index, labels });
  check(/<h2\b[^>]*>[^<]+<\/h2>/i.test(body), "PHARMACY_DISPLAY_NAME", { index });
  check(/class="p3-card-evidence-line"/.test(body), "PHARMACY_EVIDENCE_LINE", { index });
  check(count(body, /data-citation="inline_fact_source"/g) >= 2, "PHARMACY_SOURCES", { index });
  check(count(body, /<time\b[^>]*datetime="\d{4}-\d{2}-\d{2}"/g) >= 4, "PHARMACY_CAPTURE_DATES", { index });
  check(!/Provider relationship<\/dt>|Consumer price<\/dt>|Rating<\/dt>|GLP-1 relevance<\/dt>|State coverage<\/dt>|Legal identity<\/dt>|503A pathway<\/dt>|503B pathway<\/dt>|Regulatory action<\/dt>|Compounded with<\/dt>|UNKNOWN_NO_SOURCE|Research in progress|None verified|Rating not collected|Additive evidence not captured|Consumer price not published|State footprint not verified|GLP-1 relevance not verified/i.test(body), "PHARMACY_FORBIDDEN_CARD_CONTENT", { index });
  check(!/<(?:dt|dd|span)>\s*<\/(?:dt|dd|span)>/i.test(body), "PHARMACY_BLANK_CARD_NODE", { index });
}

const htmlFiles = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && entry.name.endsWith(".html")) htmlFiles.push(absolute);
  }
};
walk(PUBLIC);

const legacyPlaceholderPatterns = [
  ["UNKNOWN_NO_SOURCE", /UNKNOWN_NO_SOURCE/g],
  ["Research in progress", /Research in progress/gi],
  ["None verified", /None verified/gi],
  ["Rating not collected", /Rating not collected/gi],
  ["Additive evidence not captured", /Additive evidence not captured/gi],
  ["Consumer price not published", /Consumer price not published/gi],
  ["State footprint not verified", /State footprint not verified/gi],
  ["GLP-1 relevance not verified", /GLP-1 relevance not verified/gi],
  ["Dose pricing unpublished", /Dose pricing unpublished/gi],
  ["Dose pricing not published", /Dose pricing not published/gi],
  ["Not published value", /<(?:strong|span|td|dd)>\s*Not published\s*<\/(?:strong|span|td|dd)>/gi],
  ["No bound statement available", /No bound statement available\./gi],
];
const placeholderHits = [];
let doseGridCount = 0;
let exactDoseGridCount = 0;
let doseRowCount = 0;
for (const absolute of htmlFiles) {
  const html = fs.readFileSync(absolute, "utf8");
  const relative = path.relative(PUBLIC, absolute);
  for (const [label, pattern] of legacyPlaceholderPatterns) {
    const matches = count(html, pattern);
    if (matches) placeholderHits.push({ file: relative, label, count: matches });
  }
  doseGridCount += count(html, /class="[^"]*p3-dose-grid[^"]*"/g);
  exactDoseGridCount += count(html, /class="[^"]*p3-dose-grid[^"]*"[^>]*data-dose-model="source-reported-per-dose"/g);
  doseRowCount += count(html, /\bdata-dose-row="[^"]+"/g);
}
check(placeholderHits.length === 0, "GENERATED_HTML_PLACEHOLDER_COPY", { hits: placeholderHits });
check(doseGridCount === 2 && exactDoseGridCount === 2, "DETAIL_ONLY_DOSE_GRIDS", { expected: 2, dose_grids: doseGridCount, exact_dose_grids: exactDoseGridCount });
check(doseRowCount === 11, "EXACT_DOSE_ROW_COUNT", { expected: 11, actual: doseRowCount });

const result = {
  status: findings.length ? "FAIL" : "PASS",
  schema: "glp.option-c-card-contract-validation.v1",
  pharmacy_cards_rendered: pharmacyBodies.length,
  provider_cards_rendered: providerOpenTags.length,
  provider_cards_hydratable: providerBodies.length,
  excluded_provider_cards_rendered: excludedProviders.filter((id) => providerIds.includes(id)),
  generated_html_files_scanned: htmlFiles.length,
  generated_html_placeholder_copy_count: placeholderHits.reduce((sum, hit) => sum + hit.count, 0),
  dose_grids_total: doseGridCount,
  exact_detail_dose_grids: exactDoseGridCount,
  exact_detail_dose_rows: doseRowCount,
  findings,
};
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
