import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

test("D2k retired EPC renderer cannot be re-imported or silently restored", () => {
  assert.equal(existsSync(new URL("../src/funnel-v2.mjs", import.meta.url)), false);
  for (const directory of ["src", "scripts"]) {
    const root = new URL(`../${directory}/`, import.meta.url);
    for (const file of readdirSync(root, { recursive: true }).filter((name) => /\.(?:mjs|js|ts|py)$/.test(name))) {
      const source = readFileSync(new URL(file, root), "utf8");
      assert.doesNotMatch(source, /renderFunnelV2DecisionModule|orderProvidersByFunnelEconomics|funnelV2Economics|funnelV2GoHref|funnelV2OutboundMode|["'][^"']*funnel-v2\.mjs["']/, `${directory}/${file}`);
    }
  }
});