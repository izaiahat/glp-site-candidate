// Candidate-local editorial copy, separate from identity and sealed clinical evidence.
// Consumed directly by all owning renderers and the later Wave2 writer.
import { readFileSync } from "node:fs";
const contract = JSON.parse(readFileSync(new URL("../data/page-seo-copy.json", import.meta.url), "utf8"));
if (contract.schema !== "clinic-scout-page-seo-v1" || !contract.routes || Array.isArray(contract.routes)) throw new Error("page_seo_contract_invalid");
for (const [route, copy] of Object.entries(contract.routes)) {
  if (!/^\/(?:providers|reviews|pharmacies)\/(?:[a-z0-9-]+\/)?$/.test(route) || !copy || Object.keys(copy).sort().join(",") !== "h1,meta,title" || Object.values(copy).some(value => typeof value !== "string" || !value.trim() || /[<>\r\n]/.test(value))) throw new Error(`page_seo_copy_invalid:${route}`);
  Object.freeze(copy);
}
Object.freeze(contract.routes);
export const pageSeoRoutes = Object.freeze(Object.keys(contract.routes));
export function pageSeoCopy(route) { return Object.hasOwn(contract.routes, route) ? contract.routes[route] : null; }
