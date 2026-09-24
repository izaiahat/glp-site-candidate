import { handleReviewCaptureRequest } from "../../src/review-capture.mjs";

export async function onRequestPost(context) {
  return handleReviewCaptureRequest(context.request, context.env);
}

export async function onRequest(context) {
  return handleReviewCaptureRequest(context.request, context.env);
}
