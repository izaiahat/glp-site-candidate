// Build-derived freshness for provider surfaces.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-06: a provider wave merged same-day research into every comparison row
// and every provider card, and the comparison pages still said "Updated
// 2026-07-24". The stamp was a literal in data/money-page-specs.json, typed once
// on the day the template was frozen. Nothing recomputed it, so the site
// advertised two-week-old numbers it had refreshed that morning.
//
// WHAT THIS DOES
// --------------
// A provider surface's "updated" date is DERIVED from the dated evidence that
// surface actually carries: every `verified_as_of`, `checked_as_of`,
// `source_checked_through` and other ISO date reachable in the spec the renderer
// is handed. The stamp is the newest of those, floored at the page's published
// date and at its previous stamp so a date never travels backwards.
//
// Article bylines are deliberately NOT derived here. A guide's date is an
// editorial claim about when a human revised the prose; a comparison page's date
// is a claim about the freshness of provider data, and only the second one is
// something the machine can and must compute.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_ANYWHERE = /(?<![\d>])(\d{4}-\d{2}-\d{2})(?![\d])/g;

/** Keys whose values are dates about the machine, not about rendered evidence. */
const IGNORED_DATE_KEYS = new Set(["date_modified", "reminted_at_utc", "captured_at_utc", "merged_at_utc"]);

/** Deep-collect every ISO calendar date reachable in a spec. Pure. */
export function collectEvidenceDates(value, out = new Set(), key = "") {
  if (typeof value === "string") {
    if (IGNORED_DATE_KEYS.has(key)) return out;
    if (ISO_DATE.test(value)) out.add(value);
    else for (const match of value.matchAll(ISO_DATE_ANYWHERE)) out.add(match[1]);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceDates(item, out, key);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) collectEvidenceDates(child, out, childKey);
  }
  return out;
}

export function maxDate(dates) {
  let best = null;
  for (const date of dates) if (ISO_DATE.test(date) && (best === null || date > best)) best = date;
  return best;
}

export function minDate(dates) {
  let best = null;
  for (const date of dates) if (ISO_DATE.test(date) && (best === null || date < best)) best = date;
  return best;
}

/**
 * Derive the freshness fields for one money-page spec.
 *
 * @returns {{date_modified: string, source_checked_from: string|null, source_checked_through: string|null}}
 */
export function deriveMoneyPageFreshness(spec) {
  const evidence = collectEvidenceDates({ ...spec, date_modified: undefined });
  const sourceDates = (spec.sources || [])
    .map((source) => source.verified_as_of)
    .filter((date) => ISO_DATE.test(String(date || "")));
  const floors = [spec.date_published, spec.date_modified].filter((date) => ISO_DATE.test(String(date || "")));
  const derived = maxDate([...evidence, ...floors]);
  if (!derived) throw new Error(`freshness_underivable:${spec.page_id || spec.path}`);
  return {
    date_modified: derived,
    source_checked_from: minDate(sourceDates),
    source_checked_through: maxDate(sourceDates) || derived,
  };
}

/** Same rule for a provider review spec, whose evidence is its row and sources. */
export function deriveReviewFreshness(review) {
  const evidence = collectEvidenceDates({
    row: review.row,
    sources: Array.isArray(review.sources) ? review.sources : [...(review.sources?.values?.() || [])],
    fastpath_contract: review.fastpath_contract,
    fastpath_integration: review.fastpath_integration,
  });
  const floors = [review.date_published, review.date_modified].filter((date) => ISO_DATE.test(String(date || "")));
  const derived = maxDate([...evidence, ...floors]);
  if (!derived) throw new Error(`freshness_underivable_review:${review.program_id}`);
  return derived;
}

/**
 * The build gate. Re-reads the RENDERED bytes and refuses to ship a page that
 * stamps itself older than dated evidence it puts in front of a reader. A future
 * renderer that reintroduces a hand stamp dies here, not in an operator's audit.
 */
export function assertStampNotStale(relative, html) {
  const stamp = /"dateModified":"(\d{4}-\d{2}-\d{2})/.exec(html);
  if (!stamp) throw new Error(`freshness_stamp_missing:${relative}`);
  const body = html
    .replaceAll(stamp[0], "")
    .replace(/"datePublished":"\d{4}-\d{2}-\d{2}"/g, "")
    .replaceAll(`Updated ${stamp[1]}`, "");
  const newest = maxDate([...body.matchAll(ISO_DATE_ANYWHERE)].map((match) => match[1]));
  if (newest && stamp[1] < newest) {
    throw new Error(`freshness_stamp_stale:${relative}:stamped:${stamp[1]}:renders_evidence:${newest}`);
  }
  return stamp[1];
}
