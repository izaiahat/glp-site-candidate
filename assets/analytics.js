(() => {
  // W5's explicit candidate policy is a source-level hold, not a synthetic-UA
  // suppressor or a user-consent override. No SDK, queue, click ID or decoration.
  const candidateThirdPartyExports = window.GCS_EXPORT_POLICY?.third_party_exports === true;
  if (!candidateThirdPartyExports) {
    window.GCSAnalytics = { event: () => false, clickIdFor: () => null, decorateOutbound: anchor => anchor.href };
    return;
  }

  // Manual events carry no caller-provided properties. PostHog's last-mile
  // hook separately preserves its protocol envelope and anonymous visit/route
  // fields. This analytics permission never feeds the advertising lanes.
  const allowed = Object.freeze({
    $pageview: [],
    affiliate_click: [], comparison_table_view: [],
    cost_calculator_used: [], calculator_submit: [],
    content_upgrade_view: [], content_upgrade_submit: [],
    content_upgrade_success: [], content_upgrade_complete: [], scroll_75: [],
    sticky_cta_click: [],
    // Scoped progression is allowed only after an explicit analytics choice.
    quiz_start: [], quiz_step_complete: [], quiz_complete: [], results_view: [],
    comparison_filters_applied: [],
    comparison_sort_change: [],
  });
  const PROGRESSION_EVENTS = new Set(['quiz_start','quiz_step_complete','quiz_complete','results_view']);
  function progressionAllowed(name) {
    return !PROGRESSION_EVENTS.has(name) || window.GCSConsent?.read?.()?.analytics_basis === 'explicit';
  }
  function reviewed(name) { return typeof name === 'string' && Object.hasOwn(allowed, name); }
  function cleanProperties(name, params) {
    const clean = {};
    for (const key of allowed[name]) if (params[key] !== undefined) clean[key] = params[key];
    return clean;
  }
  // Keep only the SDK protocol fields and the approved anonymous route
  // dimensions. Never spread caller properties, profiles, referrers or forms.
  // Removing token makes the real PostHog SDK drop the event before transport.
  function beforeSend(event) {
    if (!consented() || !reviewed(event?.event) || !progressionAllowed(event.event)) return null;
    const properties = event.properties || {};
    const url = new URL(location.href);
    url.search = ''; url.hash = ''; url.username = ''; url.password = '';
    // Only neutral static paths are reportable. Health-specific and unknown
    // URLs remain absent, not renamed to a misleading homepage visit.
    const reportRoute = ['/', '/providers/', '/compare/', '/privacy/', '/privacy/cookies/', '/terms/', '/about/'].includes(url.pathname);
    return {
      event: event.event,
      ...(event.uuid !== undefined ? { uuid: event.uuid } : {}),
      ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
      properties: {
        token: properties.token,
        distinct_id: window.posthog?.get_distinct_id?.(),
        $process_person_profile: false,
        $host: url.host,
        ...(reportRoute ? { $current_url: url.href, $pathname: url.pathname } : {}),
      },
    };
  }

  function emit(name, params = {}) {
    const config = window.GCS_ANALYTICS || {};
    if (!consented() || !config.enabled || config.consent !== "granted" || !reviewed(name) || !progressionAllowed(name)) return false;
    const clean = cleanProperties(name, params);
    // A12b/A11: do not queue UI events for the uncontained GTM/GA lane.
    // PostHog below remains independently analytics-consented. A future Google
    // lane needs its own reviewed loader/event contract, not an ads toggle.
    // Outbound events use an immediate keepalive-capable fetch through the same
    // owned consent transport. Beacon cannot carry the epoch's AbortSignal.
    if (window.GCS_POSTHOG_LOADED) {
      const options = OUTBOUND_EVENTS.has(name) ? { transport: "fetch", send_instantly: true } : undefined;
      try { window.posthog?.capture?.(name, clean, options); } catch { /* analytics never breaks the funnel it measures */ }
    }
    return true;
  }

  const OUTBOUND_EVENTS = new Set(["affiliate_click", "sticky_cta_click"]);

  // ---- PostHog (task #64 restore) -----------------------------------------
  // Health-vertical rules (CRO D8): autocapture OFF, every input and text node
  // masked, session recording OFF, no person profiles for anonymous visitors.
  // The site's own banner promises "Health quiz answers are never sent to
  // analytics" - these settings are what keeps that sentence literally true, and
  // the allow-list above means a quiz ANSWER has no property to travel in.
  let pendingQueue = [], loadGeneration = 0, posthogInitialized = false;
  let transportController = null, transportHost = null;
  // Install before array.js snapshots fetch. Scope the adapter to this SDK host;
  // unrelated page fetches are untouched. Each consent epoch owns one signal.
  // Failed/queued SDK retries keep their original fetch_options, so a regrant
  // cannot resurrect an old request. Local 400 is terminal in the pinned SDK,
  // not a fabricated ingestion success, and never leaves this document.
  function prepareTransport(host) {
    if (typeof window.fetch !== 'function' || typeof window.AbortController !== 'function' || typeof window.Response !== 'function') return false;
    const origin = new URL(host).origin;
    if (transportHost && transportHost !== origin) return false;
    if (!transportHost) {
      transportHost = origin;
      const fetch = window.fetch.bind(window);
      window.fetch = (input, options = {}) => {
        let target;
        try { target = new URL(typeof input === 'string' ? input : (input.url ?? input), location.href); } catch { return fetch(input, options); }
        if (target.origin !== transportHost) return fetch(input, options);
        const signal = options.signal;
        const permitted = () => consented() && signal === transportController?.signal && signal?.aborted === false;
        const denied = () => new window.Response('', { status: 400 });
        if (!permitted()) return Promise.resolve(denied());
        return fetch(input, { ...options, referrerPolicy: 'no-referrer', credentials: 'omit' }).then(
          response => permitted() ? response : denied(),
          error => { if (!permitted()) return denied(); throw error; },
        );
      };
    }
    if (!transportController || transportController.signal.aborted) transportController = new window.AbortController();
    return true;
  }
  function transportOptions() { return { referrerPolicy: 'no-referrer', signal: transportController.signal }; }
  function stopTransport() { transportController?.abort(); }
  function loadPostHog() {
    const config = window.GCS_POSTHOG || {};
    if (!consented() || !config.enabled || !config.api_key || !config.host || !prepareTransport(config.host)) return;
    if (window.GCS_POSTHOG_LOADED) {
      window.posthog?.set_config?.({ fetch_options: transportOptions() });
      // Acknowledge/focus notifications are not new visits. The SDK emits another
      // pageview on opt_in_capturing, so only call it after an actual withdrawal.
      if (posthogInitialized && window.posthog?.has_opted_out_capturing?.() === true)
        window.posthog.opt_in_capturing({captureEventName:false});
      return;
    }
    window.GCS_POSTHOG_LOADED = true;
    const queue = pendingQueue = [], generation = ++loadGeneration;
    // `_i: []` is load-bearing, not decoration. The tail of PostHog's array.js reads
    //   var i = window.posthog; if (!i || isArray(i._i)) { ...install the real SDK... }
    // so a truthy `window.posthog` WITHOUT an array `_i` makes the library decline to
    // install and silently leave the stub in place. That is what happened here: the
    // stub below existed, array.js downloaded and executed with a 200, `posthog.init`
    // never appeared, our own load handler correctly concluded "stubbed loader" and
    // set GCS_POSTHOG_LOADED = false — and every capture was dropped, forever, with
    // no error anywhere. PostHog's own snippet declares `_i` for exactly this reason.
    if (typeof window.posthog?.init !== 'function') window.posthog = { capture: (...args) => queue.push(args), __queue: queue, _i: [] };
    const script = document.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `${config.host.replace(/\/$/, "")}/static/array.js`;
    script.addEventListener("error", () => { if (generation === loadGeneration) window.GCS_POSTHOG_LOADED = false; queue.length = 0; });
    script.addEventListener("load", () => {
      if (generation !== loadGeneration) { queue.length = 0; return; }
      // A blocked or stubbed loader must degrade to a no-op, never throw into the
      // page: analytics is not allowed to break the funnel it is measuring.
      if (!consented() || typeof window.posthog?.init !== "function") { window.GCS_POSTHOG_LOADED = false; queue.length = 0; return; }
      window.posthog.init(config.api_key, {
        api_host: config.host,
        api_transport: 'fetch',
        disable_beacon: true,
        fetch_options: transportOptions(),
        autocapture: false,
        capture_pageview: true,
        capture_pageleave: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_surveys: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
        person_profiles: "never",
        persistence: "memory",
        disable_persistence: true,
        advanced_disable_feature_flags: true,
        advanced_disable_decide: true,
        capture_exceptions: false,
        capture_heatmaps: false,
        before_send: beforeSend,
        property_denylist: ["$initial_referrer", "$referrer", "$title", "$initial_current_url", "$device_id", "$user_id"],
      });
      posthogInitialized = true;
      for (const args of queue) if (consented()) window.posthog.capture(...args);
      queue.length = 0;
    });
    document.head.appendChild(script);
  }

  // ---- non-production traffic suppression (analytics-truth fix 2026-08-20) ----
  // WHY THIS EXISTS, precisely: the previous guard sniffed the UA string only, and
  // BOTH configured Playwright projects defeat it. `devices["Desktop Chrome"]`
  // OVERRIDES navigator.userAgent to a real Windows Chrome string, and headless
  // WebKit never carried a headless marker at all (measured 2026-08-20:
  // "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML,
  // like Gecko) Version/26.5 Safari/605.1.15"). The result was 20,617 of 20,958 GA4
  // sessions in the production property arriving from hostName 127.0.0.1 — a 60x
  // distortion of every ratio the business computes.
  //
  // Two orthogonal signals now, either of which is disqualifying:
  //   1. navigator.webdriver — set true by Playwright/Puppeteer/Selenium in EVERY
  //      engine and NOT settable from page script. UA strings are cosmetic; this is
  //      the automation bit itself.
  //   2. a non-production hostname — a page served from localhost is by definition
  //      not a visitor, whatever is driving it.
  // The UA patterns are kept as a third net for crawlers that announce themselves.
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", ""]);
  function localHost() {
    const host = location.hostname || "";
    return LOCAL_HOSTS.has(host) || /(^|\.)localhost$|\.local$|\.test$|\.internal$/i.test(host) || location.protocol === "file:";
  }
  function automated() {
    return navigator.webdriver === true
      || /HeadlessChrome|Headless|Playwright|Puppeteer|Lighthouse|Google-InspectionTool|synthetic|bot|crawler|spider/i.test(navigator.userAgent || "");
  }
  function suppressed() {
    return localHost() || automated();
  }
  function consented() {
    return window.GCSConsent?.allowsExports?.('analytics') === true;
  }
  // Back-compat alias: loadPostHog() and any future caller read one predicate.
  const synthetic = suppressed;

  // Hard kill at the GA transport, not just at our own emit(). consent.js runs one
  // <script defer> earlier and has already queued gtag('config',…); the gtag/js
  // script is still in flight at this point, and gtag.js re-reads window['ga-disable-<id>']
  // on every send. Setting it here suppresses the automatic page_view too — which
  // was the bulk of the 103,013 localhost events, none of which emit() ever saw.
  if (suppressed()) {
    const config = window.GCS_ANALYTICS || {};
    for (const id of [config.measurement_id, config.debug_measurement_id, config.active_measurement_id]) {
      if (id) window["ga-disable-" + id] = true;
    }
    window.GCS_ANALYTICS_SUPPRESSED = true;
  }

  // ---- cs_click_id: first-party persistent click identity (CR-5) ----------
  // UUIDv7 so the id is time-ordered - a delayed conversion can be matched back
  // to the click window without storing a timestamp anywhere else.
  function uuidv7() {
    const bytes = new Uint8Array(16);
    (window.crypto || {}).getRandomValues?.(bytes);
    const ms = Date.now();
    for (let index = 0; index < 6; index += 1) bytes[index] = (ms / 2 ** (8 * (5 - index))) & 0xff;
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const CLICK_ID_PREFIX = "cs_click_id:last:";
  const decoratedAnchors = new Map();
  function attributionConsented() { return window.GCSConsent?.allowsExports?.('advertising') === true; }
  function clearAttribution() {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith(CLICK_ID_PREFIX)) localStorage.removeItem(key);
    } catch { /* unavailable storage cannot be erased; no new identity is issued */ }
    for (const [anchor, original] of decoratedAnchors) anchor.setAttribute('href', original);
    decoratedAnchors.clear();
  }
  function clickIdFor(providerSlug) {
    if (!attributionConsented() || suppressed()) { clearAttribution(); return null; }
    const key = CLICK_ID_PREFIX + (providerSlug || "unknown");
    const now = new Date().toISOString();
    const record = { clickId: uuidv7(), createdAt: now, providerSlug: providerSlug || "unknown" };
    try { localStorage.setItem(key, JSON.stringify(record)); } catch { /* storage denied: the click still fires, unattributed */ }
    return record.clickId;
  }

  // Per-network parameter names for sub1..sub4 (mirrors src/affiliate-subid.mjs).
  const NETWORK_PARAMS = {
    Katalys: ["sub1", "sub2", "sub3", "sub4"],
    RevOffers: ["sub1", "sub2", "sub3", "sub4"],
    Affiliati: ["s1", "s2"],
    Awin: ["clickref", "clickref2", "clickref3", "clickref4"],
    CJ: ["sid", "sid2", "sid3", "sid4"],
    Impact: ["subId1", "subId2", "subId3", "subId4"],
    ShareASale: ["afftrack", "u1", "u2", "u3"],
  };

  function decorateOutbound(anchor, clickId) {
    // ClickDealer default issuer links have no established browser-owned slot.
    // Do not inherit the Katalys fallback or even normalize their URL bytes.
    if (!attributionConsented() || suppressed() || !clickId) { clearAttribution(); return anchor.href; }
    if (anchor.dataset?.network === "ClickDealer") return anchor.href;
    let url;
    try { url = new URL(anchor.href); } catch { return anchor.href; }
    if (url.origin === window.location.origin && /^\/go\/[a-z0-9][a-z0-9-]{1,79}$/.test(url.pathname.replace(/\/$/, ""))) {
      url.searchParams.set("cs_click_id", clickId);
      return url.toString();
    }
    // PB93: only the six issued MaxBounty offers for publisher 803003 own S2.
    // No placement, health context, advertising IDs or Katalys fallback here.
    if (anchor.dataset.network === "MaxBounty") {
      const offers = ["31359", "32122", "29207", "32639", "32854", "32662"];
      if (url.protocol !== "https:" || !["afflat3e1.com", "afflat3e3.com"].includes(url.hostname)
          || !url.pathname.startsWith("/trk/lnk/")
          || url.searchParams.getAll("a").length !== 1 || url.searchParams.get("a") !== "803003"
          || url.searchParams.getAll("o").length !== 1 || !offers.includes(url.searchParams.get("o"))) return anchor.href;
      const existing = url.searchParams.getAll("s2");
      if (existing.length > 1 || (existing.length === 1 && existing[0] !== clickId)) return anchor.href;
      url.searchParams.set("s2", clickId);
      return url.toString();
    }
    const codec = anchor.dataset.subidCodec || anchor.dataset.network;
    const params = NETWORK_PARAMS[codec] || NETWORK_PARAMS.Katalys;
    // Advertising click IDs belong only to the governed /go receiver, never
    // browser analytics or arbitrary direct-network decoration.
    // Affiliati's settled contract is s1=placement and s2=owned click ID.
    // Exclude it from the generic three-slot decorator; never duplicate identity
    // into placement or replace an issuer-bound placement already in the href.
    if (anchor.dataset.network !== "Affiliati" && codec !== "Affiliati") {
      const values = [anchor.dataset.sub1, anchor.dataset.sub2, clickId];
      params.forEach((name, index) => {
        const value = values[index];
        if (!value) return;
        if (index < 2 && url.searchParams.get(name)) return;
        url.searchParams.set(name, value);
      });
    } else {
      if (!url.searchParams.get('s1') && anchor.dataset.sub1) url.searchParams.set('s1', anchor.dataset.sub1);
      url.searchParams.set('s2', clickId);
    }
    // Preserve sub1..sub4 as placement/reporting slots. Katalys' specialized
    // owned click key round-trips separately as {transaction_id} in postbacks.
    if (anchor.dataset.network === "Katalys" && clickId) url.searchParams.set("aff_click_id", clickId);
    return url.toString();
  }

  if (!attributionConsented()) clearAttribution();
  if ((window.GCS_ANALYTICS || {}).consent === "granted") loadPostHog();
  window.addEventListener("gcs:consent", (event) => {
    if (!attributionConsented()) clearAttribution();
    if (event.detail?.analytics === "granted" && consented()) loadPostHog();
    else { stopTransport(); pendingQueue.length = 0; loadGeneration++; if (!posthogInitialized) window.GCS_POSTHOG_LOADED = false; window.posthog?.opt_out_capturing?.(); }
  });

  window.GCSAnalytics = { event: emit, clickIdFor, decorateOutbound };
  window.addEventListener("gcs:analytics", (event) => emit(event.detail?.name, event.detail?.params));
  document.addEventListener('submit', event => {
    if (event.isTrusted === true && event.target?.id === 'cost-form') emit('calculator_submit');
  }, true);

  document.addEventListener("click", (event) => {
    const anchor = event.target.closest('[data-analytics-event="affiliate_click"]');
    if (!anchor) return;
    if (suppressed()) return;
    if (!attributionConsented()) clearAttribution();
    const providerSlug = anchor.dataset.providerSlug || anchor.dataset.program;
    const clickId = clickIdFor(providerSlug);
    // Remember the exact pre-decoration attribute, including relative URL bytes.
    // A second click must never replace that original with an owned-ID URL.
    const decorated = decorateOutbound(anchor, clickId);
    if (decorated !== anchor.href) {
      if (!decoratedAnchors.has(anchor)) decoratedAnchors.set(anchor, anchor.getAttribute('href'));
      anchor.href = decorated;
    }
    emit("affiliate_click", {
      program: anchor.dataset.program,
      merchant: anchor.dataset.merchant,
      page_slug: anchor.dataset.pageSlug,
      link_position: anchor.dataset.linkPosition,
      variant: anchor.dataset.variant || "a",
      subid: anchor.dataset.subid,
      provider_slug: providerSlug,
      network: anchor.dataset.network,
      rank_position: Number(anchor.dataset.rankPosition || 0),
      element_code: anchor.dataset.elementCode,
      page_type: anchor.dataset.pageType,
      page_path: window.location.pathname,
      cs_click_id: clickId,
      sub1: anchor.dataset.sub1,
    });
    if (anchor.dataset.elementCode === "F") emit("sticky_cta_click", { page_slug: anchor.dataset.pageSlug, provider_slug: providerSlug });
  });

  // No values, branch identifiers, ordinal step numbers or result counts.
  // Only operator-authorized coarse progression after an explicit analytics choice.
  window.addEventListener('gcs:quiz', event => {
    const name = event.detail?.name;
    if (PROGRESSION_EVENTS.has(name)) emit(name);
  });


  let sentScroll75 = false;
  window.addEventListener("scroll", () => {
    if (!sentScroll75 && (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight >= 0.75) {
      sentScroll75 = true;
      emit("scroll_75", { page_slug: window.location.pathname });
    }
  }, { passive: true });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        emit("comparison_table_view", {
          page_slug: window.location.pathname,
          table_id: entry.target.dataset.tableId,
        });
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-analytics-event="comparison_table_view"]').forEach((table) => observer.observe(table));
    const contentObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        emit("content_upgrade_view", {
          page_slug: window.location.pathname,
          surface: entry.target.closest("[data-capture-placement]")?.dataset.capturePlacement || (entry.target.hasAttribute("data-content-upgrade-form-inline") ? "inline" : "modal"),
        });
        contentObserver.unobserve(entry.target);
      }
    }, { threshold: 0.5 });
    document.querySelectorAll("[data-content-upgrade-form-inline], [data-content-upgrade-form]").forEach((form) => contentObserver.observe(form));
  }
})();
