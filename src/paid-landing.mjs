import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CANDIDATE_EXPORT_POLICY, policyMarkup, candidateExportShellFindings } from "./candidate-export-policy.mjs";
import { renderCompareCard } from "./provider-compare-card.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const IDS = Object.freeze(["phase4-quiz-data", "candidate-data", "quiz-ranking", "pass2-quiz-data"]);
const owned = (name) => readFileSync(new URL(`./paid-landing/${name}`, import.meta.url), "utf8");
export const factualCopyAdaptations = Object.freeze([
  ["each with its published price and a link", "with published prices where available and a link"],
  ["with their published price, plus a link", "with published prices where available, plus a link"],
  ["Real programs and published prices appear", "Real programs and available published prices appear"],
  ["Published price on each result", "Published prices where available"],
  ["The provider's published ongoing price and plan label, the first-month price where it differs, the source link and the capture date.", "Where published: the ongoing price and plan label, the first-month price where it differs, the source link and the capture date."],
  ["See each matching program's published price and plan label", "See published prices and plan labels where available"],
  ["each with its published price and a source-checked review", "with published prices where available and a source-checked review"],
]);

// Fable v5 is the paid entrance. The approved source is retained byte-exact;
// only build-bound count and explicitly noncommercial example are projected.
// There is no hidden questionnaire, paid fragment loader or contact form.
// Bind only the existing shared consent runtime, never the organic page content.
function paidConsentRuntime(organicDocument, assetVersion) {
  const scripts = [...organicDocument.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(match => match[0]);
  const policies = scripts.filter(script => script.includes('data-candidate-export-policy'));
  const configs = scripts.filter(script => script.includes('window.GCS_ANALYTICS='));
  // Raw renderQuiz() unit/component fixtures have no shared runtime. They stay
  // held and cannot supply real vendor identities or imply production parity.
  if (!policies.length && !configs.length) return `${policyMarkup(CANDIDATE_EXPORT_POLICY)}<script src="/assets/consent.js?v=${assetVersion}" defer></script>`;
  const consent = scripts.filter(script => /\bsrc="\/assets\/consent\.js\?v=[a-zA-Z0-9_-]+"/.test(script));
  const analytics = scripts.filter(script => /\bsrc="\/assets\/analytics\.[a-f0-9]{16}\.js"/.test(script));
  const suppression = scripts.filter(script => script.includes('window.GCS_ANALYTICS_SUPPRESSED=true'));
  if ([policies, configs, consent, analytics].some(items => items.length !== 1) || suppression.length > 1) throw new Error('paid_consent_runtime_shape');
  const boundPolicy = JSON.parse(policies[0].match(/Object\.freeze\((\{[^<]*\})\)/)?.[1] || 'null');
  const runtime = policies[0] + configs[0] + suppression.join('') + consent[0] + analytics[0];
  if (!boundPolicy || candidateExportShellFindings(runtime, {stage:boundPolicy.stage}).length) throw new Error('paid_consent_runtime_policy');
  return runtime;
}

export function renderPaidQuiz(organicDocument, assetVersion) {
  const organicDataHashes = {};
  let data;
  for (const id of IDS) {
    const matches = [...organicDocument.matchAll(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`, "g"))];
    if (matches.length !== 1) throw new Error(`organic_quiz_island_count:${id}`);
    JSON.parse(matches[0][1]);
    organicDataHashes[id] = digest(matches[0][1]);
    if (id === "phase4-quiz-data") data = JSON.parse(matches[0][1]);
  }
  const regions = [...organicDocument.matchAll(/<main\b(?=[^>]*\bclass="qz-shell")(?=[^>]*\bdata-phase4-quiz(?:\s|>))[^>]*>[\s\S]*?<\/main>/g)];
  const region = regions[0]?.[0];
  if (regions.length !== 1 || (region.match(/data-quiz-position="/g) || []).length !== 7) throw new Error("organic_quiz_region_shape");
  const assets = [];
  const example = renderCompareCard({ row: { program_id: "preview", provider: "Example program layout" }, rank: 0,
    cta: '<span class="demo-action" aria-disabled="true">Open provider’s website →</span>' })
    .replace('<p class="gcs-kicker">#0</p>', '<p class="gcs-kicker">Example layout</p>')
    .replace('Not published', 'Published price, when available')
    .replace('This provider does not publish a price we could capture. We say so rather than estimate.', 'Actual results show captured program information; unpublished details remain unknown.')
    .replace('No published price for this provider on the day we checked. We do not estimate one.', 'Reported information · source and capture date appear with published prices.')
    .replace(/<button\b[^>]*data-compare-add[\s\S]*?<\/button>/, '')
    .replace(' data-rank="0"', '').replace(' data-program="preview"', ' data-result-example aria-describedby="mock-caption"');
  let html = owned("v5-fable.html").replaceAll("{{LIVE_COUNT}}", "{{LIVE_PROVIDER_COUNT}}");
  // D2f F1: the preloads and font faces must request the same self-hosted files.
  for (const [family, file] of [["Manrope", "manrope-latin-var.woff2"], ["Source Sans 3", "source-sans-3-latin-var.woff2"]]) {
    const face = new RegExp(`(font-family: "${family}";\\s*src: )url\\("data:font/woff2;base64,[^"]+"\\)`);
    if (!face.test(html)) throw new Error("lp_font_source_unrecognized:" + family);
    html = html.replace(face, `$1url("/assets/fonts/${file}")`);
  }
  const examples = [...html.matchAll(/<article\b[^>]*data-result-example[\s\S]*?<\/article>/g)];
  if (examples.length !== 1) throw new Error("fable_v5_example_count");
  html = html.replace(examples[0][0], example);
  if (/{{(?!LIVE_PROVIDER_COUNT}})[^}]+}}/.test(html)) throw new Error("fable_v5_unresolved_token");
  // Reserve layout space for the focused skip link instead of covering .brand.
  html = html.replace("</head>", '<style>html[data-lp="quiz-entrance"] .skip-link:focus{position:static;display:block;width:fit-content;max-width:calc(100% - 32px);margin:12px 16px}</style></head>');
  html = html.replace("</head>", `<link rel="canonical" href="https://glpclinicscout.com/lp/quiz/"><meta name="referrer" content="no-referrer">${paidConsentRuntime(organicDocument, assetVersion)}</head>`);
  return {html, assets, fragments:[], fragmentHashes:{}, organicDataHashes,
    candidateCount:Object.keys(data.candidate_records).length,
    organicRegionSha256:digest(region), architecture:"fable-v5-link-to-unchanged-organic-quiz"};
}
