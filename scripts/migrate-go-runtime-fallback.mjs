#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";
import { renderGoRuntimeManifestModule } from "../src/go-runtime-manifest.mjs";

const manifest = {
  schema: GO_RUNTIME_MANIFEST.schema,
  program_registry_schema: GO_RUNTIME_MANIFEST.program_registry_schema,
  site_profile: GO_RUNTIME_MANIFEST.site_profile,
  internal_fallback: "https://glpclinicscout.com/providers/",
  programs: Object.values(GO_RUNTIME_MANIFEST.programs),
};
const output = renderGoRuntimeManifestModule(manifest);
if (output.includes("/best/online-glp-1-providers/")) {
  throw new Error("retired_go_runtime_fallback_survived");
}
await writeFile(new URL("../functions/go/program-manifest.js", import.meta.url), output);
console.log(JSON.stringify({ status: "PASS", programs: manifest.programs.length, internal_fallback: manifest.internal_fallback }));
