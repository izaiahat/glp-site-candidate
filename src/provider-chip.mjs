// The one place a provider chip's surface treatment is decided.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator defects, both on the compare surfaces):
//
//   1. Light/white-dominant logos were invisible. Every chip painted `#fff` and
//      the chip class came from `logo.surface`, which records the PAGE we
//      captured the mark from, not the mark's own ink. BiltRx, Live Vital,
//      DudeMeds and CareBareRx therefore shipped as empty white boxes.
//
//   2. Providers rendered a raw-text wordmark even though their logo asset was
//      already shipped and hashed in `assets/provider-logos/manifest.json`.
//      Eleven money-page rows carried no `logo` block, so seven providers with
//      a perfectly good captured mark (Pallas, SkinnyRx, RxSpan, DudeMeds,
//      Wellmedr, CoreAge, Bodybuilding) fell through to the text fallback and
//      overflowed the chip.
//
// Both had the same root cause: the chip read a HAND-MAINTAINED per-row field
// instead of the shipped asset. This module makes the asset the authority.
// The logo manifest is derived from the bytes on disk; the luminance analyzer
// derives the treatment from those same bytes; and this join hands both to
// every renderer. A row cannot disagree with the asset it ships, because it no
// longer carries an independent copy of the answer.

import { identityKey } from "./provider-identity.mjs";
import { WORDMARK_CHIPS, fitWordmark } from "./provider-wordmark.mjs";

/** Chip surface classes. `light` is the default paper chip; `dark` is the navy. */
export const CHIP_CLASS = Object.freeze({ "light-chip": "light", "dark-chip": "dark" });

function providerName(row) {
  return row?.provider || row?.display_name || row?.program_id || "Provider pending";
}

/**
 * Index the shipped logo manifest by every identity a row can be keyed under:
 * its program id, and the folded brand key (so the `shed` alias row finds the
 * `shedrx` asset rather than falling back to text for the same merchant).
 */
export function indexLogoManifest(manifest) {
  if (manifest?.schema !== "glp-provider-logo-manifest-v1" || !Array.isArray(manifest.logos)) {
    throw new Error("provider_logo_manifest_invalid");
  }
  const index = new Map();
  for (const logo of manifest.logos) {
    if (typeof logo.logo_treatment !== "string" || !CHIP_CLASS[logo.logo_treatment]) {
      throw new Error(`provider_logo_treatment_missing:${logo.program_id}`);
    }
    index.set(String(logo.program_id), logo);
    const brand = identityKey(logo.provider);
    if (brand && !index.has(`brand:${brand}`)) index.set(`brand:${brand}`, logo);
  }
  return index;
}

function findLogo(index, row) {
  return index.get(String(row.program_id))
    || index.get(`brand:${identityKey(providerName(row))}`)
    || null;
}

/** The row-shaped logo block a renderer validates, derived from the manifest. */
export function logoBlockFromManifest(entry, row) {
  return {
    path: entry.public_path,
    alt: `${providerName(row)} logo`,
    width: entry.width,
    height: entry.height,
    media_type: entry.media_type,
    surface: entry.surface,
    source_page_url: entry.source_page_url,
    source_asset_url: entry.source_asset_url ?? null,
    verified_as_of: entry.verified_as_of,
    sha256: entry.output_sha256,
    runtime_remote_load: false,
  };
}

/**
 * Decide one row's chip. Mutates and returns the row.
 *
 * A row that already carries a logo block keeps it (its alt text and dates are
 * editorial), but the block is CHECKED against the shipped asset and gains the
 * derived treatment. A row with no block adopts the shipped asset outright.
 * Only a provider with no asset at all reaches the wordmark.
 */
export function decorateProviderChip(row, logoIndex, wordmarkMetrics) {
  const entry = findLogo(logoIndex, row);
  if (entry) {
    if (row.logo && row.logo.sha256 !== entry.output_sha256) {
      // A row pinning a different asset than the one this release ships is a
      // desync, not a preference: fail rather than render a stale mark.
      throw new Error(`provider_logo_row_asset_desync:${row.program_id}`);
    }
    row.logo = {
      ...(row.logo || logoBlockFromManifest(entry, row)),
      treatment: entry.logo_treatment,
      chip_class: CHIP_CLASS[entry.logo_treatment],
      content_scale: entry.logo_fit?.content_scale ?? 1,
    };
    delete row.wordmark;
    return row;
  }
  row.logo = null;
  const name = providerName(row);
  row.wordmark = Object.fromEntries(Object.keys(WORDMARK_CHIPS)
    .map((placement) => [placement, fitWordmark(wordmarkMetrics, name, placement)]));
  // A name so long that even two lines at the minimum legible size cannot hold
  // it would ship a clipped chip - a quieter version of the defect this
  // replaced. Fail the build instead: the answer is a captured logo or a
  // shorter render name, and both are decisions a person should make.
  for (const [placement, fit] of Object.entries(row.wordmark)) {
    if (fit.clipped) {
      throw new Error(`provider_wordmark_cannot_fit:${row.program_id}:${placement}:${name}`);
    }
  }
  return row;
}

/**
 * Decorate every provider row on every comparison page, and report what it did
 * so the build receipt records which providers ship a mark and which ship a
 * fitted wordmark (the count a reader would otherwise have to eyeball).
 */
export function decorateProviderChips(pages, manifest, wordmarkMetrics) {
  const logoIndex = indexLogoManifest(manifest);
  const logoIds = new Set();
  const wordmarkIds = new Set();
  const adopted = new Set();
  for (const page of pages) {
    for (const row of page.rows || []) {
      const had = Boolean(row.logo);
      decorateProviderChip(row, logoIndex, wordmarkMetrics);
      if (row.logo) {
        logoIds.add(String(row.program_id));
        if (!had) adopted.add(String(row.program_id));
      } else {
        wordmarkIds.add(String(row.program_id));
      }
    }
  }
  return {
    schema: "glp-provider-chip-treatment-v1",
    logo_chip_programs: [...logoIds].sort(),
    wordmark_programs: [...wordmarkIds].sort(),
    // Providers whose shipped asset was NOT reaching the row before this join.
    adopted_from_manifest: [...adopted].sort(),
    dark_chip_programs: [...logoIds].sort()
      .filter((id) => logoIndex.get(id)?.logo_treatment === "dark-chip"),
  };
}

/** Wordmark fits for quiz candidates, which are keyed by program id, not rows. */
export function wordmarkFitsFor(candidates, manifest, wordmarkMetrics) {
  const logoIndex = indexLogoManifest(manifest);
  const fits = {};
  for (const candidate of candidates) {
    if (findLogo(logoIndex, candidate)) continue;
    fits[candidate.program_id] = Object.fromEntries(Object.keys(WORDMARK_CHIPS)
      .map((placement) => [placement, fitWordmark(wordmarkMetrics, providerName(candidate), placement)]));
  }
  return fits;
}
