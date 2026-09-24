// No public page may publish the internal ops@ alias, and every page that does
// publish an address must publish the one its PURPOSE routes to.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator): the inbox tool sorts incoming mail by alias, and ops@
// is the internal default it sorts AROUND. Every public contact address on the
// site was ops@, so a reader's privacy request, a correction, and a support
// question all arrived in the same unsorted pile.
//
// A plain-text grep is not enough to keep it fixed. Cloudflare's email
// obfuscation rewrites `<a href="mailto:x@y">` into
// `<a href="/cdn-cgi/l/email-protection#<hex>">` with the address XOR-encoded
// (first byte is the key). A check that does not decode that sees a clean page
// and a live reader still sees ops@. This decodes first, then checks - and its
// test pins exactly that, using an encoded ops@ as the failing fixture.
//
//   node scripts/validate-public-email-aliases.mjs [--public <dir>]
//
// Exit 0 = PASS, 1 = violations.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Decode one Cloudflare `data-cfemail` / email-protection hex payload.
 * The first byte is the XOR key; every following byte is one character.
 */
export function decodeCfEmail(hex) {
  if (typeof hex !== "string" || hex.length < 4 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let index = 2; index < hex.length; index += 2) {
    out += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16) ^ key);
  }
  return out;
}

/** Every address on a page, whether written plainly or Cloudflare-obfuscated. */
export function addressesIn(html, domain) {
  const found = new Set();
  const plain = new RegExp(`([A-Za-z0-9._%+-]+)@${domain.replace(/\./g, "\\.")}`, "g");
  for (const match of html.matchAll(plain)) found.add(match[1].toLowerCase());
  // Both shapes Cloudflare emits: the span/anchor attribute and the href hash.
  for (const match of html.matchAll(/data-cfemail="([0-9a-fA-F]+)"/g)) {
    const decoded = decodeCfEmail(match[1]);
    if (decoded && decoded.toLowerCase().endsWith(`@${domain}`)) found.add(decoded.split("@")[0].toLowerCase());
  }
  for (const match of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/g)) {
    const decoded = decodeCfEmail(match[1]);
    if (decoded && decoded.toLowerCase().endsWith(`@${domain}`)) found.add(decoded.split("@")[0].toLowerCase());
  }
  return [...found].sort();
}

/** The aliases a route is allowed to publish. */
export function allowedFor(map, route) {
  for (const rule of map.route_purposes || []) {
    if (new RegExp(rule.match).test(route)) return rule;
  }
  return null;
}

export function auditPage(map, route, html) {
  const violations = [];
  const aliases = addressesIn(html, map.domain);
  if (!aliases.length) return { route, aliases, violations };
  const rule = allowedFor(map, route);
  for (const alias of aliases) {
    if ((map.never_public || []).includes(alias)) {
      violations.push({
        route, alias,
        code: "internal_alias_published",
        why: map.never_public_reason,
      });
      continue;
    }
    if (!map.aliases[alias]) {
      violations.push({ route, alias, code: "alias_not_in_map",
        why: "an address the alias map does not define cannot be sorted by purpose" });
      continue;
    }
    if (rule && !rule.allowed.includes(alias)) {
      violations.push({ route, alias, code: "alias_wrong_for_page_purpose",
        purpose: rule.purpose, allowed: rule.allowed,
        why: `this route's purpose is ${rule.purpose}; mail sent here would land on the wrong desk` });
    }
  }
  return { route, aliases, violations };
}

async function walk(directory, base, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const publicDir = process.argv.includes("--public")
    ? process.argv[process.argv.indexOf("--public") + 1]
    : path.join(ROOT, "public");
  const map = JSON.parse(await readFile(path.join(ROOT, "data/email-alias-map.json"), "utf8"));
  if (map.schema !== "glp-public-email-alias-map-v1") throw new Error("email_alias_map_invalid");
  const files = await walk(publicDir, publicDir);
  const violations = [];
  const pages = {};
  for (const file of files) {
    const route = `/${path.relative(publicDir, file).replace(/index\.html$/, "")}`;
    const audit = auditPage(map, route, await readFile(file, "utf8"));
    if (audit.aliases.length) pages[route] = audit.aliases;
    violations.push(...audit.violations);
  }
  const report = {
    status: violations.length ? "FAIL" : "PASS",
    pages_scanned: files.length,
    pages_publishing_an_address: Object.keys(pages).length,
    addresses_by_route: pages,
    cfemail_decoding: "enabled",
    violations,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(violations.length ? 1 : 0);
}
