import { handleLeadRequest } from "../../src/lead-capture.mjs";

export async function onRequest(context) {
  return handleLeadRequest(context.request, context.env);
}
