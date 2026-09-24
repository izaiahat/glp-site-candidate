import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../artifacts/ultracode/tools/assemble-css.mjs", import.meta.url), "utf8");
assert.match(source, /const output = \[\];/);
assert.doesNotMatch(source, /let output = "";/);
assert.match(source, /output\.join\(""\)\.trim\(\)/);
console.log(JSON.stringify({ status: "PASS", finding: "F01", check: "buffered CSS minifier source contract" }));
