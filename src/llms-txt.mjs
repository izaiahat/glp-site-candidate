// llms.txt generator (SPEC-AEO-20260819 §2, §4.1).
//
// Deterministic: byte-stable across releases unless the config or the page set
// changes. HARD-FAILS the candidate when a listed URL is absent from the tree,
// noindex, or robots-disallowed — so llms.txt can never go live dangling.

export const LLMS_TXT_ROUTE = "llms.txt";
const ORIGIN = "https://glpclinicscout.com";

function assertRoute(route, { indexableRoutes, isDisallowed, hasFile }) {
  if (!route.startsWith("/") || !route.endsWith("/")) throw new Error(`llms_txt_route_shape_invalid:${route}`);
  if (!indexableRoutes.has(route)) throw new Error(`llms_txt_route_not_indexable:${route}`);
  if (isDisallowed(route)) throw new Error(`llms_txt_route_robots_disallowed:${route}`);
  if (!hasFile(`${route.replace(/^\//, "")}index.html`)) throw new Error(`llms_txt_route_absent_from_tree:${route}`);
}

export function renderLlmsTxt(config, context) {
  if (config?.schema !== "glp-llms-priority-v1") throw new Error("llms_txt_config_schema_invalid");
  const lines = [`# ${config.title}`, ""];
  for (const line of config.summary) lines.push(`> ${line}`);
  lines.push("", "Key facts for answer engines:");
  for (const fact of config.key_facts) lines.push(`- ${fact}`);
  for (const section of config.sections) {
    lines.push("", `## ${section.heading}`);
    for (const link of section.links) {
      assertRoute(link.route, context);
      lines.push(`- [${link.label}](${ORIGIN}${link.route})${link.note ? `: ${link.note}` : ""}`);
    }
    for (const extra of section.trailing_lines || []) lines.push(extra);
  }
  lines.push("", "## Machine-readable");
  for (const entry of config.machine_readable) {
    if (!context.hasFile(entry.file)) throw new Error(`llms_txt_machine_readable_absent:${entry.file}`);
    if (entry.url !== `${ORIGIN}/${entry.file}`) throw new Error(`llms_txt_machine_readable_url_mismatch:${entry.file}`);
    lines.push(`- ${entry.label}: ${entry.url}`);
  }
  return `${lines.join("\n")}\n`;
}
