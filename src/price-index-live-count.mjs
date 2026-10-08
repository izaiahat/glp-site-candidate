// S9 item 11 (D2w release 1 rebuild 1): the price-index page must render the live
// registry count through {{LIVE_PROVIDER_COUNT}} like every other surface.
// Historical observations, prices, sample sizes, dates and evidence are frozen and
// are NEVER rewritten: only the stale *totals* are dropped or scoped to their
// observation date ("subset claims rephrased, never falsified").
//
// The Build 4 semantic-preservation gate compares the generated page against the
// preserved predecessor byte-for-byte after normalization. This module projects
// the preserved document's three provider-count regions into the exact shapes the
// current renderer emits, so the copy migration is explicit and every other byte
// of that document stays strict. The predecessor pair rolls forward each build, so
// the projection is idempotent: a document already in the current shape is
// accepted unchanged, and is still required to carry the derived count.

const RENDERED_TOKEN = "{{LIVE_PROVIDER_COUNT}}";
const OBSERVED_ON = /^\d{4}-\d{2}-\d{2}$/;
// Preserved (pre-migration) shapes.
const LEGACY_ASIDE = /<p><strong>(\d+)<\/strong> live providers · <strong>(\d+)<\/strong> with at least one eligible price · <strong>(\d+)<\/strong> honestly observed (weeks|week)\.<\/p>/g;
const LEGACY_METRIC = /<p>(\d+) of (\d+) live providers had an eligible product-specific monthly observation\.<\/p>/g;
const LEGACY_UNIVERSE = /<dd>(\d+) live, wired, unique providers after declared merchant aliases are removed\.<\/dd>/g;
// Current shape: every reader-visible provider total is the derived count.
const RENDERED_COUNT = /(\{\{LIVE_PROVIDER_COUNT\}\}|\d+)(?:<\/strong>)? live(?:, wired, unique)? providers/g;

function requireLiveCount(liveCount) {
  if (!Number.isSafeInteger(liveCount) || liveCount < 1) throw new Error("price_index_live_count_invalid");
  return String(liveCount);
}

/** Substitute the derived token for comparison against already-shipped bytes. */
export function substitutePriceIndexLiveCount(html, liveCount) {
  return String(html).replaceAll(RENDERED_TOKEN, requireLiveCount(liveCount));
}

/**
 * Refuse to ship a price-index page that still states a hand-carried provider
 * total, or that lost the derived count. `substituted` selects the shipped-byte
 * form (the number) over the generated form (the token).
 */
export function assertPriceIndexLiveCount(html, liveCount, { substituted = false } = {}) {
  const marker = substituted ? requireLiveCount(liveCount) : (requireLiveCount(liveCount), RENDERED_TOKEN);
  const source = String(html);
  LEGACY_METRIC.lastIndex = 0;
  if (LEGACY_METRIC.test(source)) throw new Error("price_index_live_count_stale_total");
  LEGACY_METRIC.lastIndex = 0;
  RENDERED_COUNT.lastIndex = 0;
  const rows = [...source.matchAll(RENDERED_COUNT)];
  if (rows.length !== 4) throw new Error(`price_index_live_count_shape:rendered:${rows.length}`);
  const stale = rows.filter((row) => row[1] !== marker);
  if (stale.length) throw new Error(`price_index_live_count_not_derived:${stale.map((row) => row[1]).join(",")}`);
  return true;
}

/**
 * Project the preserved Build 4 price-index document into the current copy shape,
 * carrying its historical numbers across verbatim. Idempotent for a predecessor
 * that already carries the migrated copy.
 */
export function projectPreservedPriceIndexLiveCount(html, observedOn, liveCount, {predecessorLiveCount = liveCount} = {}) {
  const count = requireLiveCount(liveCount);
  if (!OBSERVED_ON.test(String(observedOn || ""))) throw new Error("price_index_live_count_observed_on_invalid");
  const source = String(html);
  LEGACY_METRIC.lastIndex = 0; LEGACY_ASIDE.lastIndex = 0; LEGACY_UNIVERSE.lastIndex = 0;
  const legacyMetric = [...source.matchAll(LEGACY_METRIC)];
  if (legacyMetric.length === 0) {
    // Raw membership binds the first denial transition; an authenticated
    // predecessor may already carry the current total on an ordinary repeat.
    // Never admit mixed counts or relax the exact four-region assertion.
    RENDERED_COUNT.lastIndex = 0;
    const rows = [...source.matchAll(RENDERED_COUNT)];
    const alreadyCurrent = rows.length === 4 && rows.every(row => row[1] === count);
    assertPriceIndexLiveCount(source, alreadyCurrent ? liveCount : predecessorLiveCount, { substituted: true });
    // Change only the four current catalog totals, never historical samples.
    const projected = source.replace(RENDERED_COUNT, (match, old) => count + match.slice(old.length));
    assertPriceIndexLiveCount(projected, liveCount, { substituted: true });
    return projected;
  }
  const legacyAside = [...source.matchAll(LEGACY_ASIDE)];
  const legacyUniverse = [...source.matchAll(LEGACY_UNIVERSE)];
  if (legacyMetric.length !== 2 || legacyAside.length !== 1 || legacyUniverse.length !== 1) {
    throw new Error(`price_index_live_count_shape:legacy:${legacyAside.length}:${legacyMetric.length}:${legacyUniverse.length}`);
  }
  const projected = source
    .replace(LEGACY_ASIDE, (_match, _live, indexed, weeks, weekWord) =>
      `<p><strong>${count}</strong> live providers · <strong>${indexed}</strong> with at least one eligible price in the ${observedOn} observation · <strong>${weeks}</strong> honestly observed ${weekWord}.</p>`)
    .replace(LEGACY_METRIC, (_match, sample) =>
      `<p>Historical provider sample: ${sample} with an eligible product-specific monthly observation as of ${observedOn}. The current catalog covers ${count} live providers.</p>`)
    .replace(LEGACY_UNIVERSE, () =>
      `<dd>${count} live, wired, unique providers after declared merchant aliases are removed.</dd>`);
  assertPriceIndexLiveCount(projected, liveCount, { substituted: true });
  return projected;
}
