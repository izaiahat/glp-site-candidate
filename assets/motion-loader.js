/* GLP Clinic Scout — conditional motion loader
 *
 * The page is complete and readable without this enhancement. Touch/mobile keeps
 * native scrolling; reduced-motion visitors defer the runtime until requested.
 * Both pointer types use the single motion
 * owner in dependency order. Dynamic scripts use async=false so they download
 * in parallel but execute in the declared order.
 */
(function () {
  "use strict";

  var preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  var loaded = false;
  var current = document.currentScript;
  var version = current ? new URL(current.src, document.baseURI).search : "";
  var sources = [
    "/assets/vendor/gsap/gsap.min.js",
    "/assets/vendor/gsap/ScrollTrigger.min.js",
    "/assets/vendor/gsap/SplitText.min.js",
    "/assets/vendor/gsap/Flip.min.js",
    "/assets/vendor/lenis/lenis.min.js",
    "/assets/motion.js"
  ];

  function load() {
    if (loaded || preference.matches) return;
    loaded = true;
    sources.forEach(function (source) {
    var script = document.createElement("script");
    script.src = source + version;
    script.async = false;
    script.dataset.motionDependency = source;
    script.addEventListener("error", function () {
      document.documentElement.dataset.motion = "fallback";
    }, { once: true });
    document.head.appendChild(script);
    });
  }
  if (preference.matches) document.documentElement.dataset.motion = "reduced";
  preference.addEventListener("change", load);
  load();
})();
