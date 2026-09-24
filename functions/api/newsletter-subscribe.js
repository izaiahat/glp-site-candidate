import { handleNewsletterSubscribeRequest } from "../../src/newsletter-subscribe.mjs";

export async function onRequest(context) {
  return handleNewsletterSubscribeRequest(context.request, context.env);
}
