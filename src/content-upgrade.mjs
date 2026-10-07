import { resendContactsEnabled, syncResendContact } from "./resend-contacts.mjs";
import { GUIDE_RESOURCE, validGuidePath } from './guide-resource-contract.mjs';
import { canonicalContactStatements, runCanonicalContactStatements } from "./canonical-contact.mjs";
import { COST_AFFILIATE_EMAIL_MANIFEST } from "./cost-affiliate-email-manifest.generated.mjs";

const COST_BREAKDOWN_KEYS = Object.freeze(["cost_breakdown_version", "cost_provider_id", "cost_provider_name", "cost_first_month_usd", "cost_recurring_month_usd", "cost_months", "cost_total_usd", "cost_price_context", "cost_checked_as_of"]);
const MATCH_PROGRAM_IDS_KEY = "match_program_ids";
const ALLOWED_KEYS = new Set(["email", "first_name", "source_page", "lead_magnet_key", "email_consent", "privacy_consent", "marketing_consent", "consent_version", "company", "guide_path", "request_id", MATCH_PROGRAM_IDS_KEY, ...COST_BREAKDOWN_KEYS]);
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{1,100}$/;
const CONSENT_VERSION = "glp-content-upgrade-v2-20260801";
const LEGACY_CONSENT_VERSION = "glp-content-upgrade-v1-20260724";
export const CONTENT_UPGRADE_CONSENT_COPY_SHA256 = "b5f9cf33ed141d1cf433d4d8eb30669dd5c57bd24ba5b9c943725937a99606cb";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM_ADDRESS = "hello@glpclinicscout.com";
const DEFAULT_FROM_NAME = "Clinic Scout";
const DEFAULT_SITE_ORIGIN = "https://glpclinicscout.com";
const SAFE_TRACKING_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function buildCostAffiliateOfferMap(manifest) {
  if (manifest?.schema !== "glp-cost-affiliate-email-manifest-v1" || !Array.isArray(manifest.programs)) return new Map();
  const offers = new Map();
  for (const row of manifest.programs) {
    if (!SAFE_SLUG.test(row?.program_id || "") || offers.has(row.program_id) || typeof row.merchant !== "string" || !row.merchant.trim()) return new Map();
    try {
      const url = new URL(row.affiliate_href);
      if (
        url.protocol !== "https:"
        || url.username
        || url.password
        || !SAFE_TRACKING_HOST.test(row.tracking_host || "")
        || url.hostname !== row.tracking_host
      ) return new Map();
      offers.set(row.program_id, Object.freeze({
        programId: row.program_id,
        merchant: row.merchant.trim(),
        affiliateHref: url.toString(),
        reviewPath: row.review_path,
        network: row.network || null,
      }));
    } catch { return new Map(); }
  }
  return offers;
}

const COST_AFFILIATE_OFFERS = buildCostAffiliateOfferMap(COST_AFFILIATE_EMAIL_MANIFEST);

// Content-upgrade lead magnets are all "provider terms checklist" variants today
// (lead_magnet_key === `${source_page}-terms-checklist`). Resolve the transactional
// template by lead_magnet_key so new magnets can be added without touching the send
// path. Unknown keys return null and the send is skipped + logged (never sent blind).
const CONTENT_UPGRADE_TEMPLATES = Object.freeze({
  "terms-checklist": Object.freeze({
    subject: "Your 7-point GLP-1 provider terms checklist",
    preheader: "Check cost, commitment, eligibility, shipping, support, cancellation, and evidence dates before you choose."
  }),
  "cost-breakdown": Object.freeze({
    subject: "Your GLP-1 cost breakdown",
    preheader: "The provider, entered values, planning period, total, price context, and evidence date from your calculator result."
  }),
  "match-checklist": Object.freeze({
    subject: "Your three matched GLP-1 providers",
    preheader: "Your rule-based shortlist, with first-party links to review current terms."
  })
});

function esc(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function resolveContentUpgradeTemplate(leadMagnetKey) {
  const key = String(leadMagnetKey || "");
  if (key === GUIDE_RESOURCE.leadMagnetKey) return { templateKey: 'guide-link', subject: 'Your requested guide link' };
  if (key.startsWith('guides-')) return null;
  const templateKey = key.endsWith("-match-checklist") ? "match-checklist" : key.endsWith("-terms-checklist") ? "terms-checklist" : key.endsWith("-cost-breakdown") ? "cost-breakdown" : null;
  if (!templateKey || !CONTENT_UPGRADE_TEMPLATES[templateKey]) return null;
  return { templateKey, ...CONTENT_UPGRADE_TEMPLATES[templateKey] };
}

// Branded transactional email. Email-client constraints rule the markup: nested tables,
// per-element inline styles, no external CSS/images/webfonts, bulletproof-button CTA.
function contentUpgradeEmailHtml({ template, unsubscribeUrl, origin = DEFAULT_SITE_ORIGIN, capture }) {
  if (template.templateKey === 'guide-link') {
    if (!validGuidePath(capture?.guidePath)) throw new Error('guide_path_invalid');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f7f5ef;color:#193047;font:15px/1.55 Arial,sans-serif"><main style="max-width:600px;margin:auto;padding:24px;background:#fff"><p>GLP CLINIC SCOUT</p><h1>Your requested guide link</h1><p><a href="${esc(origin)}${esc(capture.guidePath)}" style="color:#3f6f63">Open the guide you requested</a></p><p>This is the link you requested, not a subscription to follow-up emails.</p><p style="font-size:12px">GLP Clinic Scout, operated by Tilton Group LLC · 2108 N St, Ste N · Sacramento, CA 95816</p><p><a href="${esc(origin)}/privacy/">Privacy Policy</a></p></main></body></html>`;
  }
  if (template.templateKey === "match-checklist") {
    const matches = capture?.matchPrograms;
    if (!Array.isArray(matches) || matches.length !== 3) throw new Error("match_programs_missing");
    const rows = matches.map((match, index) => {
      const goUrl = `${origin}/go/${encodeURIComponent(match.programId)}?s=email-glp.match&v=a`;
      return `<tr><td style="padding:16px 0;border-bottom:1px solid #d8ded9"><p style="margin:0 0 5px;color:#617067;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Match ${index + 1}</p><p style="margin:0 0 10px;color:#10233b;font-size:18px;font-weight:800">${esc(match.merchant)}</p><a href="${esc(goUrl)}" style="display:inline-block;color:#2f6658;font-weight:800;text-decoration:underline">Review current terms &rarr;</a></td></tr>`;
    }).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head><body style="margin:0;padding:24px;background:#f3f1ea;font:400 15px/1.55 Arial,Helvetica,sans-serif;color:#193047"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(template.preheader)}</div><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:auto;background:#ffffff;border:1px solid #d8ded9;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 32px;background:#10233b;color:#ffffff"><strong style="letter-spacing:.1em">GLP CLINIC SCOUT</strong></td></tr><tr><td style="padding:28px 32px"><h1 style="margin:0 0 10px;color:#10233b;font-size:24px">Your three matched providers</h1><p style="margin:0 0 18px;color:#52645b">These are the same three rule-based matches shown after your quiz. They are not medical advice or a clinical recommendation. Verify current pricing, eligibility, medication, and service terms before choosing.</p><p style="margin:0 0 8px;padding:12px 14px;background:#eef5f1;border-radius:10px;color:#324a40;font-size:13px"><strong>Affiliate disclosure:</strong> Clinic Scout may earn a commission if you use a link below, at no extra cost to you. These records preserve the supplied quiz-match order; they are not medical recommendations.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table><p style="margin:24px 0 0"><a href="${esc(origin)}/quiz/provider-fit/" style="color:#2f6658;font-weight:800">Retake the provider-fit quiz</a> &middot; <a href="${esc(origin)}/providers/" style="color:#2f6658;font-weight:800">Browse all providers</a></p></td></tr><tr><td style="padding:18px 32px 26px;border-top:1px solid #d8ded9;color:#5a6b7d;font-size:12px"><p style="margin:0 0 8px">Not medical advice. Provider details can change; verify current terms directly.</p><p style="margin:0 0 8px">GLP Clinic Scout, operated by Tilton Group LLC &middot; 2108 N St, Ste N &middot; Sacramento, CA 95816</p><p style="margin:0"><a href="${esc(origin)}/" style="color:#2f6658">Visit GLP Clinic Scout</a> &middot; <a href="${esc(unsubscribeUrl)}" style="color:#2f6658">Unsubscribe</a> &middot; <a href="${esc(origin)}/privacy/" style="color:#2f6658">Privacy</a></p></td></tr></table></body></html>`;
  }
  if (template.templateKey === "cost-breakdown") {
    const breakdown = capture?.costBreakdown;
    if (!breakdown) throw new Error("cost_breakdown_missing");
    const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
    const rows = [
      ["Provider", breakdown.providerName],
      ["First month", money(breakdown.firstMonthUsd)],
      ["Monthly after that", money(breakdown.recurringMonthUsd)],
      ["Planning period", `${breakdown.months} month${breakdown.months === 1 ? "" : "s"}`],
      ["Calculated planning total", money(breakdown.totalUsd)],
      ["Published-price context", breakdown.priceContext],
      ["Evidence checked", breakdown.checkedAsOf]
    ].map(([label, value]) => `<tr><th align="left" style="padding:10px;border-bottom:1px solid #e3ded2;color:#10233b">${esc(label)}</th><td style="padding:10px;border-bottom:1px solid #e3ded2;color:#193047">${esc(value)}</td></tr>`).join("");
    const offer = breakdown.affiliateOffer
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px"><tr><td align="center" style="border-radius:10px;background:#3f6f63"><a href="${esc(breakdown.affiliateOffer.affiliateHref)}" rel="sponsored nofollow noopener" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:800">Start with ${esc(breakdown.affiliateOffer.merchant)} &rarr;</a></td></tr></table><p style="margin:0;color:#5a6b7d;font-size:12px">Affiliate disclosure: Clinic Scout may earn a commission if you enroll through this link, at no extra cost to you. This does not change the estimate or our editorial conclusions.</p>`
      : "";
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f7f5ef;font:400 15px/1.55 Arial,Helvetica,sans-serif;color:#193047"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:auto;background:#fff;border:1px solid #e3ded2;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 32px;background:#10233b;color:#fff"><strong>GLP CLINIC SCOUT</strong></td></tr><tr><td style="padding:28px 32px"><h1 style="margin:0 0 10px;color:#10233b">Your cost breakdown</h1><p>These are the provider and calculator inputs from your submitted result. They are a planning snapshot, not a quote; verify current prices and terms before purchasing.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>${offer}<p style="margin:24px 0 0"><a href="${esc(origin)}/tools/glp-1-cost-calculator/" style="color:#3f6f63;font-weight:800">Reopen the calculator</a></p></td></tr><tr><td style="padding:18px 32px 26px;border-top:1px solid #e3ded2;color:#5a6b7d;font-size:12px"><p>Not medical advice. Provider details can change; verify current terms directly.</p><p>GLP Clinic Scout, operated by Tilton Group LLC &middot; 2108 N St, Ste N &middot; Sacramento, CA 95816</p><p><a href="${esc(unsubscribeUrl)}">Unsubscribe</a> &middot; <a href="${esc(origin)}/privacy/">Privacy</a></p></td></tr></table></body></html>`;
  }
  const points = [
    ["Total all-in monthly cost", "Medication, consult, and any platform fees on one line."],
    ["Commitment length and cancellation terms", "Month-to-month vs. annual, and exactly how to cancel."],
    ["Eligibility requirements", "What the provider asks for before prescribing."],
    ["Medication form and what is included", "Brand vs. compounded, dose changes, refills."],
    ["Shipping timeframes and fees", "How fast, how tracked, and what it costs."],
    ["Clinician review and ongoing support", "Who reviews your intake and how you reach them."],
    ["Evidence dates", "When the provider last published or updated the price you are comparing."]
  ];
  const ink = "#10233b", green = "#3f6f63", paper = "#f7f5ef", line = "#e3ded2", muted = "#5a6b7d";
  const rows = points.map(([title, detail], index) => `<tr><td style="padding:0 0 14px;vertical-align:top;width:44px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="width:30px;height:30px;border-radius:50%;background:${green};color:#ffffff;font:800 14px/30px Arial,Helvetica,sans-serif">${index + 1}</td></tr></table></td><td style="padding:2px 0 14px;vertical-align:top;font:400 15px/1.55 Arial,Helvetica,sans-serif;color:#193047"><strong style="display:block;font-size:15px;color:${ink}">${esc(title)}</strong><span style="color:${muted};font-size:14px">${esc(detail)}</span></td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${paper}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(template.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${paper}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;border-radius:18px;overflow:hidden;background:#ffffff;border:1px solid ${line}">
<tr><td style="background:${ink};padding:24px 32px"><p style="margin:0;font:800 19px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.12em;color:#ffffff">GLP CLINIC SCOUT</p><p style="margin:6px 0 0;font:600 12px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.04em;color:#9fc2b4;text-transform:uppercase">Independent GLP-1 provider comparisons</p></td></tr>
<tr><td style="padding:32px 32px 8px"><h1 style="margin:0 0 10px;font:800 23px/1.25 Arial,Helvetica,sans-serif;color:${ink}">Your 7-point provider terms checklist</h1><p style="margin:0 0 22px;font:400 15px/1.6 Arial,Helvetica,sans-serif;color:${muted}">Run every provider through the same seven checks before you choose — the same evidence fields our comparison scores are built on.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
<tr><td align="center" style="padding:8px 32px 30px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border-radius:10px;background:${green}"><a href="${esc(origin)}/" style="display:inline-block;padding:14px 26px;font:800 15px/1 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">Compare current provider terms &rarr;</a></td></tr></table></td></tr>
<tr><td style="padding:0 32px"><hr style="border:0;border-top:1px solid ${line};margin:0"></td></tr>
<tr><td style="padding:18px 32px 26px"><p style="margin:0 0 8px;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${muted}">Not medical advice. Provider details can change &mdash; verify current terms directly before purchasing. Some links on our site are affiliate links; check the ordering method stated for each comparison. Payment is not evidence of quality, safety or medical suitability.</p><p style="margin:0 0 8px;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${muted}">GLP Clinic Scout, operated by Tilton Group LLC &middot; 2108 N St, Ste N &middot; Sacramento, CA 95816</p><p style="margin:0;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${muted}"><a href="${esc(unsubscribeUrl)}" style="color:${green}">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="${esc(origin)}/privacy/" style="color:${green}">Privacy</a></p></td></tr>
</table></td></tr></table></body></html>`;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

function checked(value) {
  return value === true || value === "true";
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeBreakdownText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${field}_invalid`);
  return text;
}

function breakdownMoney(value, field, max = 250000) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) throw new Error(`${field}_invalid`);
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > max) throw new Error(`${field}_invalid`);
  return amount;
}

function validateCostBreakdown(payload) {
  if (payload.cost_breakdown_version !== "cost-breakdown-v1") throw new Error("cost_breakdown_version_invalid");
  const providerId = String(payload.cost_provider_id || "").trim();
  if (!SAFE_SLUG.test(providerId)) throw new Error("cost_provider_id_invalid");
  const providerName = safeBreakdownText(payload.cost_provider_name, "cost_provider_name", 100);
  const firstMonthUsd = breakdownMoney(payload.cost_first_month_usd, "cost_first_month_usd", 10000);
  const recurringMonthUsd = breakdownMoney(payload.cost_recurring_month_usd, "cost_recurring_month_usd", 10000);
  const monthsText = String(payload.cost_months || "").trim();
  if (!/^\d{1,2}$/.test(monthsText)) throw new Error("cost_months_invalid");
  const months = Number(monthsText);
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new Error("cost_months_invalid");
  const totalUsd = breakdownMoney(payload.cost_total_usd, "cost_total_usd");
  const expected = Number((firstMonthUsd + recurringMonthUsd * Math.max(0, months - 1)).toFixed(2));
  if (Math.abs(totalUsd - expected) > 0.001) throw new Error("cost_total_mismatch");
  const priceContext = safeBreakdownText(payload.cost_price_context, "cost_price_context", 300);
  const checkedAsOf = String(payload.cost_checked_as_of || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAsOf)) throw new Error("cost_checked_as_of_invalid");
  return { version: "cost-breakdown-v1", providerId, providerName, firstMonthUsd, recurringMonthUsd, months, totalUsd, priceContext, checkedAsOf, affiliateOffer: COST_AFFILIATE_OFFERS.get(providerId) || null };
}

function validateMatchPrograms(payload) {
  const ids = String(payload[MATCH_PROGRAM_IDS_KEY] || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (ids.length !== 3 || new Set(ids).size !== 3) throw new Error("match_program_ids_invalid");
  const matches = ids.map((programId) => {
    if (!SAFE_SLUG.test(programId)) throw new Error("match_program_ids_invalid");
    const offer = COST_AFFILIATE_OFFERS.get(programId);
    if (!offer) throw new Error("match_program_not_governed");
    return Object.freeze({ programId: offer.programId, merchant: offer.merchant, reviewPath: offer.reviewPath });
  });
  return Object.freeze(matches);
}

export function validateContentUpgrade(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload_invalid");
  if (Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key))) throw new Error("payload_key_not_allowed");
  if (String(payload.company || "").trim()) throw new Error("bot_rejected");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("email_invalid");
  const sourcePage = String(payload.source_page || "").trim();
  if (!SAFE_SLUG.test(sourcePage)) throw new Error("source_page_invalid");
  const leadMagnetKey = String(payload.lead_magnet_key || "").trim();
  if (sourcePage.startsWith('guides-')) throw new Error('legacy_guide_capture_rejected');
  if (sourcePage === GUIDE_RESOURCE.sourcePage || leadMagnetKey === GUIDE_RESOURCE.leadMagnetKey) {
    if (sourcePage !== GUIDE_RESOURCE.sourcePage || leadMagnetKey !== GUIDE_RESOURCE.leadMagnetKey) throw new Error('guide_resource_key_invalid');
    const guideKeys = new Set(['email', 'source_page', 'lead_magnet_key', 'email_consent', 'consent_version', 'company', 'guide_path', 'request_id']);
    if (Object.keys(payload).some(key => !guideKeys.has(key))) throw new Error('guide_resource_field_not_allowed');
    if (!checked(payload.email_consent)) throw new Error('required_consent_missing');
    if (payload.consent_version !== GUIDE_RESOURCE.consentVersion) throw new Error('consent_version_invalid');
    if (!validGuidePath(payload.guide_path)) throw new Error('guide_path_invalid');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.request_id || '')) throw new Error('request_id_invalid');
    return { email, firstName: '', sourcePage, leadMagnetKey, consentVersion: GUIDE_RESOURCE.consentVersion, resourceOnly: true, guidePath: payload.guide_path, requestId: payload.request_id };
  }
  if (Object.hasOwn(payload, 'guide_path') || Object.hasOwn(payload, 'request_id')) throw new Error('guide_resource_field_not_allowed');
  const isCostBreakdown = leadMagnetKey === `${sourcePage}-cost-breakdown`;
  const isMatchChecklist = leadMagnetKey === `${sourcePage}-match-checklist`;
  if (!isCostBreakdown && !isMatchChecklist && leadMagnetKey !== `${sourcePage}-terms-checklist`) throw new Error("lead_magnet_key_invalid");
  const suppliedCostFields = COST_BREAKDOWN_KEYS.filter((key) => Object.hasOwn(payload, key));
  if (isCostBreakdown && sourcePage !== "tools-glp-1-cost-calculator") throw new Error("cost_breakdown_source_invalid");
  if (isMatchChecklist && sourcePage !== "quiz-provider-fit") throw new Error("match_checklist_source_invalid");
  if (!isMatchChecklist && Object.hasOwn(payload, MATCH_PROGRAM_IDS_KEY)) throw new Error("match_program_ids_not_allowed");
  if (!isCostBreakdown && suppliedCostFields.length) throw new Error("cost_breakdown_not_allowed");
  if (isCostBreakdown && suppliedCostFields.length !== COST_BREAKDOWN_KEYS.length) throw new Error("cost_breakdown_incomplete");
  const costBreakdown = isCostBreakdown ? validateCostBreakdown(payload) : null;
  const matchPrograms = isMatchChecklist ? validateMatchPrograms(payload) : null;
  const singleConsent = checked(payload.email_consent);
  const legacyConsent = checked(payload.privacy_consent) && checked(payload.marketing_consent);
  if (!singleConsent && !legacyConsent) throw new Error("required_consent_missing");
  const expectedVersion = singleConsent ? CONSENT_VERSION : LEGACY_CONSENT_VERSION;
  if (payload.consent_version !== expectedVersion) throw new Error("consent_version_invalid");
  const firstName = String(payload.first_name || "").trim().replace(/\s+/g, " ");
  if (firstName.length > 60 || /[\u0000-\u001f\u007f]/.test(firstName)) throw new Error("first_name_invalid");
  return { email, firstName, sourcePage, leadMagnetKey, consentVersion: expectedVersion, costBreakdown, matchPrograms };
}

async function rateLimit(env, request) {
  const key = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.LEAD_RATE_LIMITER?.limit) {
    const result = await env.LEAD_RATE_LIMITER.limit({ key: `content-upgrade:${key}` });
    return Boolean(result?.success);
  }
  if (env.CONTENT_UPGRADE_CAPTURE_MODE === "local_test") return true;
  if (!env.GLP_DB?.prepare) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`content-upgrade|${key}`));
  const keyHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const windowStart = Math.floor(Date.now() / 60000);
  try {
    const row = await env.GLP_DB.prepare("INSERT INTO request_rate_limits (scope, key_hash, window_start, request_count, updated_at) VALUES ('content-upgrade', ?, ?, 1, ?) ON CONFLICT(scope, key_hash, window_start) DO UPDATE SET request_count=request_count+1, updated_at=excluded.updated_at RETURNING request_count").bind(keyHash, windowStart, new Date().toISOString()).first();
    return Number(row?.request_count || 0) <= 5;
  } catch { return false; }
}

export async function handleContentUpgradeRequest(request, env, fetchImpl = globalThis.fetch) {
  if (request.method !== "POST") return json(405, { status: "METHOD_NOT_ALLOWED" });
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) return json(415, { status: "CONTENT_TYPE_REQUIRED" });
  if (Number(request.headers.get("content-length") || 0) > 4096) return json(413, { status: "PAYLOAD_TOO_LARGE" });
  const receipt = env.CONTENT_UPGRADE_CAPTURE_RECEIPT_SHA256 || "";
  const productionGate = env.CONTENT_UPGRADE_CAPTURE_MODE === "production_operator_approved" && /^[a-f0-9]{64}$/.test(receipt) && env.CONTENT_UPGRADE_CAPTURE_GATE === `operator-approved:${receipt}`;
  const captureOnlyMode = ["local_test", "enabled"].includes(env.CONTENT_UPGRADE_CAPTURE_MODE);
  if (!captureOnlyMode && !productionGate) return json(503, { status: "CONTENT_UPGRADE_CAPTURE_HELD" });
  if (!(await rateLimit(env, request))) return json(429, { status: "RATE_LIMITED" });
  let payload;
  try { payload = await request.json(); } catch { return json(400, { status: "JSON_INVALID" }); }
  let capture;
  try { capture = validateContentUpgrade(payload); } catch (error) { return json(400, { status: error.message }); }
  if (!env.GLP_DB?.prepare) return json(503, { status: "STORAGE_UNAVAILABLE" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`content-upgrade|${capture.email}|${capture.sourcePage}`));
  const subscriberId = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const unsubscribeToken = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const createdAt = new Date().toISOString();
  const consentSource = capture.costBreakdown || capture.matchPrograms
    ? JSON.stringify({ source_page: capture.sourcePage, lead_magnet_key: capture.leadMagnetKey, ...(capture.costBreakdown ? { cost_breakdown: capture.costBreakdown } : {}), ...(capture.matchPrograms ? { match_program_ids: capture.matchPrograms.map((match) => match.programId) } : {}) })
    : `${capture.sourcePage}:${capture.leadMagnetKey}`;
  try {
    const statements = canonicalContactStatements(env.GLP_DB, {
      subscriberId,
      email: capture.email,
      firstName: capture.firstName,
      funnelStage: "content-upgrade",
      sourceSurface: `content-upgrade/${capture.sourcePage}`,
      sourceContext: { lead_magnet_key: capture.leadMagnetKey, ...(capture.costBreakdown ? { cost_breakdown: capture.costBreakdown } : {}), ...(capture.matchPrograms ? { match_program_ids: capture.matchPrograms.map((match) => match.programId) } : {}) },
      marketingConsent: !capture.resourceOnly,
      purpose: capture.resourceOnly ? 'resource-delivery' : 'marketing',
      consentVersion: capture.consentVersion,
      consentSource,
      consentCopySha256: capture.resourceOnly ? await sha256Text(GUIDE_RESOURCE.consentText) : CONTENT_UPGRADE_CONSENT_COPY_SHA256,
      idempotencyKey: capture.resourceOnly ? `resource:${subscriberId}:${capture.requestId}` : `marketing:${subscriberId}:content-upgrade/${capture.sourcePage}:${capture.consentVersion}`,
      capturedAt: createdAt,
      unsubscribeToken,
    });
    const results = await runCanonicalContactStatements(env.GLP_DB, statements);
    if (results.some((result) => result?.success === false)) throw new Error("insert_failed");
  } catch {
    return json(503, { status: "STORAGE_FAILED" });
  }
  // Capture is durable at this point. Provider work remains separately gated.
  if (!resendContactsEnabled(env)) {
    return json(202, { status: "CAPTURED_SENDS_HELD", subscriber_id: subscriberId, lead_magnet_key: capture.leadMagnetKey });
  }
  let send;
  try {
    send = await deliverContentUpgrade({ env, capture, subscriberId, unsubscribeToken }, fetchImpl);
  } catch (error) {
    send = { status: "send_error", error: String(error?.message || error), resend_email: null, resend_contact: null };
  }
  const providerReceipts = { email: send.resend_email || null, contact: send.resend_contact || null };
  const emailAccepted = send.resend_email?.status === "sent";
  const body = {
    status: emailAccepted ? "CAPTURED" : "CAPTURED_PROVIDER_FAILED",
    subscriber_id: subscriberId,
    lead_magnet_key: capture.leadMagnetKey,
    send: send.status,
    warnings: send.warnings || [],
    provider_receipts: providerReceipts,
  };
  return json(emailAccepted ? 202 : 502, body);
}

// Best-effort delivery log. Reuses the existing email_deliveries D1 contract so send
// outcomes are auditable and the EPC/webhook machinery can reconcile them later.
// Wrapped so a logging failure can never propagate into the capture response.
async function logContentUpgradeDelivery(env, { subscriberId, leadMagnetKey, requestId = null, status, resendEmailId = null }) {
  if (!env?.GLP_DB?.prepare) return;
  const now = new Date().toISOString();
  const deliveryId = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const idempotencyKey = `content-upgrade/${subscriberId}/${requestId || leadMagnetKey}`.slice(0, 256);
  const campaignId = `content-upgrade-${leadMagnetKey}`.slice(0, 200);
  const sentAt = status === "sent" ? now : null;
  const failedAt = status === "failed" ? now : null;
  try {
    await env.GLP_DB.prepare("INSERT OR IGNORE INTO email_deliveries (delivery_id, idempotency_key, subscriber_id, vertical, funnel_stage, message_type, sequence_step, campaign_id, resend_email_id, status, created_at, sent_at, failed_at) VALUES (?, ?, ?, 'glp-clinic-scout', 'content-upgrade', 'content-upgrade-magnet', NULL, ?, ?, ?, ?, ?, ?)")
      .bind(deliveryId, idempotencyKey, subscriberId, campaignId, resendEmailId, status, now, sentAt, failedAt).run();
  } catch { /* logging is best-effort; never blocks or fails the capture */ }
}

// Env-gated Resend delivery for a captured content-upgrade subscriber. The
// requested email is attempted first, then the same address is synchronized
// into the shared global Contacts DB. Both provider receipts are returned.
export async function deliverContentUpgrade({ env, capture, subscriberId, unsubscribeToken }, fetchImpl = globalThis.fetch) {
  if (!resendContactsEnabled(env)) return { status: "sends_held", resend_email: null, resend_contact: null };
  const resourceOnly = capture.leadMagnetKey === GUIDE_RESOURCE.leadMagnetKey;
  if (String(capture.leadMagnetKey || '').startsWith('guides-')) return { status: 'send_no_template', resend_email: null, resend_contact: null };
  // Public delivery export must enforce this even for callers bypassing capture.
  if (resourceOnly && (!capture.resourceOnly || !validGuidePath(capture.guidePath) || !capture.requestId)) throw new Error('guide_resource_capture_invalid');
  const syncContact = () => resourceOnly ? Promise.resolve({ status: 'not_requested', contact_id: null }) : syncResendContact({ env, email: capture.email }, fetchImpl);
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    await logContentUpgradeDelivery(env, { subscriberId, leadMagnetKey: capture.leadMagnetKey, status: "failed" });
    const resendContact = await syncContact();
    return {
      status: "send_misconfigured",
      reason: "missing_api_key",
      resend_email_id: null,
      contact_id: null,
      resend_email: { status: "failed", endpoint: RESEND_EMAILS_ENDPOINT, http_status: null, email_id: null, reason: "missing_api_key" },
      resend_contact: resendContact,
    };
  }
  const template = resolveContentUpgradeTemplate(capture.leadMagnetKey);
  if (!template) {
    await logContentUpgradeDelivery(env, { subscriberId, leadMagnetKey: capture.leadMagnetKey, status: "failed" });
    return { status: "send_no_template", resend_email_id: null, contact_id: null, resend_email: null, resend_contact: null };
  }

  const fromAddress = env.RESEND_FROM_ADDRESS || DEFAULT_FROM_ADDRESS;
  const fromName = env.RESEND_FROM_NAME || DEFAULT_FROM_NAME;
  const origin = env.SITE_ORIGIN || DEFAULT_SITE_ORIGIN;
  const unsubscribeUrl = `${origin}/unsubscribe?token=${encodeURIComponent(unsubscribeToken || "")}`;
  const idempotencyKey = `content-upgrade/${subscriberId}/${resourceOnly ? capture.requestId : template.templateKey}`.slice(0, 256);
  let resendEmail = { status: "failed", endpoint: RESEND_EMAILS_ENDPOINT, http_status: null, email_id: null, reason: "transport_error" };
  try {
    const response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey, "User-Agent": "clinic-scout-content-upgrade/1.0" },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [capture.email],
        ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {}),
        subject: template.subject,
        html: contentUpgradeEmailHtml({ template, unsubscribeUrl, origin, capture }),
        headers: resourceOnly ? { "X-Entity-Ref-ID": idempotencyKey } : { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Entity-Ref-ID": idempotencyKey }
      })
    });
    const data = await response.json().catch(() => ({}));
    const emailId = typeof data?.id === "string" && data.id ? data.id : null;
    resendEmail = {
      status: response.ok && emailId ? "sent" : "failed",
      endpoint: RESEND_EMAILS_ENDPOINT,
      http_status: response.status,
      email_id: emailId,
      reason: response.ok && emailId ? null : response.ok ? "provider_receipt_invalid" : "provider_rejected",
    };
  } catch { /* the explicit failed receipt above remains */ }

  const resendContact = await syncContact();
  const deliveryStatus = resendEmail.status === "sent" ? "sent" : "failed";
  await logContentUpgradeDelivery(env, {
    subscriberId,
    leadMagnetKey: capture.leadMagnetKey,
    requestId: capture.requestId,
    status: deliveryStatus,
    resendEmailId: resendEmail.email_id,
  });

  const status = resendEmail.status === "sent" ? "sent" : "send_failed";
  const warnings = !resourceOnly && resendEmail.status === "sent" && resendContact.status !== "synced"
    ? [{ code: "CONTACT_SYNC_FAILED", retryable: Boolean(resendContact.retryable) }]
    : [];
  return {
    status,
    warnings,
    resend_email_id: resendEmail.email_id,
    contact_id: resendContact.contact_id,
    resend_email: resendEmail,
    resend_contact: resendContact,
  };
}

export const contentUpgradeCapturePolicy = Object.freeze({
  storedFields: ["email", "source_page", "lead_magnet_key", "email_consent", "consent_version", "cost_breakdown_if_requested", "match_program_ids_if_requested", "created_at"],
  forbiddenFields: ["phone", "state", "bmi", "weight", "current_medications", "diagnosis", "medical_history", "quiz_answers"],
  emailSends: "resend_env_gated",
  emailSendsAuthorizedByDefault: false,
  emailConsentRequired: true,
  providerSharing: false,
  storageBinding: "GLP_DB",
  launchGate: "operator",
  captureGate: "CONTENT_UPGRADE_CAPTURE_MODE",
  emailSendGate: "RESEND_ENABLED",
  emailSendProvider: "resend",
  contactsGate: "RESEND_ENABLED",
  optionalSegment: "RESEND_SEGMENT_ID",
  providerFailureResponse: "explicit_502_only_when_requested_email_is_not_accepted_after_durable_capture",
  contactSyncFailureResponse: "nonfatal_warning_after_email_acceptance",
  gracefulContactSyncDegradation: true,
  gracefulSendDegradation: false,
});
