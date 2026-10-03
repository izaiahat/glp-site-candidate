// The renderer's answer to "which hosts may this program's affiliate link land on?"
//
// It is a READER, not an authority. The authority is
// `scripts/glp_affiliate_link_rails.py::program_allowed_hosts`; the document this
// reads (`data/tracking-allowed-hosts.json`) is that resolver's output, written
// by `scripts/emit-tracking-allowed-hosts.py` as the first step of `npm run build`.
//
// It replaces `src/provider-review.mjs :: DIRECT_TRACKING_HOSTS`, a frozen
// per-network literal that was a third copy of rail knowledge and had no
// `Trackdesk` key — so Nu Image Medical's correctly-resolved link was refused by
// the only component that decides whether the monetized CTA is emitted.
//
// The monetization safety is unchanged in kind and stricter in scope: the old
// literal answered PER NETWORK (every "Direct affiliate" provider shared one
// host set); this answers PER PROGRAM. A program the document does not cover
// throws rather than rendering an unguarded link.
import { readFileSync } from "node:fs";

const SCHEMA = "glp.tracking_allowed_hosts.v1";
const SHIPPED_DOCUMENT = new URL("../data/tracking-allowed-hosts.json", import.meta.url);
const cache = new Map();

// Test/staging seam. It can only REPLACE which derived document is read — it can
// never disable the check, because every path below still refuses a host the
// chosen document does not name, and refuses a document without rail provenance.
// Production sets nothing and reads the shipped document.
function defaultDocument() {
  const override = process.env.GLP_TRACKING_ALLOWED_HOSTS_DOCUMENT;
  return override ? new URL(`file://${override}`) : SHIPPED_DOCUMENT;
}

function normalizeHost(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeNetwork(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function loadTrackingAllowedHosts(source = defaultDocument()) {
  const key = String(source);
  if (cache.has(key)) return cache.get(key);
  let document;
  try {
    document = JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    throw new Error(`tracking_allowed_hosts_document_unreadable:${error.code || error.message}`);
  }
  if (document?.schema !== SCHEMA) throw new Error("tracking_allowed_hosts_document_invalid");
  if (!document.programs || typeof document.programs !== "object") throw new Error("tracking_allowed_hosts_document_invalid");
  if (!document.rails_module?.sha256) throw new Error("tracking_allowed_hosts_provenance_missing");
  cache.set(key, document);
  return document;
}

// Test seam only: the document is read once per process, so a test that writes a
// fixture document needs a way to drop the memo. Production never calls it.
export function resetTrackingAllowedHostsCache() {
  cache.clear();
}

export function trackingNetworkIdentity(programId, network, source = defaultDocument()) {
  const entry = loadTrackingAllowedHosts(source).programs[String(programId)];
  if (!entry?.network || !entry.allowed_hosts?.length) throw new Error(`tracking_allowed_hosts_underived:${programId}`);
  const labels = [entry.network, ...(entry.network_aliases || [])];
  if (network != null && !labels.some(label => normalizeNetwork(label) === normalizeNetwork(network))) {
    throw new Error(`tracking_allowed_hosts_network_drift:${programId}`);
  }
  return entry.network;
}

export function trackingAllowedHosts(programId, network, source = defaultDocument()) {
  const document = loadTrackingAllowedHosts(source);
  const entry = document.programs[String(programId)];
  // Fail by NAME rather than by empty set. An unresolved program must never
  // reach a host comparison that an empty allowlist would silently decide.
  if (!entry || !Array.isArray(entry.allowed_hosts) || entry.allowed_hosts.length === 0) {
    throw new Error(`tracking_allowed_hosts_underived:${programId}`);
  }
  // The document is keyed by program, so a program that changed rails since it
  // was written would otherwise be checked against its OLD rail's hosts.
  if (network == null || trackingNetworkIdentity(programId, network, source) !== entry.network) {
    throw new Error(`tracking_allowed_hosts_network_drift:${programId}`);
  }
  return new Set(entry.allowed_hosts.map(normalizeHost).filter(Boolean));
}

export function isAllowedTrackingHost(programId, network, host, source = defaultDocument()) {
  return trackingAllowedHosts(programId, network, source).has(normalizeHost(host));
}
