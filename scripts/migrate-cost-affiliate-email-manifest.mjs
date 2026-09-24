#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import { buildCostCalculatorData } from "../src/cost-calculator.mjs";
import {
  costCalculatorAffiliateLinks,
  renderCostAffiliateEmailManifestModule,
} from "../src/cost-calculator-affiliate.mjs";

const readJson = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));

const [config, money, providerContracts, providerFastpath, registry, selection] = await Promise.all([
  readJson("cost-calculator.json"),
  readJson("money-page-specs.json"),
  readJson("provider-page-contracts.json"),
  readJson("provider-fastpath-contract.json"),
  readJson("program-registry.json"),
  readJson("affiliate-activation-selection.json"),
]);

const calculator = buildCostCalculatorData(config, money.pages, providerContracts, providerFastpath, registry, 'glp-clinic-scout', new Set(), await readJson('provider-pricing-matrix.json'));
const {governedEmailAffiliateLinks}=await import('../src/cost-calculator-affiliate.mjs');
const links = governedEmailAffiliateLinks(money.pages, registry, selection);
const output = renderCostAffiliateEmailManifestModule(links);
const target = new URL("../src/cost-affiliate-email-manifest.generated.mjs", import.meta.url);
await writeFile(target, output);
console.log(JSON.stringify({ status: "PASS", programs: links.length, target: target.pathname }));
