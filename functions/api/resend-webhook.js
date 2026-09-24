import { ingestResendWebhook } from "../../src/resend-email-machine.mjs";

export async function onRequestPost({ request, env }) { return ingestResendWebhook(request, env); }
export async function onRequest() { return new Response("method not allowed", { status: 405, headers: { "cache-control": "no-store" } }); }
