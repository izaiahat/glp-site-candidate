/* GLP Clinic Scout — motion runtime v3 (GSAP 3.13.0 + Lenis 1.3.11)
 *
 * v2 contract (operator directive 2026-08-26 — the restraint doctrine is
 * retired; the full library is in play):
 *  - Implements the site-wide data-motion vocabulary that the markup already
 *    carries: rise | fade | scale | slide-from-left | slide-from-right,
 *    data-motion-group (staggered children), data-motion-dur, data-motion-stagger.
 *  - H17 pair choreography: image half and copy half enter from OPPOSITE sides
 *    and meet in the middle; direction flips on the reversed card.
 *  - Content is NEVER hidden by CSS. All start states are set by JS; every
 *    tween clears its props on completion. No JS → fully static, fully visible.
 *  - prefers-reduced-motion: no Lenis, no tweens, everything at final state.
 *  - Lenis owns fine-pointer desktop scroll only. Touch/mobile keeps native scroll.
 *  - Above-the-fold [data-motion] elements play a short staggered load-in
 *    instead of a scroll reveal, so nothing pops after first paint.
 */
(function () {
  "use strict";

  if (window.CS_MOTION && window.CS_MOTION.__v2) return;

  var motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionPreference.matches;
  var pointerPreference = window.matchMedia("(pointer: fine) and (min-width: 901px)");
  var smoothPointer = pointerPreference.matches;
  var gsap = window.gsap || null;
  var ST = window.ScrollTrigger || null;
  var lenis = null;
  var lenisRaf = null;
  var live = [];      /* active tweens/timelines for teardown */
  var triggers = [];  /* active ScrollTriggers for teardown */
  var auroras = [], auroraObserver = null, mutations = null, paused = false;
  var auroraControls = [], auroraUserPaused = false;
  var listingObserver = null, listingRefresh = null;

  if (gsap && ST) gsap.registerPlugin(ST);

  /* ---- scroll transport --------------------------------------------------- */
  function stopScroll() {
    if (lenis) { lenis.destroy(); lenis = null; window.__gcsLenis = null; }
    if (gsap && lenisRaf) gsap.ticker.remove(lenisRaf);
    lenisRaf = null;
    window.__gcsLenisRaf = null;
    if (window.CS_MOTION) window.CS_MOTION.lenis = null;
  }
  function initScroll() {
    if (!reduced && !lenis && smoothPointer && window.Lenis && gsap && ST) {
      lenis = new window.Lenis({
        lerp: 0.1,
        smoothWheel: true,
        syncTouch: false,
        wheelMultiplier: 0.9,
        autoRaf: false
      });
      window.__gcsLenis = lenis;
      lenis.on("scroll", ST.update);
      lenisRaf = function (time) { lenis.raf(time * 1000); };
      window.__gcsLenisRaf = lenisRaf;
      gsap.ticker.add(lenisRaf);
      gsap.ticker.lagSmoothing(500, 33);
      if (paused) lenis.stop();
    }
  }
  initScroll();

  /* ---- entrance vocabulary ------------------------------------------------- */
  /* Never initialize a whole viewport at opacity:0. Fast scroll jumps can cross
     a ScrollTrigger start between frames; a non-zero floor keeps content readable
     until the one-shot entrance catches up instead of flashing the page ground. */
  var VARIANTS = {
    "rise":            { y: 34, opacity: 0.36 },
    "fade":            { opacity: 0.45 },
    "scale":           { scale: 0.955, opacity: 0.36 },
    "slide-from-left": { x: -64, opacity: 0.36 },
    "slide-from-right":{ x: 64, opacity: 0.36 }
  };
  var CLEAR = "opacity,transform";

  function durFor(el, fallback) {
    var raw = parseFloat(el.getAttribute("data-motion-dur") || "");
    if (!isFinite(raw) || raw <= 0) return fallback;
    /* the old contract wrote seconds (0.26); accept ms values too */
    return raw > 5 ? raw / 1000 : raw;
  }

  function track(tween) { live.push(tween); if (tween.scrollTrigger) triggers.push(tween.scrollTrigger); return tween; }

  function revealSet(targets, fromVars, el, opts) {
    var dur = durFor(el, opts.dur || 0.6);
    var vars = {
      x: 0, y: 0, scale: 1, opacity: 1,
      duration: dur,
      ease: opts.ease || "power3.out",
      stagger: opts.stagger || 0,
      delay: opts.delay || 0,
      overwrite: "auto",
      clearProps: CLEAR
    };
    if (opts.scrollTrigger) {
      vars.scrollTrigger = opts.scrollTrigger;
      /* Leave offscreen content at its CSS-final state until its trigger starts.
         This closes the fast-jump blanking race caused by fromTo immediate render. */
      vars.immediateRender = false;
    }
    return track(gsap.fromTo(targets, fromVars, vars));
  }

  /* Below the fold → scroll-gated reveal (once). Above the fold → immediate
     load-in with a small cascade so the first paint composes itself. */
  function choreograph(el, targets, fromVars, baseOpts) {
    var rect = el.getBoundingClientRect();
    var inView = rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
    if (el.getAttribute("data-motion-once") === "false") {
      var tween = revealSet(targets, fromVars, el, baseOpts).pause(0);
      gsap.set(targets, { clearProps: CLEAR });
      var play = function () { if (!tween.isActive()) tween.restart(true); };
      triggers.push(ST.create({ trigger: el, start: "top 88%", end: "bottom top", onEnter: play, onEnterBack: play }));
      if (inView) play();
      return;
    }
    if (inView) {
      baseOpts.delay = Math.min(baseOpts.loadIndex || 0, 5) * 0.07;
      baseOpts.dur = Math.min(baseOpts.dur || 0.6, 0.55);
      revealSet(targets, fromVars, el, baseOpts);
    } else {
      baseOpts.scrollTrigger = { trigger: el, start: "top 88%", once: true };
      revealSet(targets, fromVars, el, baseOpts);
    }
  }

  var loadIndex = 0;

  function initH17() {
    var cards = Array.prototype.slice.call(document.querySelectorAll("[data-h17-card]"));
    cards.forEach(function (card) {
      card.dataset.h17State = reduced ? "static" : "pending";
      if (reduced || !gsap || !ST) return;
      var art = card.querySelector(".cs-home2-logistics__art");
      var copy = card.querySelector(".cs-home2-logistics__copy");
      if (!art || !copy) return;
      var reverse = card.classList.contains("cs-home2-logistics__card--reverse");
      var artFrom = reverse ? 84 : -84;   /* art enters from its own outer side */
      var repeatEntry = card.getAttribute("data-motion-once") === "false";
      var tl = gsap.timeline({
        paused: repeatEntry,
        scrollTrigger: repeatEntry ? undefined : { trigger: card, start: "top 80%", once: true },
        defaults: { duration: 0.7, ease: "power3.out" },
        onComplete: function () { card.dataset.h17State = "complete"; }
      });
      tl.fromTo(art, { x: artFrom, opacity: 0.36 }, { x: 0, opacity: 1, clearProps: CLEAR, immediateRender: false }, 0);
      tl.fromTo(copy, { x: -artFrom, opacity: 0.36 }, { x: 0, opacity: 1, clearProps: CLEAR, immediateRender: false }, 0.08);
      track(tl);
      if (repeatEntry) {
        var play = function () { if (!tl.isActive()) { card.dataset.h17State = "playing"; tl.restart(); } };
        triggers.push(ST.create({ trigger: card, start: "top 80%", end: "bottom top", onEnter: play, onEnterBack: play }));
        var rect = card.getBoundingClientRect();
        if (rect.top < innerHeight * 0.8 && rect.bottom > 0) play();
      }
    });
  }

  function initVocabulary() {
    if (reduced || !gsap || !ST) return;

    /* single-element entrances */
    var singles = Array.prototype.slice.call(document.querySelectorAll("[data-motion]"));
    singles.forEach(function (el) {
      if (el.closest("[data-h17-card]") || el.hasAttribute("data-h17-card")) return;
      var variant = VARIANTS[el.getAttribute("data-motion")];
      if (!variant) return;
      choreograph(el, el, variant, { loadIndex: loadIndex++, dur: 0.6 });
    });

    /* grouped, staggered entrances */
    var groups = Array.prototype.slice.call(document.querySelectorAll("[data-motion-group]"));
    groups.forEach(function (group) {
      var variant = VARIANTS[group.getAttribute("data-motion-group")] || VARIANTS.rise;
      var children = Array.prototype.slice.call(group.children);
      if (!children.length) return;
      var stagger = parseFloat(group.getAttribute("data-motion-stagger") || "");
      if (!isFinite(stagger) || stagger < 0) stagger = 0.08;
      choreograph(group, children, variant, { loadIndex: loadIndex++, dur: 0.6, stagger: stagger });
    });
  }

  function syncAuroras() {
    auroras.forEach(function (item) {
      var running = !reduced && !paused && !auroraUserPaused && !document.hidden && item.visible;
      item.tween.paused(!running);
      if (item.grow) item.grow.paused(!running);
    });
  }

  function syncAuroraControls() {
    auroraControls.forEach(function (item) {
      var label = auroraUserPaused ? "Resume card animation" : "Pause card animation";
      if (item.button.textContent !== label) item.button.textContent = label;
      item.button.setAttribute("aria-pressed", String(auroraUserPaused));
    });
  }

  function initAuroraControls() {
    auroraControls = auroraControls.filter(function (item) {
      if (item.grid.isConnected && item.grid.querySelector(".p3-card-aurora")) return true;
      item.button.removeEventListener("click", item.toggle);
      item.button.remove();
      return false;
    });
    document.querySelectorAll(".p3-provider-grid").forEach(function (grid) {
      if (!grid.querySelector(".p3-card-aurora") || auroraControls.some(function (item) { return item.grid === grid; })) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "cs-btn cs-btn--quiet";
      button.dataset.auroraPause = "";
      var toggle = function () { auroraUserPaused = !auroraUserPaused; syncAuroraControls(); syncAuroras(); };
      button.addEventListener("click", toggle);
      grid.parentNode.insertBefore(button, grid);
      auroraControls.push({ grid: grid, button: button, toggle: toggle });
    });
    syncAuroraControls();
  }

  function removeAurora(item) {
    item.tween.kill();
    if (item.grow) item.grow.kill();
    if (auroraObserver) auroraObserver.unobserve(item.el);
    ["mouseenter", "mouseleave", "focusin", "focusout"].forEach(function (name) { item.card.removeEventListener(name, item.interact); });
    gsap.set(item.el, { clearProps: CLEAR });
    gsap.set(item.card, { clearProps: "transform" });
    item.card.style.transitionProperty = item.transitionProperty;
  }

  function initAuroras() {
    if (reduced || !gsap) return;
    if (!auroraObserver && window.IntersectionObserver) {
      auroraObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          auroras.forEach(function (item) { if (item.el === entry.target) item.visible = entry.isIntersecting; });
        });
        syncAuroras();
      });
    }
    document.querySelectorAll(".p3-card-aurora").forEach(function (el) {
      if (auroras.some(function (item) { return item.el === el; })) return;
      var card = el.closest(".p3-provider-card") || el.parentElement;
      var rect = el.getBoundingClientRect();
      var item = { el: el, card: card, visible: rect.bottom > 0 && rect.top < innerHeight, transitionProperty: card.style.transitionProperty };
      // GSAP owns card transforms; a CSS transform transition would restart
      // on every tween frame and cancel its previous Animation.finished promise.
      card.style.transitionProperty = "border-color, box-shadow";
      item.tween = gsap.fromTo(el, { opacity: 0.42, xPercent: -4, scale: 1 }, {
        opacity: 0.82, xPercent: 4, scale: 1.12, duration: 4.5, repeat: -1, yoyo: true, ease: "sine.inOut", paused: true
      });
      item.interact = function (event) {
        if (event.type === "mouseenter") item.hovered = true;
        if (event.type === "mouseleave") item.hovered = false;
        var focused = event.type === "focusout" ? card.contains(event.relatedTarget) : card.contains(document.activeElement);
        var active = item.hovered || focused;
        item.tween.timeScale(active ? 2.2 : 1);
        if (item.grow) item.grow.kill();
        item.grow = gsap.to(card, { scale: active ? 1.015 : 1, duration: 0.22, overwrite: "auto" });
        syncAuroras();
      };
      ["mouseenter", "mouseleave", "focusin", "focusout"].forEach(function (name) { card.addEventListener(name, item.interact); });
      auroras.push(item);
      if (auroraObserver) auroraObserver.observe(el);
    });
    auroras = auroras.filter(function (item) {
      if (item.el.isConnected) return true;
      removeAurora(item);
      return false;
    });
    initAuroraControls();
    syncAuroras();
  }

  function teardown() {
    if (listingObserver) { listingObserver.disconnect(); listingObserver = null; }
    if (listingRefresh !== null) { cancelAnimationFrame(listingRefresh); listingRefresh = null; }
    reduced = true;
    stopScroll();
    if (mutations) { mutations.disconnect(); mutations = null; }
    auroras.forEach(removeAurora);
    auroras = [];
    auroraControls.forEach(function (item) { item.button.removeEventListener("click", item.toggle); item.button.remove(); });
    auroraControls = [];
    if (auroraObserver) { auroraObserver.disconnect(); auroraObserver = null; }
    triggers.forEach(function (t) { try { t.kill(); } catch (e) {} });
    triggers = [];
    live.forEach(function (t) { try { t.kill(); } catch (e) {} });
    live = [];
    if (gsap) {
      gsap.set("[data-motion],[data-motion] > *,[data-motion-group] > *,[data-h17-card] .cs-home2-logistics__art,[data-h17-card] .cs-home2-logistics__copy", { clearProps: CLEAR });
    }
    document.querySelectorAll("[data-h17-card]").forEach(function (card) { card.dataset.h17State = "static"; });
    if (window.CS_MOTION) { window.CS_MOTION.reduced = true; window.CS_MOTION.lenis = null; }
  }

  function init() {
    loadIndex = 0;
    var main = document.querySelector("main");
    if (main) {
      // Reuse the existing reveal vocabulary for content sections on every
      // family, without animating the whole main/form or nested controls.
      main.querySelectorAll(":scope > section, :scope > div > section").forEach(function (el) {
        if (el.closest(".cs-home2-hero") || el.hasAttribute("data-motion-group") || el.hasAttribute("data-h17-card") || el.querySelector("[data-h17-card],[data-motion-group]")) return;
        if (!el.hasAttribute("data-motion")) el.setAttribute("data-motion", "rise");
      });
    }

    var listing = document.querySelector("main.listing[data-phase3-route]");
    if (listing && /^\/(?:providers\/|lp\/best-providers\/)/.test(listing.dataset.phase3Route)) {
      // Bind animation to existing content, not the listing's filter/drawer controls.
      listing.querySelectorAll(":scope > .listing__intro, :scope > section, :scope > .listing__category-art, :scope > .p3-typed-offer-panel, :scope > .p3-evidence-boundary, :scope > .p3-source-disclosure").forEach(function (el) {
        el.setAttribute("data-motion", "rise");
        el.setAttribute("data-motion-once", "false");
      });
    }
    initScroll();
    initH17();
    initVocabulary();
    initAuroras();
    if (listing && !reduced && ST && window.ResizeObserver && !listingObserver) {
      listingObserver = new ResizeObserver(function () {
        if (listingRefresh !== null) cancelAnimationFrame(listingRefresh);
        listingRefresh = requestAnimationFrame(function () { listingRefresh = null; ST.refresh(); });
      });
      listingObserver.observe(listing);
    }
    if (!reduced && !mutations) {
      mutations = new MutationObserver(initAuroras);
      mutations.observe(document.body, { childList: true, subtree: true });
    }
    if (window.CS_MOTION) { window.CS_MOTION.reduced = reduced; window.CS_MOTION.lenis = lenis; }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  motionPreference.addEventListener("change", function (event) {
    if (event.matches) teardown();
    else { reduced = false; init(); }
  });
  pointerPreference.addEventListener("change", function (event) {
    smoothPointer = event.matches;
    if (!smoothPointer || reduced) stopScroll();
    else initScroll();
    if (window.CS_MOTION) {
      window.CS_MOTION.lenis = lenis;
      window.CS_MOTION.nativeMobile = !smoothPointer;
    }
  });
  document.addEventListener("visibilitychange", syncAuroras);

  window.CS_MOTION = {
    __v2: true,
    lenis: lenis,
    reduced: reduced,
    nativeMobile: !smoothPointer,
    gsap: gsap,
    getTweens: function () { return live.slice(); },
    getAuroras: function () { return auroras.slice(); },
    refresh: function () { if (ST) ST.refresh(); },
    stop: function () { paused = true; if (lenis) lenis.stop(); syncAuroras(); },
    start: function () { paused = false; if (lenis && !reduced) lenis.start(); syncAuroras(); }
  };
})();
