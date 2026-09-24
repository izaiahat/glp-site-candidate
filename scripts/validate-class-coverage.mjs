// Every class a template renders must have a rule somewhere that styles it.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator): the "Related coverage for the next verification step"
// section on review pages rendered as one run-together string -
// "Provider evidence reviewWellorithm reviewOpen the dated evidence…" - because
// the markup was a card list (`<li><a><span class="gcs-kicker">…<strong>…
// <small>…`) and NOTHING in any stylesheet turned those children into blocks.
// The class names existed; the rules for them never did. That is invisible to
// every other gate: the HTML validates, the build passes, the page ships broken.
//
// This closes that whole CLASS of defect. It collects every class name the built
// tree actually renders and every class selector the site ships (site.css plus
// preserved inline <style> blocks), and reports names with no rule anywhere. A
// name with no rule is either dead markup or a section nobody styled - both
// worth knowing before a reader finds it.
//
// It is deliberately advisory-by-default and strict for the classes that carry
// LAYOUT: an unstyled decorative hook is noise, an unstyled card grid is the
// defect above. `--strict` fails on any unknown class.
//
//   node scripts/validate-class-coverage.mjs [--strict]
//
// Exit 0 = PASS, 1 = unstyled layout-bearing classes found.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

//: Hooks that are addressed by JavaScript or by attribute selectors, never by a
//: class rule. Each one is a deliberate exception with a reason.
const BEHAVIOURAL_CLASSES = new Map([
  ["is-active", "toggled by assets/site.js; styled through a compound selector"],
  ["visually-hidden", "utility defined in the shared stylesheet reset"],
]);

//: A class that decides LAYOUT is load-bearing: if it has no rule, the section
//: collapses into run-together text (the 2026-08-18 defect). These prefixes and
//: names are held to the strict standard even without --strict.
const LAYOUT_BEARING = /^(grid|cards?|row|col|stack|list|layout|panel|card|wrap|table|media|tile|flex)(-|$)|(-grid|-cards?|-row|-layout|-wrap|-list|-stack|-tile)$/;

async function walk(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/** Class names that appear in any class selector of a stylesheet. */
export function definedClasses(css) {
  const defined = new Set();
  // Strip declaration blocks so `.foo` inside a `content:".foo"` cannot count.
  const selectorsOnly = css.replace(/\{[^{}]*\}/g, "{}");
  for (const match of selectorsOnly.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(match[1]);
  return defined;
}

/** Class names actually rendered by the built tree, with an example route. */
export async function renderedClasses(publicDir) {
  const rendered = new Map();
  for (const file of await walk(publicDir)) {
    const route = `/${path.relative(publicDir, file).replace(/index\.html$/, "")}`;
    const html = await readFile(file, "utf8");
    // Only real class attributes, never a class name mentioned inside a script.
    const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
    for (const match of body.matchAll(/\sclass="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/).filter(Boolean)) {
        if (!rendered.has(name)) rendered.set(name, route);
      }
    }
  }
  return rendered;
}

/**
 * Every stylesheet the built tree actually applies: inline <style> blocks plus
 * every LOCAL stylesheet any page links. The Google Ads API compliance pages
 * ship their own /google-ads-api/assets/site.css, and a collector that only
 * read the main stylesheet would report every one of their classes as unstyled.
 */
async function pageStylesheets(publicDir) {
  let css = "";
  const linked = new Set();
  for (const file of await walk(publicDir)) {
    const html = await readFile(file, "utf8");
    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css += `\n${match[1]}`;
    for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="(\/[^"?]+)/gi)) linked.add(match[1]);
  }
  for (const href of [...linked].sort()) {
    css += `\n${await readFile(path.join(publicDir, href.replace(/^\//, "")), "utf8").catch(() => "")}`;
  }
  return css;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const publicDir = path.join(ROOT, "public");
  const strict = process.argv.includes("--strict");
  const css = await pageStylesheets(publicDir);
  const defined = definedClasses(css);
  const rendered = await renderedClasses(publicDir);
  const unstyled = [];
  for (const [name, route] of [...rendered].sort()) {
    if (defined.has(name) || BEHAVIOURAL_CLASSES.has(name)) continue;
    unstyled.push({ class: name, first_seen: route, layout_bearing: LAYOUT_BEARING.test(name) });
  }
  const blocking = unstyled.filter((row) => row.layout_bearing || strict);
  const report = {
    status: blocking.length ? "FAIL" : "PASS",
    rendered_classes: rendered.size,
    defined_class_selectors: defined.size,
    unstyled_total: unstyled.length,
    unstyled_layout_bearing: unstyled.filter((row) => row.layout_bearing).length,
    unstyled: unstyled.slice(0, 60),
    blocking,
    why: "A rendered class with no rule anywhere is either dead markup or a section "
      + "nobody styled. The layout-bearing ones are what shipped as run-together text.",
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(blocking.length ? 1 : 0);
}
