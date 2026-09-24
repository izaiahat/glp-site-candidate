// Canonical answer-engine entity contract (SPEC-AEO-20260819 P0-C).
//
// One Organization identity for the whole site. Every Article / Review /
// Dataset publisher-or-creator node resolves to this @id instead of minting a
// fresh inline organization, so an answer engine reading any page on the site
// resolves the same publisher.
//
// `sameAs` is deliberately ABSENT: we have no verified external profile yet and
// an empty array is worse than omission (AEO P0-C, P2-L). It gets populated only
// after real profiles exist.

export const SITE_ORIGIN = "https://glpclinicscout.com";
export const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
export const ORGANIZATION_NAME = "GLP Clinic Scout";
export const ORGANIZATION_ALTERNATE_NAME = "Clinic Scout";
export const ORGANIZATION_LEGAL_NAME = "Tilton Group LLC";
export const EDITORIAL_TEAM_ID = `${SITE_ORIGIN}/authors/clinic-scout-editorial-team/#organization`;

// Names that have historically been rendered for OUR publisher entity. Any node
// carrying one of these as a publisher/creator is the same real-world entity and
// collapses onto ORGANIZATION_ID.
export const PUBLISHER_ALIASES = Object.freeze([
  "GLP Clinic Scout",
  "Clinic Scout",
]);

export function canonicalOrganizationNode() {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: ORGANIZATION_NAME,
    alternateName: ORGANIZATION_ALTERNATE_NAME,
    legalName: ORGANIZATION_LEGAL_NAME,
    url: `${SITE_ORIGIN}/`,
    publishingPrinciples: `${SITE_ORIGIN}/editorial-guidelines/`,
  };
}

function isOurPublisherNode(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    typeof value.name === "string" && PUBLISHER_ALIASES.includes(value.name.trim()));
}

/**
 * Collapse publisher/creator references onto the canonical @id, drop empty
 * `sameAs` properties, and give the editorial-team author node a truthful
 * `worksFor` edge. Returns true when anything changed.
 */
export function normalizeEntityNode(node, state) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    let changed = false;
    for (const item of node) changed = normalizeEntityNode(item, state) || changed;
    return changed;
  }
  let changed = false;
  for (const key of ["publisher", "creator", "provider", "sourceOrganization"]) {
    if (isOurPublisherNode(node[key])) {
      node[key] = { "@id": ORGANIZATION_ID };
      state.publisherRefs += 1;
      changed = true;
    }
  }
  if (Array.isArray(node.sameAs) && node.sameAs.length === 0) {
    delete node.sameAs;
    state.emptySameAs += 1;
    changed = true;
  }
  if (node["@id"] === EDITORIAL_TEAM_ID && !node.worksFor) {
    node.worksFor = { "@id": ORGANIZATION_ID };
    changed = true;
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") changed = normalizeEntityNode(value, state) || changed;
  }
  return changed;
}
