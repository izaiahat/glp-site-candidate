import { validatePriceIndexInputs } from "./price-index.mjs";
import { composeWeeklyNewsletter } from "./resend-email-machine.mjs";

const money = (amount) => `$${Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (value) => value[0].toUpperCase() + value.slice(1);

function isoWeekNumber(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("price_watch_observation_date_invalid");
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
}

function movementText(movers, observedOn) {
  if (movers.status === "NO_PRIOR_OBSERVED_WEEK") {
    return "Week over week: no prior observed week exists yet. Clinic Scout does not backfill or invent earlier prices, so there is no movement claim this week.";
  }
  if (movers.status === "NO_OBSERVED_PRICE_CHANGES") {
    return `Week over week: no price changes were observed between ${movers.previous_observed_on} and ${observedOn} in the tracked comparison set.`;
  }
  if (movers.status !== "OBSERVED_MOVERS" || !Array.isArray(movers.movers) || !movers.movers.length) throw new Error("price_watch_movers_invalid");
  return `Week over week: ${movers.movers.map((mover) => `${mover.provider} ${label(mover.medication)} moved from ${money(mover.prior_amount_usd)} to ${money(mover.current_amount_usd)} (${mover.delta_usd > 0 ? "+" : ""}${money(mover.delta_usd)})`).join("; ")}.`;
}

export function composePriceWatchIssue({ config, priceIndexInput, eligiblePrograms = [], now = Date.now() }) {
  const validation = validatePriceIndexInputs(priceIndexInput, { now });
  const latest = validation.latest_observation;
  const metrics = new Map(validation.metrics.map((metric) => [metric.medication, metric]));
  const semaglutide = metrics.get("semaglutide");
  const tirzepatide = metrics.get("tirzepatide");
  if (!semaglutide || !tirzepatide) throw new Error("price_watch_metrics_incomplete");
  const subject = `GLP-1 price watch: ${money(semaglutide.median_usd)} semaglutide median, ${money(tirzepatide.median_usd)} tirzepatide`;
  const movement = movementText(validation.movers, latest.observed_on);
  const preheader = `${validation.record_count} dated price observations through ${latest.data_as_of}. ${validation.movers.status === "NO_PRIOR_OBSERVED_WEEK" ? "No prior observed week yet." : "Observed movement is stated in the email."}`;
  const bodyText = [
    `Dated snapshot: observed ${latest.observed_on}; source evidence checked through ${latest.data_as_of}.`,
    `Compounded semaglutide: ${money(semaglutide.median_usd)} median across ${semaglutide.provider_count} eligible provider observations, with a ${money(semaglutide.min_usd)} to ${money(semaglutide.max_usd)} range and ${money(semaglutide.spread_usd)} spread.`,
    `Compounded tirzepatide: ${money(tirzepatide.median_usd)} median across ${tirzepatide.provider_count} eligible provider observations, with a ${money(tirzepatide.min_usd)} to ${money(tirzepatide.max_usd)} range and ${money(tirzepatide.spread_usd)} spread.`,
    movement,
    `How to read it: ${priceIndexInput.tracker.price_index.methodology.comparison_limitations}`,
  ].join("\n");
  const issue = composeWeeklyNewsletter({
    config,
    weekNumber: isoWeekNumber(latest.observed_on),
    eligiblePrograms,
    editorial: {
      campaign_id: `price-watch-${latest.observed_on}`,
      subject,
      preheader,
      body_text: bodyText,
    },
  });
  return {
    ...issue,
    schema: "glp-clinic-scout-weekly-price-watch-v1",
    source: {
      route: validation.route,
      tracker_path: "data/price-tracker.json",
      price_index_validator: "src/price-index.mjs#validatePriceIndexInputs",
      observed_on: latest.observed_on,
      data_as_of: latest.data_as_of,
      observation_count: validation.observation_count,
      record_count: validation.record_count,
      record_set_sha256: latest.record_set_sha256,
      source_hashes: validation.source_hashes,
      original_data_study_id: validation.study_id,
      source_ledger_payload_sha256: validation.source_ledger_payload_sha256,
      movers_status: validation.movers.status,
    },
    consent_scope: "active_opted_in_glp_site_captures_only",
    unsubscribe_behavior: "rfc8058_one_click_plus_visible_link_immediate_suppression",
    postal_address_evidence: "src/legal-pages.mjs",
    send_authorized: false,
  };
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_not_object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label}_keys_invalid`);
}

export function validatePublishedPriceWatchIssue(issue, { expectedObservedOn } = {}) {
  exactObjectKeys(issue, [
    "campaignId", "consent_scope", "featuredProgram", "postal_address_evidence",
    "promotion_share_max", "promotion_share_percent", "schema", "send_authorized", "source", "status",
    "template", "unsubscribe_behavior", "zero_click_value",
  ], "price_watch_issue");
  exactObjectKeys(issue.template, ["affiliate_slot", "body_text", "preheader", "step", "subject", "week_number"], "price_watch_template");
  exactObjectKeys(issue.source, [
    "data_as_of", "movers_status", "observation_count", "observed_on", "original_data_study_id",
    "price_index_validator", "record_count", "record_set_sha256", "route", "source_hashes",
    "source_ledger_payload_sha256", "tracker_path",
  ], "price_watch_source");
  exactObjectKeys(issue.source.source_hashes, [
    "original_data_study_sha256", "program_content_ledger_sha256", "program_registry_sha256",
  ], "price_watch_source_hashes");
  if (issue.schema !== "glp-clinic-scout-weekly-price-watch-v1") throw new Error("price_watch_schema_invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue.source.observed_on || "")) throw new Error("price_watch_observed_on_invalid");
  if (expectedObservedOn && issue.source.observed_on !== expectedObservedOn) throw new Error("price_watch_observation_not_current_schedule");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue.source.data_as_of || "") || issue.source.data_as_of > issue.source.observed_on) throw new Error("price_watch_data_as_of_invalid");
  if (issue.campaignId !== `price-watch-${issue.source.observed_on}`) throw new Error("price_watch_campaign_invalid");
  if (issue.status !== "READY_GATE_REQUIRED_NO_PROMOTION" || issue.featuredProgram !== null || issue.promotion_share_percent !== 0 || issue.template.affiliate_slot !== false) throw new Error("price_watch_promotion_not_held");
  if (issue.send_authorized !== false || issue.consent_scope !== "active_opted_in_glp_site_captures_only" || issue.unsubscribe_behavior !== "rfc8058_one_click_plus_visible_link_immediate_suppression") throw new Error("price_watch_send_boundary_invalid");
  if (issue.source.route !== "/glp-1-price-index/" || issue.source.tracker_path !== "data/price-tracker.json" || issue.source.price_index_validator !== "src/price-index.mjs#validatePriceIndexInputs") throw new Error("price_watch_source_identity_invalid");
  if (!Number.isInteger(issue.source.observation_count) || issue.source.observation_count < 1 || !Number.isInteger(issue.source.record_count) || issue.source.record_count < 1) throw new Error("price_watch_source_counts_invalid");
  for (const digest of [issue.source.record_set_sha256, issue.source.source_ledger_payload_sha256, ...Object.values(issue.source.source_hashes)]) {
    if (!/^[a-f0-9]{64}$/.test(digest || "")) throw new Error("price_watch_source_hash_invalid");
  }
  if (issue.template.step !== null || !Number.isInteger(issue.template.week_number) || issue.template.week_number < 1 || typeof issue.template.subject !== "string" || !issue.template.subject || typeof issue.template.preheader !== "string" || !issue.template.preheader || typeof issue.template.body_text !== "string" || !issue.template.body_text || issue.zero_click_value !== issue.template.body_text) throw new Error("price_watch_template_invalid");
  return issue;
}
