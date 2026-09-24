import { syncResendContact } from "../src/resend-contacts.mjs";

const UNSUBSCRIBE_COPY_SHA256 = "0dfd4a42e308557ab5aae397e4b73f59b26ef3989a2daad445e3040b7d960ba3";

function response(status, body, type = "text/html; charset=utf-8") { return new Response(body, { status, headers: { "content-type": type, "cache-control": "no-store", "x-robots-tag": "noindex,nofollow,noarchive" } }); }

async function unsubscribe(env, token, source) {
  const db = env.GLP_DB || env.EMAIL_DB;
  if (!/^[a-f0-9]{32}$/.test(token || "") || !db?.prepare || typeof db.batch !== "function") return { ok: false, provider: null };
  const now = new Date().toISOString();
  const subscriber = await db.prepare("SELECT email,first_name,vertical,funnel_stage FROM subscribers WHERE unsubscribe_token=? LIMIT 1").bind(token).first();
  if (!subscriber) return { ok: true, provider: null };
  const statements = [
    db.prepare("UPDATE subscribers SET status='unsubscribed',consent_status='withdrawn',next_send_at=NULL,updated_at=? WHERE unsubscribe_token=?").bind(now, token),
    db.prepare("INSERT OR IGNORE INTO suppression_log(email,vertical,reason,source,created_at) VALUES (?,?,'unsubscribed',?,?)").bind(subscriber.email, subscriber.vertical, source, now),
    db.prepare("INSERT OR IGNORE INTO contact_capture_events (capture_id,idempotency_key,email,first_name,vertical,funnel_stage,source_surface,source_context,review_id,purpose,marketing_consent,consent_status,consent_version,consent_source,consent_copy_sha256,captured_at) VALUES (?,?,?,?,?,?,?,?,NULL,'withdrawal',0,'withdrawn','unsubscribe-v1-20260827',?,?,?)")
      .bind(`contact_${crypto.randomUUID()}`, `withdrawal:${token}`, subscriber.email, subscriber.first_name || "there", subscriber.vertical, subscriber.funnel_stage, `unsubscribe/${source}`, null, source, UNSUBSCRIBE_COPY_SHA256, now),
  ];
  const results = await db.batch(statements);
  if (results.some((result) => result?.success === false)) return { ok: false, provider: null };
  const provider = await syncResendContact({ env, email: subscriber.email, firstName: subscriber.first_name || "there", unsubscribed: true });
  return { ok: true, provider };
}

export async function onRequestGet({ request }) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[a-f0-9]{32}$/.test(token)) return response(400, "<h1>Invalid unsubscribe link</h1>");
  return response(200, `<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · Clinic Scout</title></head><body style="font:18px/1.6 system-ui;max-width:680px;margin:auto;padding:40px"><h1>Unsubscribe from Clinic Scout</h1><p>This stops future marketing and drip email for this vertical.</p><form method="post"><input type="hidden" name="token" value="${token}"><button style="min-height:48px;padding:12px 18px" type="submit">Unsubscribe</button></form></body></html>`);
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url); const contentType = request.headers.get("content-type") || ""; let token = url.searchParams.get("token") || "";
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const body = await request.formData(); token = String(body.get("token") || token);
    const oneClick = body.get("List-Unsubscribe") === "One-Click";
    if (!token || (!oneClick && body.get("token") !== token)) return response(400, "invalid", "text/plain");
  }
  const result = await unsubscribe(env, token, request.headers.get("user-agent")?.includes("Resend") ? "one-click" : "web-form");
  return result.ok ? response(200, "<h1>Unsubscribed</h1><p>No further marketing email will be sent.</p>") : response(400, "<h1>Unable to unsubscribe</h1>");
}
