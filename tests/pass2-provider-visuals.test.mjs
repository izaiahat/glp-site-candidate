import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { providerVisualKind, renderProviderEvidencePicture } from "../src/pass2-provider-visuals.mjs";

const registry = JSON.parse(await readFile(new URL("../data/program-registry.json", import.meta.url), "utf8"));
const htmlEsc = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;");

test("every governed provider maps to a complete scene or hash-bound local logo fallback", () => {
  for (const program of registry.programs) {
    const visual = providerVisualKind(program);
    const html = renderProviderEvidencePicture(program);
    assert.match(html, new RegExp(`data-provider-visual="${program.program_id}"`));
    assert.match(html, new RegExp(`data-provider-visual-kind="${visual.kind}"`));
    if (visual.kind === "editorial-scene") {
      assert.match(html, /640\.avif 640w, [^\s]+-1280\.avif 1280w/);
      assert.match(html, /640\.webp 640w, [^\s]+-1280\.webp 1280w/);
      assert.match(html, /width="1280" height="720"/);
      const alt = `alt="Original editorial evidence scene for the ${htmlEsc(program.display_name)} provider profile"`;
      assert.ok(html.includes(alt));
    } else {
      assert.match(html, new RegExp(`/assets/provider-logos/${program.program_id}\.webp`));
      assert.match(html, /First-party .* provider logo; editorial scene unavailable/);
      assert.doesNotMatch(html, /provider-review-pass2/);
    }
  }
});
