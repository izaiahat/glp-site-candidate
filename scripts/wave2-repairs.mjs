import { pageSeoCopy } from "../src/page-seo-copy.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { scoreProvider } from "../src/money-page.mjs";

const SITE = "https://glpclinicscout.com";
const COMMERCIAL_ROUTE = /^\/(?:reviews|compare|best|cost)\//;
const REVIEW_INTAKE_ROUTE = "/reviews/submit/";
const REVIEW_INTAKE_RUNTIME = new URL("../assets/review-intake.js", import.meta.url);

const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const text = (value) => String(value ?? "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
const sourceBackedText = (value, fallback) => {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "UNKNOWN_NO_SOURCE" ? normalized : fallback;
};
const pageFile = (publicDir, route) => path.join(publicDir, route.replace(/^\//, ""), "index.html");

export function isEditorialReviewDetailRoute(route) {
  return /^\/reviews\/[a-z0-9-]+\/$/.test(String(route || "")) && route !== REVIEW_INTAKE_ROUTE;
}

export function finalizeReviewIntakeHtml(html, route = REVIEW_INTAKE_ROUTE) {
  if (route !== REVIEW_INTAKE_ROUTE) return html;
  return String(html)
    .replace(/<section\b[^>]*class="[^"]*\breview-depth-supplement\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<section\b[^>]*class="[^"]*\breview-depth\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<section\b[^>]*class="[^"]*\b(?:related-coverage|comparison-next-steps)\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (script) => /window\.GCS_ANALYTICS\s*=/.test(script) ? "" : script)
    .replace(/<script\b[^>]*\bsrc="[^"]*\/assets\/analytics(?:\.[a-f0-9]{8,})?\.js(?:\?[^\"]*)?"[^>]*>\s*<\/script>/gi, "");
}

export async function finalizeReviewIntakeRoute({ publicDir }) {
  const routeFile = pageFile(publicDir, REVIEW_INTAKE_ROUTE);
  const before = await readFile(routeFile, "utf8");
  const after = finalizeReviewIntakeHtml(before);
  await writeFile(routeFile, after);
  const runtime = await readFile(REVIEW_INTAKE_RUNTIME, "utf8");
  const runtimeTarget = path.join(publicDir, "assets", "review-intake.js");
  await mkdir(path.dirname(runtimeTarget), { recursive: true });
  await writeFile(runtimeTarget, runtime);
  return {
    route: REVIEW_INTAKE_ROUTE,
    removedBytes: Buffer.byteLength(before) - Buffer.byteLength(after),
    runtimeBytes: Buffer.byteLength(runtime),
    hasGeneratedAudit: /How to audit the captured/i.test(after),
    hasAnalyticsRuntime: /\/assets\/analytics(?:\.[a-f0-9]{8,})?\.js/i.test(after),
  };
}

function titleFrom(html, route) {
  const h1 = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const title = text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  return h1 || title || route;
}

function descriptionFrom(html) {
  return text(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1]) || "This page records the published evidence and the limits of that evidence.";
}

function sourceAnchors(html) {
  const ids = [...html.matchAll(/\bid="(source-\d+)"/gi)].map((match) => match[1]);
  return [...new Set(ids)].slice(0, 8);
}

function sourceRefs(ids) {
  if (!ids.length) return "the source notes already listed on this page";
  return ids.map((id, index) => `<a class="inline-citation" href="#${esc(id)}" aria-label="Source ${index + 1}">${index + 1}</a>`).join(" ");
}

function profileFor(route, html, reviews) {
  const review = reviews.get(route);
  const provider = review?.provider || titleFrom(html, route).replace(/\s+(?:Review|review).*$/, "").trim();
  const row = review?.row || {};
  const limits = [...new Set([...(row.cons || []), ...(row.limitations || [])])];
  const strengths = [...new Set(row.pros || [])];
  const checkedCandidate = review?.date_modified || review?.date_published || text(html.match(/(?:Checked|Updated|Data current through)\s+([^<.]+)/i)?.[1]);
  return {
    provider,
    route,
    summary: descriptionFrom(html),
    price: sourceBackedText(row.starting_price, "The captured page does not establish a separate all-in recurring price statement beyond the evidence already shown above."),
    product: sourceBackedText(row.meds_offered, "The captured page does not establish a complete product, formulation, or service inventory beyond the wording already shown above."),
    coverage: sourceBackedText(row.insurance, "The captured page does not establish a complete insurance, reimbursement, or payment-support policy."),
    workflow: sourceBackedText(row.average_wait, "The captured page does not establish a complete review, fulfillment, or delivery timeline."),
    fit: row.best_for || "Readers who want to inspect the cited public record and verify unresolved terms directly before making a purchase decision.",
    bottomLine: row.bottom_line || "The page is an evidence record, not a recommendation, outcome claim, or statement that the reviewed option is suitable for a particular person.",
    strengths: strengths.length ? strengths : ["The page identifies the public source used for the review.", "The page keeps the limits of the captured evidence visible instead of filling them with estimates."],
    limits: limits.length ? limits : ["Current price, availability, eligibility, and final terms require direct confirmation.", "The cited record does not establish clinical outcomes, individual suitability, or a comparative quality rating."],
    checked: /^\d{4}-\d{2}-\d{2}$/.test(checkedCandidate || "") ? checkedCandidate : "Verification date not established",
    citations: sourceAnchors(html),
    ratingValue: review ? (() => {
      const value = scoreProvider(row);
      return Number.isFinite(value) ? Number((value / 10).toFixed(1)) : null;
    })() : null,
  };
}

function reviewTitle(provider) {
  const full = `${provider} Review 2026: Costs, Terms & Evidence`;
  return full.length <= 60 ? full : `${provider} Review 2026`;
}

function faqItems(profile) {
  const provider = profile.provider;
  return [
    { q: `What price does the ${provider} evidence establish?`, a: `The captured wording is “${profile.price}” It is a dated source record, not a final quote; cadence, supply, inclusions, and later charges remain unknown unless stated.` },
    { q: `What does the ${provider} review say is included?`, a: `The captured product or service wording is “${profile.product}” Confirm the exact product, service scope, and fulfillment entity directly before payment.` },
    { q: `Does ${provider} accept insurance?`, a: `The captured coverage wording is “${profile.coverage}” Coverage, reimbursement, HSA or FSA eligibility, and prior authorization remain plan- and administrator-specific.` },
    { q: `How long does the ${provider} process take?`, a: `The captured process wording is “${profile.workflow}” Ask which event starts each clock and which stages can pause before treating it as an end-to-end timeline.` },
    { q: `How should I compare ${provider} with alternatives?`, a: `Compare the same evidence fields: first and recurring charges, cadence, inclusions, commitment, cancellation, shipping, and source date. An unknown field should remain unknown rather than receive a favorable score.` },
    { q: `Is the ${provider} score a medical-quality rating?`, a: profile.ratingValue === null ? `No numeric overall score is published for this evidence record. The page does not rate outcomes, safety, or individual suitability.` : `No. The published ${profile.ratingValue}/10 score measures the page's commercial-evidence rubric, not outcomes, safety, clinician quality, or individual suitability.` },
  ];
}

export function normalizeReviewMetadata(html, profile) {
  const seo = pageSeoCopy(profile.route);
  const title = seo?.title ?? reviewTitle(profile.provider);
  const h1 = seo?.h1 ?? title;
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`)
    .replace(/(<h1\b[^>]*>)[\s\S]*?(<\/h1>)/i, (_, open, close) => `${open}${esc(h1)}${close}`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, (match, open, close) => seo ? `${open}${esc(seo.meta)}${close}` : match);
}

function reviewDepth(profile, alternatives) {
  const p = esc(profile.provider);
  const citations = sourceRefs(profile.citations);
  const cite = `<span class="review-depth-citations">${citations}</span>`;
  const strengths = profile.strengths.map((item) => `<li>${esc(item)} ${cite}</li>`).join("");
  const limits = profile.limits.map((item) => `<li>${esc(item)} ${cite}</li>`).join("");
  const alternativeRows = alternatives.map((item) => `<tr><td><a href="${esc(item.route)}">${esc(item.label)}</a></td><td>Compare the dated sources, pricing and terms, including details that remain unknown.</td></tr>`).join("");
  const faq = faqItems(profile);
  const faqHtml = faq.map((item) => `<details><summary>${esc(item.q)}</summary><p>${esc(item.a)} ${cite}</p></details>`).join("");
  return `<section class="panel evidence-line review-depth" aria-labelledby="review-depth-title">
    <p class="gcs-kicker">Extended evidence audit</p>
    <h2 id="review-depth-title">What the ${p} record establishes—and what it does not</h2>
    <p>${esc(profile.summary)} That sentence is the scope of this review, not a promise about ${p}. The evidence set was checked through ${esc(profile.checked)} and is limited to the sources already identified on this page. Public pages can change after capture, so every amount, policy, availability statement, and workflow detail remains a dated record rather than a quote. ${cite}</p>
    <p>This extended audit keeps three categories separate: wording the cited source publishes, questions the source leaves unresolved, and decisions that require a licensed professional or a current written provider response. It does not infer a clinician, pharmacy, medication, result, reviewer rating, or discount that the cited material does not establish. That boundary is especially important when a short marketing phrase could otherwise be mistaken for an all-in commercial or clinical promise. ${cite}</p>

    <h3>${p} evidence snapshot</h3>
    <dl class="facts"><div><dt>Reported price wording</dt><dd>${esc(profile.price)}</dd></div><div><dt>Product or service wording</dt><dd>${esc(profile.product)}</dd></div><div><dt>Coverage wording</dt><dd>${esc(profile.coverage)}</dd></div><div><dt>Process wording</dt><dd>${esc(profile.workflow)}</dd></div></dl>
    <table class="review-pricing-evidence"><caption>${p} dated pricing-evidence record</caption><thead><tr><th>Evidence field</th><th>Captured wording</th><th>Checked</th></tr></thead><tbody><tr><td>Reported price wording</td><td>${esc(profile.price)}</td><td>${esc(profile.checked)}</td></tr><tr><td>Cadence, supply, and inclusions</td><td>Use only the wording above; unstated fields remain unknown.</td><td>${esc(profile.checked)}</td></tr></tbody></table>
    <p>The snapshot above is deliberately literal. For ${p}, a published starting figure is not automatically a monthly total, a product mention is not proof of eligibility, and a shipping phrase is not the same as a complete timeline. The review therefore carries the exact captured language forward and treats cadence, supply period, included services, later charges, and destination-specific availability as unknown unless the cited record states them. ${cite}</p>
    <p>Readers should compare the snapshot with the source page before payment. Ask whether the wording still appears, whether a new condition or footnote has been added, and whether the amount applies to the exact product, dose, route, plan, or service being discussed. If checkout or intake contradicts this dated record, the current written term controls the transaction; the discrepancy should also be submitted through Clinic Scout's correction channel. ${cite}</p>

    <h3>How to read ${p} pricing without inventing a total</h3>
    <p>The captured price evidence for ${p} is: “${esc(profile.price)}” This review does not convert that wording into a recurring estimate when frequency, supply duration, inclusions, dose rules, or later-period pricing are absent. It also does not assume that consultation, laboratory work, supplies, shipping, membership, taxes, or follow-up are included. Each of those items is a separate verification question because combining them without direct evidence would create a price claim the source did not make. ${cite}</p>
    <p>A practical written quote should identify the first charge, every recurring charge, the billing cadence, the amount of product or service attached to each charge, the minimum commitment, renewal behavior, cancellation deadline, refund terms, and any charge that can change with dose or state. Keep a copy of that quote and the checkout terms. This is purchasing discipline, not a prediction that ${p} will impose any particular charge. ${cite}</p>

    <h3>Product and service wording for ${p}</h3>
    <p>The captured product or service language is: “${esc(profile.product)}” That wording is preserved without upgrading it into a claim about approval, equivalence, efficacy, safety, availability, or suitability. A brand reference, ingredient name, category label, test description, supplement description, or program name can answer what a page discusses; it cannot by itself prove what a person will receive or whether a licensed professional will consider it appropriate. ${cite}</p>
    <p>Before relying on the ${p} record, request the exact product or service name, formulation or specification where relevant, dispensing or fulfillment entity, licensed-review sequence where relevant, state or destination restrictions, substitutions policy, and the route for urgent or technical questions. If the current source does not answer one of those questions, “not stated” is the correct editorial result. The review does not fill a source gap with general industry practice. ${cite}</p>

    <h3>Eligibility, review, and fulfillment boundaries</h3>
    <p>The captured workflow language for ${p} is: “${esc(profile.workflow)}” This is not expanded into an end-to-end timeline unless the source defines the starting event and each stage. Intake completion, clinician review, prescription decision, pharmacy processing, carrier pickup, laboratory processing, manufacturing, and final delivery can describe different clocks. A single speed phrase cannot safely represent all of them, and no timeline establishes eligibility or an outcome. ${cite}</p>
    <p>Ask ${p} what event starts each clock, which stages can pause for records or payment, how status updates are delivered, and what remedy exists after delay, failed delivery, damaged goods, an unusable specimen, or a changed recommendation. Those questions are presented as a checklist, not as allegations that any failure has occurred. A clear answer should be retained in writing with the order or enrollment record. ${cite}</p>

    <h3>Coverage and payment questions</h3>
    <p>The captured coverage statement is: “${esc(profile.coverage)}” The review does not translate benefits checks, reimbursement language, HSA or FSA wording, superbills, prior-authorization help, or general insurance references into guaranteed coverage. Plan rules, account-administrator decisions, medical-necessity criteria, coding, deductibles, and exclusions can change the result. Where the source is silent, the honest status remains unresolved. ${cite}</p>
    <p>For ${p}, request the cash price and any insurance-dependent price separately. Confirm whether payment is collected before eligibility or professional review, what happens after denial, whether reimbursement paperwork is supplied, and whether cancellation or refund terms differ after a service begins. This checklist does not imply that ${p} offers each payment path; it identifies the missing facts a reader needs before treating a headline amount as the final obligation. ${cite}</p>

    <h3>Documented strengths and tradeoffs</h3>
    <p>Clinic Scout records strengths only when they arise from the captured page evidence or from the page's transparent handling of missing evidence. For ${p}, the documented positives are:</p><ul>${strengths}</ul>
    <p>These points do not become a star rating, medical-quality score, outcome measure, or endorsement. They describe what was comparatively useful in the inspected record. A source can be clear about one field and silent about another, so the review keeps field-level evidence separate instead of letting one visible term create a broad positive impression. ${cite}</p>
    <p>The same discipline applies to tradeoffs. For ${p}, the current record preserves:</p><ul>${limits}</ul>
    <p>A limitation means that the cited record cannot support a stronger statement. It is not proof that the service is poor, unavailable, unsafe, or unsuitable. It is a prompt to verify the field directly and to compare the written answer with alternatives using the same standard. ${cite}</p>

    <h3>Who may find this ${p} review useful</h3>
    <p>The evidence-navigation fit recorded for this page is: “${esc(profile.fit)}” That is a description of the research task, not a clinical-fit recommendation. A reader who values visible sources and explicit unknowns may use the page to prepare questions. Someone who requires a verified all-in amount, a confirmed delivery date, an independent outcome dataset, or a guaranteed eligibility decision should not treat this page alone as sufficient. ${cite}</p>
    <p>${esc(profile.bottomLine)} The page cannot choose a treatment, test, supplement, or service for the reader. For health-related decisions, discuss personal risks, alternatives, and follow-up with an appropriately licensed professional. For purchasing decisions, compare written terms, cancellation rights, privacy handling, and the identity of every entity involved before submitting payment or sensitive information. ${cite}</p>

    <h3>A source-first verification sequence for ${p}</h3>
    <ol><li>Open each cited source and confirm that the relevant wording remains visible.</li><li>Save the page date, URL, screenshots, and any checkout or intake terms that affect cost or eligibility.</li><li>List every field that remains “not stated,” including cadence, supply, inclusions, timing, availability, and refund rules where applicable.</li><li>Send those questions to ${p} and request answers in writing before payment.</li><li>Compare the written response with the public wording and ask for clarification when they differ.</li><li>Do not infer clinical quality, outcomes, or individual suitability from commercial transparency.</li></ol>
    <p>This sequence makes the review reproducible. Another reader can start with the same captured claims, inspect the same source notes, and see where a later page changed. It also keeps correction work precise: a correction should identify the statement, the current first-party source, and the date observed rather than replacing one unsupported claim with another. ${cite}</p>
    <p>Source checking is intentionally narrower than a full provider audit. Clinic Scout did not independently verify every license, pharmacy relationship, laboratory accreditation, product lot, customer experience, or outcome for ${p} through this page. The absence of such verification is not a negative finding; it simply marks the boundary of this editorial artifact. ${cite}</p>

    <h3>Questions to retain after enrollment or purchase</h3>
    <p>If a reader proceeds with ${p}, the evidence task continues after checkout. Retain receipts, consent forms, product or service descriptions, fulfillment records, cancellation instructions, privacy notices, and the contact route for problems. Check whether the delivered or scheduled item matches the written order. Record any changed price or term with its date and source so that a concern can be investigated without relying on memory. ${cite}</p>
    <p>For recurring arrangements, confirm the next billing date, refill or reorder trigger, dose or specification changes, required follow-up, pause options, cancellation cutoff, and the consequences of a failed payment or missed step. These are general recordkeeping questions, not claims about ${p}'s actual policy. The provider's current written terms and applicable law determine the answer. ${cite}</p>

    <h3>Alternative evidence records</h3>
    <table class="review-alternatives"><caption>Other provider records reviewed under the same evidence rules</caption><thead><tr><th>Record</th><th>How to use it</th></tr></thead><tbody>${alternativeRows}</tbody></table>

    <h3>Frequently asked questions about the ${p} evidence</h3>
    <div class="review-faq">${faqHtml}</div>

    <h3>Editorial conclusion for the captured ${p} record</h3>
    <p>Use the dated sources above to compare the published details and identify questions that remain unanswered. ${profile.ratingValue === null ? `It cannot create a reviewer score, aggregate rating, clinician endorsement, guaranteed savings figure, outcome claim, or individualized recommendation. The structured Review therefore remains rating-free.` : `Its published ${esc(profile.ratingValue)}/10 editorial score measures only the stated commercial-evidence rubric. It is not an aggregate customer rating, clinical-quality score, outcome claim, or individualized recommendation.`} ${cite}</p>
    <p>Use the ${p} review as a documented starting point. Recheck the direct source, obtain the exact current terms, and stop when an important answer remains unclear. Clear unknowns are more useful than confident estimates: they tell the reader what must be verified before cost, access, timing, product, or support can be compared responsibly. ${cite}</p>
  </section>`;
}

function addReviewSchema(html, profile) {
  const url = `${SITE}${profile.route}`;
  const author = { "@type": "Organization", name: "Clinic Scout Editorial Team", url: `${SITE}/authors/clinic-scout-editorial-team/` };
  let hasProduct = false;
  let hasReview = false;
  let hasFaq = false;
  const visit = (value) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.includes("Product")) hasProduct = true;
    if (types.includes("Review")) {
      hasReview = true;
      value.author = value.author || author;
      if (profile.ratingValue !== null) value.reviewRating = { "@type": "Rating", ratingValue: profile.ratingValue, bestRating: 10, worstRating: 0 };
    }
    if (types.includes("FAQPage")) hasFaq = true;
    Object.values(value).forEach(visit);
  };
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (script, raw) => {
    try { const data = JSON.parse(raw); visit(data); return `<script type="application/ld+json">${JSON.stringify(data)}</script>`; }
    catch { return script; }
  });
  if (hasProduct && hasReview && hasFaq) return html;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      ...(!hasProduct ? [{ "@type": "Product", "@id": `${url}#reviewed-product`, name: profile.provider, url, category: "Reviewed provider program" }] : []),
      ...(!hasReview ? [{ "@type": "Review", "@id": `${url}#editorial-review`, name: `${profile.provider} editorial review`, url, author, itemReviewed: { "@id": `${url}#reviewed-product` }, reviewBody: profile.summary, datePublished: profile.checked, dateModified: profile.checked, ...(profile.ratingValue !== null ? { reviewRating: { "@type": "Rating", ratingValue: profile.ratingValue, bestRating: 10, worstRating: 0 } } : {}) }] : []),
      ...(!hasFaq ? [{ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: faqItems(profile).map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })) }] : []),
    ],
  };
  return html.replace("</head>", `<script type="application/ld+json">${JSON.stringify(graph)}</script></head>`);
}

function relatedCoverage(route, targets, labels) {
  const index = targets.indexOf(route);
  // Window widened from 10 with the READY6 routes added to `targets`: a fixed
  // window over a larger target set would have pushed non-READY6 routes below the
  // ten-distinct-inbound-source floor (drhouse fell to 7).
  const selected = Array.from({ length: 15 }, (_, offset) => targets[(index + offset + 1) % targets.length]);
  const items = selected.map((target) => {
    const kind = target.startsWith("/reviews/") ? "Provider evidence review" : target.startsWith("/compare/") ? "Side-by-side evidence comparison" : target.startsWith("/cost/") ? "Cost evidence page" : "Best-of evidence page";
    return `<li><a href="${esc(target)}"><span class="gcs-kicker">${kind}</span><strong>${esc(labels.get(target))}</strong><small>See the dated sources, limitations and questions to ask next.</small></a></li>`;
  }).join("");
  return `<section class="panel evidence-line comparison-next-steps" aria-labelledby="comparison-next-steps-title"><p class="gcs-kicker">Compare your next option</p><h2 id="comparison-next-steps-title">Keep narrowing the shortlist</h2><p>Open another provider or cost comparison to check price, inclusions, and unresolved terms side by side.</p><ul class="grid">${items}</ul></section>`;
}

async function writeRoute(publicDir, route, html) {
  const file = pageFile(publicDir, route);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
}

// 2026-08-06 coverage repair (G5): the READY6 clean-room routes are rewritten from
// frozen bytes after this pass, so they are not EDITABLE here - but they are live,
// monetized, indexable commercial pages, and excluding them from the link universe
// left all six (coivas, shed, breezemeds, mangorx, direct-meds, sprout-health) with
// zero inbound links while every other review page had 10-13. They are link TARGETS
// here even though they are not edited.
export async function applyWave2Repairs({ publicDir, indexableRoutes, providerReviews, linkTargetRoutes = [] }) {
  const reviews = new Map(providerReviews.map((review) => [review.path, review]));
  const commercial = indexableRoutes.filter((route) => COMMERCIAL_ROUTE.test(route)).sort();
  const editable = new Set(commercial);
  const linkOnly = linkTargetRoutes.filter((route) => COMMERCIAL_ROUTE.test(route) && !editable.has(route));
  const linkTargets = [...new Set([...commercial, ...linkOnly])].sort();
  const labels = new Map();
  const htmlByRoute = new Map();
  for (const route of linkTargets) {
    const html = await readFile(pageFile(publicDir, route), "utf8");
    if (editable.has(route)) htmlByRoute.set(route, html);
    labels.set(route, titleFrom(html, route));
  }
  for (const route of commercial) {
    let html = htmlByRoute.get(route);
    html = html
      .replace(/<section class="panel evidence-line review-depth"[\s\S]*?<\/section>/g, "")
      .replace(/<section class="panel evidence-line (?:related-coverage|comparison-next-steps)"[\s\S]*?<\/section>/g, "");
    if (isEditorialReviewDetailRoute(route)) {
      const profile = profileFor(route, html, reviews);
      const reviewRoutes = linkTargets.filter((target) => isEditorialReviewDetailRoute(target));
      const currentIndex = reviewRoutes.indexOf(route);
      const alternatives = Array.from({ length: 3 }, (_, offset) => reviewRoutes[(currentIndex + offset + 1) % reviewRoutes.length]).map((target) => ({ route: target, label: labels.get(target) }));
      html = normalizeReviewMetadata(html, profile);
      html = addReviewSchema(html, profile).replace("</main>", `${reviewDepth(profile, alternatives)}</main>`);
    }
    html = html.replace("</main>", `${relatedCoverage(route, linkTargets, labels)}</main>`);
    await writeRoute(publicDir, route, html);
  }
  await finalizeReviewIntakeRoute({ publicDir });
}
