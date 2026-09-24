import { handleGoRequest } from "../../src/worker.mjs";
import { GO_RUNTIME_MANIFEST } from "./program-manifest.js";

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }
  if (context.params.program === "_manifest") {
    const body = JSON.stringify({
      schema: GO_RUNTIME_MANIFEST.schema,
      manifest_sha256: GO_RUNTIME_MANIFEST.manifest_sha256,
      program_ids: Object.keys(GO_RUNTIME_MANIFEST.programs).sort(),
    });
    return new Response(method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "application/json; charset=utf-8",
        "X-GLP-Program-Manifest-SHA256": GO_RUNTIME_MANIFEST.manifest_sha256,
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }
  const manifest = {
    internal_fallback: GO_RUNTIME_MANIFEST.internal_fallback,
    programs: Object.values(GO_RUNTIME_MANIFEST.programs),
  };
  const response = await handleGoRequest(context.request, { ...context.env, PROGRAM_MANIFEST: manifest }, context.params.program);
  const headers = new Headers(response.headers);
  headers.set("X-GLP-Program-Manifest-SHA256", GO_RUNTIME_MANIFEST.manifest_sha256);
  return new Response(method === "HEAD" ? null : response.body, { status: response.status, headers });
}
