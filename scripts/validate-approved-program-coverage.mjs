#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { loadApprovedProgramCoverage, validateApprovedProgramCoverage } from "../src/approved-program-coverage.mjs";

const root = new URL("../", import.meta.url);
const inputs = await loadApprovedProgramCoverage(root);
const result = validateApprovedProgramCoverage(inputs);
const text = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(new URL("../artifacts/ops/approved-53-coverage-gate.json", import.meta.url), text);
process.stdout.write(text);
