import { test, expect } from "@playwright/test";

const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!configuredBaseURL) {
  throw new Error("pass2-late-home-closure requires PLAYWRIGHT_BASE_URL; it must not start a server");
}
const baseOrigin = new URL(configuredBaseURL).origin;

async function openHome(page) {
  const response = await page.goto("/", { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main > .cs-home2-hero")).toBeVisible();
}

async function openReviewSheet(page) {
  const trigger = page.locator("[data-review-open]").first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const sheet = page.locator("[data-review-sheet]");
  await expect(sheet).toHaveClass(/is-open/);
  const panel = sheet.locator(".cs-review-sheet__panel");
  await expect(panel).toBeVisible();
  await expect.poll(
    () => panel.evaluate((node) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(node).transform).m41)),
    { timeout: 1_500, intervals: [16, 32, 64] },
  ).toBeLessThan(1);
  // WebKit can report a zeroed transform one frame before the fixed sheet's
  // visual rect settles. Gate on the rendered edge too so geometry assertions
  // inspect the open state rather than that compositor hand-off frame.
  await expect.poll(
    () => panel.evaluate((node) => Math.max(0, node.getBoundingClientRect().right - innerWidth)),
    { timeout: 1_500, intervals: [16, 32, 64] },
  ).toBeLessThan(1);
  return sheet;
}

async function scrollMetrics(page) {
  return page.evaluate(async () => {
    const longTasks = [];
    let observer;
    try {
      observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // WebKit does not currently expose Long Tasks. Frame timing remains the
      // cross-engine acceptance signal, while Chromium reports both signals.
    }

    scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const deltas = [];
    const duration = 3000;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const started = performance.now();
    let prior = started;
    await new Promise((resolve) => {
      const step = (now) => {
        deltas.push(now - prior);
        prior = now;
        const progress = Math.min(1, (now - started) / duration);
        scrollTo(0, maxScroll * progress);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    observer?.disconnect();

    const sorted = deltas.slice(2).sort((left, right) => left - right);
    const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
    return {
      frameCount: sorted.length,
      frameDeltaP50Ms: Number(percentile(0.5).toFixed(1)),
      frameDeltaP95Ms: Number(percentile(0.95).toFixed(1)),
      frameDeltaP99Ms: Number(percentile(0.99).toFixed(1)),
      maximumFrameDeltaMs: Number((sorted.at(-1) || 0).toFixed(1)),
      severeFramesOver50: sorted.filter((value) => value > 50).length,
      longTaskCount: longTasks.length,
      longTaskTotalMs: Number(longTasks.reduce((sum, value) => sum + value, 0).toFixed(1)),
      documentHeight: document.documentElement.scrollHeight,
      scrollDistance: maxScroll,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseOrigin || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
});

test.describe("PASS 2 late home closure — desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });

  test("O-23: canonical two-step review intake uses the full desktop sheet width and keeps its primary action reachable", async ({ page, browserName }) => {
    await openHome(page);
    const sheet = await openReviewSheet(page);
    const panel = sheet.locator(".cs-review-sheet__panel");

    const geometry = await panel.evaluate((node) => {
      const form = node.querySelector("form");
      const field = (name) => form.querySelector(`[name="${name}"]`).closest("label").getBoundingClientRect().toJSON();
      const panelBounds = node.getBoundingClientRect();
      const formBounds = form.getBoundingClientRect();
      const contactRow = ["public_display_name", "verification_email"].map(field);
      const narrative = form.querySelector('textarea[name="primary_review_body"]').closest("label").getBoundingClientRect();
      const primaryStep = form.querySelector('[data-review-step="primary"]').getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        panel: panelBounds.toJSON(),
        panelClientHeight: node.clientHeight,
        panelScrollHeight: node.scrollHeight,
        panelScrollTop: node.scrollTop,
        panelOverflowY: getComputedStyle(node).overflowY,
        form: formBounds.toJSON(),
        formColumns: getComputedStyle(form).gridTemplateColumns.split(" ").filter(Boolean).length,
        contactRow,
        primaryStep: primaryStep.toJSON(),
        narrative: narrative.toJSON(),
        compact: form.hasAttribute("data-review-compact"),
        hasCounterpart: Boolean(form.querySelector('[data-review-step="counterpart"]')),
        hasEvidenceUpload: Boolean(form.querySelector('input[type="file"]')),
      };
    });
    console.log(`[pass2-late-home][${browserName}] O-23-desktop ${JSON.stringify(geometry)}`);

    expect(geometry.viewport).toEqual({ width: 1440, height: 900 });
    expect(geometry.panel.top).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(900);
    expect(geometry.panelScrollTop).toBe(0);
    expect(geometry.panelOverflowY).toMatch(/auto|scroll/);
    expect(geometry.compact).toBe(true);
    expect(geometry.hasCounterpart).toBe(false);
    expect(geometry.hasEvidenceUpload).toBe(false);
    expect(geometry.formColumns).toBe(1);
    expect(geometry.primaryStep.width).toBeGreaterThanOrEqual(geometry.form.width - 1);
    expect(Math.max(...geometry.contactRow.map((box) => box.top)) - Math.min(...geometry.contactRow.map((box) => box.top))).toBeLessThanOrEqual(1);
    expect(geometry.contactRow[1].left).toBeGreaterThan(geometry.contactRow[0].right);
    expect(geometry.narrative.width).toBeGreaterThan(500);

    const primaryAction = sheet.getByRole("button", { name: "Submit for review", exact: true });
    await expect(primaryAction).toBeInViewport();
  });

  test("A-1: aurora keeps three visible layers in continuous non-linear 20s compositor orbits", async ({ page, browserName }) => {
    await openHome(page);
    await expect(page.locator(".cs-home2-hero")).not.toHaveClass(/is-motion-visible/);

    const aurora = await page.locator(".cs-home2-flow").evaluate((flow) => {
      const hero = flow.closest(".cs-home2-hero");
      const heroArea = hero.offsetWidth * hero.offsetHeight;
      const flowArea = flow.offsetWidth * flow.offsetHeight;
      const parentStyle = getComputedStyle(flow);
      const children = [...flow.children].map((node) => {
        const style = getComputedStyle(node);
        return {
          width: node.offsetWidth,
          height: node.offsetHeight,
          area: node.offsetWidth * node.offsetHeight,
          filter: style.filter,
          mixBlendMode: style.mixBlendMode,
          willChange: style.willChange,
          animationName: style.animationName,
          animationDurationSeconds: parseFloat(style.animationDuration),
          animationTimingFunction: style.animationTimingFunction,
          animationPlayState: style.animationPlayState,
          backgroundImage: style.backgroundImage,
        };
      });
      const paintedChildArea = children.reduce((sum, child) => sum + child.area, 0);
      return {
        hero: { width: hero.offsetWidth, height: hero.offsetHeight, area: heroArea },
        flow: { width: flow.offsetWidth, height: flow.offsetHeight, area: flowArea },
        parentOpacity: Number(parentStyle.opacity),
        parentFilter: parentStyle.filter,
        oversizedParentAreaRatio: Number((flowArea / heroArea).toFixed(4)),
        paintedChildAreaRatio: Number((paintedChildArea / heroArea).toFixed(4)),
        largestChildAreaRatio: Number((Math.max(...children.map((child) => child.area)) / heroArea).toFixed(4)),
        children,
      };
    });
    console.log(`[pass2-late-home][${browserName}] O-31-aurora ${JSON.stringify(aurora)}`);

    expect(aurora.parentOpacity).toBeCloseTo(0.96, 2);
    expect(aurora.parentFilter).toBe("none");
    expect(aurora.oversizedParentAreaRatio).toBeGreaterThanOrEqual(1.43);
    expect(aurora.oversizedParentAreaRatio).toBeLessThanOrEqual(1.45);
    expect(aurora.paintedChildAreaRatio).toBeGreaterThanOrEqual(1.27);
    expect(aurora.paintedChildAreaRatio).toBeLessThanOrEqual(1.3);
    expect(aurora.largestChildAreaRatio).toBeLessThan(0.55);
    expect(aurora.children).toHaveLength(3);
    for (const child of aurora.children) {
      expect(child.filter).toBe("none");
      expect(child.mixBlendMode).toBe("normal");
      expect(child.willChange).toContain("transform");
      expect(child.animationName).toMatch(/^cs-home-aurora-orbit-/);
      expect(child.animationDurationSeconds).toBe(20);
      expect(child.animationTimingFunction).not.toBe("linear");
      expect(child.animationPlayState).toBe("running");
      expect(child.backgroundImage).toContain("radial-gradient");
    }

    await page.locator("footer").scrollIntoViewIfNeeded();
    const offscreenLayers = await page.locator(".cs-home2-flow > span").evaluateAll((nodes) => nodes.map((node) => ({
      willChange: getComputedStyle(node).willChange,
      animationName: getComputedStyle(node).animationName,
    })));
    expect(offscreenLayers.every((child) => child.willChange.includes("transform") && child.animationName.startsWith("cs-home-aurora-orbit-"))).toBe(true);
  });

  test("O-31: Chromium median scroll budgets pass and WebKit completes both viewports", async ({ page, browserName }) => {
    const measurements = [];
    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const trials = [];
      const trialCount = browserName === "chromium" ? 3 : 1;
      for (let trial = 0; trial < trialCount; trial += 1) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openHome(page);
        // Keep the scroll metric scoped to steady-state scrolling rather than
        // initial reveal/image work immediately after navigation.
        await page.waitForTimeout(700);
        trials.push(await scrollMetrics(page));
      }
      const median = (values) => {
        const sorted = [...values].sort((left, right) => left - right);
        return sorted[Math.floor(sorted.length / 2)];
      };
      measurements.push({
        viewport: viewport.name,
        trials,
        frameDeltaP95MedianMs: median(trials.map((row) => row.frameDeltaP95Ms)),
        severeFramesOver50Median: median(trials.map((row) => row.severeFramesOver50)),
        longTaskTotalMedianMs: median(trials.map((row) => row.longTaskTotalMs)),
      });
    }
    console.log(`[pass2-late-home][${browserName}] O-31-scroll ${JSON.stringify(measurements)}`);

    for (const measurement of measurements) {
      expect(measurement.trials.every((row) => row.documentHeight > (measurement.viewport === "desktop" ? 900 : 844))).toBe(true);
      expect(measurement.trials.every((row) => row.scrollDistance > 0)).toBe(true);
      if (browserName === "chromium") {
        expect(measurement.frameDeltaP95MedianMs).toBeLessThanOrEqual(35);
        expect(measurement.severeFramesOver50Median).toBeLessThanOrEqual(3);
        expect(measurement.longTaskTotalMedianMs).toBeLessThanOrEqual(200);
      }
    }
  });
});

test.describe("PASS 2 late home closure — mobile 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference", isMobile: true, hasTouch: true });

  test("O-23: review form becomes a single contained column on mobile and its primary action remains reachable", async ({ page, browserName }) => {
    await openHome(page);
    const sheet = await openReviewSheet(page);
    const panel = sheet.locator(".cs-review-sheet__panel");
    // WebKit can resolve the visible sheet while the final compositor frame is
    // still a few pixels inside the 260ms translateX entrance. Geometry is an
    // acceptance boundary here, so sample it only after the rendered edge has
    // reached the viewport rather than relying on DOM visibility alone.
    await expect.poll(
      () => panel.evaluate((node) => Math.abs(node.getBoundingClientRect().right - innerWidth)),
      { timeout: 3_000, message: "review sheet panel reaches its rendered open edge" },
    ).toBeLessThanOrEqual(0.01);
    const geometry = await panel.evaluate((node) => {
      const form = node.querySelector("form");
      const fields = ["public_display_name", "verification_email", "subject_name", "primary_headline", "primary_experience_date", "primary_review_body"]
        .map((name) => form.querySelector(`[name="${name}"]`).closest(".p5-field, label").getBoundingClientRect().toJSON());
      return {
        viewport: { width: innerWidth, height: innerHeight },
        panel: node.getBoundingClientRect().toJSON(),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
        formColumns: getComputedStyle(form).gridTemplateColumns.split(" ").filter(Boolean).length,
        fields,
        compact: form.hasAttribute("data-review-compact"),
        primaryActionBeforeScroll: form.querySelector('[data-review-submit]').getBoundingClientRect().toJSON(),
      };
    });
    console.log(`[pass2-late-home][${browserName}] O-23-mobile ${JSON.stringify(geometry)}`);

    expect(geometry.viewport).toEqual({ width: 390, height: 844 });
    expect(geometry.panel.left).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.right).toBeLessThanOrEqual(390);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.compact).toBe(true);
    expect(geometry.formColumns).toBe(1);
    expect(geometry.fields.every((box, index, boxes) => index === 0 || box.top > boxes[index - 1].top)).toBe(true);
    expect(geometry.fields.every((box) => box.left >= geometry.panel.left && box.right <= geometry.panel.right)).toBe(true);
    expect(geometry.overflowY).toMatch(/auto|scroll/);

    const primaryAction = sheet.getByRole("button", { name: "Submit for review", exact: true });
    await primaryAction.scrollIntoViewIfNeeded();
    await expect(primaryAction).toBeInViewport();
  });
});
