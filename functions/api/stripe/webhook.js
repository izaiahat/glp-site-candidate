import { ingestStripeWebhook, stripeWebhookHealth } from "../../../src/stripe-webhook.mjs";

export async function onRequestPost({ request, env }) { return ingestStripeWebhook(request, env); }
export async function onRequestGet({ env }) { return stripeWebhookHealth(env); }
export async function onRequest() { return new Response("method not allowed", { status: 405, headers: { "cache-control": "no-store" } }); }
