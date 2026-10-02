import { constructNetworkUrl } from "./network-constructors.mjs";
import { loadPlatformContext } from "./platform-click-context.mjs";
import { redirectorTermsAllowed } from "./go-redirector-authority.mjs";
import { xentrafficAccountRef } from "./xentraffic-attribution.mjs";

const SAFE_PAGE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_POSITION = /^[a-z0-9][a-z0-9-]{0,11}$/;
const SAFE_VARIANT = /^[a-z0-9]{1,4}$/;
const SAFE_PROGRAM = /^[a-z0-9][a-z0-9-]{1,79}$/;
const CLIENT_CLICK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLICK_TOKEN = /^(?:c1-[a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const NETWORK = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const NETWORK_OFFER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
// 2026-08-06: the old fallback route 404s live; every non-attributed /go/
// hit stranded. Point at the live money hub instead.
const INTERNAL_FALLBACK = "https://glpclinicscout.com/best/online-glp-1-providers/";
const BOT_UA = /bot|spider|crawler|headless|curl|wget|python-requests|facebookexternalhit|preview|uptime|monitor/i;

function redirect(location, reason, logStatus = "not-required", ga4Status = "not-eligible") {
  return new Response(null, {
    status: 307,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      "X-Content-Type-Options": "nosniff",
      "X-Redirect-Reason": reason,
      "X-Attribution-Log": logStatus,
      "X-GA4-Server-Event": ga4Status,
      "X-Click-Token-Spec": "click-identity-v2",
    },
  });
}

function safeOfficialFallback(program, internalFallback) {
  try {
    const target = new URL(program?.official_fallback || "");
    const allowed = program?.allowed_fallback_hosts || [];
    if (target.protocol !== "https:" || target.username || target.password || !allowed.includes(target.hostname.toLowerCase())) return internalFallback;
    return target.toString();
  } catch { return internalFallback; }
}

export function parseGoQuery(url) {
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(["s", "v", "cs_click_id"]);
  if (keys.length < 2 || keys.length > 3 || new Set(keys).size !== keys.length || !keys.includes("s") || !keys.includes("v") || keys.some((key) => !allowed.has(key))) throw new Error("query_shape_invalid");
  if (url.searchParams.getAll("s").length !== 1 || url.searchParams.getAll("v").length !== 1 || url.searchParams.getAll("cs_click_id").length > 1) throw new Error("query_duplicate_invalid");
  const surface = url.searchParams.get("s") || "";
  const variant = url.searchParams.get("v") || "";
  const parts = surface.split(".");
  if (parts.length !== 2) throw new Error("surface_shape_invalid");
  const [pageSlug, linkPosition] = parts;
  const csClickId = url.searchParams.get("cs_click_id") || "";
  if (!SAFE_PAGE.test(pageSlug) || !SAFE_POSITION.test(linkPosition) || !SAFE_VARIANT.test(variant) || (csClickId && !CLIENT_CLICK_ID.test(csClickId))) throw new Error("query_value_invalid");
  return { surface, pageSlug, linkPosition, variant, csClickId: csClickId || null };
}

export function mintClickToken(randomBytes = null) {
  const bytes = randomBytes || crypto.getRandomValues(new Uint8Array(12));
  if (!(bytes instanceof Uint8Array) || bytes.length !== 12) throw new Error("click_token_entropy_invalid");
  return `c1-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function monthCode(env) {
  // Calendar grouping remains separate from the click's UUIDv7 timestamp.
  if (env.ATTRIBUTION_MONTH && /^\d{6}$/.test(env.ATTRIBUTION_MONTH)) return env.ATTRIBUTION_MONTH;
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function cookieValue(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const piece of raw.split(";")) {
    const [key, ...value] = piece.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function referrerClass(request) {
  const raw = request.headers.get("referer") || "";
  if (!raw) return "none";
  try {
    const referrer = new URL(raw);
    if (referrer.pathname.startsWith("/go/")) return "redirect-loop";
    if (["glpclinicscout.com", "www.glpclinicscout.com", "staging.glpclinicscout.com"].includes(referrer.hostname.toLowerCase())) return "first-party";
    return "offsite";
  } catch { return "malformed"; }
}

async function trafficGate(request, env, liveCandidate) {
  const ua = request.headers.get("user-agent") || "";
  const referrer = referrerClass(request);
  if (!ua || BOT_UA.test(ua)) return { pass: false, status: "bot-heuristic", uaClass: "bot-or-empty", referrer };
  if (referrer === "redirect-loop" || referrer === "malformed") return { pass: false, status: referrer, uaClass: "browser", referrer };
  if (!liveCandidate) return { pass: true, status: "staging-not-rate-limited", uaClass: "browser", referrer };
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.CLICK_RATE_LIMITER?.limit) {
    const result = await env.CLICK_RATE_LIMITER.limit({ key: ip });
    return { pass: Boolean(result?.success), status: result?.success ? "valid" : "rate-limited", uaClass: "browser", referrer };
  }
  if (!env.GLP_DB?.prepare) return { pass: false, status: "rate-limiter-missing", uaClass: "browser", referrer };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`affiliate|${ip}`));
  const keyHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const windowStart = Math.floor(Date.now() / 60000);
  try {
    const row = await env.GLP_DB.prepare("INSERT INTO request_rate_limits (scope, key_hash, window_start, request_count, updated_at) VALUES ('affiliate', ?, ?, 1, ?) ON CONFLICT(scope, key_hash, window_start) DO UPDATE SET request_count=request_count+1, updated_at=excluded.updated_at RETURNING request_count").bind(keyHash, windowStart, new Date().toISOString()).first();
    const pass = Number(row?.request_count || 0) <= 60;
    return { pass, status: pass ? "valid" : "rate-limited", uaClass: "browser", referrer };
  } catch { return { pass: false, status: "rate-limit-storage-failed", uaClass: "browser", referrer }; }
}

function liveAllowed(env, program, pageSlug, linkPosition, variant) {
  return Boolean(
    env.AFFILIATE_RUNTIME_MODE === "production" &&
    program.link_mode === "server_redirect" &&
    program.go_route_wired === true &&
    program.live_link_allowed === true &&
    program.promotion_authorized === true &&
    program.status === "live_operator_approved" &&
    program.operator_selection_receipt_sha256 &&
    env.AFFILIATE_LIVE_GATE === `operator-approved:${program.operator_selection_receipt_sha256}` &&
    program.allowed_page_roles?.includes(pageSlug) &&
    program.allowed_positions?.includes(linkPosition) &&
    program.allowed_variants?.includes(variant) &&
    program.constructor_verified === true &&
    program.advertiser_permission_verified === true &&
    program.encoding_verified === true &&
    program.privacy_qa_passed === true &&
    redirectorTermsAllowed(program)
  );
}

export function networkOfferId(program) {
  const explicit = String(program?.network_offer_id || "");
  if (NETWORK_OFFER_ID.test(explicit)) return explicit;
  let tracking;
  try { tracking = new URL(program?.tracking?.base_url || ""); } catch { return null; }
  let derived = "";
  if (program.network === "awin") {
    derived = tracking.searchParams.get(tracking.pathname === "/awclick.php" ? "mid" : "awinmid") || "";
  } else if (program.network === "katalys" || program.network === "affiliati") {
    derived = tracking.searchParams.get("offer_id") || tracking.searchParams.get("oid") || "";
  } else if (program.network === "cj") {
    derived = tracking.pathname.match(/^\/click-\d{1,10}-(\d{1,15})(?:-\d+)?$/)?.[1] || "";
  } else if (program.network === "partnerize") {
    derived = tracking.pathname.match(/\/camref:([A-Za-z0-9]+)/)?.[1] || "";
  }
  return NETWORK_OFFER_ID.test(derived) ? derived : null;
}

export function networkAccountRef(program) {
  if (program.network === "xentraffic") return xentrafficAccountRef(program);
  if (program.network !== "affiliati") return null;
  try {
    const tracking = new URL(program.tracking.base_url);
    const values = [tracking.searchParams.get("a"), tracking.searchParams.get("aff_id")].filter(Boolean);
    if (!values.length || values.some(value => !/^[0-9]{1,20}$/.test(value) || value !== values[0])) return null;
    return values[0];
  } catch { return null; }
}

async function writeClickMapping(env, event) {
  if (!env.GLP_DB?.prepare || !CLICK_TOKEN.test(event.click_token)) return false;
  const issuedReferralOnly = event.program_id === "gobymeds" && event.network === "direct"
    && event.network_offer_id === null && event.issued_link_passthrough_verified === true;
  if (!NETWORK.test(event.network || "") || (!NETWORK_OFFER_ID.test(event.network_offer_id || "") && !issuedReferralOnly)) return false;
  try {
    // Ordinary clicks are never reclassified from permission/context objects.
    // Registered TEST context uses the separate read/CAS consumer, not INSERT.
    // Keep this guard even though handleGoRequest no longer passes a context.
    if (event.platform_context) return false;
    await env.GLP_DB.prepare("INSERT INTO affiliate_click_map (click_token, event_id, page_slug, link_position, program_id, merchant, network, network_offer_id, variant, yyyymm, created_at, ivt_status, ua_class, referrer_class, analytics_consent, ga4_status, ga4_attempts, reconciliation_status, network_account_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)")
      .bind(event.click_token, event.click_token, event.page_slug, event.link_position, event.program_id, event.program_id, event.network, event.network_offer_id, event.variant, event.yyyymm, event.created_at, event.ivt_status, event.ua_class, event.referrer_class, event.analytics_consent, event.ga4_status, event.network_account_ref)
      .run();
    return true;
  } catch { return false; }
}

async function updateGa4Status(env, clickToken, status) {
  if (!env.GLP_DB?.prepare || !CLICK_TOKEN.test(clickToken)) return false;
  try {
    await env.GLP_DB.prepare("UPDATE affiliate_click_map SET ga4_status = ? WHERE click_token = ? AND ga4_status = 'pending'").bind(status, clickToken).run();
    return true;
  } catch { return false; }
}

async function sendGa4AffiliateClick() {
  // W6_SERVER_EXPORT_HELD: browser opt-in and legacy environment gates do
  // not authorize exporting health-intent affiliate metadata to GA4.
  // Preserve first-party attribution independently of this retired sender.
  return "configuration-held";
}

export async function handleGoRequest(request, env, programId) {
  let manifest = env.PROGRAM_MANIFEST || env.AFFILIATE_PROGRAMS_JSON;
  if (typeof manifest === "string") { try { manifest = JSON.parse(manifest); } catch { manifest = null; } }
  if (!manifest?.programs && SAFE_PROGRAM.test(programId || "")) {
    const key = `AFFILIATE_PROGRAM_${programId.toUpperCase().replaceAll("-", "_")}`;
    let item = env[key];
    if (typeof item === "string") { try { item = JSON.parse(item); } catch { item = null; } }
    manifest = { internal_fallback: INTERNAL_FALLBACK, programs: item ? [item] : [] };
  }
  if (!SAFE_PROGRAM.test(programId || "") || !manifest?.programs) return redirect(INTERNAL_FALLBACK, "unknown-program");
  const program = manifest.programs.find((item) => item.program_id === programId || item.route_slug === programId);
  if (!program) return redirect(manifest.internal_fallback || INTERNAL_FALLBACK, "unknown-program");
  let attribution;
  try { attribution = parseGoQuery(new URL(request.url)); } catch { return redirect(manifest.internal_fallback || INTERNAL_FALLBACK, "invalid-attribution"); }
  const { pageSlug, linkPosition, variant, csClickId } = attribution;
  if (!program.allowed_page_roles?.includes(pageSlug) || !program.allowed_positions?.includes(linkPosition) || !program.allowed_variants?.includes(variant)) return redirect(manifest.internal_fallback || INTERNAL_FALLBACK, "assignment-not-allowlisted");
  const prefetch = ["purpose", "sec-purpose", "x-purpose", "x-moz"]
    .some((name) => /\b(?:prefetch|prerender)\b/i.test(request.headers.get(name) || ""));
  if (request.method === "HEAD" || prefetch) {
    // Inspection/speculative fetch is not a navigation or an owned click.
    // Return only a governed fallback before rate limiting, minting or DB I/O.
    return redirect(safeOfficialFallback(program, manifest.internal_fallback || INTERNAL_FALLBACK), "non-navigational-request", "not-minted");
  }
  const liveCandidate = liveAllowed(env, program, pageSlug, linkPosition, variant);
  const traffic = await trafficGate(request, env, liveCandidate);
  if (!traffic.pass) return redirect(manifest.internal_fallback || INTERNAL_FALLBACK, `ivt-${traffic.status}`, "blocked");
  const fallback = safeOfficialFallback(program, manifest.internal_fallback || INTERNAL_FALLBACK);
  if (!liveCandidate) return redirect(fallback, "operator-or-tos-gate-held", "not-minted");

  const clickToken = csClickId || (program.network === "affiliati" ? mintUuidV7ClickToken() : mintClickToken());
  const event = {
    click_token: clickToken,
    page_slug: pageSlug,
    link_position: linkPosition,
    program_id: program.program_id,
    network: String(program.network || "").toLowerCase(),
    network_offer_id: networkOfferId(program),
    network_account_ref: networkAccountRef(program),
    issued_link_passthrough_verified: program.program_id === "gobymeds" && program.network === "direct"
      && program.tracking?.issued_link_passthrough_verified === true
      && program.tracking?.base_url === "https://my.gobymeds.com/s/vuMPMv",
    variant,
    yyyymm: monthCode(env),
    created_at: new Date().toISOString(),
    ivt_status: traffic.status,
    ua_class: traffic.uaClass,
    referrer_class: traffic.referrer,
    analytics_consent: cookieValue(request, "gcs_analytics_consent") === "granted" ? "granted" : "denied",
    ga4_status: "pending",
  };
  if (
    event.network === "affiliati"
    && (
      !CLIENT_CLICK_ID.test(clickToken)
      || !NETWORK_OFFER_ID.test(String(program.network_offer_id || ""))
      || event.network_offer_id !== String(program.network_offer_id)
    )
  ) return redirect(fallback, "affiliati-click-identity-held", "not-mapped");
  if (event.network === "xentraffic" && !event.network_account_ref) {
    return redirect(fallback, "xentraffic-account-identity-held", "not-mapped");
  }
  let destination;
  try { /* AFFILIATI_S1_S2_CONTRACT_V1 */ destination = constructNetworkUrl(program, clickToken, `${pageSlug}.${linkPosition}`); } catch { return redirect(fallback, "constructor-failed", "not-mapped"); }
  // Registered TEST capture attaches by CAS to an independently existing click;
  // ordinary clicks retain the unchanged INSERT, with NULL platform context.
  const captured = await loadPlatformContext(request, env, event);
  if (!captured && !(await writeClickMapping(env, event))) return redirect(manifest.internal_fallback || INTERNAL_FALLBACK, "click-map-failed-closed", "failed");
  const ga4Status = await sendGa4AffiliateClick(request, env, event);
  await updateGa4Status(env, clickToken, ga4Status);
  return redirect(destination, "affiliate-live", "mapped", ga4Status);
}

export function mintUuidV7ClickToken(now = Date.now(), randomBytes = null) {
  const bytes = randomBytes ? new Uint8Array(randomBytes) : crypto.getRandomValues(new Uint8Array(16));
  if (!(randomBytes === null || randomBytes instanceof Uint8Array) || bytes.length !== 16
      || !Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) throw new Error("click_uuidv7_input_invalid");
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index--) { bytes[index] = Number(timestamp & 255n); timestamp >>= 8n; }
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export const opaqueClickPolicy = Object.freeze({
  version: "click-identity-v2",
  tokenPattern: CLICK_TOKEN.source,
  mappedDimensions: ["page_slug", "link_position", "program_id", "network", "network_offer_id", "variant", "yyyymm"],
  store: "Cloudflare D1 GLP_DB",
  propagationSlaMinutes: 15,
  rawIpStored: false,
  rawUaStored: false,
  rawReferrerStored: false,
  serverGa4ConsentRequired: true,
  groundTruth: "GLP_DB",
});