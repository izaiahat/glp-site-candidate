// Phase-2 library adoption acceptance (design pass 2026-08-27).
// Contract: reports/glp-clinic-scout/rebuild/LIBRARY-MENU-20260827/FABLE-SELECTIONS.md
// Selections under test: #1 skeleton (zero CLS on swap), #2 dropdown motion,
// #3 search expand + typeahead stagger, #4 press feedback, #5 tabular-nums,
// #6 sheet/toast asymmetry + toast timer-pause, #7 count-up, #8 quiz results
// entrance; #9/#10 verify-only (marquee pause + no entrance on high-frequency
// interactions). Kowalski filters govern: interactive feedback ≤300ms except
// quiz results (500ms) and band entrances; keyboard-initiated opens animate
// NOT AT ALL; reduced motion kills everything.

import { expect, test } from "@playwright/test";

const CONSENT_SEED = ["gcs_tracking_consent_v1", JSON.stringify({
  analytics: "denied",
  advertising: "denied",
  version: "gcs-cookie-v4-distinct-purposes",
  record_type: "preference_only",
  saved_at: "2026-08-27T00:00:00.000Z",
})];

async function runQuizToFinish(page) {
  // Pointer-driven flow: intents → current_use(no) → reasons → features → state → email.
  await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
  await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
  await page.locator('[data-single="current_use"][data-value="no"]').click();
  await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
  await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
  await page.locator('[data-quiz-select="state"]').selectOption("CA");
  await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
}

test.describe("pointer-mode adoption behavior", () => {
  test.use({ reducedMotion: "no-preference" });

  test("selections #1+#8: quiz skeleton occupies the loaded content's exact box — zero CLS on swap — then the sanctioned 500ms/60ms entrance plays", async ({ page, browserName }) => {
    await page.goto("/quiz/provider-fit/", { waitUntil: "load" });
    await runQuizToFinish(page);

    await page.evaluate(() => {
      window.__adoptionShifts = [];
      if ("LayoutShift" in window) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__adoptionShifts.push(entry.value);
          }
        }).observe({ type: "layout-shift", buffered: false });
      }
    });

    await page.locator("[data-quiz-finish]").click();
    // Park the pointer so no card picks up a :hover transform mid-measurement.
    await page.mouse.move(4, 4);

    // Skeleton beat: real cards laid out, content invisible, shimmer face.
    const cards = page.locator("[data-result-cards] .qz-card");
    await expect(page.locator("[data-result-cards].is-computing")).toBeVisible();
    await expect(page.locator('[data-result-cards][aria-busy="true"]')).toHaveCount(1);
    expect(await cards.count()).toBe(3);
    const skeletonRects = await cards.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const hiddenDuringBeat = await cards.first().evaluate((card) =>
      [...card.children].every((child) => getComputedStyle(child).visibility === "hidden"));
    expect(hiddenDuringBeat).toBe(true);

    // Entrance: 500ms rise, 60ms stagger (sanctioned rare moment).
    await expect(page.locator("[data-result-cards].is-entering")).toBeVisible({ timeout: 2000 });
    const timing = await cards.evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { name: style.animationName, duration: style.animationDuration, delay: style.animationDelay };
    }));
    for (const [index, row] of timing.entries()) {
      expect(row.name).toBe("qz-card-enter");
      expect(row.duration).toBe("0.5s");
      expect(row.delay).toBe(`${(index * 0.06).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}s`);
    }

    // Settled: identical boxes, zero non-input layout shift across the swap.
    await expect(page.locator("[data-result-cards].is-entering")).toHaveCount(0, { timeout: 4000 });
    const settledRects = await cards.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    expect(settledRects.length).toBe(skeletonRects.length);
    for (let index = 0; index < settledRects.length; index += 1) {
      // The page may have scrolled (results.scrollIntoView); compare geometry
      // via width/height exactly and x exactly; y via card-to-card spacing.
      expect(Math.abs(settledRects[index].width - skeletonRects[index].width)).toBeLessThan(0.5);
      expect(Math.abs(settledRects[index].height - skeletonRects[index].height)).toBeLessThan(0.5);
      expect(Math.abs(settledRects[index].x - skeletonRects[index].x)).toBeLessThan(0.5);
    }
    const skeletonGaps = skeletonRects.slice(1).map((rect, i) => rect.y - skeletonRects[i].y);
    const settledGaps = settledRects.slice(1).map((rect, i) => rect.y - settledRects[i].y);
    for (let index = 0; index < skeletonGaps.length; index += 1) {
      // Sub-pixel rendering noise only; the hard zero-shift proof is the CLS
      // observer below, which the browser computes against real layout.
      expect(Math.abs(settledGaps[index] - skeletonGaps[index])).toBeLessThan(1.5);
    }
    if (browserName === "chromium") {
      const cls = await page.evaluate(() => (window.__adoptionShifts || []).reduce((sum, v) => sum + v, 0));
      expect(cls).toBe(0);
    }
  });

  test("selections #2/#3/#4/#6: every interactive feedback ≤300ms with the specified asymmetries; press scales to 0.98", async ({ page }) => {
    // No consent seed here: the consent corner card itself is under test.
    await page.goto("/", { waitUntil: "load" });
    await page.waitForSelector("#gcs-consent", { state: "attached", timeout: 5000 });
    const consentDuration = await page.evaluate(() => getComputedStyle(document.querySelector("#gcs-consent")).animationDuration);
    expect(consentDuration).toBe("0.2s"); // selection #6: 200ms rise (was 500ms)
    await page.locator('#gcs-consent [data-consent="denied"]').click();

    const timings = await page.evaluate(() => {
      const seconds = (value) => value.split(",").map((part) => parseFloat(part));
      const out = {};
      const menu = document.querySelector(".cs-navmenu");
      out.menuClose = getComputedStyle(menu).transitionDuration;
      const menuButton = document.querySelector(".cs-navgroup > button");
      menuButton.setAttribute("aria-expanded", "true");
      out.menuOpen = getComputedStyle(menu).transitionDuration;
      out.menuOpenScaleFrom = /scale\(0\.98\)/.test("translateY(-8px) scale(0.98)");
      menuButton.setAttribute("aria-expanded", "false");
      out.caret = getComputedStyle(menuButton, "::after").transitionDuration;
      const panel = document.querySelector(".cs-search-panel");
      out.searchClose = getComputedStyle(panel).transitionDuration;
      panel.classList.add("is-open");
      out.searchOpen = getComputedStyle(panel).transitionDuration;
      panel.classList.remove("is-open");
      const layer = document.querySelector("[data-subscribe-layer]");
      const sheet = layer.querySelector(".cs-subscribe-sheet");
      layer.hidden = false;
      out.sheetClose = getComputedStyle(sheet).transitionDuration;
      layer.classList.add("is-open");
      out.sheetOpen = getComputedStyle(sheet).transitionDuration;
      layer.classList.remove("is-open");
      layer.hidden = true;
      const review = document.querySelector(".cs-review-sheet");
      const reviewPanel = review?.querySelector(".cs-review-sheet__panel");
      if (reviewPanel) {
        out.reviewClose = getComputedStyle(reviewPanel).transitionDuration;
        review.classList.add("is-open");
        out.reviewOpen = getComputedStyle(reviewPanel).transitionDuration;
        review.classList.remove("is-open");
      }
      out.ctaTransform = (() => {
        const cta = document.querySelector(".cta");
        const style = getComputedStyle(cta);
        const properties = style.transitionProperty.split(",").map((s) => s.trim());
        const durations = seconds(style.transitionDuration);
        const at = properties.indexOf("transform");
        return durations[at >= 0 ? Math.min(at, durations.length - 1) : 0];
      })();
      return out;
    });

    // Selection #2: dropdown 170ms open / 120ms close, caret 200ms.
    expect(timings.menuOpen).toBe("0.17s, 0.17s");
    expect(timings.menuClose).toBe("0.12s, 0.12s");
    expect(timings.caret).toBe("0.2s");
    // Selection #3: search expand 200ms open (transform), faster close.
    expect(timings.searchOpen).toBe("0.16s, 0.2s");
    expect(timings.searchClose).toBe("0.14s, 0.16s");
    // Selection #6: sheets 260ms in / 180ms out.
    expect(timings.sheetOpen).toBe("0.26s, 0.2s");
    expect(timings.sheetClose).toBe("0.18s, 0.14s");
    expect(timings.reviewOpen).toBe("0.26s");
    expect(timings.reviewClose).toBe("0.18s");
    // Selection #4: press transition sits at the 90ms instant tier.
    expect(timings.ctaTransform).toBeCloseTo(0.09, 5);

    // Everything above respects the ≤300ms interactive ceiling.
    for (const value of [timings.menuOpen, timings.menuClose, timings.caret, timings.searchOpen, timings.searchClose, timings.sheetOpen, timings.sheetClose, timings.reviewOpen, timings.reviewClose]) {
      for (const part of String(value).split(",")) expect(parseFloat(part)).toBeLessThanOrEqual(0.3);
    }

    // Press feedback: :active scales the CTA to 0.98 (ui-skills recipe).
    const cta = page.getByRole("link", { name: "Calculate your cost", exact: true });
    await expect(cta).toBeVisible();
    await cta.scrollIntoViewIfNeeded();
    const box = await cta.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(160);
    const matrix = await cta.evaluate((node) => getComputedStyle(node).transform);
    await page.mouse.up();
    const scale = parseFloat(matrix.replace("matrix(", "").split(",")[0]);
    expect(scale).toBeCloseTo(0.98, 2);
  });

  test("selection #3+#7: search panel entrance + 20ms open-render stagger; count-up runs once on enter to the exact final value", async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), CONSENT_SEED);
    await page.addInitScript(() => {
      window.__adoptionCounterSamples = [];
      new MutationObserver(() => {
        const counter = document.querySelector("[data-counter-to]");
        if (!counter || !/\d/.test(counter.textContent || "")) return;
        const value = Number(counter.textContent.replace(/[^0-9]/g, ""));
        const samples = window.__adoptionCounterSamples;
        if (Number.isFinite(value) && samples.at(-1) !== value) samples.push(value);
      }).observe(document, { childList: true, characterData: true, subtree: true });
    });
    await page.goto("/", { waitUntil: "load" });

    // Hold the search index on the wire BEFORE the panel opens (open prefetches
    // it) so the searching skeleton state below stays observable.
    let releaseIndex;
    let interceptedIndex = false;
    const heldIndex = new Promise((resolve) => { releaseIndex = resolve; });
    await page.route("**/assets/search-index.json", async (route) => {
      interceptedIndex = true;
      await heldIndex;
      await route.continue();
    });

    try {
    // Pointer-open the search: quick-links render staggers 20ms per row.
    await page.locator(".cs-search-toggle").click();
    await expect.poll(() => interceptedIndex).toBe(true);
    await expect(page.locator(".cs-search-panel.is-open")).toBeVisible();
    const rows = page.locator(".cs-search-hit--enter");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    const delays = await rows.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationDelay));
    delays.forEach((delay, index) => {
      expect(parseFloat(delay)).toBeCloseTo(index * 0.02, 5);
    });
    const resultsAnimation = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector(".cs-search-results"));
      return { name: style.animationName, duration: style.animationDuration };
    });
    expect(resultsAnimation.name).toBe("cs-search-results-in");
    expect(resultsAnimation.duration).toBe("0.16s");

    // Selection #1 in the search panel: skeleton rows in hit geometry while
    // the index resolves (the route above holds the network open).
    await page.locator(".cs-search-box input").pressSequentially("wegovy", { delay: 30 });
    await expect(page.locator(".cs-search-hit--skeleton").first()).toBeVisible({ timeout: 2000 });
    expect(await page.locator(".cs-search-hit--skeleton .cs-skeleton").count()).toBeGreaterThanOrEqual(6);
    // Typing stamped keyboard modality: no per-item animation may play inside
    // the results panel during the high-frequency searching state (Kowalski
    // B2/B4; verify item #10 probe — typed updates never trigger entrances).
    const runningDuringType = await page.evaluate(() => {
      const results = document.querySelector(".cs-search-results");
      return results.getAnimations({ subtree: true })
        .filter((a) => a.playState === "running" && Number(a.effect?.getTiming?.().duration || 0) > 0).length;
    });
    expect(runningDuringType).toBe(0);
    } finally {
      releaseIndex();
    }
    await expect(page.locator(".cs-search-hit").first()).toBeVisible({ timeout: 4000 });
    await page.keyboard.press("Escape");

    // Selection #7: count-up — final value is server-rendered; on enter it
    // tweens 0 → final in 600ms and lands exactly on the integer.
    const counter = page.locator("[data-counter-to]").first();
    const target = Number(await counter.getAttribute("data-counter-to"));
    const tabular = await counter.evaluate((node) => getComputedStyle(node).fontVariantNumeric);
    expect(tabular).toContain("tabular-nums");
    await counter.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.__adoptionCounterSamples.length)).toBeGreaterThan(1);
    const samples = await page.evaluate(() => window.__adoptionCounterSamples);
    expect(Math.min(...samples)).toBeLessThan(target); // observed during first entry
    await page.waitForTimeout(700);
    expect(Number((await counter.textContent()).replace(/[^0-9]/g, ""))).toBe(target); // exact landing
  });

  test("selection #6: the timed welcome toast pauses its dismiss timer on hover/focus and resumes after", async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), CONSENT_SEED);
    await page.addInitScript(() => {
      localStorage.setItem("gcs.visit.v1", JSON.stringify({
        lastPath: "/guides/",
        lastTitle: "Guides",
        lastSeenAt: Date.now() - 24 * 60 * 60 * 1000,
      }));
    });
    await page.goto("/", { waitUntil: "load" });
    const toast = page.locator(".cs-welcome-toast");
    await expect(toast).toBeVisible({ timeout: 3000 });
    await toast.hover();
    // Unpaused, the toast dies at 7000ms. Hovered, it must survive well past it.
    await page.waitForTimeout(8000);
    await expect(toast).toBeVisible();
    // Leave: the remaining time resumes and the toast dismisses on its own.
    await page.mouse.move(4, 4);
    await expect(toast).toHaveCount(0, { timeout: 9000 });
  });

  test("verify item #9: review-hub marquee drifts, pauses on hover", async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), CONSENT_SEED);
    await page.goto("/reviews/", { waitUntil: "load" });
    // The track animates forever, so Playwright actionability (which waits for
    // a stable box) can never be used on it — drive scroll + hover directly.
    const running = await page.evaluate(() => {
      const node = document.querySelector(".cs-revhub-collage__track");
      node.scrollIntoView({ block: "center" });
      const style = getComputedStyle(node);
      return { name: style.animationName, state: style.animationPlayState };
    });
    expect(running.name).toBe("cs-collage-drift");
    expect(running.state).toBe("running");
    const box = await page.evaluate(() => {
      const rect = document.querySelector(".cs-revhub-collage").getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + Math.min(rect.height / 2, 200) };
    });
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(120);
    const paused = await page.evaluate(() => getComputedStyle(document.querySelector(".cs-revhub-collage__track")).animationPlayState);
    expect(paused).toBe("paused");
  });
});

test.describe("keyboard-initiated opens animate not at all", () => {
  test.use({ reducedMotion: "no-preference" });

  test("filter B4: keyboard open of search and nav menu is instant — zero animation, zero transition", async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), CONSENT_SEED);
    await page.goto("/", { waitUntil: "load" });

    // Reach the search toggle by keyboard alone.
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press("Tab");
      const onToggle = await page.evaluate(() => document.activeElement?.classList?.contains("cs-search-toggle") || false);
      if (onToggle) break;
    }
    expect(await page.evaluate(() => document.activeElement?.classList?.contains("cs-search-toggle"))).toBe(true);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.documentElement.dataset.inputModality)).toBe("keyboard");
    await expect(page.locator(".cs-search-panel.is-open")).toBeVisible();
    const searchState = await page.evaluate(() => {
      const panel = document.querySelector(".cs-search-panel");
      return {
        transition: getComputedStyle(panel).transitionDuration,
        animations: panel.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
      };
    });
    expect(searchState.transition.split(",").every((part) => parseFloat(part) === 0)).toBe(true);
    expect(searchState.animations).toBe(0);
    await page.keyboard.press("Escape");

    // Keyboard focus opens the nav dropdown; it must not animate either.
    // (The nav links sit after the search toggle in DOM order — walk forward.)
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press("Tab");
      const onGroup = await page.evaluate(() => {
        const active = document.activeElement;
        return Boolean(active && active.closest(".cs-navgroup") && active.tagName === "BUTTON");
      });
      if (onGroup) break;
    }
    const menuState = await page.evaluate(() => {
      const button = document.querySelector('.cs-navgroup > button[aria-expanded="true"]');
      const menu = button?.nextElementSibling;
      if (!menu) return null;
      return {
        transition: getComputedStyle(menu).transitionDuration,
        animations: menu.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
      };
    });
    expect(menuState).not.toBeNull();
    expect(menuState.transition.split(",").every((part) => parseFloat(part) === 0)).toBe(true);
    expect(menuState.animations).toBe(0);
  });
});

test.describe("reduced motion kills everything", () => {
  test.use({ reducedMotion: "reduce" });

  test("emulateMedia reduce: no skeleton beat, instant quiz results, static marquee/search, count-up holds the final value", async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), CONSENT_SEED);
    // Direct emulateMedia per the acceptance contract (context-level
    // reducedMotion proved unreliable in this harness — see probe 2026-08-27).
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/", { waitUntil: "load" });
    await page.locator(".cs-search-toggle").click();
    await expect(page.locator(".cs-search-panel.is-open")).toBeVisible();
    await page.waitForTimeout(250); // let zero-duration transitions retire
    const mediaState = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(mediaState, "reduce emulation must be active").toBe(true);
    const homeRunning = await page.evaluate(() =>
      document.getAnimations()
        .filter((a) => a.playState === "running" && Number(a.effect?.getTiming?.().duration || 0) > 0)
        .map((a) => `${a.animationName || a.transitionProperty}@${a.effect?.getTiming?.().duration}`));
    expect(homeRunning).toEqual([]);
    await page.keyboard.press("Escape");
    const counter = page.locator("[data-counter-to]").first();
    const target = Number(await counter.getAttribute("data-counter-to"));
    await counter.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect(Number((await counter.textContent()).replace(/[^0-9]/g, ""))).toBe(target);

    await page.goto("/quiz/provider-fit/", { waitUntil: "load" });
    await runQuizToFinish(page);
    await page.locator("[data-quiz-finish]").click();
    // Results are immediate: no computing beat, no aria-busy, no animations.
    await expect(page.locator("[data-result-cards] .qz-card").first()).toBeVisible();
    expect(await page.locator("[data-result-cards].is-computing").count()).toBe(0);
    expect(await page.locator('[data-result-cards][aria-busy="true"]').count()).toBe(0);
    const contentVisible = await page.locator("[data-result-cards] .qz-card").first()
      .evaluate((card) => [...card.children].every((child) => getComputedStyle(child).visibility === "visible"));
    expect(contentVisible).toBe(true);
    const quizRunning = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    expect(quizRunning).toBe(0);

    await page.goto("/reviews/", { waitUntil: "load" });
    const marquee = await page.locator(".cs-revhub-collage__track").first()
      .evaluate((node) => getComputedStyle(node).animationName);
    expect(marquee).toBe("none");
  });
});
