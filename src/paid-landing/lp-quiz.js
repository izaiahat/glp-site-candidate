/* /lp/quiz/ entrance — progressive enhancement only.
   1. Message-match headline slot: swaps the default H1/lede when ?h= names an
      allowlisted variant carried in the page's own JSON. No other query key is
      read, echoed or stored. Without JS the default copy stands.
   2. Sticky mobile CTA once the hero action leaves the viewport.
   3. Compatibility hooks for the existing paid wrapper engine (assets/paid-quiz.js):
      the primary CTA carries data-lp-quiz-start, the hero carries data-paid-intro
      and the status line data-paid-status. Without a [data-phase4-quiz] mount the
      engine returns early and the CTA is a plain link to /quiz/provider-fit/.
   No network requests, storage writes, analytics or pixels. Event hooks
   (data-lp-event) are inert markers for a later consent-gated integration. */
(() => {
  "use strict";
  const root = document.documentElement;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 1. headline variant (allowlisted)
  try {
    const key = new URLSearchParams(window.location.search).get("h");
    const node = document.querySelector("[data-lp-headlines]");
    if (key && node && /^[a-z]{1,16}$/.test(key)) {
      const variants = JSON.parse(node.textContent || "{}");
      const v = Object.prototype.hasOwnProperty.call(variants, key) ? variants[key] : null;
      const h1 = document.querySelector("[data-lp-headline]");
      const lede = document.querySelector("[data-lp-lede]");
      if (v && h1 && lede && typeof v.h1 === "string" && typeof v.lede === "string") {
        h1.textContent = v.h1;
        lede.textContent = v.lede;
        document.title = v.h1 + " · Clinic Scout";
        root.setAttribute("data-lp-variant", key);
      }
    }
  } catch (_) { /* default copy stands */ }

  // 2. sticky CTA on small screens
  const sticky = document.querySelector("[data-lp-sticky]");
  const primary = document.querySelector("[data-lp-quiz-start]");
  if (sticky && primary && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      const narrow = window.innerWidth < 900;
      sticky.hidden = visible || !narrow;
      document.body.classList.toggle("has-sticky", !sticky.hidden);
    }, { rootMargin: "0px 0px -10% 0px" });
    io.observe(primary);
  }

  // 3. motion: nothing to start; CSS owns decoration and the reduced-motion kill.
  if (reduced) root.setAttribute("data-lp-motion", "off");
})();
