import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const BASE_URL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4500";
const OUT_DIR = process.env.CENSUS_OUT_DIR || "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/PAGE-SPECS-20260826/ours-hygiene-census";
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.CENSUS_CONCURRENCY || 4)));
const CATEGORY_LABELS = {
  "blue-family-cta-link": "Blue-family CTA-like links",
  "no-hover-state-change": "Buttons or anchor-buttons with no hover-state change",
  "contrast-below-4.5": "Heading/card-title/button-label contrast below 4.5:1",
  "overflow-or-clipping": "Overflow, clipping, or horizontal page overflow",
  "left-aligned-dead-space": "Narrow left-aligned section content with excess right dead space",
  "flat-colour-provider-logo": "Provider logos rendering as at least 95% one flat colour",
  "heading-to-first-card-row-over-850": "Heading top to first card-row bottom over 850px",
};

function sitemapRoutes() {
  const xml = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
  const routes = [...xml.matchAll(/<loc>https:\/\/glpclinicscout\.com([^<]*)<\/loc>/g)]
    .map((match) => match[1] || "/")
    .map((route) => route.startsWith("/") ? route : `/${route}`);
  if (!routes.length) throw new Error("sitemap_has_no_routes");
  return [...new Set(routes)];
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  screen: { width: 1440, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-US",
  serviceWorkers: "block",
});
const externalRequests = [];
await context.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE_URL) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
  externalRequests.push(url.slice(0, 500));
  return route.abort();
});

async function inspectGeometry(page, route) {
  return page.evaluate(({ route, categoryLabels }) => {
    const findings = [];
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01;
    };
    const text = (element) => (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180);
    const selector = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const data = [...element.attributes].find((attribute) => attribute.name.startsWith("data-") && attribute.value);
      if (data) return `${element.tagName.toLowerCase()}[${data.name}="${CSS.escape(data.value)}"]`;
      const classes = [...element.classList].filter((value) => !/^(is-|has-|active|open|visible|selected)/.test(value)).slice(0, 3);
      const base = `${element.tagName.toLowerCase()}${classes.map((value) => `.${CSS.escape(value)}`).join("")}`;
      const siblings = element.parentElement ? [...element.parentElement.children].filter((item) => item.tagName === element.tagName) : [];
      return siblings.length > 1 ? `${base}:nth-of-type(${siblings.indexOf(element) + 1})` : base;
    };
    const add = (category, element, detail) => findings.push({
      page: route,
      category,
      selector: typeof element === "string" ? element : selector(element),
      text: typeof element === "string" ? "" : text(element),
      detail,
    });
    const rgb = (value) => {
      const match = String(value).match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,\/]\s*([\d.]+))?\s*\)/i);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
    };
    const composite = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    };
    const resolvedBackground = (element) => {
      let accumulated = [0, 0, 0, 0];
      let current = element;
      let imageBacked = false;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (style.backgroundImage !== "none") imageBacked = true;
        const layer = rgb(style.backgroundColor);
        if (layer && layer[3] > 0) accumulated = composite(accumulated, layer);
        if (accumulated[3] >= 0.999) break;
        current = current.parentElement;
      }
      return { rgba: composite(accumulated, [255, 255, 255, 1]), imageBacked };
    };
    const linear = (channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color) => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
    const contrast = (left, right) => {
      const a = luminance(left);
      const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const isBlue = (color) => {
      if (!color || color[3] < 0.1) return false;
      const [r, g, b] = color;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min < 24) return false;
      return b > r * 1.12 && b >= g * 0.92 && b - r > 30;
    };
    const buttonLike = (element) => {
      if (element.tagName === "BUTTON" || element.getAttribute("role") === "button") return true;
      const style = getComputedStyle(element);
      const classText = `${element.className || ""} ${element.getAttribute("data-analytics-event") || ""}`;
      const label = text(element);
      return /btn|button|cta|action|pill/i.test(classText)
        || (/^(get|find|compare|start|check|take|show|submit|browse|explore|see|open|learn|read|search|calculate|join|subscribe)\b/i.test(label) && element.getBoundingClientRect().height >= 28)
        || (["inline-flex", "flex"].includes(style.display) && Number.parseFloat(style.borderRadius) >= 10 && element.getBoundingClientRect().height >= 28 && element.getBoundingClientRect().height <= 100);
    };

    for (const anchor of [...document.querySelectorAll("a[href]")].filter(visible)) {
      if (!buttonLike(anchor)) continue;
      const style = getComputedStyle(anchor);
      const colors = [rgb(style.color), rgb(style.backgroundColor), rgb(style.borderTopColor)];
      if (colors.some(isBlue)) add("blue-family-cta-link", anchor, {
        confidence: "high",
        color: style.color,
        background_color: style.backgroundColor,
        border_color: style.borderTopColor,
        href_inspected_only: anchor.getAttribute("href"),
      });
    }

    const contrastCandidates = [...new Set([
      ...document.querySelectorAll("h1,h2,h3,h4,h5,h6,button,[role=button]"),
      ...document.querySelectorAll('[class*="card"] strong,[class*="card"] [class*="title"],a.cs-btn,a.gcs-button,a[class*="cta"]'),
    ])].filter((element) => visible(element) && text(element));
    for (const element of contrastCandidates) {
      const style = getComputedStyle(element);
      const foregroundRaw = rgb(style.color);
      if (!foregroundRaw) continue;
      const background = resolvedBackground(element);
      const foreground = composite(foregroundRaw, background.rgba);
      const ratio = contrast(foreground, background.rgba);
      if (ratio < 4.5) add("contrast-below-4.5", element, {
        confidence: background.imageBacked ? "low" : "high",
        ratio: Number(ratio.toFixed(2)),
        foreground: style.color,
        resolved_background: `rgba(${background.rgba.map((value, index) => index < 3 ? Math.round(value) : Number(value.toFixed(3))).join(", ")})`,
        note: background.imageBacked ? "Resolved color layers were measured, but a gradient or image also contributes to the real background." : "Resolved through ancestor background-color layers.",
      });
    }

    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) add("overflow-or-clipping", "html", {
      confidence: "high",
      kind: "horizontal-page-overflow",
      scroll_width: doc.scrollWidth,
      client_width: doc.clientWidth,
      overflow_px: doc.scrollWidth - doc.clientWidth,
    });
    for (const element of [...document.querySelectorAll("body *")].filter(visible)) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const clipX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
      const clipY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
      const outside = rect.left < -2 || rect.right > doc.clientWidth + 2;
      if (clipX || clipY || outside) {
        const intentionalRail = /rail|track|marquee|carousel|scroller|overflow/i.test(String(element.className || ""));
        add("overflow-or-clipping", element, {
          confidence: intentionalRail ? "low" : "high",
          kind: [clipX && "clipped-x", clipY && "clipped-y", outside && "outside-page-x"].filter(Boolean),
          client: { width: element.clientWidth, height: element.clientHeight },
          scroll: { width: element.scrollWidth, height: element.scrollHeight },
          rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
          overflow: { x: style.overflowX, y: style.overflowY },
          note: intentionalRail ? "Low-confidence heuristic: class name suggests intentional rail/carousel clipping." : "",
        });
      }
    }

    for (const section of [...document.querySelectorAll("main section")].filter(visible)) {
      const sectionRect = section.getBoundingClientRect();
      const style = getComputedStyle(section);
      const leftEdge = sectionRect.left + Number.parseFloat(style.paddingLeft || "0");
      const rightEdge = sectionRect.right - Number.parseFloat(style.paddingRight || "0");
      const containerWidth = rightEdge - leftEdge;
      if (containerWidth < 200) continue;
      const children = [...section.children].filter((element) => visible(element) && getComputedStyle(element).position !== "absolute" && element.getAttribute("aria-hidden") !== "true");
      if (!children.length) continue;
      const rects = children.map((element) => element.getBoundingClientRect());
      const contentLeft = Math.min(...rects.map((rect) => rect.left));
      const contentRight = Math.max(...rects.map((rect) => rect.right));
      const contentWidth = Math.max(0, contentRight - contentLeft);
      const widthRatio = contentWidth / containerWidth;
      const leftDead = Math.max(0, contentLeft - leftEdge) / containerWidth;
      const rightDead = Math.max(0, rightEdge - contentRight) / containerWidth;
      if (widthRatio < 0.7 && leftDead <= 0.15 && rightDead > 0.15) add("left-aligned-dead-space", section, {
        confidence: "low",
        content_width_ratio: Number(widthRatio.toFixed(3)),
        left_dead_space_ratio: Number(leftDead.toFixed(3)),
        right_dead_space_ratio: Number(rightDead.toFixed(3)),
        container_width_px: Math.round(containerWidth),
        content_width_px: Math.round(contentWidth),
        note: "Low-confidence geometry heuristic; asymmetric editorial compositions may be intentional.",
      });
    }

    const logos = [...document.querySelectorAll("img")].filter((element) => visible(element) && /logo|provider/i.test(`${element.alt} ${element.src} ${element.className}`));
    for (const image of logos) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.clearRect(0, 0, 32, 32);
        context.drawImage(image, 0, 0, 32, 32);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        const buckets = new Map();
        let sampled = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 16) continue;
          sampled += 1;
          const key = `${Math.round(pixels[index] / 16) * 16},${Math.round(pixels[index + 1] / 16) * 16},${Math.round(pixels[index + 2] / 16) * 16},${Math.round(pixels[index + 3] / 32) * 32}`;
          buckets.set(key, (buckets.get(key) || 0) + 1);
        }
        const dominant = [...buckets.entries()].sort((left, right) => right[1] - left[1])[0];
        const ratio = sampled && dominant ? dominant[1] / sampled : 0;
        if (sampled && ratio >= 0.95) add("flat-colour-provider-logo", image, {
          confidence: sampled < 80 ? "low" : "high",
          dominant_colour_bucket: dominant[0],
          dominant_ratio: Number(ratio.toFixed(4)),
          sampled_nontransparent_pixels: sampled,
          source_inspected_only: image.getAttribute("src"),
          note: sampled < 80 ? "Low-confidence heuristic because few nontransparent pixels survived the 32×32 sample." : "Canvas sample quantized channels to 16-level buckets.",
        });
      } catch (error) {
        add("flat-colour-provider-logo", image, { confidence: "low", sample_error: String(error), note: "Logo could not be canvas-sampled; retained as a low-confidence finding rather than dropped." });
      }
    }

    for (const container of [...document.querySelectorAll("main,main section")].filter(visible)) {
      const heading = container.querySelector(":scope > h1,:scope > h2,:scope > h3,:scope > div > h1,:scope > div > h2,:scope > div > h3,.section-heading h1,.section-heading h2,.section-heading h3");
      if (!heading || !visible(heading)) continue;
      const headingRect = heading.getBoundingClientRect();
      const cardCandidates = [...container.querySelectorAll(':scope > [class*="grid"] > [class*="card"],:scope > [class*="grid"] > article,:scope > div > [class*="card"],:scope > article,:scope > ul > li')]
        .filter((element) => visible(element) && element.getBoundingClientRect().top >= headingRect.top - 1);
      if (!cardCandidates.length) continue;
      const firstTop = Math.min(...cardCandidates.map((element) => element.getBoundingClientRect().top));
      const firstRow = cardCandidates.filter((element) => Math.abs(element.getBoundingClientRect().top - firstTop) <= 12);
      const firstRowBottom = Math.max(...firstRow.map((element) => element.getBoundingClientRect().bottom));
      const span = firstRowBottom - headingRect.top;
      if (span > 850) add("heading-to-first-card-row-over-850", container, {
        confidence: "high",
        heading_selector: selector(heading),
        heading_text: text(heading),
        first_row_card_count: firstRow.length,
        heading_top_to_first_row_bottom_px: Math.round(span),
      });
    }

    const hoverTargets = [...new Set([...document.querySelectorAll("button,[role=button],a[href]")])]
      .filter((element) => visible(element) && buttonLike(element));
    const hoverStyle = (element) => {
      const regular = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      const after = getComputedStyle(element, "::after");
      const pick = (style) => ({
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
        boxShadow: style.boxShadow,
        transform: style.transform,
        textDecoration: style.textDecorationLine,
        opacity: style.opacity,
        filter: style.filter,
      });
      return { regular: pick(regular), before: pick(before), after: pick(after) };
    };
    const hover = hoverTargets.map((element, index) => {
      const marker = `census-hover-${index + 1}`;
      element.setAttribute("data-census-hover", marker);
      return { marker, selector: selector(element), text: text(element), before: hoverStyle(element) };
    });
    return { findings, hover, categoryLabels };
  }, { route, categoryLabels: CATEGORY_LABELS });
}

async function inspectPage(route) {
  const page = await context.newPage();
  page.setDefaultTimeout(200);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || response.status() >= 400) throw new Error(`http_${response?.status() || "no_response"}`);
    await page.evaluate(async () => {
      const assetSettlement = Promise.allSettled([
        document.fonts?.ready,
        ...[...document.images].map((image) => image.complete ? undefined : image.decode()),
      ]);
      await Promise.race([
        assetSettlement,
        new Promise((resolveTimeout) => window.setTimeout(resolveTimeout, 2_000)),
      ]);
    });
    await page.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}" });
    await page.waitForTimeout(50);
    const result = await inspectGeometry(page, route);
    console.log(`census start ${route} hover_targets=${result.hover.length}`);

    for (const target of result.hover) {
      const locator = page.locator(`[data-census-hover="${target.marker}"]`);
      try {
        await page.hover(`[data-census-hover="${target.marker}"]`, { force: true, timeout: 100 });
        const after = await locator.evaluate((element) => {
          const pick = (style) => ({
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderTopColor,
            boxShadow: style.boxShadow,
            transform: style.transform,
            textDecoration: style.textDecorationLine,
            opacity: style.opacity,
            filter: style.filter,
          });
          return { regular: pick(getComputedStyle(element)), before: pick(getComputedStyle(element, "::before")), after: pick(getComputedStyle(element, "::after")) };
        });
        if (JSON.stringify(target.before) === JSON.stringify(after)) result.findings.push({
          page: route,
          category: "no-hover-state-change",
          selector: target.selector,
          text: target.text,
          detail: { confidence: "high", compared_properties: ["color", "backgroundColor", "borderColor", "boxShadow", "transform", "textDecoration", "opacity", "filter"], pseudo_elements_compared: ["::before", "::after"] },
        });
      } catch (error) {
        result.findings.push({
          page: route,
          category: "no-hover-state-change",
          selector: target.selector,
          text: target.text,
          detail: { confidence: "low", hover_probe_error: String(error), note: "Hover comparison could not complete; retained as low-confidence rather than dropped." },
        });
      }
    }
    return { route, status: response.status(), findings: result.findings, page_errors: pageErrors };
  } catch (error) {
    return { route, status: null, findings: [], page_errors: pageErrors, crawl_error: String(error) };
  } finally {
    await page.close();
  }
}

const routes = sitemapRoutes();
const results = new Array(routes.length);
let cursor = 0;
async function worker(workerId) {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= routes.length) return;
    results[index] = await inspectPage(routes[index]);
    console.log(`census worker=${workerId} ${index + 1}/${routes.length} ${routes[index]} findings=${results[index].findings.length}${results[index].crawl_error ? " ERROR" : ""}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, index) => worker(index + 1)));
await context.close();
await browser.close();

const findings = results.flatMap((result) => result.findings).sort((left, right) => left.page.localeCompare(right.page) || left.category.localeCompare(right.category) || left.selector.localeCompare(right.selector));
const failures = results.filter((result) => result.crawl_error).map(({ route, crawl_error, page_errors }) => ({ route, crawl_error, page_errors }));
const countsByCategory = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((category) => [category, findings.filter((finding) => finding.category === category).length]));
const countsByPage = results.map((result) => ({ page: result.route, findings: result.findings.length, counts: Object.fromEntries(Object.keys(CATEGORY_LABELS).map((category) => [category, result.findings.filter((finding) => finding.category === category).length])) }))
  .sort((left, right) => right.findings - left.findings || left.page.localeCompare(right.page));
const lowConfidence = findings.filter((finding) => finding.detail?.confidence === "low").length;
const generatedAt = new Date().toISOString();
const document = {
  schema: "glp.design-pass-mechanical-defect-census.v1",
  generated_at_utc: generatedAt,
  base_url: BASE_URL,
  viewport: { width: 1440, height: 900 },
  methodology: "All sitemap pages were rendered headlessly with a desktop Chrome UA. Geometry and initial computed styles came from page.evaluate; hover styles were compared before and after Playwright page.hover with transition durations forced to zero. No links were clicked.",
  sitemap_pages_expected: routes.length,
  sitemap_pages_completed: results.length - failures.length,
  finding_count: findings.length,
  low_confidence_finding_count: lowConfidence,
  counts_by_category: countsByCategory,
  worst_pages_first: countsByPage,
  crawl_failures: failures,
  external_requests_blocked: [...new Set(externalRequests)],
  findings,
};

mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = resolve(OUT_DIR, "census.json");
writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
const rows = Object.entries(CATEGORY_LABELS).map(([category, label]) => `| ${label} | ${countsByCategory[category]} |`).join("\n");
const worstRows = countsByPage.slice(0, 40).map((row) => `| ${row.page} | ${row.findings} | ${Object.entries(row.counts).filter(([, count]) => count).map(([category, count]) => `${category}: ${count}`).join("; ") || "none"} |`).join("\n");
const failureRows = failures.length ? failures.map((failure) => `- \`${failure.route}\`: ${failure.crawl_error}`).join("\n") : "- None.";
const markdown = `# Rebuilt-site mechanical defect census\n\nGenerated: ${generatedAt}\n\nScope: ${document.sitemap_pages_completed}/${document.sitemap_pages_expected} sitemap pages at 1440×900. This is a mechanical heuristic inventory, not Fable aesthetic acceptance. Low-confidence findings are retained and labeled rather than discarded. No links were clicked; external requests were blocked.\n\n## Counts by category\n\n| Category | Findings |\n|---|---:|\n${rows}\n\nTotal findings: ${findings.length}  \nLow-confidence findings: ${lowConfidence}\n\n## Worst pages first\n\n| Page | Total | Breakdown |\n|---|---:|---|\n${worstRows}\n\n## Crawl failures\n\n${failureRows}\n\nFull selector-level evidence is in \`census.json\`.\n`;
const markdownPath = resolve(OUT_DIR, "CENSUS.md");
writeFileSync(markdownPath, markdown);
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", pages: document.sitemap_pages_completed, expected: document.sitemap_pages_expected, findings: findings.length, low_confidence: lowConfidence, census_json: jsonPath, census_markdown: markdownPath, failures: failures.length }));
if (failures.length) process.exitCode = 1;
