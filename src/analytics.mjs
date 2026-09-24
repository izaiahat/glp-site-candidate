const EVENT_PARAMS = Object.freeze({
  affiliate_click: ["program", "merchant", "page_slug", "link_position", "variant", "subid"],
  comparison_table_view: ["page_slug", "table_id"],
  comparison_facets_changed: ["therapeutic", "treatment", "visible_count"],
  cost_calculator_used: ["page_slug"],
  cost_calculator_complete: ["page_slug", "provider"],
  eligibility_quiz_complete: ["page_slug"],
  quiz_start: ["page_slug"],
  quiz_step_complete: ["step_number"],
  provider_finder_used: ["page_slug"],
  scroll_75: ["page_slug"],
});
const PROHIBITED = new Set(["quiz_answers", "bmi_range", "current_meds", "insurance", "state", "email", "referrer", "user_id"]);

export function buildAnalyticsEvent(name, params) {
  const allowed = EVENT_PARAMS[name];
  if (!allowed) throw new Error("analytics_event_not_allowlisted");
  const keys = Object.keys(params || {});
  if (keys.some((key) => !allowed.includes(key) || PROHIBITED.has(key))) {
    throw new Error("analytics_param_not_allowlisted");
  }
  if (name === "affiliate_click" && allowed.some((key) => !params[key])) {
    throw new Error("affiliate_click_param_missing");
  }
  return { name, params: Object.fromEntries(allowed.filter((key) => params[key] !== undefined).map((key) => [key, String(params[key])])) };
}

export function emitAnalytics(target, config, name, params) {
  const event = buildAnalyticsEvent(name, params);
  if (!config?.enabled || config?.consent !== "granted") return { emitted: false, reason: "analytics_disabled", event };
  if (typeof target?.gtag === "function") {
    target.gtag("event", event.name, event.params);
    return { emitted: true, transport: "gtag", event };
  }
  if (Array.isArray(target?.dataLayer)) {
    target.dataLayer.push({ event: event.name, ...event.params });
    return { emitted: true, transport: "dataLayer", event };
  }
  return { emitted: false, reason: "analytics_transport_missing", event };
}

export const analyticsPolicy = Object.freeze({ events: EVENT_PARAMS, stagingEnabled: false, remoteKeyEventRegistration: "operator_or_production_config_gate" });
