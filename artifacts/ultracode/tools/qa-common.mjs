import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { connect } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = process.cwd();
export const PUBLIC = path.join(ROOT, "public");
export const ARTIFACTS = path.join(ROOT, "artifacts", "ultracode");
export const LOGS = path.join(ARTIFACTS, "logs");

const MIME = {
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
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

mkdirSync(LOGS, { recursive: true });

// The root that owns THIS copy of the QA tools: <root>/artifacts/ultracode/tools/qa-common.mjs.
// Identity by location, not by a pinned directory name: a lineage copy of the candidate keeps the
// same package identity under a new directory name, and the pinned basename
// "glp-visual-ultracode-20260821" silently refused every renamed root (GLP-38 WO-15).
export const OWNING_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function assertCandidateRoot() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  let sameTree = false;
  try { sameTree = realpathSync(ROOT) === realpathSync(OWNING_ROOT); } catch { sameTree = false; }
  if (manifest.name !== "glp-clinic-scout-phase2-content-staging" || !sameTree) {
    throw new Error(`qa_wrong_candidate_root:${ROOT}`);
  }
}

export function writeJson(fileName, value) {
  const target = path.isAbsolute(fileName) ? fileName : path.join(ARTIFACTS, fileName);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function safeTarget(directory, rawUrl) {
  const url = new URL(rawUrl, "http://127.0.0.1");
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ""); }
  catch { return null; }
  if (!relative || relative.endsWith("/")) relative += "index.html";
  const target = path.resolve(directory, relative);
  const base = path.resolve(directory) + path.sep;
  if (!target.startsWith(base)) return null;
  try {
    const status = statSync(target);
    if (status.isDirectory()) return path.join(target, "index.html");
    return target;
  } catch {
    try {
      const nested = path.join(target, "index.html");
      if (statSync(nested).isFile()) return nested;
    } catch {}
    return null;
  }
}

// R1 (orchestrator ruling 2026-09-17): every oracle server models the candidate's receipted retirements - the
// public/_redirects table (read from the SERVED directory, so a snapshot carries its own table) and the query-aware
// /best/online-glp-1-providers/ Pages Function - as real 301s. A bare static server recorded 33 receipted retirements
// as 404 findings across the responsive and interaction gates on the final pass. A genuinely missing route still 404s.
async function loadRetirementModel(directory) {
  const { pathToFileURL } = await import("node:url");
  const { parseRedirects, redirectLocation } = await import(pathToFileURL(path.join(ROOT, "scripts", "review-redirects.mjs")).href);
  const { onRequestGet: resolveRetiredProviderRoute } = await import(pathToFileURL(path.join(ROOT, "functions", "best", "online-glp-1-providers", "index.js")).href);
  let redirects = new Map();
  try { redirects = parseRedirects(readFileSync(path.join(directory, "_redirects"), "utf8")); } catch {}
  return async (request) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/best/online-glp-1-providers/") {
      const origin = `http://${request.headers.host || "127.0.0.1"}`;
      const answer = await resolveRetiredProviderRoute({ request: new Request(new URL(request.url || "/", origin)) });
      return { status: answer.status, location: answer.headers.get("location") };
    }
    const redirect = redirects.get(url.pathname);
    if (!redirect) return null;
    return { status: redirect.status, location: redirectLocation(redirect.to, `http://${request.headers.host || "127.0.0.1"}${request.url || "/"}`) };
  };
}

export async function startStaticServer(directory, options = {}) {
  const retirement = await loadRetirementModel(directory);
  const server = createServer(async (request, response) => {
    const modelled = await retirement(request).catch(() => null);
    if (modelled) {
      response.writeHead(modelled.status, { location: modelled.location, "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
      response.end();
      return;
    }
    const target = safeTarget(directory, request.url || "/");
    if (!target) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("not found");
      return;
    }
    try {
      const body = readFileSync(target);
      const headers = {
        "content-type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
        "content-length": String(body.length),
        "cache-control": options.cacheControl || "no-store",
      };
      if (options.csp) headers["content-security-policy"] = options.csp;
      response.writeHead(200, headers);
      if (request.method === "HEAD") response.end(); else response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function localRequest(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
    || parsed.protocol === "data:"
    || parsed.protocol === "blob:";
}

export async function installEgressDeny(context, attempts, options = {}) {
  const extraOrigins = new Set(options.extraOrigins || []);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    let origin = "";
    try { origin = new URL(url).origin; } catch {}
    if (localRequest(url) || extraOrigins.has(origin)) return route.continue();
    attempts.push({
      at: new Date().toISOString(),
      method: request.method(),
      resource_type: request.resourceType(),
      url: url.slice(0, 500),
      body: request.postData()?.slice(0, 500) || null,
      disposition: "ABORTED_DENY_BY_DEFAULT",
    });
    return route.abort("blockedbyclient");
  });
}

export async function dismissConsent(page) {
  const button = page.locator('[data-consent="denied"]');
  if (await button.count()) {
    await button.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(20);
  }
}

export function ensure(condition, message, detail = undefined) {
  if (!condition) {
    const error = new Error(message);
    if (detail !== undefined) error.detail = detail;
    throw error;
  }
}

export function formatError(error) {
  return {
    message: String(error?.message || error),
    detail: error?.detail,
    stack: String(error?.stack || "").split("\n").slice(0, 5).join("\n"),
  };
}

// Same ephemeral test-only cert pattern as tests/a17-loader-browser-helper.mjs:
// openssl writes under TMPDIR, the key/cert are read into memory, and the files
// are removed before the TLS server starts. Never emit key material to reports.
function localTlsIdentity() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "glp-nowrite-tls-"));
  try {
    const key = path.join(directory, "key.pem"), cert = path.join(directory, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
      "-out", cert, "-days", "1", "-subj", "/CN=glpclinicscout.com"], { stdio: "ignore" });
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function startDenyProxy({ snapshotDirectory } = {}) {
  const attempts = [];
  const mappedTunnels = [];
  const sockets = new Set();
  let snapshot = null;
  if (snapshotDirectory) {
    const directory = realpathSync(snapshotDirectory);
    const headers = readFileSync(path.join(directory, "_headers"), "utf8");
    const csp = headers.split("\n").find((row) => row.trim().startsWith("Content-Security-Policy:"))?.trim().replace(/^Content-Security-Policy:\s*/, "");
    if (!csp) throw new Error("nowrite_snapshot_csp_missing");
    snapshot = createTlsServer(localTlsIdentity(), (request, response) => {
      // This server is only accessible through the exact mapped CONNECT. It serves
      // the snapshot bytes, not a synthetic HTML stand-in or a live origin fetch.
      const proposed = safeTarget(directory, request.url || "/");
      let target = null;
      try {
        const resolved = realpathSync(proposed);
        if (resolved.startsWith(`${directory}${path.sep}`) && statSync(resolved).isFile()) target = resolved;
      } catch { /* Missing assets fail closed, including a directory without index.html. */ }
      if (!["GET", "HEAD"].includes(request.method) || !target) {
        response.writeHead(target ? 405 : 404, { "content-security-policy": csp, "cache-control": "no-store" });
        response.end();
        return;
      }
      try {
        const body = readFileSync(target);
        response.writeHead(200, {
          "content-type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
          "content-length": String(body.length),
          "content-security-policy": csp,
          "cache-control": "no-store",
        });
        response.end(request.method === "HEAD" ? undefined : body);
      } catch {
        response.writeHead(404, { "content-security-policy": csp, "cache-control": "no-store" });
        response.end();
      }
    });
    await new Promise((resolve, reject) => {
      snapshot.once("error", reject);
      snapshot.listen(0, "127.0.0.1", resolve);
    });
  }
  const server = createServer((request, response) => {
    attempts.push({
      at: new Date().toISOString(),
      method: request.method,
      target: String(request.url || "").slice(0, 500),
      disposition: "DENIED_BY_LOOPBACK_PROXY",
    });
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("external network denied by ULTRACODE QA");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", (request, socket, head) => {
    if (snapshot && request.url === "glpclinicscout.com:443") {
      const upstream = connect(snapshot.address().port, "127.0.0.1", () => {
        mappedTunnels.push({ at: new Date().toISOString(), method: "CONNECT", target: request.url,
          disposition: "MAPPED_TO_LOOPBACK_SNAPSHOT" });
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
      return;
    }
    attempts.push({
      at: new Date().toISOString(),
      method: "CONNECT",
      target: String(request.url || "").slice(0, 500),
      disposition: "DENIED_BY_LOOPBACK_PROXY",
    });
    socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    attempts,
    mappedTunnels,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      if (snapshot) {
        snapshot.closeAllConnections();
        await new Promise((resolve) => snapshot.close(resolve));
      }
    },
  };
}

export async function spawnLogged(command, args, options = {}) {
  const started = new Date();
  const cwd = options.cwd || ROOT;
  const log = options.log;
  mkdirSync(path.dirname(log), { recursive: true });
  const chunks = [];
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    chunks.push(chunk);
    if (options.tee !== false) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    chunks.push(chunk);
    if (options.tee !== false) process.stderr.write(chunk);
  });
  const exit = await new Promise((resolve) => {
    child.once("error", (error) => {
      chunks.push(Buffer.from(`\nspawn error: ${error.stack || error}\n`));
      resolve(127);
    });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
  const ended = new Date();
  writeFileSync(log, Buffer.concat(chunks));
  return {
    command: [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" "),
    cwd,
    start: started.toISOString(),
    end: ended.toISOString(),
    exit,
    log: path.relative(ROOT, log).split(path.sep).join("/"),
  };
}
