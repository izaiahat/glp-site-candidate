import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

import { onRequestGet as resolveRetiredProviderRoute } from "../functions/best/online-glp-1-providers/index.js";
import { onRequest as resolveGoRoute } from "../functions/go/[program].js";
import { onRequestGet as resolveGeoState } from "../functions/api/geo-state.js";
import { onRequest as resolveReviewCapture } from "../functions/api/review-capture.js";
import { createLocalReviewEnvironment } from "../src/local-review-d1.mjs";
import { parseRedirects, redirectLocation } from "./review-redirects.mjs";

export { parseRedirects, redirectLocation } from "./review-redirects.mjs";

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// GLP_REVIEW_PUBLIC_ROOT lets a READER serve a write-protected snapshot of public/ (readers snapshot, never hold the
// build lock, 2026-09-17) while the Functions, _redirects table and /go resolver stay the candidate's own.
const publicRoot = process.env.GLP_REVIEW_PUBLIC_ROOT ? path.resolve(process.env.GLP_REVIEW_PUBLIC_ROOT) : path.join(candidateRoot, "public");
const queryAwareRoute = "/best/online-glp-1-providers/";

const MIME_TYPES = Object.freeze({
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
});
const COMPRESSIBLE_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".webmanifest", ".xml"]);

export function publicFileForPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const target = path.resolve(publicRoot, `.${relative}`);
  if (target !== publicRoot && !target.startsWith(`${publicRoot}${path.sep}`)) return null;
  return target;
}

async function sendResponse(response, res, method) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  if (method === "HEAD" || response.body === null) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function sendStatic(filePath, res, method, acceptEncoding = "") {
  let details;
  try {
    details = await stat(filePath);
  } catch {
    return false;
  }
  if (!details.isFile()) return false;
  const extension = path.extname(filePath).toLowerCase();
  const compressed = COMPRESSIBLE_EXTENSIONS.has(extension) && /(?:^|[\s,])gzip(?:[\s,;]|$)/i.test(String(acceptEncoding));
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME_TYPES[extension] || "application/octet-stream");
  if (compressed) {
    /* Cloudflare Pages compresses text transport in production. Mirror that
       boundary in review/Lighthouse runs so scores measure the candidate users
       receive rather than an impossible uncompressed local transport. */
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
  } else {
    res.setHeader("Content-Length", String(details.size));
  }
  res.setHeader("Cache-Control", "no-store");
  if (method === "HEAD") {
    res.end();
    return true;
  }
  const source = createReadStream(filePath);
  if (compressed) source.pipe(createGzip()).pipe(res);
  else source.pipe(res);
  return true;
}

export async function createReviewServer(env = {}) {
  const redirects = parseRedirects(await readFile(path.join(publicRoot, "_redirects"), "utf8"));
  return createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const origin = `http://${req.headers.host || "127.0.0.1"}`;
      const requestUrl = new URL(req.url || "/", origin);

      if (requestUrl.pathname === "/api/review-capture") {
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, value);
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request(requestUrl, {
          method,
          headers,
          body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
        });
        const response = await resolveReviewCapture({ request, env });
        await sendResponse(response, res, method);
        return;
      }

      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method not allowed\n");
        return;
      }

      if (requestUrl.pathname === "/api/geo-state") {
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, value);
        }
        const response = await resolveGeoState({ request: new Request(requestUrl, { method, headers }) });
        await sendResponse(response, res, method);
        return;
      }

      if (requestUrl.pathname === queryAwareRoute) {
        const response = await resolveRetiredProviderRoute({ request: new Request(requestUrl) });
        await sendResponse(response, res, method);
        return;
      }

      const goMatch = requestUrl.pathname.match(/^\/go\/([^/]+)\/?$/);
      if (goMatch) {
        const response = await resolveGoRoute({
          request: new Request(requestUrl, { method }),
          params: { program: decodeURIComponent(goMatch[1]) },
          env: {},
        });
        await sendResponse(response, res, method);
        return;
      }

      const redirect = redirects.get(requestUrl.pathname);
      if (redirect) {
        res.writeHead(redirect.status, {
          Location: redirectLocation(redirect.to, requestUrl),
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end(method === "HEAD" ? undefined : `Redirecting to ${redirect.to}\n`);
        return;
      }

      const filePath = publicFileForPath(requestUrl.pathname);
      if (filePath && await sendStatic(filePath, res, method, req.headers["accept-encoding"] || "")) return;

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(method === "HEAD" ? undefined : "Not found\n");
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`Review server error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4500);
  const host = process.env.HOST || "127.0.0.1";
  const localEnvironment = await createLocalReviewEnvironment(process.env.GLP_LOCAL_REVIEW_DB);
  const server = await createReviewServer(localEnvironment);
  server.listen(port, host, () => {
    process.stdout.write(`GLP review server listening on http://${host}:${port}\n`);
  });
}
