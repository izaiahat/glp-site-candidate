// Which hosts on the open web belong to an APPROVED provider — derived, never
// hand-listed, so a provider wired tomorrow is covered sitewide the same day.
//
// The build gate
// (`scripts/validate-approved-provider-link-monetization.mjs`) needs one
// question answered for every outbound anchor the site ships: "is this host a
// program we are approved with?" If yes, the link must either carry our
// attribution or carry a recorded reason for being bare. A hand-maintained
// domain list would silently go stale the moment a program is added, which is
// exactly the failure mode the operator directive names ("this should have been
// the standard from the start"). So the map is projected from the same governed
// artifacts the site already renders from.

import { readFileSync } from "node:fs";
import { isNonPublicSourceUrl } from "./citation-attribution.mjs";
import {buildAffiliateLinkMap} from './affiliate-link-map.mjs';
import {loadProviderPageContracts} from './provider-cta-contract.mjs';
import {loadGoSelection} from './go-runtime-selection.mjs';

const SITE_PROFILE = "glp-clinic-scout";

// Affiliate-network click redirectors. A link here IS our attribution.
export const TRACKING_HOSTS = Object.freeze(new Set([
  "track.revoffers.com",
  "www.awin1.com",
  "awin1.com",
  "www.tkqlhce.com",
  "www.anrdoezrs.net",
  "www.dpbolvw.net",
  "www.jdoqocy.com",
  "www.kqzyfj.com",
  "click.linksynergy.com",
  "go.skimresources.com",
]));

// Hosts that appear inside provider evidence but are NOT a provider we could
// ever be paid by: regulators, payers, drug manufacturers, standards bodies,
// research indexes, and our own site. Monetizing any of these is impossible and
// citing them is normal editorial practice.
const NON_PROVIDER_HOST_PATTERNS = Object.freeze([
  /(^|\.)glpclinicscout\.com$/i,
  /(^|\.)gov$/i,
  /(^|\.)mil$/i,
  /(^|\.)edu$/i,
  /(^|\.)lilly\.com$/i,
  /(^|\.)novonordisk\.com$/i,
  /(^|\.)novocare\.com$/i,
  /(^|\.)novo-pi\.com$/i,
  /(^|\.)novomedlink\.com$/i,
  /(^|\.)ozempic\.com$/i,
  /(^|\.)wegovy\.com$/i,
  /(^|\.)mounjaro\.com$/i,
  /(^|\.)zepbound\.com$/i,
  /(^|\.)lillycares\.com$/i,
  /(^|\.)endocrine\.org$/i,
  /(^|\.)obesity\.org$/i,
  /(^|\.)ismp\.org$/i,
  /(^|\.)nabp\.pharmacy$/i,
  /(^|\.)legitscript\.com$/i,
  /(^|\.)who\.int$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)trustpilot\.com$/i,
  /(^|\.)bbb\.org$/i,
]);

export function isNonProviderHost(host) {
  return NON_PROVIDER_HOST_PATTERNS.some((pattern) => pattern.test(String(host || "")));
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function addHost(map, host, programId) {
  if (!host || isNonProviderHost(host) || TRACKING_HOSTS.has(host) || isNonPublicSourceUrl(`https://${host}/`)) return;
  if (!map.has(host)) map.set(host, new Set());
  map.get(host).add(programId);
}

function walkSourceUrls(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkSourceUrls(item, visit);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && /^https?:\/\//i.test(value) && /source_url|url$|_url$|urls$/i.test(key)) visit(value);
    else if (Array.isArray(value) && /source_urls?$/i.test(key)) value.filter((item) => typeof item === "string").forEach(visit);
    else walkSourceUrls(value, visit);
  }
}

/**
 * @returns {{
 *   domains: Map<string, {program_ids: string[]}>,
 *   programs: Map<string, {program_id, display_name, monetized, monetized_hrefs: string[], go_route: string|null, suppression: object|null, hosts: string[]}>,
 * }}
 */
function entriesOf(collection) {
  if (!collection || typeof collection !== "object") return [];
  if (Array.isArray(collection)) {
    return collection
      .map((record) => [record?.program_id || record?.programId || record?.registry_id || record?.slug, record])
      .filter(([key]) => typeof key === "string" && key);
  }
  return Object.entries(collection);
}

export function buildApprovedProviderDomainMap({ registry, moneyPageSpecs, contentLedger, providerContracts, approvedRegistry, pricingMatrix, affiliateMap = {} }) {
  const domainToPrograms = new Map();
  const programs = new Map();

  for (const program of registry?.programs || []) {
    const profile = program.profiles?.[SITE_PROFILE];
    if (!profile) continue;
    // "Approved" for this gate = the site publishes it as a live, vertical-fit,
    // wired program. A removed or non-fit program is not a provider we are
    // approved with and its links are ordinary editorial links.
    if (program.commercial_state !== "live" || profile.vertical_fit !== true || profile.wired !== true) continue;
    const slug = program.review_slug || program.program_id;
    const goDisabled = profile.surfaces?.go === false;
    programs.set(slug, {
      program_id: slug,
      registry_id: program.program_id,
      display_name: program.display_name || slug,
      go_route: goDisabled ? null : (program.go?.route || null),
      go_entry_state: program.go?.entry_state || null,
      suppression: goDisabled ? (profile.exceptions?.go || null) : null,
      monetized_hrefs: new Set(),
      hosts: new Set(),
    });
  }

  const slugByRegistryId = new Map((registry?.programs || []).map((program) => [program.program_id, program.review_slug || program.program_id]));
  const resolve = (id) => (programs.has(id) ? id : slugByRegistryId.get(id));
  // Same exact approved-link owner as the renderer; no whole-host exemption.
  for (const [id,link] of Object.entries(affiliateMap)) {
    const entry=programs.get(resolve(id));
    if (entry && link.live===true && /^https:\/\//.test(link.affiliate_href || '')) entry.monetized_hrefs.add(link.affiliate_href);
  }

  for (const page of moneyPageSpecs?.pages || []) {
    for (const row of page.rows || []) {
      const slug = resolve(row.program_id);
      const entry = slug && programs.get(slug);
      if (!entry) continue;
      if (row.source_url) { const host = hostOf(row.source_url); addHost(domainToPrograms, host, slug); entry.hosts.add(host); }
      if (typeof row.affiliate_href === "string" && row.affiliate_href && row.live_link_allowed === true && row.promotion_authorized === true) {
        entry.monetized_hrefs.add(row.affiliate_href);
        const host = hostOf(row.affiliate_href);
        // A transparent-direct program runs its own click entry point on its
        // own domain, so that host is both the tracking host AND a provider
        // host. It is recorded as a provider domain so a BARE link to the same
        // domain still has to answer to the gate.
        if (!TRACKING_HOSTS.has(host)) { addHost(domainToPrograms, host, slug); entry.hosts.add(host); }
      }
    }
  }

  for (const contract of providerContracts?.providers || []) {
    const slug = resolve(contract.program_id);
    const entry = slug && programs.get(slug);
    if (!entry) continue;
    const trackingUrl = contract.network_contract?.tracking_url;
    if (typeof trackingUrl === "string" && trackingUrl) entry.monetized_hrefs.add(trackingUrl);
  }

  for (const program of approvedRegistry?.programs || []) {
    const slug = resolve(program.registry_id);
    const entry = slug && programs.get(slug);
    if (!entry) continue;
    const issued = program.tracking?.provider_issued_url;
    if (typeof issued === "string" && issued) entry.monetized_hrefs.add(issued);
  }

  // Provider research/evidence pages: every first-party URL we captured for a
  // program is, by construction, a page on that provider's own web estate.
  // Governed artifacts spell the program collection two ways — a keyed object
  // and an array of records carrying their own id — so both are walked.
  const ingestKeyed = (collection) => {
    for (const [key, record] of entriesOf(collection)) {
      const slug = resolve(key);
      const entry = slug && programs.get(slug);
      if (!entry) continue;
      walkSourceUrls(record, (url) => {
        const host = hostOf(url);
        addHost(domainToPrograms, host, slug);
        if (host && !isNonProviderHost(host) && !TRACKING_HOSTS.has(host) && !isNonPublicSourceUrl(url)) entry.hosts.add(host);
      });
    }
  };
  ingestKeyed(contentLedger?.programs || contentLedger);
  ingestKeyed(registry?.therapeutic_taxonomy?.programs);
  ingestKeyed(pricingMatrix?.providers);

  const domains = new Map([...domainToPrograms.entries()]
    .map(([host, ids]) => [host, { program_ids: [...ids].sort() }])
    .sort((left, right) => left[0].localeCompare(right[0])));

  const programSummaries = new Map([...programs.entries()].map(([slug, entry]) => [slug, {
    program_id: entry.program_id,
    registry_id: entry.registry_id,
    display_name: entry.display_name,
    go_route: entry.go_route,
    go_entry_state: entry.go_entry_state,
    monetized: entry.monetized_hrefs.size > 0,
    monetized_hrefs: [...entry.monetized_hrefs].sort(),
    suppression: entry.suppression,
    hosts: [...entry.hosts].filter(Boolean).sort(),
  }]));

  return { domains, programs: programSummaries };
}

/**
 * Resolve a host to the approved program that owns it, including hosts on the
 * SAME registrable domain that no artifact happened to capture. A provider's
 * checkout, portal, or help subdomain is still that provider — a link there is
 * a link to them, and the gate must not miss it because the evidence ledger
 * only ever cited `www`.
 */
export function lookupProviderDomain(domains, host) {
  const clean = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!clean) return null;
  if (domains.has(clean)) return { host: clean, ...domains.get(clean) };
  const labels = clean.split(".");
  for (let index = 1; index <= labels.length - 2; index += 1) {
    const candidate = labels.slice(index).join(".");
    if (domains.has(candidate)) return { host: candidate, matched_via: "registrable_domain_rollup", ...domains.get(candidate) };
  }
  // A captured host may itself be a subdomain (`my.gobymeds.com`), so also match
  // a link that sits one level up or across from it on the same estate.
  const suffix = labels.slice(-2).join(".");
  for (const known of domains.keys()) {
    const knownLabels = known.split(".");
    if (knownLabels.slice(-2).join(".") === suffix) return { host: known, matched_via: "shared_registrable_domain", ...domains.get(known) };
  }
  return null;
}

export function loadApprovedProviderDomainMap(root = new URL("../", import.meta.url)) {
  const read = (relative) => JSON.parse(readFileSync(new URL(relative, root), "utf8"));
  const affiliateMap=buildAffiliateLinkMap(read('data/money-page-specs.json').pages,read('data/program-registry.json'),read('data/affiliate-activation-selection.json'),'compare',SITE_PROFILE,{
    providerContracts:loadProviderPageContracts(root),providerFastpath:read('data/provider-fastpath-contract.json'),approvedRegistry:read('data/approved-program-registry.json'),wireInApprovals:read('data/affiliate-wire-in-approvals.json'),goSelection:loadGoSelection(root),
  });
  return buildApprovedProviderDomainMap({
    affiliateMap,
    registry: read("data/program-registry.json"),
    moneyPageSpecs: read("data/money-page-specs.json"),
    contentLedger: read("data/program-content-ledger.json"),
    providerContracts: read("data/provider-page-contracts.json"),
    approvedRegistry: read("data/approved-program-registry.json"),
    pricingMatrix: read("data/provider-pricing-matrix.json"),
  });
}
