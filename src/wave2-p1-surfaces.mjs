import { GUIDE_RESOURCE, validGuidePath } from './guide-resource-contract.mjs';
const CONSENT_VERSION = "glp-content-upgrade-v2-20260801";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function sourceSlugForRoute(route) {
  const raw = String(route || "/").split("/").filter(Boolean).join("-") || "home";
  return raw.slice(0, 100).replace(/-+$/g, "") || "home";
}

function renderForm(sourcePage, route) {
  if (validGuidePath(route)) {
    return `<aside class="panel evidence-line inline-capture" aria-label="Email a guide link" data-p1-capture-surface data-capture-placement="guide-resource"><div class="inline-capture-grid"><div><h2>Keep a link to this guide</h2><p>Receive a link to this page so you can return to its sources and reading notes.</p></div><form action="/api/content-upgrade" method="post" data-content-upgrade-form-inline><input type="hidden" name="source_page" value="${GUIDE_RESOURCE.sourcePage}"><input type="hidden" name="lead_magnet_key" value="${GUIDE_RESOURCE.leadMagnetKey}"><input type="hidden" name="consent_version" value="${GUIDE_RESOURCE.consentVersion}"><input type="hidden" name="guide_path" value="${esc(route)}"><input type="hidden" name="request_id" value=""><div class="inline-capture-row"><label class="capture-email-field" for="guide-resource-email"><span>Email</span><input id="guide-resource-email" type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@email.com"></label></div><p class="capture-consent-note">${GUIDE_RESOURCE.consentText} <a href="/privacy/">Privacy Policy</a>.</p><button type="submit" class="cta lead">Email me a link to this guide</button><label class="capture-honeypot" aria-hidden="true">Leave blank<input type="text" name="company" tabindex="-1" autocomplete="off"></label><p class="capture-status" role="status" aria-live="polite"></p></form></div></aside>`;
  }
  const quiz = route === "/quiz/provider-fit/" || route === "/matches/customized/";
  const calculator = route === "/tools/glp-1-cost-calculator/";
  const guide = route.startsWith("/guides/");
  const heading = quiz ? "Save your matched-provider checklist" : calculator ? "Email this cost breakdown" : guide ? "Keep this source-checked guide" : "Get the 7-point provider terms checklist";
  const copy = quiz ? "Keep the terms, evidence dates, and verification questions for the providers shown in your results." : calculator ? "Keep the provider, your entered values, planning period, calculated total, published-price context, and evidence date shown in this result." : guide ? "Send this guide to your inbox so the sources and verification steps are easy to find later." : "Before choosing, check total cost, commitment, eligibility, shipping, support, cancellation, and when the information was checked.";
  const button = quiz ? "Email me my match checklist" : calculator ? "Email me this cost breakdown" : guide ? "Email me the source-checked guide" : "Email me the checklist";
  const magnet = quiz ? "match-checklist" : calculator ? "cost-breakdown" : "terms-checklist";
  const costFields = calculator ? `<input type="hidden" name="cost_breakdown_version" value="cost-breakdown-v1"><input type="hidden" name="cost_provider_id"><input type="hidden" name="cost_provider_name"><input type="hidden" name="cost_first_month_usd"><input type="hidden" name="cost_recurring_month_usd"><input type="hidden" name="cost_months"><input type="hidden" name="cost_total_usd"><input type="hidden" name="cost_price_context"><input type="hidden" name="cost_checked_as_of">` : "";
  const matchFields = quiz ? `<input type="hidden" name="match_program_ids" value="">` : "";

  const emailField = route === "/glp-1-price-index/"
    ? `<div class="inline-capture-row"><label class="visually-hidden" for="p1-capture-email-${esc(sourcePage)}">Email</label><input id="p1-capture-email-${esc(sourcePage)}" type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@email.com"></div>`
    : `<div class="inline-capture-row"><label class="capture-email-field" for="p1-capture-email-${esc(sourcePage)}"><span>Email</span><input id="p1-capture-email-${esc(sourcePage)}" type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@email.com"></label></div>`;
  return `<aside class="panel evidence-line inline-capture" aria-label="${calculator ? "Email this cost breakdown" : quiz ? "Email these provider matches" : guide ? "Email this source-checked guide" : "Free provider terms checklist"}" data-p1-capture-surface data-capture-placement="${quiz ? "quiz-results" : calculator ? "calculator-result" : "inline"}"><div class="inline-capture-grid"><div><p class="gcs-kicker">Free source-check tool</p><h2>${heading}</h2><p>${copy}</p></div><form action="/api/content-upgrade" method="post" data-content-upgrade-form-inline><input type="hidden" name="source_page" value="${esc(sourcePage)}"><input type="hidden" name="lead_magnet_key" value="${esc(sourcePage)}-${magnet}"><input type="hidden" name="consent_version" value="${CONSENT_VERSION}">${costFields}${matchFields}${emailField}<p class="capture-consent-note">By submitting your email, you agree to receive this resource and occasional provider-comparison research under the <a href="/privacy/">Privacy Policy</a>. Unsubscribe anytime.</p><button type="submit" class="cta lead">${button}</button><label class="capture-honeypot" aria-hidden="true">Leave blank<input type="text" name="company" tabindex="-1" autocomplete="off"></label><p class="capture-status" role="status" aria-live="polite"></p></form></div></aside>`;
}

const behavior = `<script data-p1-content-upgrade>(()=>{for(const surface of document.querySelectorAll('[data-p1-capture-surface]')){const form=surface.querySelector('form');const placement=surface.dataset.capturePlacement||'inline';form.addEventListener('submit',async event=>{event.preventDefault();const status=form.querySelector('.capture-status');if(placement==='calculator-result'){const selected=document.querySelector('#provider option:checked');const displayedMoney=id=>(document.querySelector(id)?.textContent||'').replace(/[$,]/g,'').trim();const fields={cost_provider_id:selected?.value||'',cost_provider_name:selected?.textContent?.trim()||'',cost_first_month_usd:displayedMoney('#result-first'),cost_recurring_month_usd:displayedMoney('#result-recurring'),cost_months:document.querySelector('#months')?.value||'',cost_total_usd:displayedMoney('#result-period'),cost_price_context:document.querySelector('#cost-context')?.textContent?.trim()||'',cost_checked_as_of:document.querySelector('#cost-checked')?.textContent?.trim()||''};for(const [name,value] of Object.entries(fields)){const input=form.elements.namedItem(name);if(input)input.value=value;}}const requestId=form.elements.namedItem('request_id');if(requestId&&!requestId.value)requestId.value=crypto.randomUUID();const payload=Object.fromEntries(new FormData(form).entries());payload.email_consent='true';window.GCSAnalytics?.event('content_upgrade_submit',{page_slug:payload.source_page,surface:placement});try{const response=await fetch(form.action,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload),referrerPolicy:'no-referrer'});const result=await response.json().catch(()=>({}));if(!response.ok){if(result.status==='CAPTURED_PROVIDER_FAILED'){status.textContent='Saved, but email delivery failed. Please try again later.';return}throw new Error(result.status||'request_failed')}const delivered=result.status==='CAPTURED'&&result.send==='sent';const held=result.status==='CAPTURED_SENDS_HELD';if(!delivered&&!held)throw new Error('unexpected_capture_status');status.textContent=delivered?(placement==='guide-resource'?'Done — your guide link was emailed.':placement==='calculator-result'?'Done — your cost breakdown was emailed.':'Done — your checklist was emailed.'):'Saved — email delivery is not active yet.';form.reset();window.GCSAnalytics?.event('content_upgrade_success',{page_slug:payload.source_page,surface:placement});window.GCSAnalytics?.event('content_upgrade_complete',{page_slug:payload.source_page});}catch(error){status.textContent=error.message==='CONTENT_UPGRADE_CAPTURE_HELD'?'This request is temporarily unavailable. Please try again later.':'We could not save that request. Please try again.';}});}const retake=document.querySelector('[data-p1-quiz-retake]');if(retake)retake.addEventListener('click',()=>{const result=document.querySelector('#result');const questions=document.querySelector('#quiz-questions');const steps=[...document.querySelectorAll('#quiz-questions .question')];if(result)result.hidden=true;if(questions)questions.hidden=false;steps.forEach((step,index)=>step.hidden=index!==0);document.querySelector('[data-role="quiz-back"]')?.setAttribute('hidden','');steps[0]?.querySelector('.option,select')?.focus();});})();</script>`;

function normalizeExistingContentUpgrade(html) {
  const consent = `<div class="capture-consents"><p class="capture-consent-note">By submitting your email, you agree to receive this checklist and occasional provider-comparison research under the <a href="/privacy/">Privacy Policy</a>. Unsubscribe anytime.</p></div>`;
  const passiveConsent = `<p class="capture-consent-note">By submitting your email, you agree to receive this checklist and occasional provider-comparison research under the <a href="/privacy/">Privacy Policy</a>. Unsubscribe anytime.</p>`;
  const visibleCaptureConsentCheckbox = /<input\b(?=[^>]*\btype=["']checkbox["'])(?=[^>]*\bname=["'](?:email_consent|marketing_consent|privacy_consent|subscribe_consent)["'])[^>]*>/i;
  const submitEvent = "window.GCSAnalytics?.event('content_upgrade_submit',{page_slug:payload.source_page,surface:form.hasAttribute('data-content-upgrade-form-inline')?'inline':'modal'});";
  const successEvent = "window.GCSAnalytics?.event('content_upgrade_success',{page_slug:slug,surface:form.hasAttribute('data-content-upgrade-form-inline')?'inline':'modal'});";
  let normalized = html
    .replaceAll("glp-content-upgrade-v1-20260724", CONSENT_VERSION)
    .replace(/<div class="capture-consents">[\s\S]*?<\/div>/g, consent)
    // O-28 late-audit repair: some preserved pages predate the capture-consents
    // wrapper and carry one checkbox directly inside a label. Submission itself
    // is the consent event, so retain a passive privacy/unsubscribe notice while
    // removing every visible email-capture consent control. Review attestations
    // and health gates use different names and remain untouched.
    .replace(/<label\b[^>]*>[\s\S]*?<\/label>/gi, (label) => visibleCaptureConsentCheckbox.test(label) ? passiveConsent : label)
    .replace(/<input\b(?=[^>]*\btype=["']checkbox["'])(?=[^>]*\bname=["'](?:email_consent|marketing_consent|privacy_consent|subscribe_consent)["'])[^>]*>/gi, "")
    .replace(/const payload=Object\.fromEntries\(new FormData\(form\)\.entries\(\)\);(?!payload\.email_consent='true';)/g, "const payload=Object.fromEntries(new FormData(form).entries());payload.email_consent='true';")
    .replace(/(<div class="inline-capture-row">[\s\S]*?)(<button\b[\s\S]*?<\/button>)(<\/div>)(<div class="capture-consents">[\s\S]*?<\/div>)/g, "$1$3$4$2")
    .replaceAll(submitEvent, "")
    .replaceAll(successEvent, "")
    .replace("window.GCSAnalytics&&window.GCSAnalytics.event&&window.GCSAnalytics.event('content_upgrade_complete',{page_slug:slug})", "window.GCSAnalytics?.event('content_upgrade_complete',{page_slug:slug})")
    .replace(/>(?:Save request|Send me the checklist|Send the checklist)<\/button>/g, ">Email me the checklist</button>");
  if (!normalized.includes("data-p1-content-upgrade")) normalized = normalized
    .replace("try{const response=await fetch(form.action", `${submitEvent}try{const response=await fetch(form.action`)
    .replace("window.GCSAnalytics?.event('content_upgrade_complete',{page_slug:slug})", `${successEvent}window.GCSAnalytics?.event('content_upgrade_complete',{page_slug:slug})`);
  return normalized;
}

export function addP1ContentUpgradeSurface(html, relative = "") {
  if (typeof html !== "string" || !/<link\s+rel="canonical"/i.test(html)) return html;
  // Replace this producer's carried-forward guide form before the generic
  // legacy normalizer can reintroduce bundled marketing consent.
  const guideRoute = html.match(/<link\s+rel="canonical" href="https:\/\/glpclinicscout\.com([^"#?]*)/i)?.[1];
  if (validGuidePath(guideRoute)) {
    html = html.replace(/<aside\b[^>]*data-p1-capture-surface[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<script\b[^>]*data-p1-content-upgrade[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*data-p1-capture-resilience[^>]*>[\s\S]*?<\/script>/gi, '');
    // Unknown legacy forms must be reconciled, never silently retained.
    if (/action=["']\/api\/content-upgrade["']/i.test(html)) throw new Error('guide_legacy_capture_requires_reconciliation');
  }
  let normalized = normalizeExistingContentUpgrade(html);
  if (/action="\/api\/content-upgrade"/i.test(normalized)) return normalized;
  const fallback = relative === "index.html" ? "/" : relative.endsWith("/index.html") ? `/${relative.slice(0,-"index.html".length)}` : "/";
  const route = normalized.match(/<link\s+rel="canonical" href="https:\/\/glpclinicscout\.com([^"#?]*)/i)?.[1] || fallback;
  if (/^\/(?:clinics|directory|privacy|terms|unsubscribe|google-ads-api|404)(?:\/|$)/.test(route)) return html;
  if (route === "/quiz/provider-fit/") normalized = normalized
    .replace(/<form id="lead-form"[\s\S]*?<\/form>/, "")
    .replace(/document\.querySelector\('#lead-form'\)\.addEventListener\('submit',event=>event\.preventDefault\(\)\)/, "")
    .replace('<p class="gcs-note">Not medical advice.', '<button type="button" class="gcs-button secondary" data-p1-quiz-retake>Change my answers</button><a class="gcs-button secondary" href="/quiz/provider-fit/?restart=1" data-role="quiz-restart">Start over</a><p class="gcs-note">Not medical advice.');
  const form = renderForm(sourceSlugForRoute(route), route);
  let withForm;
  /* Phase 4 quiz has no #result section; anchor inside the (hidden-until-
     finish) results shell so the capture only ever appears AFTER results
     render — never mid-quiz (operator order 2026-08-26). */
  const phase4Start = normalized.indexOf('<section class="qz-result-shell');
  const legacyStart = normalized.indexOf('<section id="result"');
  const resultStart = (route === "/quiz/provider-fit/" || route === "/matches/customized/") ? (legacyStart >= 0 ? legacyStart : phase4Start) : -1;
  if (resultStart >= 0) {
    const resultEnd = normalized.indexOf("</section>", resultStart);
    if (resultEnd < 0) throw new Error("quiz_result_capture_insertion_point_missing");
    withForm = `${normalized.slice(0, resultEnd)}${form}${normalized.slice(resultEnd)}`;
  } else if (route === "/tools/glp-1-cost-calculator/") {
    const result = normalized.indexOf('<aside id="cost-result"');const end = normalized.indexOf("</aside>",result);
    if (result < 0 || end < 0) throw new Error("calculator_result_capture_insertion_point_missing");
    withForm = `${normalized.slice(0,end)}${form}${normalized.slice(end)}`;
  } else if (route.startsWith("/guides/")) {
    const headings=[...normalized.matchAll(/<h2\b/gi)];const second=headings[1]?.index;const end=second==null?-1:normalized.indexOf("</section>",second);
    if (end < 0) withForm = normalized.replace("</main>", `${form}</main>`);
    else withForm = `${normalized.slice(0,end+10)}${form}${normalized.slice(end+10)}`;
  } else if (normalized.includes("</main>")) {
    withForm = normalized.replace("</main>", `${form}</main>`);
  } else {
    return normalized;
  }
  return withForm.replace("</body>", `${behavior}<script src="/assets/content-capture-resilient.js" defer data-p1-capture-resilience></script></body>`);
}

export function addP1IntentBridge(html) {
  const route = html.match(/<link\s+rel="canonical" href="https:\/\/glpclinicscout\.com([^"#?]*)/i)?.[1];
  const bridges = {
    "/guides/healthrx-vs-agelessrx/": ["/compare/healthrx-vs-agelessrx/", "See the commercial price-and-service comparison", "HealthRX vs AgelessRx: Billing Evidence Guide"],
    "/compare/healthrx-vs-agelessrx/": ["/guides/healthrx-vs-agelessrx/", "Read the billing-terms research guide", "HealthRX vs AgelessRx: Price & Service Comparison"],
    "/guides/wellorithm-vs-enhance-md/": ["/compare/wellorithm-vs-enhance-md/", "See the commercial recurring-cost comparison", "Wellorithm vs Enhance.MD: Pricing Evidence Guide"],
    "/compare/wellorithm-vs-enhance-md/": ["/guides/wellorithm-vs-enhance-md/", "Read the first-month pricing research guide", "Wellorithm vs Enhance.MD: Recurring Cost Comparison"],
  };
  const bridge = bridges[route];
  if (!bridge || !html.includes("</main>")) return html;
  const panel = `<aside class="panel evidence-line p1-intent-bridge" aria-label="Related comparison"><p class="gcs-kicker">Different intent, same providers</p><p>This page keeps its stated research angle. For the sibling angle, <a href="${bridge[0]}">${bridge[1]}</a>.</p></aside>`;
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${bridge[2]}</title>`)
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, `<h1>${bridge[2]}</h1>`)
    .replace("</main>", `${panel}</main>`);
}

export function addP1AffiliatePreconnect(html) {
  // An affiliate anchor is not permission to contact its network on page load.
  // Also remove this finalizer's old hints from carried-forward documents.
  return html.replace(/<link\s+rel="(?:preconnect|dns-prefetch)"\s+href="(?:https:)?\/\/track\.revoffers\.com"[^>]*>/gi, "");
}

export function applyWave2P1Surfaces(html, relative = "") {
  return addP1AffiliatePreconnect(addP1ContentUpgradeSurface(addP1IntentBridge(html), relative));
}

export const wave2P1SurfaceContract = Object.freeze({
  consentVersion: CONSENT_VERSION,
  oneVisibleConsentCheckbox: false,
  requiredRoutes: ["/quiz/provider-fit/", "/tools/glp-1-cost-calculator/", "/guides/"],
  cannibalizationPairs: 2,
});
