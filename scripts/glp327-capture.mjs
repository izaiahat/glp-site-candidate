// Bounded, unauthenticated preview-only browser checks; never a site build.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = resolve(process.argv[2] || "reports/glp327/captures");
const sha = b => createHash("sha256").update(b).digest("hex");
const files = ["reports/glp327/preview.html", "assets/site-p3.css", "src/sponsor-placement-candidate.mjs"];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async p => [p, sha(await readFile(resolve(root, p)))])));
await mkdir(out, { recursive: true });
const before = await hashes();
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = resolve(root, "." + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { "content-type": ({ ".html": "text/html", ".css": "text/css", ".webp": "image/webp", ".woff2": "font/woff2" })[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
const base = await new Promise((ok, bad) => server.listen(0, "127.0.0.1", e => e ? bad(e) : ok(`http://127.0.0.1:${server.address().port}`)));
let browser;
const checks = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", reducedMotion: "reduce" });
    const blocked = [], errors = [], responses = [];
    await context.route("**/*", async route => {
      const request = route.request(), url = request.url();
      if (url.startsWith(base + "/") && ["GET", "HEAD"].includes(request.method())) await route.continue();
      else { blocked.push({ url, method: request.method() }); await route.abort("blockedbyclient"); }
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("response", r => responses.push({ path: r.url().replace(base, ""), status: r.status() }));
    const response = await page.goto(base + "/reports/glp327/preview.html", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // Screenshot first, then sample geometry and bitmap. The source-bound two-card
    // preview is intentionally eager so full-page capture cannot skip its text.
    const path = resolve(out, `${name}-${width}x${height}.png`);
    const png = await page.screenshot({ path, fullPage: true, animations: "disabled" });
    const dom = await page.evaluate(async data => {
      const cards = [...document.querySelectorAll("#provider-results article[data-program]")];
      const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; };
      const prices = cards.flatMap(c => [...c.querySelectorAll(".p3-source-price>strong")].map(e => {
        const r = document.createRange(); r.selectNodeContents(e);
        const rects = [...r.getClientRects()].map(x => ({ x: x.x, y: x.y, width: x.width, height: x.height }));
        return { program: c.dataset.program, text: e.textContent.trim(), rects, lineHeight: getComputedStyle(e).lineHeight, container: box(e.parentElement) };
      }));
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      const paint = cards.map(c => {
        const h = c.querySelector("h3"), b = box(h), region = { x: Math.ceil(b.x), y: Math.ceil(b.y), width: Math.floor(b.width), height: Math.floor(b.height) };
        if (region.width < 2 || region.height < 2) return { program: c.dataset.program, heading: h.textContent.trim(), headingRegion: region, colors: 0, transitions: 0, card: box(c), contentVisibility: getComputedStyle(c).contentVisibility, headingVisible: getComputedStyle(h).visibility };
        const pixels = ctx.getImageData(region.x, region.y, region.width, region.height).data;
        const colors = new Set(); let transitions = 0;
        for (let y = 1; y < region.height - 1; y += 2) for (let x = 1; x < region.width - 1; x += 2) {
          const i = (y * region.width + x) * 4, left = i - 4;
          colors.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
          if (Math.abs(pixels[i] - pixels[left]) + Math.abs(pixels[i + 1] - pixels[left + 1]) + Math.abs(pixels[i + 2] - pixels[left + 2]) > 85) transitions++;
        }
        return { program: c.dataset.program, heading: h.textContent.trim(), headingRegion: region, colors: colors.size, transitions, card: box(c), contentVisibility: getComputedStyle(c).contentVisibility, headingVisible: getComputedStyle(h).visibility };
      });
      const sponsor = document.querySelector("[data-sponsor-placement-candidate]");
      return { paint, prices, scrollWidth: document.documentElement.scrollWidth, banner: document.querySelector(".glp327-preview-banner")?.innerText, sponsorBeforeResults: !!(sponsor.compareDocumentPosition(document.querySelector("#provider-results")) & Node.DOCUMENT_POSITION_FOLLOWING), interactive: document.querySelectorAll("a,button,input,form,script,iframe").length, cssLoaded: [...document.styleSheets].some(s => s.href?.endsWith("/assets/site-p3.css")) };
    }, png.toString("base64"));
    const failures = [];
    if (response?.status() !== 200 || responses.some(r => r.status !== 200) || !dom.cssLoaded) failures.push("local asset load");
    if (blocked.length || errors.length) failures.push("unexpected request/page error");
    if (dom.scrollWidth > width + 1) failures.push("horizontal overflow");
    if (!dom.banner?.includes("VIEW-ONLY INTERNAL PROPOSAL") || !dom.sponsorBeforeResults || dom.interactive) failures.push("limited/inert sponsor contract");
    if (dom.paint.map(c => c.program).join(",") !== "snagrx,yucca-health-xentraffic-offer-3117") failures.push("organic order");
    // Regression 1: actual currency glyph ranges must occupy one line inside
    // their price containers; outer-card width/innerText alone cannot prove it.
    if (dom.prices.length !== 4 || dom.prices.some(p => p.rects.length !== 1 || p.rects[0].height > parseFloat(p.lineHeight) * 1.5 || p.rects[0].width < 35 || p.rects[0].width > p.container.width)) failures.push("currency glyphs wrap or lack room");
    // Regression 2: sample heading-region pixels from the *captured PNG* for
    // both cards. A blank content-visibility rectangle has no text edges.
    if (dom.paint.length !== 2 || dom.paint.some(c => c.transitions < 12 || c.colors < 12 || c.headingVisible !== "visible")) failures.push("card text not painted in captured frame");
    checks.push({ name, viewport: { width, height }, status: failures.length ? "FAIL" : "PASS", failures, image: path, imageSha256: sha(png), imageBytes: png.length, dom, blocked, errors, responses });
    await context.close();
  }
} catch (e) { checks.push({ status: "EXECUTION_ERROR", error: String(e), stack: e.stack }); }
finally { if (browser) await browser.close(); await new Promise(ok => server.close(ok)); }
const after = await hashes();
const result = { status: checks.length === 2 && checks.every(c => c.status === "PASS") && JSON.stringify(before) === JSON.stringify(after) ? "PASS" : "FAIL", head: (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), before, after, checks, scope: "Limited internal two-card excerpt, not a complete private build or live-site acceptance." };
await writeFile(resolve(out, "CAPTURE.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ status: result.status, head: result.head, checks: checks.map(c => ({ name: c.name, status: c.status, failures: c.failures, image: c.image })) }));
if (result.status !== "PASS") process.exitCode = 1;
