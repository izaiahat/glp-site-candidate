import { selectedFamilyStyles } from "./selected-family-styles.mjs";
import { pageSeoCopy } from "./page-seo-copy.mjs";
const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const canonicalHead = (title, description, path, robots = "index,follow,max-image-preview:large", dateModified = null) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${esc(robots)}"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="https://glpclinicscout.com${esc(path)}">${dateModified ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "CollectionPage", name: title, url: `https://glpclinicscout.com${path}`, dateModified })}</script>` : ""}</head>`;

const picture = (stem, alt, priority = false) => `<picture class="p3-review-visual"><source srcset="/assets/images/${stem}-640.avif 640w, /assets/images/${stem}-1280.avif 1280w" sizes="(max-width: 760px) calc(100vw - 32px), 48vw" type="image/avif"><source srcset="/assets/images/${stem}-640.webp 640w, /assets/images/${stem}-1280.webp 1280w" sizes="(max-width: 760px) calc(100vw - 32px), 48vw" type="image/webp"><img src="/assets/images/${stem}-1280.jpg" srcset="/assets/images/${stem}-640.jpg 640w, /assets/images/${stem}-1280.jpg 1280w" sizes="(max-width: 760px) calc(100vw - 32px), 48vw" width="1280" height="720" ${priority ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" alt="${esc(alt)}"></picture>`;

function normalizedReviewRows(programs, logoByProgram = {}) {
  if (!Array.isArray(programs)) throw new Error("review_hub_programs_required");
  const rows = programs
    .filter((row) => row && /^\/reviews\/[a-z0-9-]+\/$/.test(row.review_path || ""))
    .map((row) => ({
      program_id: String(row.program_id || ""),
      display_name: String(row.display_name || ""),
      review_path: row.review_path,
      logo: logoByProgram[row.program_id] || null,
    }))
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
  if (!rows.length || rows.some((row) => !/^[a-z0-9-]+$/.test(row.program_id) || !row.display_name)) {
    throw new Error("review_hub_program_contract_invalid");
  }
  if (new Set(rows.map((row) => row.program_id)).size !== rows.length || new Set(rows.map((row) => row.review_path)).size !== rows.length) {
    throw new Error("review_hub_program_contract_duplicate");
  }
  return rows;
}

function logoMarkup(row) {
  const logo = row.logo;
  if (!logo || !/^\/assets\/provider-logos\/[a-z0-9.-]+\.(?:svg|webp)$/.test(logo.path || "") || !logo.alt) {
    return `<span class="p3-review-card__wordmark" aria-hidden="true">${esc(row.display_name)}</span>`;
  }
  return `<span class="p3-review-card__logo"><img src="${esc(logo.path)}" alt="${esc(logo.alt)}" width="${esc(logo.width)}" height="${esc(logo.height)}" loading="lazy" decoding="async"></span>`;
}

export function renderReviewHubPage({ programs, logoByProgram = {} }) {
  const rows = normalizedReviewRows(programs, logoByProgram);
  const cards = rows.map((row) => `<article class="p3-review-card" data-review-card data-review-name="${esc(row.display_name.toLowerCase())}">${logoMarkup(row)}<p class="p3-kicker">Independent review</p><h2>${esc(row.display_name)}</h2><p>See the sourced facts, known gaps, and commercial relationship state we can verify.</p><a class="cta secondary" href="${esc(row.review_path)}">Read the evidence review</a></article>`).join("");
  return `${canonicalHead("Provider reviews · Clinic Scout", "Browse Clinic Scout provider reviews built from source-dated evidence, with unsupported details left visible as gaps.", "/reviews/")}<body><main class="p3-page p3-review-hub" data-review-hub><section class="p3-review-hero"><div><p class="p3-kicker">Provider review library</p><h1>Evidence first. Gaps left visible.</h1><p>Browse ${rows.length} independent provider review records. A listed page is not an endorsement, and missing facts do not become assumptions.</p><div class="p3-review-hero__actions"><a class="cta primary" href="/reviews/submit/">Share an experience</a><a class="cta secondary" href="/review-standards/">Read the moderation standard</a></div></div>${picture("review-hub-pass2", "Blank evidence cards, a research dossier, and a magnifying glass arranged on a dark editorial desk", true)}</section><section class="p3-review-directory" aria-labelledby="review-directory-title"><div class="p3-review-directory__head"><div><p class="p3-kicker">Source-dated directory</p><h2 id="review-directory-title">Browse provider reviews</h2></div><label class="p3-review-search">Filter by provider name<input type="search" autocomplete="off" data-review-filter aria-controls="review-results" placeholder="Search ${rows.length} providers"><span data-review-count aria-live="polite">${rows.length} reviews</span></label></div><div class="p3-review-grid" id="review-results">${cards}</div><div class="p3-empty" data-review-empty hidden><h3>No review matches that name.</h3><p>Clear the filter or browse the provider comparison.</p><button class="cta secondary" type="button" data-review-filter-clear>Clear filter</button></div></section><section class="p3-review-method"><p class="p3-kicker">What a review means here</p><h2>Publication is a moderation decision, not an automatic outcome.</h2><div class="p3-feature-grid"><article><h3>Source before summary</h3><p>Commercial and service facts need a named, dated source.</p></article><article><h3>Experience before claim</h3><p>Submitted experiences remain held until manual moderation and verification.</p></article><article><h3>Unknown stays unknown</h3><p>No source means a visible gap, not a confident estimate.</p></article></div></section></main><script src="/assets/review-hub.js" defer></script></body></html>`;
}

const MAGNIFIER_SVG = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="6.2" stroke="currentColor" stroke-width="1.8"/><path d="m13.8 13.8 3.6 3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SHIELD_SVG = '<svg class="cs-revhub-trust__shield" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 7.5 3.4v5.1c0 4.6-3.2 7.6-7.5 8.5-4.3-.9-7.5-3.9-7.5-8.5V6.4L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m8.8 11.8 2.2 2.2 4.2-4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CAMERA_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2.4" stroke="currentColor" stroke-width="1.6"/><path d="M8.4 7 10 4.4h4L15.6 7" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13.4" r="3.4" stroke="currentColor" stroke-width="1.6"/></svg>';

function entityMonogram(name) {
  const letters = String(name || "").split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return letters || "?";
}

function entityTile(row) {
  const logo = row.logo;
  if (row.entity_type === "provider" && logo && /^\/assets\/provider-logos\/[a-z0-9.-]+\.(?:svg|webp)$/.test(logo.path || "") && logo.alt) {
    const dark = logo.treatment === "dark-chip" ? " cs-logo-tile--dark" : "";
    return `<span class="cs-logo-tile cs-logo-tile--72${dark}"><img src="${esc(logo.path)}" alt="${esc(logo.alt)}" width="${esc(logo.width)}" height="${esc(logo.height)}" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="cs-wordmark-tile cs-logo-tile--72" aria-hidden="true">${esc(entityMonogram(row.display_name))}</span>`;
}

function collageColumn(tiles, reverse = false) {
  const set = tiles.map(([glyph, copy]) => `<div class="cs-revhub-collage__tile">${glyph ? CAMERA_SVG : ""}<span>${esc(copy)}</span></div>`).join("");
  return `<div class="cs-revhub-collage__col${reverse ? " cs-revhub-collage__col--reverse" : ""}"><div class="cs-revhub-collage__track">${set}<div class="cs-revhub-collage__dup" aria-hidden="true">${set}</div></div></div>`;
}

export function renderReviewDirectoryPage({ programs, pharmacies = [], logoByProgram = {}, dateModified = null }) {
  const seo = pageSeoCopy("/reviews/");
  const providerRows = normalizedReviewRows(programs, logoByProgram).map((row) => ({ ...row, entity_type: "provider", href: row.review_path, cta: "Evidence review" }));
  const pharmacyRows = (Array.isArray(pharmacies) ? pharmacies : pharmacies.entries || [])
    .map((row) => ({
      entity_type: "pharmacy",
      program_id: String(row?.slug || "").trim(),
      display_name: String(row?.display_name || "").trim(),
      href: String(row?.route || "").trim(),
      cta: "Evidence profile",
    }))
    .filter((row) => row.program_id && row.display_name && /^\/pharmacies\/[a-z0-9-]+\/$/.test(row.href))
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
  if (new Set(pharmacyRows.map((row) => row.program_id)).size !== pharmacyRows.length || new Set(pharmacyRows.map((row) => row.href)).size !== pharmacyRows.length) throw new Error("review_hub_pharmacy_contract_duplicate");
  const entityRows = [...providerRows, ...pharmacyRows];
  const cards = entityRows.map((row, index) => `<article class="cs-revhub-card" data-review-card data-review-type="${row.entity_type}" data-review-name="${esc(row.display_name.toLowerCase())}" data-review-index="${index}"><div class="cs-revhub-card__head">${entityTile(row)}<span class="cs-revhub-card__type">${row.entity_type === "provider" ? "Provider" : "Pharmacy"}</span></div><h3>${esc(row.display_name)}</h3><p class="cs-revhub-card__status">Source-dated evidence review</p><div class="cs-revhub-card__actions"><a class="cs-arrowlink" href="${esc(row.href)}">${row.cta} <span class="cs-arrow" aria-hidden="true">→</span></a><a class="cs-revhub-card__share" href="/reviews/submit/?entity=${encodeURIComponent(row.display_name)}&amp;type=${row.entity_type}">Share an experience</a></div></article>`).join("");
  const collage = `<div class="cs-revhub-collage" role="note" aria-label="Reader photo wall placeholder — empty until approved submissions exist">${collageColumn([[true, "Your shipment photo could be the first on this wall"], [false, "Real packaging and paperwork only — no stock photos"], [true, "Photos appear only after review and approval"]])}${collageColumn([[false, "Nothing borrowed, nothing staged"], [true, "Approved reader photos will appear here, dated"], [false, "Only approved reader photos appear here"]], true)}</div>`;
  const hero = `<section class="cs-revhub-hero"><div class="cs-revhub-hero__copy"><p class="p3-kicker">Review and evidence library</p><h1>${seo ? `${esc(seo.h1.slice(0, -7))}<span class="cs-grad-words">${esc(seo.h1.slice(-7))}</span>` : 'Real experiences, <span class="cs-grad-words">verified first</span>.'}</h1><p class="cs-revhub-hero__lede">Browse ${providerRows.length} provider reviews and ${pharmacyRows.length} pharmacy evidence profiles. A listed page is not an endorsement.</p><form class="cs-revhub-search" data-review-hero-search role="search" aria-label="Search reviews and evidence profiles"><input type="search" placeholder="Search providers or pharmacies" autocomplete="off" aria-label="Search providers or pharmacies"><button type="submit" aria-label="Search">${MAGNIFIER_SVG}</button></form><div class="cs-revhub-trust">${SHIELD_SVG}<p>Providers cannot pay to add, edit, or remove reviews here. Every submission is reviewed before publication, and <a href="/how-we-make-money/">affiliate partnerships</a> never change what a review says. <a href="/review-standards/">Read our review standard</a>.</p></div><div class="cs-revhub-write"><p>Used a GLP-1 provider or pharmacy?</p><a class="cs-btn cs-btn--writeglow" href="/reviews/submit/">Write a review <span class="cs-arrow" aria-hidden="true">›</span></a></div><dl class="cs-revhub-state"><div><dt>Approved submitted reviews</dt><dd>0</dd></div><div><dt>Automatic publication</dt><dd>Never</dd></div></dl></div>${collage}</section>`;
  const directory = `<section class="cs-revhub-directory" aria-labelledby="review-directory-title"><div class="cs-revhub-directory__head"><div><p class="p3-kicker">Source-dated directory</p><h2 id="review-directory-title">Browse reviews by provider or pharmacy</h2></div><label class="cs-revhub-filter">Filter by name<input type="search" autocomplete="off" data-review-filter aria-controls="review-results" placeholder="Search ${entityRows.length} profiles"><span data-review-count aria-live="polite">${entityRows.length} evidence profiles</span></label></div><div class="cs-revhub-typerow" role="group" aria-label="Filter by entity type"><button type="button" class="cs-chip-toggle" data-review-type-filter="all" aria-pressed="true">All · ${entityRows.length}</button><span class="sr-only">Choose an entity type.</span><button type="button" class="cs-chip-toggle" data-review-type-filter="provider" aria-pressed="false">Providers · ${providerRows.length}</button><button type="button" class="cs-chip-toggle" data-review-type-filter="pharmacy" aria-pressed="false">Pharmacies · ${pharmacyRows.length}</button></div><div class="cs-revhub-grid" id="review-results">${cards}</div><div class="cs-revhub-empty" data-review-empty hidden><h3>No evidence profile matches.</h3><p>Clear the filters or browse all entities.</p><button class="cta secondary" type="button" data-review-filter-clear>Clear filters</button></div><button class="cta secondary cs-revhub-loadmore" type="button" data-review-load-more>Load more evidence profiles</button></section>`;
  const band = `<section class="cs-revhub-band" aria-labelledby="revhub-band-title"><div class="cs-revhub-band__wash" aria-hidden="true"></div><div class="cs-revhub-band__copy"><h2 id="revhub-band-title">Help the next person choose well.</h2><p>Your experience — good or bad — is checked and published without provider influence.</p></div><a class="cs-btn cs-revhub-band__cta" href="/reviews/submit/">Start your review <span class="cs-arrow" aria-hidden="true">›</span></a></section>`;
  const wall = `<section class="cs-revhub-wall" aria-labelledby="revhub-wall-title"><div class="cs-revhub-wall__copy"><p class="p3-kicker">Recent reviews</p><h2 id="revhub-wall-title">Share what happened. Help someone compare.</h2><p>Submitted experiences are checked before they can appear here.</p><a class="cta secondary" href="/reviews/submit/">Write a review</a></div><div class="cs-revhub-wall__ghosts" aria-hidden="true"><div class="cs-revhub-ghostcard"><span class="cs-revhub-ghostcard__stars">★★★★★</span><span class="cs-revhub-ghostcard__line"></span><span class="cs-revhub-ghostcard__line cs-revhub-ghostcard__line--short"></span><span class="cs-revhub-ghostcard__chip">No reader reviews published yet</span></div><div class="cs-revhub-ghostcard"><span class="cs-revhub-ghostcard__stars">★★★★★</span><span class="cs-revhub-ghostcard__line"></span><span class="cs-revhub-ghostcard__line cs-revhub-ghostcard__line--short"></span><span class="cs-revhub-ghostcard__chip">No reader reviews published yet</span></div><div class="cs-revhub-ghostcard"><span class="cs-revhub-ghostcard__stars">★★★★★</span><span class="cs-revhub-ghostcard__line"></span><span class="cs-revhub-ghostcard__line cs-revhub-ghostcard__line--short"></span><span class="cs-revhub-ghostcard__chip">No reader reviews published yet</span></div></div></section>`;
  const method = `<section class="cs-revhub-method"><p class="p3-kicker">What a submitted review means here</p><h2>Every published review is checked first.</h2><div class="cs-revhub-method__grid"><article><h3>Source before summary</h3><p>Commercial and service facts need a named, dated source.</p></article><article><h3>Experience before claim</h3><p>Submitted experiences are checked and verified before publication.</p></article><article><h3>Unknown stays unknown</h3><p>No source means a visible gap, not a confident estimate.</p></article></div></section>`;
  return `${canonicalHead(seo?.title ?? "Provider reviews and pharmacy evidence · Clinic Scout", seo?.meta ?? "Browse Clinic Scout provider reviews and pharmacy evidence profiles built from source-dated records.", "/reviews/", "index,follow,max-image-preview:large", dateModified)}<body><main class="p3-page cs-revhub" data-review-hub data-review-page-size="24">${selectedFamilyStyles("/reviews/")}${hero.replace(/<dl class="cs-revhub-state">[\s\S]*?<\/dl>/, "")}${directory}${band}${wall}${method}</main><script src="/assets/review-hub.js" defer></script></body></html>`;
}

const REVIEW_PRODUCTS = Object.freeze([
  ["compounded_semaglutide", "Compounded semaglutide"],
  ["compounded_tirzepatide", "Compounded tirzepatide"],
  ["ozempic", "Ozempic"],
  ["wegovy", "Wegovy"],
  ["wegovy_pill", "Wegovy Pill"],
  ["mounjaro", "Mounjaro"],
  ["zepbound", "Zepbound"],
  ["other_or_unsure", "Other or not sure"],
]);

const REVIEW_TYPES = Object.freeze([
  ["overall_experience", "Overall experience"],
  ["billing_and_cost", "Billing and cost"],
  ["service_and_support", "Service and support"],
  ["fulfillment", "Fulfillment"],
  ["other", "Other"],
]);

const publicTag = () => '<span class="cs-tag cs-tag--public">public</span>';
const privateTag = (text = "private") => `<span class="cs-tag cs-tag--private">${esc(text)}</span>`;

function fieldTip(id, text) {
  return `<span class="cs-tipwrap"><button type="button" class="cs-tipdot" aria-label="More about this field" aria-describedby="${id}">i</button><span class="cs-tip" role="tooltip" id="${id}">${esc(text)}</span></span>`;
}

function reviewSelect(name, label, choices, help = "", { required = false, defaultValue = "" } = {}) {
  const helpId = `${name}-help`;
  return `<label class="p5-field"><span>${esc(label)}</span><select name="${esc(name)}"${required ? " required" : ""}${help ? ` aria-describedby="${helpId}"` : ""}><option value=''${defaultValue ? "" : " selected"}>Choose one</option>${choices.map(([value, text]) => `<option value='${esc(value)}'${defaultValue === value ? " selected" : ""}>${esc(text)}</option>`).join("")}</select>${help ? `<small id="${helpId}">${esc(help)}</small>` : ""}</label>`;
}

function reviewStars(prefix, legend) {
  const fieldName = prefix === "primary" ? "rating" : `${prefix}_rating`;
  return `<fieldset class="cs-stars" data-review-rating><legend>${esc(legend)} ${publicTag()}</legend><div class="cs-stars__row">${[1, 2, 3, 4, 5].map((value) => `<label class="cs-stars__item"><input type="radio" name="${fieldName}" value="${value}"${prefix === "primary" ? " required" : ""}><span class="cs-stars__glyph" aria-hidden="true">★</span><span class="sr-only">${value} out of 5</span></label>`).join("")}</div></fieldset>`;
}

function reviewEntityType(prefix, required = false) {
  const fieldName = prefix === "primary" ? "experience_type" : `${prefix}_entity_type`;
  return `<fieldset class="p5-entity-type" data-review-entity-type-group="${prefix}"><legend>${prefix === "primary" ? "What are you reviewing?" : "Related review type"}</legend><div><label><input type="radio" name="${fieldName}" value="provider"${required ? " required" : ""}><span>Provider</span></label><label><input type="radio" name="${fieldName}" value="pharmacy"${required ? " required" : ""}><span>Pharmacy</span></label></div></fieldset>`;
}

function reviewCombobox(prefix, entityCount) {
  const helpId = `${prefix}-entity-help`;
  const fieldName = prefix === "primary" ? "subject_name" : `${prefix}_entity_name`;
  const registrationName = prefix === "primary" ? "entity_registration" : `${prefix}_entity_registration`;
  const inputId = `${prefix}-entity-input`;
  return `<div class="p5-field cs-combobox" data-review-combobox="${prefix}"><label for="${inputId}">${prefix === "primary" ? "Provider or pharmacy" : "Related provider or pharmacy"} ${publicTag()}</label><div class="cs-combobox__control"><input type="search" name="${fieldName}" id="${inputId}" autocomplete="organization"${prefix === "primary" ? " required" : ""} data-review-entity="${prefix}" aria-describedby="${helpId}" placeholder="Start typing a name"><svg class="cs-combobox__chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="cs-combobox__list" data-review-combobox-list hidden></div><small id="${helpId}">Choose from ${entityCount} listed providers and pharmacies. If it is not listed, enter its public name for review.</small><input type="hidden" name="${registrationName}" value="" data-review-entity-registration="${prefix}"></div>`;
}

function reviewDropzone(prefix) {
  const helpId = `${prefix}-evidence-help`;
  const fieldName = prefix === "primary" ? "evidence" : `${prefix}_evidence`;
  const inputId = `${prefix}-evidence-input`;
  return `<div class="p5-upload cs-dropzone" data-review-dropzone="${prefix}"><label for="${inputId}">${prefix === "primary" ? "Add a photo or document" : "Optional related photo or document"} ${privateTag("private until approved")}</label><div class="cs-dropzone__zone" data-review-dropzone-zone>${CAMERA_SVG}<p class="cs-dropzone__cta"><strong>Add a photo</strong><span>or drag and drop one here</span></p><input type="file" name="${fieldName}" id="${inputId}" accept="image/jpeg,image/png,image/webp,application/pdf" data-review-evidence="${prefix}" aria-describedby="${helpId}"></div><div class="cs-dropzone__preview" data-review-dropzone-preview hidden></div><small id="${helpId}">JPEG, PNG, WebP, or PDF. Combined limit: 2 MB. Evidence remains private unless separately approved.</small></div>`;
}

function reviewDetailsDisclosure(prefix) {
  const primary = prefix === "primary";
  return `<details class="cs-intake-more"><summary><span>Product and topic</span><small>${primary ? "Preset to “not sure” — open to adjust" : "Optional detail"}</small></summary><div class="p5-fields-grid">${reviewSelect(`${prefix}_product`, "Product involved", REVIEW_PRODUCTS, "", { required: primary, defaultValue: primary ? "other_or_unsure" : "" })}${reviewSelect(`${prefix}_review_type`, "What part are you reviewing?", REVIEW_TYPES, "", { required: primary, defaultValue: primary ? "overall_experience" : "" })}</div></details>`;
}

function reviewFields(prefix, entityCount) {
  const primary = prefix === "primary";
  return `${reviewEntityType(prefix, primary)}<div class="cs-entity-row">${reviewCombobox(prefix, entityCount)}${reviewStars(prefix, "Overall rating")}</div><div class="p5-fields-grid"><label class="p5-field"><span>Headline ${publicTag()}</span><input type="text" name="${prefix}_headline" minlength="8" maxlength="120"${primary ? " required" : ""} aria-describedby="${prefix}-headline-help"><small id="${prefix}-headline-help">One short line, 8 characters or more.</small></label><label class="p5-field"><span>Experience date ${publicTag()}</span><input type="date" name="${prefix}_experience_date"${primary ? " required" : ""}></label></div><label class="p5-field"><span>Your review ${publicTag()} ${fieldTip(`${prefix}-review-tip`, "Rejected if it contains private health details: diagnoses, doses, prescription or member numbers, insurance IDs, or card numbers.")}</span><textarea name="${prefix}_review_body" minlength="50" maxlength="2000" rows="5"${primary ? " required" : ""} aria-describedby="${prefix}-review-privacy" placeholder="What happened with care, cost, support, or delivery?"></textarea><small id="${prefix}-review-privacy">Describe service, cost, support, or fulfillment — leave out diagnoses, dose or prescription details, member or insurance IDs, and card numbers.</small></label>${reviewDetailsDisclosure(prefix)}${reviewDropzone(prefix)}`;
}

function governedEntityOptions(programs, pharmacies) {
  const aliasNames = new Set((programs || [])
    .filter((row) => row?.review_path && row?.profiles?.["glp-clinic-scout"]?.canonical_identity?.role === "alias")
    .map((row) => String(row.display_name || "")));
  const providerRows = normalizedReviewRows(programs).map((row) => ({ name: row.display_name, type: "provider", disabled: aliasNames.has(row.display_name) }));
  const pharmacyRows = (Array.isArray(pharmacies) ? pharmacies : pharmacies.entries || [])
    .map((row) => ({ name: String(row?.display_name || "").trim(), type: "pharmacy" }))
    .filter((row) => row.name);
  const entities = [...providerRows, ...pharmacyRows].sort((left, right) => left.name.localeCompare(right.name));
  const byName = new Map();
  for (const entity of entities) {
    if (byName.has(entity.name) && byName.get(entity.name) !== entity.type) throw new Error(`review_entity_name_ambiguous:${entity.name}`);
    byName.set(entity.name, entity.type);
  }
  return entities
    .filter((entity, index) => entities.findIndex((candidate) => candidate.name === entity.name) === index)
    .map(({ name, type, disabled = false }) => `<option value="${esc(name)}" data-review-entity-type="${type}"${disabled ? " disabled data-review-entity-alias=\"true\"" : ""}>${type === "provider" ? "Provider" : "Pharmacy"} · ${esc(name)}${disabled ? " (canonical profile only)" : ""}</option>`)
    .join("");
}

export function renderReviewIntakeForm({ programs, pharmacies = [], compact = false }) {
  const entityOptions = governedEntityOptions(programs, pharmacies);
  const entityCount = (entityOptions.match(/data-review-entity-type=/g) || []).length
    - (entityOptions.match(/data-review-entity-alias="true"/g) || []).length;
  const summary = `<div class="cs-form-summary" data-review-summary hidden tabindex="-1"><strong>Check the highlighted fields</strong><ul data-review-summary-list></ul></div>`;
  if (compact) {
    const compactStep = `<section class="p5-step p5-step--compact" data-review-step="primary" aria-label="Share your review"><div class="p5-fields-grid"><label class="p5-field"><span>Display name ${publicTag()} ${fieldTip("display-name-tip", "Shown with your review if it is approved. Use a first name or nickname, not a full legal name.")}</span><input type="text" name="public_display_name" autocomplete="nickname" minlength="1" maxlength="60" required></label><label class="p5-field"><span>Email ${privateTag()} ${fieldTip("verification-email-tip", "Never shown publicly. Used only to verify your submission and answer questions about it.")}</span><input type="email" name="verification_email" autocomplete="email" maxlength="254" required></label></div>${reviewEntityType("primary", true)}<div class="cs-entity-row">${reviewCombobox("primary", entityCount)}${reviewStars("primary", "Overall rating")}</div><div class="p5-fields-grid"><label class="p5-field"><span>Headline ${publicTag()}</span><input type="text" name="primary_headline" minlength="8" maxlength="120" required></label><label class="p5-field"><span>Experience date ${publicTag()}</span><input type="date" name="primary_experience_date" required></label></div><label class="p5-field"><span>Your review ${publicTag()} ${fieldTip("primary-review-tip", "Rejected if it contains diagnoses, doses, prescription or member numbers, insurance IDs, or card numbers.")}</span><textarea name="primary_review_body" minlength="50" maxlength="2000" rows="4" required placeholder="What happened with care, cost, support, or delivery?"></textarea></label><input type="hidden" name="primary_product" value="other_or_unsure"><input type="hidden" name="primary_review_type" value="overall_experience"><section class="p5-review-block p5-review-block--attest cs-attest" aria-label="Review confirmation"><label class="p5-check"><input type="checkbox" name="combined_attestation" required data-review-attestation>This is my truthful experience. I removed private health and payment details. Clinic Scout may contact me to verify it before publication.</label></section><input type="text" name="company" tabindex="-1" autocomplete="off" class="hp capture-honeypot" aria-hidden="true"><div class="p5-actions"><button class="cta primary" type="submit" data-review-submit>Submit for review</button></div></section>`;
    return `<form class="p3-review-form p5-review-form p5-review-form--compact" data-review-page-form data-review-intake data-review-compact method="post" action="/api/review-capture">${summary}${compactStep}<p class="p3-form-status p5-review-receipt" data-review-page-status role="status" aria-live="polite"></p></form><datalist id="review-provider-options">${entityOptions}</datalist>`;
  }
  const primaryStep = `<section class="p5-step" data-review-step="primary" aria-labelledby="review-step-primary-title"><div class="p5-step__heading"><span>Step 1 of 2</span><h3 id="review-step-primary-title">Your review</h3></div><div class="p5-fields-grid"><label class="p5-field"><span>Display name ${publicTag()} ${fieldTip("display-name-tip", "Shown with your review if it is approved. Use a first name or nickname, not a full legal name.")}</span><input type="text" name="public_display_name" autocomplete="nickname" minlength="1" maxlength="60" required aria-describedby="display-name-help"><small id="display-name-help">First name or nickname.</small></label><label class="p5-field"><span>Email ${privateTag()} ${fieldTip("verification-email-tip", "Never shown publicly. Used only to verify your submission and answer questions about it.")}</span><input type="email" name="verification_email" autocomplete="email" maxlength="254" required aria-describedby="verification-email-help"><small id="verification-email-help">Verification only — never displayed.</small></label></div>${reviewFields("primary", entityCount)}<section class="p5-review-block p5-review-block--attest cs-attest" aria-labelledby="review-attestation-title"><h4 id="review-attestation-title">One honest confirmation</h4><label class="p5-check"><input type="checkbox" name="combined_attestation" required data-review-attestation>This is my own truthful experience. I removed private health details — diagnoses, dose or prescription details, member or insurance IDs, and card numbers — from the review and evidence. Clinic Scout may review this submission and contact me to verify it before publication.</label></section><input type="text" name="company" tabindex="-1" autocomplete="off" class="hp capture-honeypot" aria-hidden="true"><div class="p5-actions"><button class="cta primary" type="button" data-review-next>Continue</button></div></section>`;
  const counterpartStep = `<section class="p5-step" data-review-step="counterpart" aria-labelledby="review-step-counterpart-title"><div class="p5-step__heading"><span>Step 2 of 2</span><h3 id="review-step-counterpart-title" data-review-counterpart-title>Add a related second review?</h3><p data-review-counterpart-copy>If your first review is about a provider, you can also describe the pharmacy experience, or vice versa. We only connect them when you name both.</p></div><fieldset class="p5-review-block p5-review-block--optional"><legend>Optional related review</legend>${reviewFields("counterpart", entityCount)}<p class="p5-readiness" data-review-counterpart-readiness role="status">Complete every field to submit both reviews, or skip this optional review.</p></fieldset><div class="p5-actions p5-actions--split"><button class="cta secondary" type="button" data-review-back>Back</button><button class="cta secondary" type="button" data-review-skip>Skip and submit my first review</button><button class="cta primary" type="submit" data-review-submit>Submit both reviews</button></div></section>`;
  return `<form class="p3-review-form p5-review-form" data-review-page-form data-review-intake method="post" action="/api/review-capture" enctype="multipart/form-data"><input type="hidden" name="schema_version" value="review_intake_v2"><ol class="p5-stepper" aria-label="Review submission progress"><li data-review-progress="primary" aria-current="step"><span>1</span><strong>Your review</strong></li><li data-review-progress="counterpart"><span>2</span><strong>Optional second review</strong></li></ol><noscript><p class="p5-noscript">JavaScript is off, so both steps remain visible. Complete the required first review, optionally complete every field for a related second review, then submit.</p></noscript>${summary}${primaryStep}${counterpartStep}<p class="p3-form-status p5-review-receipt" data-review-page-status role="status" aria-live="polite"></p></form><datalist id="review-provider-options">${entityOptions}</datalist>`;
}

export function renderReviewSubmissionPage({ programs, pharmacies = [], dateModified = null }) {
  // frame-ancestors is enforced by the sitewide response header. Browsers ignore
  // it in a meta-delivered policy and emit a console error, so the document-level
  // policy intentionally omits that ineffective duplicate directive.
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";
  const head = canonicalHead("Submit a review · Clinic Scout", "Submit a provider or pharmacy experience for verification. Every submission is reviewed before publication.", "/reviews/submit/", "noindex,follow,noarchive,nosnippet", dateModified)
    .replace("</head>", `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}"></head>`);
  const hero = `<header class="p5-review-intake__hero cs-intake-hero"><p class="p3-kicker">Reader review intake</p><h1>Share your <span class="cs-grad-words">experience</span>.</h1><p class="cs-intake-trust">Fields marked ${publicTag()} may appear if approved; your email stays ${privateTag()}. Every submission is reviewed before publication, providers cannot influence the decision, and <a href="/review-standards/">the standard is public</a>.</p></header>`;
  return `${head}<body><main class="p3-page p5-review-intake cs-intake" data-review-intake-root>${hero}<section class="p5-review-intake__card" aria-labelledby="review-form-title"><div class="p5-review-intake__intro"><p class="p3-kicker">About two minutes</p><h2 id="review-form-title">Share one review, then optionally add another.</h2></div>${renderReviewIntakeForm({ programs, pharmacies })}</section></main><script type="module" src="/assets/review-intake.js" data-review-intake-runtime></script></body></html>`;
}

function renderReviewSubmissionPageLegacy({ programs, pharmacies = [], dateModified = null }) {
  const rows = normalizedReviewRows(programs);
  const pharmacyNames = (Array.isArray(pharmacies) ? pharmacies : pharmacies.entries || [])
    .map((row) => String(row?.display_name || "").trim())
    .filter(Boolean);
  const entities = [...rows.map((row) => ({ name: row.display_name, type: "provider" })), ...pharmacyNames.map((name) => ({ name, type: "pharmacy" }))]
    .sort((left, right) => left.name.localeCompare(right.name));
  const byName = new Map();
  for (const entity of entities) {
    if (byName.has(entity.name) && byName.get(entity.name) !== entity.type) throw new Error(`review_entity_name_ambiguous:${entity.name}`);
    byName.set(entity.name, entity.type);
  }
  const options = [...byName].map(([name, type]) => `<option value="${esc(name)}" data-review-entity-type="${type}"></option>`).join("");
  return `${canonicalHead("Submit a provider experience · Clinic Scout", "Submit a provider experience for verification. Nothing is published automatically.", "/reviews/submit/", "noindex,follow,noarchive,nosnippet", dateModified)}<body><main class="p3-page p3-review-submit"><section class="p3-review-hero"><div><p class="p3-kicker">Review intake</p><h1>Share what happened. Keep private health details out.</h1><p>Your submission is not published automatically. We use the contact details only to verify the experience and resolve questions.</p></div>${picture("review-submit-pass2", "A blank upload card, camera, phone, and sealed evidence envelope on a dark editorial desk", true)}</section><section class="p3-review-form-wrap" aria-labelledby="review-form-title"><div><p class="p3-kicker">Experience submission</p><h2 id="review-form-title">Tell us about the provider interaction.</h2><p>Do not include diagnosis details, prescription numbers, member IDs, insurance IDs, payment-card data, or other sensitive identifiers.</p></div><form class="p3-review-form" data-review-page-form novalidate><fieldset class="p3-entity-type"><legend>What are you reviewing?</legend><div><label><input type="radio" name="experience_type" value="provider" required><span>Provider</span></label><label><input type="radio" name="experience_type" value="pharmacy" required><span>Pharmacy</span></label></div></fieldset><label>Provider or pharmacy<input type="search" name="subject_name" list="review-provider-options" autocomplete="organization" required data-review-entity aria-describedby="review-entity-help"><small id="review-entity-help">Choose an exact entity from the governed review directory.</small></label><datalist id="review-provider-options">${options}</datalist><fieldset class="p3-rating"><legend>Overall rating</legend><div>${[1, 2, 3, 4, 5].map((value) => `<label><input type="radio" name="rating" value="${value}" required><span>${value}<span class="sr-only"> out of 5</span></span></label>`).join("")}</div></fieldset><label>Short headline<input type="text" name="headline" minlength="8" maxlength="120" required></label><label>What happened<textarea name="review" minlength="50" maxlength="2000" rows="8" required></textarea></label><label>When did this happen?<input type="month" name="occurred_month" required></label><label>First name<input type="text" name="first_name" autocomplete="given-name" maxlength="60" required></label><label>Email for verification<input type="email" name="email" autocomplete="email" maxlength="254" required></label><label>Optional evidence<input type="file" name="evidence" accept="image/jpeg,image/png,image/webp,application/pdf" data-review-evidence><small>Optional. Up to 2 MB. Files are held for moderation and never published automatically.</small></label><label class="p3-check"><input type="checkbox" name="truthful_attestation" required>I confirm this describes my own experience and is accurate to the best of my knowledge.</label><label class="p3-check"><input type="checkbox" name="moderation_consent" required>I agree that Clinic Scout may review this submission and contact me for verification.</label><input type="text" name="company" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true"><button class="cta primary" type="submit">Submit for moderation</button><p class="p3-form-status" data-review-page-status role="status" aria-live="polite"></p></form></section></main><script src="/assets/review-hub.js" defer></script></body></html>`;
}
