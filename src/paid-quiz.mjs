import { createHash } from "node:crypto";
import { candidateExportPolicyMarkup } from "./candidate-export-policy.mjs";
export { renderPaidQuiz } from "./paid-landing.mjs";

const IDS = Object.freeze(["phase4-quiz-data", "candidate-data", "quiz-ranking", "pass2-quiz-data"]);
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const digest = (value) => createHash("sha256").update(value).digest("hex");

// Reconcile the historical parts seam around CURRENT rendered bytes. The organic
// renderer, questions, ranking, registries and four data producers stay unchanged.
// Retired W3/W6 implementation, intentionally not exported or called. The active
// producer above emits only the parent-chosen ordinary link-through entrance.
function renderLegacyInlinePaidQuiz(organicDocument, assetVersion) {
  const fragments = IDS.map((id) => {
    const expression = new RegExp(`<script type="application/json" id="${id}">[\\s\\S]*?<\\/script>`, "g");
    const matches = [...organicDocument.matchAll(expression)];
    if (matches.length !== 1) throw new Error(`paid_quiz_island_count:${id}`);
    const html = '<meta name="robots" content="noindex,follow">' + matches[0][0] + '<footer>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</footer>';
    return { id, route: `/lp/quiz/data/${id}/`, file: `lp/quiz/data/${id}/index.html`, html, sha256: digest(html) };
  });
  const region = organicDocument.match(/<main class="qz-shell" data-phase4-quiz>[\s\S]*?<\/main>/)?.[0];
  if (!region || (region.match(/data-quiz-position="/g) || []).length !== 7) throw new Error("paid_quiz_region_shape");
  const data = JSON.parse(fragments[0].html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
  const candidateCount = Object.keys(data.candidate_records).length;
  const hashes = Object.fromEntries(fragments.map(({ id, sha256 }) => [id, sha256]));
  const contacts = [...region.matchAll(/<section\b[^>]*data-position-id="contact"[^>]*>[\s\S]*?<\/section>/g)];
  if (contacts.length !== 1) throw new Error("paid_quiz_contact_shape");
  const contact = contacts[0][0];
  const paidContact = contact.replace(/<h2\b[\s\S]*?(?=<p class="qz-error")/, '<h2 id="qz-title-6" tabindex="-1">Ready to compare your matches</h2><p class="qz-help">No contact details are collected here. Continue to your source-backed matches.</p>');
  if (paidContact === contact || /data-quiz-input="(?:email|first_name)"/.test(paidContact)) throw new Error("paid_quiz_contact_removal_failed");
  const paidRegion = region.replace(contact, paidContact)
    .replace('<strong>In-progress answers stay on this device.</strong> Never sent to analytics. Subscribing sends only Position 7’s disclosed fields to Clinic Scout, not providers.', '<strong>Your answers are processed and saved in this browser.</strong> Use “Start over and clear saved answers” to remove saved quiz progress. This paid quiz has no contact or subscription form. Providers decide clinical eligibility.');
  if (paidRegion.includes('Position 7’s') || paidRegion.includes('Never sent to analytics.')) throw new Error("paid_quiz_privacy_copy_migration_failed");
  const mounted = paidRegion.replace('<main class="qz-shell" data-phase4-quiz>', `<section class="qz-shell" data-phase4-quiz hidden tabindex="-1" aria-label="Provider-fit questionnaire" data-quiz-page-slug="lp-quiz" data-quiz-slot="lp-quiz.lp1" data-quiz-fragments="${esc(JSON.stringify(fragments.map((f) => f.route)))}" data-quiz-fragment-hashes="${esc(JSON.stringify(hashes))}">`).replace(/<\/main>$/, "</section>");
  const html = `<!doctype html><html lang="en" data-release="local-candidate-not-deployed"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><meta name="referrer" content="no-referrer"><title>Compare GLP-1 programs around what matters to you · Clinic Scout</title><meta name="description" content="Seven questions, then up to three programs to research. No email required for your results. This is a comparison, not a medical eligibility decision."><link rel="canonical" href="https://glpclinicscout.com/lp/quiz/"><link rel="icon" href="/assets/brand/favicon.svg"><link rel="stylesheet" href="/assets/site-tools.css?v=${assetVersion}"><link rel="stylesheet" href="/assets/paid-quiz.css?v=${assetVersion}"><script src="/assets/quiz-page.js?v=${assetVersion}" defer></script><script src="/assets/paid-quiz.js?v=${assetVersion}" defer></script></head><body data-paid-funnel="route-quiz"><a class="skip-link" href="#main">Skip to main content</a><header class="pq-brand"><a href="/">Clinic Scout</a><span>Independent research · Tilton Group LLC</span></header><main id="main" tabindex="-1"><section class="pq-intro" data-paid-intro><p class="gcs-kicker">Independent GLP-1 program comparison</p><h1>Compare programs around what matters to you.</h1><p class="pq-lede">Seven questions, then up to three programs to research. A licensed clinician still makes every medical decision.</p><ul class="pq-facts"><li>No email required for results</li><li>Sources and dates on the cards</li><li>No paid placement</li></ul><p class="pq-disclosure affiliate-disclosure">Clinic Scout is reader-supported. Some result links are sponsored, and we may earn a commission if you sign up. Check the ordering method stated for each comparison; payment is not evidence of quality, safety or medical suitability. <a href="/how-we-make-money/">How we make money</a>.</p><a class="begin pq-start" href="/quiz/provider-fit/" data-lp-quiz-start>Find programs to compare</a><p><a href="/providers/?sort=cheapest">Or compare providers without the quiz</a></p><p class="pq-status" role="status" aria-live="polite" data-paid-status></p><details><summary>What the quiz does and does not do</summary><p>The current quiz pool contains ${candidateCount} program records before your answers are applied. Source gaps and review-only records remain visible. Your shortlist may contain fewer than three matches, including none.</p><p>Questions cover your preferences, current program, state and optional email updates. This is not a diagnosis, medical recommendation or guarantee of eligibility. For adults 18 and over.</p></details></section>${mounted}<aside class="pq-privacy" aria-label="Tracking and storage status" data-paid-privacy><strong>Optional analytics and advertising tags are off on this page.</strong><p>Starting this quiz does not grant tracking consent. In-progress answers are saved on this device by the existing quiz; use “Start over and clear saved answers” to remove them. Results do not require an email address. Optional subscription has its own disclosed fields and choices. Other pages have separate tracking behavior. <a href="/privacy/">Privacy details</a>.</p></aside></main><footer class="pq-footer"><p>Consumer research, not medical advice. Clinic Scout does not prescribe or sell medication.</p><p>Tilton Group LLC</p><nav aria-label="Legal"><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/privacy/cookies/#do-not-sell-or-share">Cookie and sharing choices</a></nav></footer></body></html>`;
  const contactFreeHtml = html
    .replace("</head>", `${candidateExportPolicyMarkup}<script src="/assets/consent.js?v=${assetVersion}" defer></script></head>`)
    .replace("<p>Tilton Group LLC</p>", "<p>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</p>")
    .replace("Questions cover your preferences, current program, state and optional email updates.", "Questions cover your preferences, current program and state.")
    .replace("Optional subscription has its own disclosed fields and choices.", "No subscription is offered on this paid page.")
    .replace("Other pages have separate tracking behavior.", "This local candidate also holds optional third-party analytics on its shared review pages. Following a provider link leaves Clinic Scout and is subject to that provider’s privacy practices.");
  return { html: contactFreeHtml, fragments, candidateCount, organicRegionSha256: digest(region), fragmentHashes: hashes };
}
