import { CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES, COST_CALCULATOR_CAPTURE } from "./site-capture-consent-sources.mjs";
import { onboardingRuntimeGate, ONBOARDING_ELIGIBILITY_SQL } from './onboarding-consent.mjs';
import { syncResendContact } from './resend-contacts.mjs';

const RESEND_API = "https://api.resend.com/emails";
const EMAIL_STATUS_EVENTS = new Set(["email.sent", "email.delivered", "email.delivery_delayed", "email.failed", "email.opened", "email.clicked", "email.bounced", "email.complained", "email.suppressed"]);
const CLINIC_SCOUT_SENDER_DOMAIN = "glpclinicscout.com";
const CLINIC_SCOUT_FROM_IDENTITY = "GLP Clinic Scout <izaiah@glpclinicscout.com>";
const CLINIC_SCOUT_POSTAL_ADDRESS = "Tilton Group LLC · 2108 N St, Ste N · Sacramento, CA 95816";
const CONTENT_UPGRADE_CONSENT_VERSIONS = new Set(["glp-content-upgrade-v1-20260724", "glp-content-upgrade-v2-20260801"]);
const QUIZ_LEAD_CONSENT_VERSION = "glp-lead-v2-20260723";
const NEWSLETTER_CONSENT_VERSION = "glp-newsletter-v1-20260822";
const NEWSLETTER_SITE_CAPTURE_SOURCE = "/subscribe-bottom-sheet/";
const PRICE_INDEX_SITE_CAPTURE_SOURCE = "/glp-1-price-index/:price-watch";
const QUIZ_SITE_CAPTURE_SOURCE = "/quiz/provider-fit/";
const CONTENT_UPGRADE_SITE_CAPTURE_SOURCE_SET = new Set(CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES);
const CONTENT_UPGRADE_SITE_CAPTURE_SOURCE_SQL = CONTENT_UPGRADE_TERMS_CAPTURE_SOURCES.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
const COST_BREAKDOWN_KEYS = Object.freeze(["checkedAsOf", "firstMonthUsd", "months", "priceContext", "providerId", "providerName", "recurringMonthUsd", "totalUsd", "version"]);
const RESEND_SUPPRESSION_COPY_SHA256 = "940dd2111e673ee83c1ca16ee1e8e177a5dc947d0b4633c1b43ed4da928e2d71";

function isExactCostCalculatorCapture(consentSource) {
  try {
    const value = JSON.parse(consentSource);
    const breakdown = value?.cost_breakdown;
    return Boolean(
      value
      && !Array.isArray(value)
      && Object.keys(value).sort().join(",") === "cost_breakdown,lead_magnet_key,source_page"
      && value.source_page === COST_CALCULATOR_CAPTURE.sourcePage
      && value.lead_magnet_key === COST_CALCULATOR_CAPTURE.leadMagnetKey
      && breakdown
      && typeof breakdown === "object"
      && !Array.isArray(breakdown)
      && Object.keys(breakdown).sort().join(",") === COST_BREAKDOWN_KEYS.join(",")
      && breakdown.version === "cost-breakdown-v1"
      && /^[a-z0-9][a-z0-9-]{1,100}$/.test(breakdown.providerId)
      && typeof breakdown.providerName === "string" && breakdown.providerName.length >= 1 && breakdown.providerName.length <= 100
      && Number.isFinite(breakdown.firstMonthUsd) && breakdown.firstMonthUsd >= 0 && breakdown.firstMonthUsd <= 10000
      && Number.isFinite(breakdown.recurringMonthUsd) && breakdown.recurringMonthUsd >= 0 && breakdown.recurringMonthUsd <= 10000
      && Number.isInteger(breakdown.months) && breakdown.months >= 1 && breakdown.months <= 24
      && Number.isFinite(breakdown.totalUsd) && breakdown.totalUsd >= 0 && breakdown.totalUsd <= 250000
      && Math.abs(breakdown.totalUsd - Number((breakdown.firstMonthUsd + breakdown.recurringMonthUsd * Math.max(0, breakdown.months - 1)).toFixed(2))) <= 0.001
      && typeof breakdown.priceContext === "string" && breakdown.priceContext.length >= 1 && breakdown.priceContext.length <= 300
      && typeof breakdown.checkedAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(breakdown.checkedAsOf)
    );
  } catch {
    return false;
  }
}

// Keep the database-side eligibility, initial claim, and retry claim on the same
// positive provenance contract. A nonempty label is not evidence of a site capture.
const WEEKLY_PRICE_WATCH_CONSENT_PROVENANCE_SQL = `(
  (
    s.funnel_stage='content-upgrade'
    AND s.consent_version IN ('glp-content-upgrade-v1-20260724','glp-content-upgrade-v2-20260801')
    AND (
      s.consent_source='${PRICE_INDEX_SITE_CAPTURE_SOURCE}'
      OR s.consent_source IN (${CONTENT_UPGRADE_SITE_CAPTURE_SOURCE_SQL})
      OR CASE WHEN json_valid(s.consent_source)=1 THEN (
        json_type(s.consent_source, '$.source_page')='text'
        AND json_extract(s.consent_source, '$.source_page')='${COST_CALCULATOR_CAPTURE.sourcePage}'
        AND json_type(s.consent_source, '$.lead_magnet_key')='text'
        AND json_extract(s.consent_source, '$.lead_magnet_key')='${COST_CALCULATOR_CAPTURE.leadMagnetKey}'
        AND json_type(s.consent_source, '$.cost_breakdown')='object'
        AND (SELECT COUNT(*) FROM json_each(s.consent_source))=3
        AND (SELECT COUNT(*) FROM json_each(s.consent_source, '$.cost_breakdown'))=9
        AND json_type(s.consent_source, '$.cost_breakdown.version')='text'
        AND json_extract(s.consent_source, '$.cost_breakdown.version')='cost-breakdown-v1'
        AND json_type(s.consent_source, '$.cost_breakdown.providerId')='text'
        AND LENGTH(json_extract(s.consent_source, '$.cost_breakdown.providerId')) BETWEEN 2 AND 101
        AND json_extract(s.consent_source, '$.cost_breakdown.providerId') NOT GLOB '*[^a-z0-9-]*'
        AND json_extract(s.consent_source, '$.cost_breakdown.providerId') GLOB '[a-z0-9]*'
        AND json_type(s.consent_source, '$.cost_breakdown.providerName')='text'
        AND LENGTH(json_extract(s.consent_source, '$.cost_breakdown.providerName')) BETWEEN 1 AND 100
        AND json_type(s.consent_source, '$.cost_breakdown.firstMonthUsd') IN ('integer','real')
        AND json_extract(s.consent_source, '$.cost_breakdown.firstMonthUsd') BETWEEN 0 AND 10000
        AND json_type(s.consent_source, '$.cost_breakdown.recurringMonthUsd') IN ('integer','real')
        AND json_extract(s.consent_source, '$.cost_breakdown.recurringMonthUsd') BETWEEN 0 AND 10000
        AND json_type(s.consent_source, '$.cost_breakdown.months')='integer'
        AND json_extract(s.consent_source, '$.cost_breakdown.months') BETWEEN 1 AND 24
        AND json_type(s.consent_source, '$.cost_breakdown.totalUsd') IN ('integer','real')
        AND json_extract(s.consent_source, '$.cost_breakdown.totalUsd') BETWEEN 0 AND 250000
        AND ABS(json_extract(s.consent_source, '$.cost_breakdown.totalUsd') - (json_extract(s.consent_source, '$.cost_breakdown.firstMonthUsd') + json_extract(s.consent_source, '$.cost_breakdown.recurringMonthUsd') * (json_extract(s.consent_source, '$.cost_breakdown.months') - 1))) <= 0.001
        AND json_type(s.consent_source, '$.cost_breakdown.priceContext')='text'
        AND LENGTH(json_extract(s.consent_source, '$.cost_breakdown.priceContext')) BETWEEN 1 AND 300
        AND json_type(s.consent_source, '$.cost_breakdown.checkedAsOf')='text'
        AND LENGTH(json_extract(s.consent_source, '$.cost_breakdown.checkedAsOf'))=10
        AND json_extract(s.consent_source, '$.cost_breakdown.checkedAsOf') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      ) ELSE 0 END
    )
  )
  OR (
    s.funnel_stage='quiz-lead'
    AND s.consent_version='${QUIZ_LEAD_CONSENT_VERSION}'
    AND s.consent_source='${QUIZ_SITE_CAPTURE_SOURCE}'
  )
  OR (
    s.funnel_stage='newsletter'
    AND s.consent_version='${NEWSLETTER_CONSENT_VERSION}'
    AND s.consent_source='${NEWSLETTER_SITE_CAPTURE_SOURCE}'
  )
)`;

const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function emailRuntimeGate(config, env) {
  const receipt = env.EMAIL_OPERATOR_RECEIPT_SHA256 || "";
  const domain = config.domain || {};
  const activation = config.activation_evidence || {};
  return Boolean(config.status === "LIVE_SCHEDULED_ZERO_ELIGIBLE" && config.runtime_enabled === true && config.send_authorized === true && config.operator_approval?.receipt_sha256 === receipt && activation.operator_receipt_sha256 === receipt && activation.from_identity === CLINIC_SCOUT_FROM_IDENTITY && activation.reply_to === "izaiah@glpclinicscout.com" && env.EMAIL_RUNTIME_MODE === "production_operator_approved" && /^[a-f0-9]{64}$/.test(receipt) && env.EMAIL_SEND_GATE === `operator-approved:${receipt}` && env.EMAIL_WARMUP_STATUS === "PASS" && env.RESEND_API_KEY && domain.from_name === "GLP Clinic Scout" && domain.from_identity === CLINIC_SCOUT_FROM_IDENTITY && domain.resend_domain_verified === true && domain.alias_routing_verified === true && domain.sender_alias === "izaiah@glpclinicscout.com" && domain.reply_to === "izaiah@glpclinicscout.com" && domain.spf === "PASS" && domain.dkim === "PASS" && domain.dmarc === "PASS" && domain.warmup_status === "PASS");
}

export function selectWeeklyFeature(eligiblePrograms, weekNumber) {
  const pool = eligiblePrograms.filter((program) => program.curation_eligible === true && program.live_link_allowed === true && program.redirector_tos_verified === true).sort((a, b) => a.program_id.localeCompare(b.program_id));
  return pool.length ? pool[Math.abs(Number(weekNumber)) % pool.length] : null;
}

export function buildMessage({ config, subscriber, template, featuredProgram = null, campaignId }) {
  if (subscriber.consent_status !== "opted-in" || subscriber.status !== "active" || !subscriber.unsubscribe_token) throw new Error("subscriber_not_sendable");
  if (template.step == null && !isWeeklyPriceWatchSubscriber(subscriber)) throw new Error("subscriber_not_sendable");
  const position = template.step ? `w${template.step}` : "weekly";
  const variant = template.step ? "a" : `n${String(template.week_number || 0).padStart(2, "0").slice(-2)}`;
  const eligibleFeature = featuredProgram?.live_link_allowed === true && featuredProgram?.redirector_tos_verified === true;
  const goUrl = eligibleFeature ? `https://glpclinicscout.com/go/${encodeURIComponent(featuredProgram.program_id)}?s=email-glp.${position}&v=${variant}` : null;
  const promo = eligibleFeature && featuredProgram.promo_code_verified === true && featuredProgram.promo_code ? featuredProgram.promo_code : null;
  const unsubscribe = `https://glpclinicscout.com/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}`;
  if (template.copy_format === "glp47-approved-20261009") {
    // The approved onboarding bytes must not inherit weekly briefing copy.
    if (!config.welcome_sequence.includes(template) || !template.body_text || !config.welcome_footer) throw new Error("glp47_template_not_bound");
    const text = `${template.body_text}\n\n${config.welcome_footer.replace("{{unsubscribe_url}}", unsubscribe)}`;
    if (/\{\{[^}]*\}\}/.test(text)) throw new Error("glp47_unresolved_template_token");
    const safeUrl = esc(unsubscribe);
    return {
      endpoint: RESEND_API,
      idempotencyKey: `${campaignId}/${subscriber.subscriber_id}/${template.step}`.slice(0, 256),
      body: {
        from: config.welcome_sequence_approval.sender,
        to: [subscriber.email], subject: template.subject,
        reply_to: config.welcome_sequence_approval.reply_to,
        html: `<div style="white-space:pre-wrap">${esc(text).replaceAll(safeUrl, `<a href="${safeUrl}">${safeUrl}</a>`)}</div>`,
        text,
        headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Clinic-Scout-Campaign": campaignId },
        tags: [{ name: "vertical", value: subscriber.vertical }, { name: "funnel_stage", value: subscriber.funnel_stage }, { name: "campaign", value: campaignId }],
      },
      attribution: { page_slug: "email-glp", link_position: position, variant, campaign_id: campaignId, program_id: null },
    };
  }
  const affiliate = goUrl ? `<p><strong>Featured option:</strong> ${esc(featuredProgram.display_name)}. <a href="${goUrl}">Review current terms</a>${promo ? ` · verified promo code <strong>${esc(promo)}</strong>` : ""}</p><p><small>Affiliate disclosure: Clinic Scout may earn a commission if you use this link. Commission does not change our evidence standards.</small></p>` : `<p><strong>Featured option held:</strong> no program has cleared economics, EPC sample, compliance, redirector-ToS, and live-link gates.</p>`;
  const valueParagraphs = String(template.body_text || "Compare current all-in cost, eligibility limits, service area, cancellation terms, and what each public source actually proves.")
    .split(/\n+/).filter(Boolean).map((paragraph) => `<p>${esc(paragraph)}</p>`).join("");
  const firstName = String(subscriber.first_name || "").trim();
  const greetingHtml = firstName ? `Hi ${esc(firstName)},` : "Hi,";
  const greetingText = firstName ? `Hi ${firstName},` : "Hi,";
  const html = `<!doctype html><html><body style="font:16px/1.6 system-ui,sans-serif;color:#193047;max-width:680px;margin:auto;padding:24px"><div style="display:none;max-height:0;overflow:hidden">${esc(template.preheader)}</div><p>Clinic Scout</p><h1>${esc(template.subject)}</h1><p>${greetingHtml}</p><p>${esc(template.preheader)}</p><p>This issue gives you the useful comparison in the email itself; no click is required to get the core takeaway.</p>${valueParagraphs}${template.affiliate_slot ? affiliate : ""}<hr><p style="font-size:12px;color:#5a6b7d">Not medical advice. Published prices and terms can change; verify current terms directly before purchasing.</p><p style="font-size:12px;color:#5a6b7d">${esc(CLINIC_SCOUT_POSTAL_ADDRESS)}</p><p><a href="${unsubscribe}">Unsubscribe</a> · <a href="https://glpclinicscout.com/privacy/">Privacy</a></p></body></html>`;
  const text = `${template.subject}\n\n${greetingText}\n\n${template.preheader}\n\nThis issue gives you the useful comparison in the email itself; no click is required to get the core takeaway.\n\n${String(template.body_text || "Compare current all-in cost, eligibility limits, service area, cancellation terms, and what each public source actually proves.")}\n\nNot medical advice. Published prices and terms can change; verify current terms directly before purchasing.\n\n${CLINIC_SCOUT_POSTAL_ADDRESS}\n\nUnsubscribe: ${unsubscribe}`;
  return {
    endpoint: RESEND_API,
    idempotencyKey: `${campaignId}/${subscriber.subscriber_id}/${template.step || template.week_number}`.slice(0, 256),
    body: {
      from: config.domain.from_identity,
      to: [subscriber.email],
      subject: template.subject,
      html,
      text,
      ...(config.domain.reply_to ? { reply_to: config.domain.reply_to } : {}),
      headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Clinic-Scout-Campaign": campaignId },
      tags: [{ name: "vertical", value: subscriber.vertical }, { name: "funnel_stage", value: subscriber.funnel_stage }, { name: "campaign", value: campaignId }],
    },
    attribution: { page_slug: "email-glp", link_position: position, variant, campaign_id: campaignId, program_id: eligibleFeature ? featuredProgram.program_id : null },
  };
}

export async function sendWithResend(message, env, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(message.endpoint, { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey, "User-Agent": "clinic-scout-email-machine/1.0" }, body: JSON.stringify(message.body) });
  } catch {
    return { status: "retry", retry: true, reason: "network-error" };
  }
  let result = {};
  try { result = await response.json(); } catch { result = {}; }
  if (response.ok && result.id) return { status: "sent", resend_email_id: result.id, retry: false };
  if ([429, 500, 502, 503, 504].includes(response.status)) return { status: "retry", retry: true, http_status: response.status };
  return { status: "failed", retry: false, http_status: response.status };
}

function nextSendAt(consentAt, sequence, nextStep) {
  const entry = sequence.find((item) => item.step === nextStep);
  if (!entry) return null;
  return new Date(new Date(consentAt).getTime() + entry.day * 86_400_000).toISOString();
}

export async function runDripScheduler(env, config, now = new Date(), fetchImpl = fetch) {
  if (config.welcome_sequence.some(item => item.copy_format === 'glp47-approved-20261009')) {
    if (!await onboardingRuntimeGate(config, env)) return {status:'HELD',sent:0,reason:'glp47_onboarding_runtime_held_b01'};
    if (!env.EMAIL_DB?.prepare) return {status:'HELD',sent:0,reason:'email_db_missing'};
    const dailyCap = Math.max(1, Math.min(25, Number(env.EMAIL_WARMUP_DAILY_CAP || 25) || 1));
    const daily = await env.EMAIL_DB.prepare("SELECT COUNT(*) AS count FROM email_deliveries WHERE vertical='glp-clinic-scout' AND message_type='welcome' AND sent_at>=?").bind(now.toISOString().slice(0,10)+'T00:00:00.000Z').first();
    const cap = Math.max(0, dailyCap-Number(daily?.count||0));
    if (!cap) return {status:'HELD',sent:0,reason:'onboarding_daily_cap',receipts:[]};
    const due = await env.EMAIL_DB.prepare(`SELECT s.* FROM subscribers s WHERE ${ONBOARDING_ELIGIBILITY_SQL} AND s.next_send_at<=? AND s.next_drip_step BETWEEN 1 AND 2 ORDER BY s.next_send_at LIMIT ?`).bind(now.toISOString(),cap).all();
    const receipts=[];let sent=0;let held=0;
    for (const subscriber of due.results||[]) {
      const template=config.welcome_sequence.find(t=>t.step===subscriber.next_drip_step);
      const campaignId=`welcome-glp-${template.step}`;
      const message=buildMessage({config,subscriber,template,campaignId});
      const deliveryId=`${subscriber.subscriber_id}:${campaignId}`;
      const claim=await env.EMAIL_DB.prepare(`INSERT OR IGNORE INTO email_deliveries(delivery_id,idempotency_key,subscriber_id,vertical,funnel_stage,message_type,sequence_step,campaign_id,status,created_at) SELECT ?,?,?,?,?,'welcome',?,?,'sending',? WHERE EXISTS(SELECT 1 FROM subscribers s WHERE ${ONBOARDING_ELIGIBILITY_SQL} AND s.subscriber_id=? AND s.next_drip_step=?) AND (SELECT COUNT(*) FROM email_deliveries d WHERE d.vertical='glp-clinic-scout' AND d.message_type='welcome' AND d.created_at>=? AND d.status IN ('sending','sent','delivered'))<?`).bind(deliveryId,message.idempotencyKey,subscriber.subscriber_id,subscriber.vertical,subscriber.funnel_stage,template.step,campaignId,now.toISOString(),subscriber.subscriber_id,template.step,now.toISOString().slice(0,10)+'T00:00:00.000Z',dailyCap).run();
      if (Number(claim?.meta?.changes||0)!==1) continue;
      // Revalidate after claiming and before each outward effect. Unknown effects
      // retain their claim; no time-based blind retry of provider idempotency.
      const eligible=()=>env.EMAIL_DB.prepare(`SELECT 1 AS found FROM subscribers s WHERE ${ONBOARDING_ELIGIBILITY_SQL} AND s.subscriber_id=?`).bind(subscriber.subscriber_id).first();
      if (!(await eligible())) {held++;continue;}
      let contact=null;
      if (template.step===1) {
        contact=await syncResendContact({env:{...env,RESEND_ENABLED:'true'},email:subscriber.email,firstName:subscriber.first_name},fetchImpl);
        if (contact.status!=='synced') {held++;receipts.push({delivery_id:deliveryId,status:'HELD',reason:'contact_sync_failed'});continue;}
      }
      if (!(await eligible())) {held++;continue;}
      const outcome=await sendWithResend(message,env,fetchImpl);
      if (outcome.status!=='sent') {held++;receipts.push({delivery_id:deliveryId,status:'UNKNOWN_OR_FAILED',reason:outcome.reason||`provider_http_${outcome.http_status}`});continue;}
      await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='sent',resend_email_id=?,sent_at=? WHERE delivery_id=?").bind(outcome.resend_email_id,now.toISOString(),deliveryId).run();
      // Day two is two days after actual welcome, not an old capture clock.
      const next=template.step===1?new Date(now.getTime()+2*86400000).toISOString():null;
      await env.EMAIL_DB.prepare(`UPDATE subscribers SET next_drip_step=?,next_send_at=?,last_sent_at=?,updated_at=? WHERE subscriber_id=? AND vertical=? AND status='active' AND consent_status='opted-in' AND NOT EXISTS(SELECT 1 FROM suppression_log z WHERE z.email=subscribers.email AND z.vertical=subscribers.vertical)`).bind(template.step+1,next,now.toISOString(),now.toISOString(),subscriber.subscriber_id,subscriber.vertical).run();
      sent++;receipts.push({delivery_id:deliveryId,status:'sent',resend_email_id:outcome.resend_email_id,resend_contact_id:contact?.contact_id||null,sequence_step:template.step});
    }
    const pending = await env.EMAIL_DB.prepare("SELECT COUNT(*) AS count FROM email_deliveries WHERE vertical='glp-clinic-scout' AND message_type='welcome' AND status IN ('sending','retry')").bind().first();
    const unresolved = Number(pending?.count||0);
    return {status:held||unresolved?'HELD':'PASS',sent,held,unresolved,receipts};
  }
  if (!emailRuntimeGate(config, env)) return { status: "HELD", sent: 0, reason: "email_runtime_gate" };
  if (!env.EMAIL_DB?.prepare) return { status: "HELD", sent: 0, reason: "email_db_missing" };
  const cap = Number(env.EMAIL_WARMUP_DAILY_CAP || 25);
  const due = await env.EMAIL_DB.prepare("SELECT * FROM subscribers WHERE status='active' AND consent_status='opted-in' AND next_send_at <= ? AND next_drip_step BETWEEN 1 AND 5 ORDER BY next_send_at LIMIT ?").bind(now.toISOString(), cap).all();
  let sent = 0; let retries = 0; let failed = 0;
  for (const subscriber of due.results || []) {
    const template = config.welcome_sequence.find((item) => item.step === subscriber.next_drip_step);
    if (!template) continue;
    const campaignId = `welcome-glp-${template.step}`;
    const message = buildMessage({ config, subscriber, template, campaignId });
    const deliveryId = `${subscriber.subscriber_id}:${campaignId}`;
    const inserted = await env.EMAIL_DB.prepare("INSERT OR IGNORE INTO email_deliveries (delivery_id,idempotency_key,subscriber_id,vertical,funnel_stage,message_type,sequence_step,campaign_id,status,created_at) SELECT ?,?,?,?,?,'welcome',?,?,'sending',? WHERE EXISTS (SELECT 1 FROM subscribers WHERE subscriber_id=? AND vertical=? AND status='active' AND consent_status='opted-in')").bind(deliveryId, message.idempotencyKey, subscriber.subscriber_id, subscriber.vertical, subscriber.funnel_stage, template.step, campaignId, now.toISOString(), subscriber.subscriber_id, subscriber.vertical).run();
    let claimed = Number(inserted?.meta?.changes || 0) === 1;
    if (!claimed) {
      const retryClaim = await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='sending' WHERE delivery_id=? AND status='retry' AND EXISTS (SELECT 1 FROM subscribers WHERE subscriber_id=? AND vertical=? AND status='active' AND consent_status='opted-in')").bind(deliveryId, subscriber.subscriber_id, subscriber.vertical).run();
      claimed = Number(retryClaim?.meta?.changes || 0) === 1;
    }
    if (!claimed) continue;
    const outcome = await sendWithResend(message, env);
    if (outcome.status === "sent") {
      const step = template.step + 1;
      await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='sent',resend_email_id=?,sent_at=? WHERE delivery_id=?").bind(outcome.resend_email_id, now.toISOString(), deliveryId).run();
      await env.EMAIL_DB.prepare("UPDATE subscribers SET next_drip_step=?,next_send_at=?,last_sent_at=?,updated_at=? WHERE subscriber_id=? AND vertical=?").bind(step, nextSendAt(subscriber.consent_at, config.welcome_sequence, step), now.toISOString(), now.toISOString(), subscriber.subscriber_id, subscriber.vertical).run();
      sent += 1;
    } else if (outcome.retry) {
      await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='retry' WHERE delivery_id=?").bind(deliveryId).run(); retries += 1;
    } else {
      await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='failed',failed_at=? WHERE delivery_id=?").bind(now.toISOString(), deliveryId).run(); failed += 1;
    }
  }
  return { status: failed ? "PARTIAL" : "PASS", sent, retries, failed };
}

export function composeWeeklyNewsletter({ config, weekNumber, eligiblePrograms, editorial }) {
  const featuredProgram = selectWeeklyFeature(eligiblePrograms, weekNumber);
  const template = { step: null, week_number: weekNumber, subject: editorial.subject, preheader: editorial.preheader, body_text: editorial.body_text, affiliate_slot: Boolean(featuredProgram) };
  return { template, featuredProgram, campaignId: editorial.campaign_id || `weekly-glp-${String(weekNumber).padStart(2, "0")}`, status: featuredProgram ? "READY_GATE_REQUIRED" : "READY_GATE_REQUIRED_NO_PROMOTION", zero_click_value: editorial.body_text, promotion_share_percent: featuredProgram ? 16 : 0, promotion_share_max: config.newsletter.promotion_percent_max };
}

export function isWeeklyPriceWatchSubscriber(subscriber) {
  const consentSource = subscriber?.consent_source;
  if (typeof consentSource !== "string" || consentSource !== consentSource.trim()) return false;
  const contentUpgradeProvenance = subscriber?.funnel_stage === "content-upgrade"
    && CONTENT_UPGRADE_CONSENT_VERSIONS.has(subscriber.consent_version)
    && (
      consentSource === PRICE_INDEX_SITE_CAPTURE_SOURCE
      || CONTENT_UPGRADE_SITE_CAPTURE_SOURCE_SET.has(consentSource)
      || isExactCostCalculatorCapture(consentSource)
    );
  const quizLeadProvenance = subscriber?.funnel_stage === "quiz-lead"
    && subscriber.consent_version === QUIZ_LEAD_CONSENT_VERSION
    && consentSource === QUIZ_SITE_CAPTURE_SOURCE;
  const newsletterProvenance = subscriber?.funnel_stage === "newsletter"
    && subscriber.consent_version === NEWSLETTER_CONSENT_VERSION
    && consentSource === NEWSLETTER_SITE_CAPTURE_SOURCE;
  return Boolean(
    subscriber?.vertical === "glp-clinic-scout"
    && subscriber.consent_status === "opted-in"
    && subscriber.status === "active"
    && (contentUpgradeProvenance || quizLeadProvenance || newsletterProvenance)
    && /^[a-f0-9]{32}$/.test(subscriber.unsubscribe_token || "")
  );
}

export async function runWeeklyPriceWatch(env, config, issue, now = new Date(), fetchImpl = fetch) {
  if (!emailRuntimeGate(config, env)) return { status: "HELD", sent: 0, reason: "email_runtime_gate" };
  if (!env.EMAIL_DB?.prepare) return { status: "HELD", sent: 0, reason: "email_db_missing" };
  if (!issue || !["READY_GATE_REQUIRED", "READY_GATE_REQUIRED_NO_PROMOTION"].includes(issue.status) || !/^price-watch-\d{4}-\d{2}-\d{2}$/.test(issue.campaignId || "")) return { status: "HELD", sent: 0, reason: "price_watch_issue_invalid" };
  if (Number(issue.promotion_share_percent || 0) > Number(config.newsletter.promotion_percent_max)) return { status: "HELD", sent: 0, reason: "promotion_share_exceeded" };
  const requestedCap = Number(env.EMAIL_WEEKLY_CAP || env.EMAIL_WARMUP_DAILY_CAP || 25);
  const cap = Number.isInteger(requestedCap) && requestedCap > 0 ? Math.min(requestedCap, 500) : 25;
  const due = await env.EMAIL_DB.prepare(`SELECT * FROM subscribers s WHERE s.vertical='glp-clinic-scout' AND s.status='active' AND s.consent_status='opted-in' AND ${WEEKLY_PRICE_WATCH_CONSENT_PROVENANCE_SQL} AND LENGTH(s.unsubscribe_token)=32 AND s.unsubscribe_token NOT GLOB '*[^a-f0-9]*' AND NOT EXISTS (SELECT 1 FROM suppression_log x WHERE x.email=s.email AND x.vertical=s.vertical) ORDER BY s.created_at LIMIT ?`).bind(cap).all();
  let sent = 0; let retries = 0; let failed = 0; let skipped = 0;
  for (const subscriber of due.results || []) {
    if (!isWeeklyPriceWatchSubscriber(subscriber)) { skipped += 1; continue; }
    const message = buildMessage({ config, subscriber, template: issue.template, featuredProgram: issue.featuredProgram, campaignId: issue.campaignId });
    const deliveryId = `${subscriber.subscriber_id}:${issue.campaignId}`;
    const claim = await env.EMAIL_DB.prepare(`INSERT OR IGNORE INTO email_deliveries (delivery_id,idempotency_key,subscriber_id,vertical,funnel_stage,message_type,sequence_step,campaign_id,featured_program_id,promo_code,status,created_at) SELECT ?,?,?,?,?,'weekly-price-watch',NULL,?,?,?,'sending',? WHERE EXISTS (SELECT 1 FROM subscribers s WHERE s.subscriber_id=? AND s.email=? AND s.funnel_stage=? AND s.consent_version=? AND s.consent_source=? AND s.unsubscribe_token=? AND s.vertical='glp-clinic-scout' AND s.status='active' AND s.consent_status='opted-in' AND ${WEEKLY_PRICE_WATCH_CONSENT_PROVENANCE_SQL} AND LENGTH(s.unsubscribe_token)=32 AND s.unsubscribe_token NOT GLOB '*[^a-f0-9]*') AND NOT EXISTS (SELECT 1 FROM suppression_log x WHERE x.email=? AND x.vertical='glp-clinic-scout')`).bind(deliveryId, message.idempotencyKey, subscriber.subscriber_id, subscriber.vertical, subscriber.funnel_stage, issue.campaignId, issue.featuredProgram?.program_id || null, issue.featuredProgram?.promo_code_verified === true ? issue.featuredProgram.promo_code : null, now.toISOString(), subscriber.subscriber_id, subscriber.email, subscriber.funnel_stage, subscriber.consent_version, subscriber.consent_source, subscriber.unsubscribe_token, subscriber.email).run();
    let claimed = Number(claim?.meta?.changes || 0) === 1;
    if (!claimed) {
      const retry = await env.EMAIL_DB.prepare(`UPDATE email_deliveries SET status='sending' WHERE delivery_id=? AND status='retry' AND EXISTS (SELECT 1 FROM subscribers s WHERE s.subscriber_id=? AND s.email=? AND s.funnel_stage=? AND s.consent_version=? AND s.consent_source=? AND s.unsubscribe_token=? AND s.vertical='glp-clinic-scout' AND s.status='active' AND s.consent_status='opted-in' AND ${WEEKLY_PRICE_WATCH_CONSENT_PROVENANCE_SQL} AND LENGTH(s.unsubscribe_token)=32 AND s.unsubscribe_token NOT GLOB '*[^a-f0-9]*') AND NOT EXISTS (SELECT 1 FROM suppression_log x WHERE x.email=? AND x.vertical='glp-clinic-scout')`).bind(deliveryId, subscriber.subscriber_id, subscriber.email, subscriber.funnel_stage, subscriber.consent_version, subscriber.consent_source, subscriber.unsubscribe_token, subscriber.email).run();
      claimed = Number(retry?.meta?.changes || 0) === 1;
    }
    if (!claimed) { skipped += 1; continue; }
    const outcome = await sendWithResend(message, env, fetchImpl);
    if (outcome.status === "sent") {
      await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='sent',resend_email_id=?,sent_at=? WHERE delivery_id=?").bind(outcome.resend_email_id, now.toISOString(), deliveryId).run();
      await env.EMAIL_DB.prepare("UPDATE subscribers SET last_sent_at=?,updated_at=? WHERE subscriber_id=? AND vertical='glp-clinic-scout'").bind(now.toISOString(), now.toISOString(), subscriber.subscriber_id).run();
      sent += 1;
    } else if (outcome.retry) {
      await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='retry' WHERE delivery_id=?").bind(deliveryId).run(); retries += 1;
    } else {
      await env.EMAIL_DB.prepare("UPDATE email_deliveries SET status='failed',failed_at=? WHERE delivery_id=?").bind(now.toISOString(), deliveryId).run(); failed += 1;
    }
  }
  return { status: failed ? "PARTIAL" : "PASS", sent, retries, failed, skipped };
}

function base64Bytes(value) { const normalized = value.replace(/^whsec_/, ""); const raw = atob(normalized); return Uint8Array.from(raw, (character) => character.charCodeAt(0)); }
function timingSafeEqual(left, right) { if (left.length !== right.length) return false; let difference = 0; for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i); return difference === 0; }

export async function verifyResendWebhook(rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers.get("svix-id") || ""; const timestamp = headers.get("svix-timestamp") || ""; const signature = headers.get("svix-signature") || "";
  if (!id || !/^\d{10}$/.test(timestamp) || !signature || !secret?.startsWith("whsec_")) throw new Error("webhook_signature_headers_invalid");
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) throw new Error("webhook_timestamp_invalid");
  const key = await crypto.subtle.importKey("raw", base64Bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  if (!signature.split(" ").some((part) => part.startsWith("v1,") && timingSafeEqual(part.slice(3), expected))) throw new Error("webhook_signature_invalid");
  return true;
}

export function resendSenderDomain(from) {
  if (typeof from !== "string") return null;
  const trimmed = from.trim();
  const bracketed = trimmed.match(/<([^<>]+)>\s*$/)?.[1];
  const address = (bracketed || trimmed).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) return null;
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

export async function ingestResendWebhook(request, env) {
  if (!env.RESEND_WEBHOOK_SECRET) return new Response("held", { status: 503 });
  const rawBody = await request.text();
  try { await verifyResendWebhook(rawBody, request.headers, env.RESEND_WEBHOOK_SECRET); } catch { return new Response("invalid", { status: 401 }); }
  let event; try { event = JSON.parse(rawBody); } catch { return new Response("invalid", { status: 400 }); }
  if (resendSenderDomain(event?.data?.from) !== CLINIC_SCOUT_SENDER_DOMAIN) return new Response("ignored-foreign", { status: 202 });
  const db = env.EMAIL_DB || env.GLP_DB;
  if (!db?.prepare) return new Response("held", { status: 503 });
  if (!EMAIL_STATUS_EVENTS.has(event.type) || !event.created_at || !event.data?.email_id) return new Response("ignored", { status: 202 });
  const bodyHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const svixId = request.headers.get("svix-id");
  const receivedAt = new Date().toISOString();
  const status = event.type.replace("email.", "");
  const statements = [
    db.prepare("INSERT OR IGNORE INTO resend_webhook_events (svix_id,event_type,resend_email_id,occurred_at,received_at,payload_sha256) VALUES (?,?,?,?,?,?)").bind(svixId, event.type, event.data.email_id, event.created_at, receivedAt, bodyHash),
    db.prepare("UPDATE email_deliveries SET status=?, delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END, failed_at=CASE WHEN ? IN ('failed','bounced','complained','suppressed') THEN ? ELSE failed_at END WHERE resend_email_id=?").bind(status, status, event.created_at, status, event.created_at, event.data.email_id),
  ];
  if (event.type === "email.clicked") {
    const link = String(event.data.click?.link || "");
    const urlClass = link.includes("/go/") ? "affiliate-go" : link.includes("/unsubscribe") ? "unsubscribe" : "editorial";
    statements.push(db.prepare("INSERT OR IGNORE INTO email_clicks (svix_id,resend_email_id,clicked_url_class,click_token,occurred_at) VALUES (?,?,?,NULL,?)").bind(svixId, event.data.email_id, urlClass, event.created_at));
  }
  if (["email.bounced", "email.complained", "email.suppressed"].includes(event.type)) {
    statements.push(
      db.prepare("UPDATE subscribers SET status=?,consent_status='suppressed',next_send_at=NULL,updated_at=? WHERE subscriber_id=(SELECT subscriber_id FROM email_deliveries WHERE resend_email_id=?)").bind(status, receivedAt, event.data.email_id),
      db.prepare("INSERT OR IGNORE INTO suppression_log(email,vertical,reason,source,created_at) SELECT s.email,s.vertical,?,'resend-webhook',? FROM subscribers s JOIN email_deliveries d ON d.subscriber_id=s.subscriber_id WHERE d.resend_email_id=?").bind(status, receivedAt, event.data.email_id),
      db.prepare("INSERT OR IGNORE INTO contact_capture_events (capture_id,idempotency_key,email,first_name,vertical,funnel_stage,source_surface,source_context,review_id,purpose,marketing_consent,consent_status,consent_version,consent_source,consent_copy_sha256,captured_at) SELECT ?,?,s.email,s.first_name,s.vertical,s.funnel_stage,'resend-webhook',?,NULL,'suppression',0,?,'resend-webhook-v1-20260827',?, ?,? FROM subscribers s JOIN email_deliveries d ON d.subscriber_id=s.subscriber_id WHERE d.resend_email_id=?")
        .bind(`contact_${crypto.randomUUID()}`, `suppression:${svixId}`, JSON.stringify({ event_type: event.type, resend_email_id: event.data.email_id }), status, event.type, RESEND_SUPPRESSION_COPY_SHA256, event.created_at, event.data.email_id),
    );
  }
  if (typeof db.batch === "function") await db.batch(statements);
  else for (const statement of statements) await statement.run();
  return new Response("ok", { status: 200 });
}

export function calculatePerEmailEpc({ validClicks, netCommission, minimumClicks = 30 }) {
  const epc = validClicks ? Math.round((netCommission / validClicks) * 10000) / 10000 : null;
  return { valid_clicks: validClicks, net_commission: netCommission, epc, sample_gate: validClicks >= minimumClicks ? "PASS" : "HELD_MINIMUM_SAMPLE", optimization_allowed: validClicks >= minimumClicks };
}

export const resendMachinePolicy = Object.freeze({ provider: "Resend", sendingDomain: CLINIC_SCOUT_SENDER_DOMAIN, senderAlias: "izaiah@glpclinicscout.com", optInRequired: true, activeSubscriberRequired: true, siteCapturesOnly: true, suppressionCheckedAtClaim: true, healthDataInEmailEvents: false, idempotencyKeys: true, signedWebhooks: true, foreignSenderRejected: true, customUserAgent: "clinic-scout-email-machine/1.0", oneClickUnsubscribe: true, postalAddress: CLINIC_SCOUT_POSTAL_ADDRESS, minimumEpcClicks: 30, sendsInStaging: 0 });
