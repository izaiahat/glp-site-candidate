// Installed before locator.click, but the deadline covers only the dispatched
// pointer interaction, never Playwright's visibility/enabled/stability wait.
// Keep this callback self-contained: locator.evaluate serializes it into the page.
export function armConsentClickPaintProxy(element) {
  window.__gcsInpProxyPromise = new Promise((resolve, reject) => {
    let started;
    let timer;
    element.addEventListener("pointerdown", () => {
      started = performance.now();
      timer = setTimeout(() => reject(new Error("consent INP proxy did not observe a click within 5s after pointerdown")), 5_000);
    }, { once: true });
    element.addEventListener("click", () => {
      if (started === undefined) {
        reject(new Error("consent INP proxy click arrived without pointerdown"));
        return;
      }
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve(performance.now() - started);
      });
    }, { once: true });
  });
}
