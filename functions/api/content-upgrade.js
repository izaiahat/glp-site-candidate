import { handleContentUpgradeRequest } from "../../src/content-upgrade.mjs";

export async function onRequest(context) {
  return handleContentUpgradeRequest(context.request, context.env);
}
