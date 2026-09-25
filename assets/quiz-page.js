(() => {
  const root = document.querySelector("[data-phase4-quiz]");
  // W3 delivery seam: organic data remains inline; paid data is atomic and deferred.
  // Placement is build-owned, never inferred from arbitrary query parameters.
  const paid = root?.dataset.quizPageSlug === "lp-quiz" && root?.dataset.quizSlot === "lp-quiz.lp1";
  const pageSlug = paid ? "lp-quiz" : "quiz-provider-fit";
  const boot = (payloadNode) => {
  if (!root || !payloadNode) return;

  let data;
  try { data = JSON.parse(payloadNode.textContent); } catch { return; }

  const flow = data.flow;
  const form = root.querySelector("[data-phase4-questions]");
  const positions = [...root.querySelectorAll("[data-quiz-position]")];
  const results = root.querySelector("[data-phase4-results]");
  const resultCards = results.querySelector("[data-result-cards]");
  const resultEmpty = results.querySelector("[data-result-empty]");
  const resultSummary = results.querySelector("[data-result-summary]");
  const explore = results.querySelector("[data-explore-providers]");
  const progress = root.querySelector(".qz-progress");
  const progressBar = progress.querySelector("span");
  const progressText = root.querySelector("[data-progress-text]");
  const answers = { intents: [], reasons: [], features: [], maintenance: false };
  const preferencesKey = "gcs.quiz.provider-fit.preferences.v1";
  const progressKey = "gcs.quiz.provider-fit.progress.v1";
  let current = 0;
  let restoredResultDrug = "";

  root.phase4State = answers;
  root.classList.add("qz-enhanced");
  results.hidden = true;
  form.addEventListener("submit", (event) => event.preventDefault());

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const familyOf = (drug) => flow.current_drugs.find((item) => item.value === drug)?.family || null;
  const labelOf = (items, value) => {
    const item = items.find((candidate) => candidate.value === value || candidate.code === value);
    return item?.label || item?.name || value;
  };

  function clearSavedQuiz() {
    // Ruling (e): neither answers nor derived matches may persist between pages.
    for (const store of ["localStorage", "sessionStorage"]) {
      for (const key of [progressKey, preferencesKey]) {
        try { window[store].removeItem(key); } catch {
          // Storage may be unavailable; do not fall back to another store.
        }
      }
    }
  }

  function saveProgress() {
    // Existing step handlers share this live object, never a storage snapshot.
    root.phase4State = answers;
  }

  function hydrateProgress() {
    clearSavedQuiz();
    return 0;
  }

  function path() {
    if (answers.intents.includes("NOT_SURE")) return [0, 1, 3, 4, 5, 6];
    if (answers.current_use === "yes") return [0, 2, 3, 4, 5, 6];
    if (answers.current_use === "no") return [0, 2, 1, 4, 5, 6];
    return [0, 2];
  }

  function clearError(position = positions[current]) {
    const error = position?.querySelector("[data-quiz-error]");
    if (error) error.textContent = "";
  }

  function showError(message, control = null) {
    const error = positions[current]?.querySelector("[data-quiz-error]");
    if (error) error.textContent = message;
    if (control) {
      control.setAttribute("aria-invalid", "true");
      control.focus({ preventScroll: true });
    }
  }

  function syncBranch() {
    const situation = root.querySelector('[data-branch="situation"]');
    const currentTreatment = root.querySelector('[data-branch="current-treatment"]');
    const notSure = answers.intents.includes("NOT_SURE");
    situation.hidden = !notSure;
    currentTreatment.hidden = notSure || answers.current_use !== "yes";
  }

  function armNext() {
    const active = positions.find((position) => Number(position.dataset.quizPosition) === current);
    const action = active?.querySelector("[data-quiz-next],[data-quiz-finish]");
    if (action) action.dataset.armed = valid(current) === null ? "true" : "false";
  }

  function show(index, { focus = true, direction = null, animate = true } = {}) {
    const target = positions.find((position) => Number(position.dataset.quizPosition) === index);
    const prev = positions.find((position) => !position.hidden && position !== target);
    const dir = direction || (index >= current ? "forward" : "back");
    root.querySelectorAll("[data-quiz-transition]").forEach((node) => node.remove());
    current = index;
    results.hidden = true;
    syncBranch();
    progress.setAttribute("aria-valuenow", String(index + 1));
    progressBar.style.transform = `scaleX(${(index + 1) / 8})`;
    progressText.textContent = `Question ${index + 1} of 7`;
    clearError();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce || !prev || !target) {
      positions.forEach((position) => { position.hidden = position !== target; });
    } else {
      /* Animate an inert visual copy; only the destination remains a live step. */
      const outClass = dir === "back" ? "qz-slide-out-right" : "qz-slide-out-left";
      const inClass = dir === "back" ? "qz-slide-in-left" : "qz-slide-in-right";
      const prevTop = prev.offsetTop;
      const outgoing = prev.cloneNode(true);
      [outgoing, ...outgoing.querySelectorAll("*")].forEach((node) => {
        node.removeAttribute("id");
        node.removeAttribute("name");
        [...node.attributes].filter((attribute) => attribute.name.startsWith("data-quiz-") || ["data-single", "data-multi", "data-value"].includes(attribute.name))
          .forEach((attribute) => node.removeAttribute(attribute.name));
      });
      outgoing.dataset.quizTransition = "";
      outgoing.setAttribute("aria-hidden", "true");
      outgoing.inert = true;
      outgoing.style.pointerEvents = "none";
      outgoing.style.position = "absolute";
      outgoing.style.left = "0";
      outgoing.style.right = "0";
      outgoing.style.top = `${prevTop}px`;
      outgoing.classList.remove("qz-slide-in-left", "qz-slide-in-right", "qz-slide-out-left", "qz-slide-out-right");
      outgoing.classList.add(outClass);
      positions.forEach((position) => { position.hidden = position !== target; });
      prev.after(outgoing);
      const clearPrev = () => outgoing.remove();
      outgoing.addEventListener("animationend", clearPrev, { once: true });
      setTimeout(clearPrev, 420);
      target.classList.add(inClass);
      const clearTarget = () => target.classList.remove(inClass);
      target.addEventListener("animationend", clearTarget, { once: true });
      setTimeout(clearTarget, 520);
    }
    armNext();
    saveProgress();
    if (focus) target?.querySelector("h2")?.focus({ preventScroll: true });
  }

  function syncPressed(key) {
    root.querySelectorAll(`[data-single="${key}"],[data-multi="${key}"]`).forEach((button) => {
      const selected = Array.isArray(answers[key]) ? answers[key].includes(button.dataset.value) : answers[key] === button.dataset.value;
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function setDoseOptions() {
    const select = root.querySelector('[data-quiz-select="current_dose"]');
    const drug = flow.current_drugs.find((item) => item.value === answers.current_drug);
    const doses = drug?.doses || [];
    select.replaceChildren(new Option(drug ? "Choose a dose" : "Choose a medication first", ""));
    for (const dose of doses) select.add(new Option(`${dose}${/^\d/.test(dose) ? " mg/week" : ""}`, dose));
    if (!doses.includes(answers.current_dose)) answers.current_dose = "";
    select.value = answers.current_dose || "";
    select.disabled = !drug;
  }

  function toggleIntent(value) {
    if (value === "NOT_SURE") {
      answers.intents = answers.intents.includes("NOT_SURE") ? [] : ["NOT_SURE"];
      answers.current_use = "";
      answers.current_drug = "";
      answers.current_dose = "";
      answers.situation = "";
      syncPressed("current_use");
      syncPressed("situation");
      setDoseOptions();
    } else {
      answers.intents = answers.intents.filter((item) => item !== "NOT_SURE");
      answers.intents = answers.intents.includes(value)
        ? answers.intents.filter((item) => item !== value)
        : [...answers.intents, value];
      answers.situation = "";
      syncPressed("situation");
    }
    syncPressed("intents");
  }

  function toggleMultiple(key, value) {
    const values = answers[key] || [];
    answers[key] = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    syncPressed(key);
    if (key === "reasons") {
      const other = root.querySelector("[data-reason-other]");
      other.hidden = !answers.reasons.includes("OTHER_HEALTH_CONCERNS");
      if (other.hidden) {
        answers.reason_other = "";
        other.querySelector("input").value = "";
      }
    }
  }

  function valid(index) {
    if (index === 0) return answers.intents.length > 0 ? null : "Choose at least one treatment or Not sure.";
    if (index === 2) return answers.current_use ? null : "Choose Yes or No.";
    if (index === 3 && answers.intents.includes("NOT_SURE")) return answers.situation ? null : "Choose the situation that best matches your comparison goal.";
    if (index === 3 && answers.current_use === "yes") {
      if (!answers.current_drug) return "Choose your current medication.";
      if (!answers.current_dose) return "Choose your current dose.";
    }
    if (index === 5) return answers.state ? null : "Choose a state or jurisdiction.";
    if (index === 6 && answers.email && !emailPattern.test(answers.email)) return "Enter a valid email address or leave it blank.";
    return null;
  }

  // Funnel telemetry (CR-5): non-answer metadata ONLY — position numbers and
  // result counts. The analytics runtime owns consent gating and prop allowlists;
  // this side just announces. No answer value ever rides a detail object.
  let quizStarted = false;
  function quizEvent(name, extra = {}) {
    try { window.dispatchEvent(new CustomEvent("gcs:quiz", { detail: { name, ...extra } })); } catch { /* telemetry never breaks the quiz */ }
  }
  function markQuizStart() {
    if (quizStarted) return;
    quizStarted = true;
    quizEvent("quiz_start");
  }

  function next() {
    const error = valid(current);
    if (error) {
      const control = current === 5
        ? root.querySelector('[data-quiz-select="state"]')
        : current === 6
          ? root.querySelector('[data-quiz-input="email"]')
          : null;
      showError(error, control);
      return;
    }
    quizEvent("quiz_step_complete", { step_number: current + 1 });
    const route = path();
    const at = route.indexOf(current);
    if (at >= 0 && at < route.length - 1) show(route[at + 1]);
  }

  function back() {
    const route = path();
    const at = route.indexOf(current);
    if (at > 0) show(route[at - 1], { direction: "back" });
  }

  function goal() {
    const values = [...answers.features, answers.situation || ""];
    if (values.some((value) => /COACHING|NUTRITION_SUPPORT/.test(value))) return "coaching";
    if (values.some((value) => /FSA_HSA|LOWEST_COST/.test(value))) return "price";
    return "medication-form";
  }

  function resolveOutcome() {
    if (answers.intents.includes("NOT_SURE")) {
      if (answers.situation === "FDA_APPROVED_ONLY") return { kind: "brand", intent: "ZEPBOUND", route: data.brand_routes.ZEPBOUND };
      return { kind: "compounded", drug: answers.situation === "LOWEST_COST" ? "SEMAGLUTIDE" : "TIRZEPATIDE" };
    }
    const compounded = answers.intents.filter((intent) => ["SEMAGLUTIDE", "TIRZEPATIDE"].includes(intent));
    if (compounded.length === 1) return { kind: "compounded", drug: compounded[0] };
    if (compounded.length > 1) return { kind: "compounded", drug: ["SEMAGLUTIDE", "WEGOVY", "OZEMPIC"].includes(answers.current_drug) ? "SEMAGLUTIDE" : "TIRZEPATIDE" };
    const brand = [...answers.intents].reverse().find((intent) => data.brand_routes[intent]);
    return { kind: "brand", intent: brand, route: data.brand_routes[brand] };
  }

  function appendText(parent, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    parent.append(node);
    return node;
  }

  function selectedDoseFor(drug) {
    if (answers.current_use !== "yes" || familyOf(answers.current_drug) !== drug || !answers.current_dose) return null;
    return answers.current_dose;
  }

  function buildCard(record, index, drug) {
    const card = document.createElement("article");
    card.className = `qz-card${index === 0 ? " qz-card--top" : ""}`;
    card.dataset.program = record.program_id;
    appendText(card, "p", "qz-card-status", index === 0 ? "Top rule-based match" : `Match ${index + 1}`);

    const identity = document.createElement("div");
    identity.className = "qz-card-identity";
    const logo = document.createElement("span");
    logo.className = `qz-logo-slot${record.logo ? ` qz-logo-slot--${record.logo.chip_class}` : ""}`;
    logo.setAttribute("role", "img");
    logo.setAttribute("aria-label", record.logo?.alt || `${record.display_name} identity`);
    if (record.logo) {
      const image = document.createElement("img");
      image.src = record.logo.path;
      image.alt = record.logo.alt;
      image.width = record.logo.width;
      image.height = record.logo.height;
      image.loading = "lazy";
      image.decoding = "async";
      logo.append(image);
    } else {
      const wordmark = document.createElement("span");
      wordmark.setAttribute("aria-hidden", "true");
      wordmark.textContent = record.display_name;
      logo.append(wordmark);
    }
    identity.append(logo);
    appendText(identity, "h3", "qz-card-name", record.display_name);
    card.append(identity);

    const dose = selectedDoseFor(drug);
    if (dose) appendText(card, "p", "qz-card-context", `Your selected dose: ${dose}${/^\d/.test(dose) ? " mg/week" : ""}.`);
    // Build-time escaped source evidence; never consumed by shortlist or cost scoring.
    const typedEvidence = record.typed_price_evidence?.[drug];
    if (typedEvidence) {
      const panel = document.createElement('section');
      panel.setAttribute('data-quiz-typed-evidence', '');
      panel.innerHTML = typedEvidence;
      card.append(panel);
    }
    const price = record.pricing?.[drug];
    if (price) {
      if (price.label) appendText(card, "p", "qz-card-plan", price.label);
      const figure = appendText(card, "p", "qz-card-price", `$${Number(price.amount).toLocaleString("en-US")}/${price.cadence}`);
      const term = price.month_1_usd !== null && price.month_1_usd !== price.amount
        ? `First month: $${Number(price.month_1_usd).toLocaleString("en-US")}. Then the price shown above.`
        : "Published ongoing price.";
      appendText(card, "p", "qz-card-term", `${term}${price.captured_on ? ` Source captured on ${price.captured_on}.` : ""}`);
      if (price.source_url) {
        const source = document.createElement("a");
        source.href = price.source_url;
        source.rel = "noopener noreferrer";
        source.className = "cs-arrowlink qz-card-source";
        source.textContent = "Price source ";
        appendText(source, "span", "cs-arrow", "→");
        figure.after(source);
      }
    }

    /* Their results grammar: chips carry the facts, prose collapses. Every
       sentence is preserved inside the fold — compressed, never deleted. */
    const matched = answers.features.filter((feature) => (record.verified_features || []).includes(feature));
    if (matched.length) {
      const featureList = document.createElement("ul");
      featureList.className = "qz-card-features qz-card-features--chips";
      for (const feature of matched) appendText(featureList, "li", "", labelOf(flow.features, feature));
      card.append(featureList);
    }
    const more = document.createElement("details");
    more.className = "qz-card-more";
    appendText(more, "summary", "", "Why this match");
    appendText(more, "p", "qz-card-why", record.why_match);
    if (answers.features.length) appendText(more, "p", "qz-card-match", matched.length ? `${matched.length} of ${answers.features.length} selected preferences matched verified provider details.` : "No selected preference had verified supporting details for this provider.");
    if (!matched.length) {
      const featureList = document.createElement("ul");
      featureList.className = "qz-card-features";
      appendText(featureList, "li", "", answers.features.length ? "No selected preference had verified supporting details." : "You did not select an optional service preference.");
      more.append(featureList);
    }
    appendText(more, "p", "qz-card-review", record.review_state);
    card.append(more);

    const actions = document.createElement("div");
    actions.className = "qz-card-actions";
    const learn = document.createElement("a");
    learn.href = record.review_path;
    learn.textContent = "Learn more";
    actions.append(learn);
    if (record.has_live_link && record.affiliate_href) {
      const start = document.createElement("a");
      start.href = record.affiliate_href;
      // Preserve the source-owned destination. A paid placement registry must
      // be supplied before changing an attribution tuple or claiming coverage.
      start.rel = "sponsored nofollow noopener";
      start.textContent = "Get Started";
      start.dataset.program = record.program_id;
      start.dataset.linkMode = "transparent-direct";
      // CR-5 outbound identity: element code Q, rank = display order. The
      // analytics runtime keys decoration off these attributes at click time.
      start.dataset.analyticsEvent = "affiliate_click";
      start.dataset.providerSlug = record.program_id;
      start.dataset.merchant = record.display_name;
      if (!record.network) throw new Error(`quiz_affiliate_network_missing:${record.program_id}`);
      start.dataset.network = record.network;
      start.dataset.subidCodec = record.subid_codec;
      start.dataset.elementCode = "Q";
      start.dataset.rankPosition = String(index + 1);
      start.dataset.pageType = "quiz-results";
      start.dataset.pageSlug = pageSlug;
      start.dataset.linkPosition = "quiz-result";
      start.dataset.sub1 = `${index + 1}Q`;
      start.dataset.sub2 = pageSlug;
      actions.append(start);
    }
    card.append(actions);
    return card;
  }

  function exploreUrl(state, drug) {
    const query = new URLSearchParams({ state, drug, form: "COMPOUNDED", sort: "cheapest" });
    const dose = selectedDoseFor(drug);
    if (dose && /^\d/.test(dose)) query.set("dose", dose);
    return `/providers/?${query.toString()}`;
  }

  function saveCompletedPreferences() {
    // A result ID can reveal the answered comparison; it is not a safe cache.
    clearSavedQuiz();
  }

  /* Design pass 2026-08-27 (Phase-2 selections #1 + #8).
     #1 skeleton-while-computing: the real cards are appended first, then the
     grid holds a short .is-computing beat where card content is invisible and
     the card faces shimmer while three terse status beats run (55-quiz.css) —
     the skeleton IS the loaded content's
     box, so the swap cannot shift layout. shadcn Skeleton pattern (MIT).
     #8 results entrance (built in-house): staggered card rise via the
     .is-entering keyframes in 55-quiz.css. Both play only for pointer sessions
     without reduced motion; keyboard-initiated finishes and reduced motion get
     the final state instantly (Kowalski filters B4 / reduced-motion contract). */
  const computeStatus = document.createElement("p");
  computeStatus.className = "qz-compute-status";
  computeStatus.hidden = true;
  computeStatus.setAttribute("role", "status");
  computeStatus.setAttribute("aria-live", "polite");
  resultCards.before(computeStatus);
  let computeTimers = [];
  function settleResults() {
    computeTimers.forEach((timer) => clearTimeout(timer));
    computeTimers = [];
    resultCards.classList.remove("is-computing");
    resultCards.removeAttribute("aria-busy");
    computeStatus.hidden = true;
  }
  function choreographResults() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const keyboard = document.documentElement.dataset.inputModality === "keyboard";
    resultCards.classList.remove("is-entering");
    if (reduce || keyboard) { settleResults(); return; }
    [...resultCards.querySelectorAll(".qz-card")].forEach((card, index) => {
      card.style.setProperty("--qz-enter-index", String(index));
    });
    resultCards.classList.add("is-computing");
    resultCards.setAttribute("aria-busy", "true");
    computeStatus.hidden = false;
    computeStatus.textContent = "Comparing providers…";
    computeTimers.push(setTimeout(() => { computeStatus.textContent = "Checking your answers…"; }, 450));
    computeTimers.push(setTimeout(() => { computeStatus.textContent = "Finding your best match…"; }, 900));
    computeTimers.push(setTimeout(() => {
      settleResults();
      resultCards.classList.add("is-entering");
      /* deterministic disarm: last card lands at 120ms stagger + 500ms rise,
         badge at 780ms, earned chip at 1040ms — the class drops after the
         whole cascade so a later re-render starts clean. */
      setTimeout(() => resultCards.classList.remove("is-entering"), 1150);
    }, 1350));
  }

  function renderResults(drug, { restored = false } = {}) {
    const key = `${drug}|${answers.state}|${goal()}`;
    const ids = data.result_sets[key] || [];
    settleResults();
    resultCards.classList.remove("is-entering");
    resultCards.replaceChildren();
    resultSummary.textContent = `${labelOf(flow.jurisdictions, answers.state)} · ${drug === "SEMAGLUTIDE" ? "Compounded semaglutide" : "Compounded tirzepatide"} · ${ids.length} governed record${ids.length === 1 ? "" : "s"}`;
    for (const [index, id] of ids.entries()) {
      const record = data.candidate_records[id];
      if (record) resultCards.append(buildCard(record, index, drug));
    }
    const matchInput = document.querySelector('[data-capture-placement="quiz-results"] [name="match_program_ids"]');
    if (matchInput) matchInput.value = ids.slice(0, 3).join(",");
    saveCompletedPreferences(ids);
    saveProgress({ completed: true, resultDrug: drug });
    progress.setAttribute("aria-valuenow", "8");
    progressBar.style.transform = "scaleX(1)";
    progressText.textContent = "Results · Step 8 of 8";
    if (!restored) {
      quizEvent("quiz_complete", { result_count: ids.length });
      quizEvent("results_view", { result_count: ids.length });
    }
    /* Earned badge: lowest ongoing price among the records SHOWN — a relative,
       data-derived claim about this shortlist only, never an invented rating. */
    const priced = ids
      .map((id) => ({ id, amount: data.candidate_records[id]?.pricing?.[drug]?.amount }))
      .filter((entry) => Number.isFinite(entry.amount));
    if (priced.length > 1) {
      const cheapest = priced.reduce((low, entry) => (entry.amount < low.amount ? entry : low));
      const status = resultCards.querySelector(`.qz-card[data-program="${cheapest.id}"] .qz-card-status`);
      if (status) appendText(status, "span", "qz-chip-earned", "Lowest price shown");
    }
    const shown = resultCards.querySelectorAll(".qz-card").length;
    resultEmpty.hidden = shown > 0;
    resultCards.hidden = shown === 0;
    if (shown > 0) choreographResults();
    explore.href = exploreUrl(answers.state, drug);
    form.hidden = true;
    results.hidden = false;
    document.body.classList.remove("qz-active");
    results.classList.add("is-new");
    results.addEventListener("animationend", () => results.classList.remove("is-new"), { once: true });
    results.querySelector("h2")?.focus({ preventScroll: true });
    results.scrollIntoView?.({ block: "start" });
  }

  async function captureNewsletter() {
    const statuses = [...root.querySelectorAll("[data-newsletter-status],[data-result-newsletter-status]")];
    const setStatus = (message) => statuses.forEach((status) => { status.textContent = message; });
    // The paid seam is comparison-only, even if state is populated outside UI.
    if (paid) {
      setStatus("");
      return;
    }
    const email = String(answers.email || "").trim();
    if (!email) {
      setStatus("");
      return;
    }
    setStatus("Saving your Clinic Scout subscription…");
    try {
      const response = await fetch(flow.contact.newsletter_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email,
          first_name: String(answers.first_name || "").trim(),
          email_consent: true,
          company: "",
          consent_version: flow.contact.newsletter_consent_version,
          consent_source: flow.contact.newsletter_consent_source,
          source_surface: "quiz-provider-fit",
          provider_context: {
            state: answers.state,
            medication_intents: [...answers.intents],
          },
        }),
      });
      if (!response.ok) throw new Error("newsletter_capture_failed");
      setStatus("Your Clinic Scout subscription was saved.");
      return "saved";
    } catch {
      setStatus("Your matches are ready, but the subscription could not be saved. Please try again from the site newsletter form.");
      return "failed";
    }
  }

  async function finish() {
    const error = valid(6);
    if (error) {
      showError(error, root.querySelector('[data-quiz-input="email"]'));
      return;
    }
    const outcome = resolveOutcome();
    const subscription = captureNewsletter();
    if (outcome.kind === "brand") {
      await subscription;
      saveProgress();
      const query = new URLSearchParams({
        state: answers.state,
        drug: outcome.intent,
        form: outcome.intent === "WEGOVY_PILL" ? "COMPOUNDED" : "BRAND_NAME",
        sort: "cheapest",
      });
      location.assign(`${outcome.route}?${query.toString()}`);
      return;
    }
    const selectedGoal = goal();
    const ids = data.result_sets[`${outcome.drug}|${answers.state}|${selectedGoal}`] || [];
    saveCompletedPreferences(ids);
    saveProgress({ completed: true, resultDrug: outcome.drug });
    quizEvent("quiz_complete", { result_count: ids.length });
    const query = new URLSearchParams({
      state: answers.state,
      drug: outcome.drug,
      form: "COMPOUNDED",
      goal: selectedGoal,
      source: "survey",
    });
    const dose = selectedDoseFor(outcome.drug);
    if (dose) query.set("dose", dose);
    const newsletterStatus = await subscription;
    try {
      // One-use UI feedback only; no email, name, state or treatment is stored.
      sessionStorage.removeItem("gcs.quiz.newsletter-status.v1");
      if (["saved", "failed"].includes(newsletterStatus)) {
        sessionStorage.setItem("gcs.quiz.newsletter-status.v1", JSON.stringify({
          status: newsletterStatus,
          saved_at: Date.now(),
        }));
      }
    } catch { /* Storage denial must not prevent the first-party results hand-off. */ }
    location.assign(`/matches/customized/?${query.toString()}`);
  }

  root.querySelector("#begin-quiz")?.addEventListener("click", () => show(0));
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-multi],[data-single],[data-toggle]")) markQuizStart();
    const multi = event.target.closest("[data-multi]");
    if (multi) {
      if (multi.dataset.multi === "intents") toggleIntent(multi.dataset.value);
      else toggleMultiple(multi.dataset.multi, multi.dataset.value);
      clearError();
      armNext();
      saveProgress();
      return;
    }
    const single = event.target.closest("[data-single]");
    if (single) {
      const key = single.dataset.single;
      answers[key] = single.dataset.value;
      syncPressed(key);
      clearError();
      if (key === "current_use") {
        if (answers.current_use === "yes") {
          answers.reasons = [];
          answers.reason_other = "";
          syncPressed("reasons");
          show(3);
        } else {
          answers.current_drug = "";
          answers.current_dose = "";
          answers.monthly_cost = "";
          const monthlyCost = root.querySelector('[data-quiz-input="monthly_cost"]');
          if (monthlyCost) monthlyCost.value = "";
          setDoseOptions();
          show(1);
        }
      } else if (key === "situation") {
        show(4);
      }
      return;
    }
    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      answers[toggle.dataset.toggle] = !answers[toggle.dataset.toggle];
      toggle.setAttribute("aria-pressed", String(answers[toggle.dataset.toggle]));
      armNext();
      saveProgress();
      return;
    }
    if (event.target.closest("[data-quiz-next]")) { next(); return; }
    if (event.target.closest("[data-quiz-back]")) { back(); return; }
    if (event.target.closest("[data-quiz-finish]")) { finish(); return; }
    if (event.target.closest("[data-quiz-restart]")) {
      try {
        localStorage.removeItem(progressKey);
        localStorage.removeItem(preferencesKey);
      } catch {
        // Storage can be unavailable in hardened/private contexts. Reload still resets memory state.
      }
      location.reload();
      return;
    }
    if (event.target.closest("[data-edit-answers]")) {
      results.hidden = true;
      form.hidden = false;
      document.body.classList.add("qz-active");
      show(0);
    }
  });

  root.querySelectorAll("[data-quiz-select]").forEach((select) => {
    select.addEventListener("change", () => {
      select.removeAttribute("aria-invalid");
      answers[select.dataset.quizSelect] = select.value;
      if (select.dataset.quizSelect === "current_drug") setDoseOptions();
      clearError();
      armNext();
      saveProgress();
    });
  });
  root.querySelectorAll("[data-quiz-input]").forEach((input) => {
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      answers[input.dataset.quizInput] = input.value;
      clearError();
      armNext();
      saveProgress();
    });
  });

  root.querySelector("[data-reason-other]").hidden = true;
  setDoseOptions();
  /* Focus mode (their pattern): while the quiz is active, chrome below the
     stage steps back. JS-gated only — no-JS readers keep the full page. */
  document.body.classList.add("qz-active");
  const restoredPosition = hydrateProgress();
  explore.classList.add("cta", "primary", "qz-explore");
  if (restoredResultDrug) renderResults(restoredResultDrug, { restored: true });
  else show(restoredPosition, { focus: false, animate: false });
  };

  const inline = document.querySelector("#phase4-quiz-data");
  if (inline) { boot(inline); return; }

  let deferred = [];
  try { deferred = JSON.parse(root?.dataset.quizFragments || "[]"); } catch { deferred = []; }
  if (!root || !Array.isArray(deferred) || deferred.length !== 4) return;
  let loading = null;
  const load = () => {
    if (loading) return loading;
    loading = (async () => {
      const ids = ["phase4-quiz-data", "candidate-data", "quiz-ranking", "pass2-quiz-data"];
      const expected = ids.map((id) => `/lp/quiz/data/${id}/`);
      if (deferred.some((path, index) => path !== expected[index])) throw new Error("quiz_fragment_route");
      const declaration = root.dataset.quizFragments;
      const hashDeclaration = root.dataset.quizFragmentHashes;
      const hashes = JSON.parse(hashDeclaration || "null");
      if (!hashes || Object.keys(hashes).length !== ids.length || ids.some((id) => !/^[a-f0-9]{64}$/.test(hashes[id] || ""))) throw new Error("quiz_fragment_hash_manifest");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const parser = new DOMParser();
        const islands = await Promise.all(expected.map(async (path, index) => {
          const response = await fetch(path, { credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
          if (!response.ok) throw new Error(`quiz_fragment_${response.status}`);
          const text = await response.text();
          const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
          const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
          if (digest !== hashes[ids[index]]) throw new Error("quiz_fragment_generation_mismatch");
          const parsed = parser.parseFromString(text, "text/html");
          const scripts = parsed.querySelectorAll("script");
          const island = scripts[0];
          if (scripts.length !== 1 || island.type !== "application/json" || island.id !== ids[index] || island.hasAttribute("src")) throw new Error("quiz_fragment_shape");
          const data = JSON.parse(island.textContent);
          if (index === 1 ? !Array.isArray(data) : !data || typeof data !== "object" || Array.isArray(data)) throw new Error("quiz_fragment_data_shape");
          if (index === 0) {
            const flowArrays = ["current_drugs", "features", "intent_options", "jurisdictions", "no_use_reasons", "situations"];
            if (!data.flow || !data.flow.contact || flowArrays.some((key) => !Array.isArray(data.flow[key]))) throw new Error("quiz_fragment_flow_shape");
          }
          const node = document.createElement("script");
          node.type = "application/json";
          node.id = island.id;
          node.textContent = island.textContent;
          return node;
        }));
        if (!root.isConnected || document.querySelector("[data-phase4-quiz]") !== root || root.dataset.quizFragments !== declaration || root.dataset.quizFragmentHashes !== hashDeclaration) throw new Error("quiz_fragment_stale_root");
        if (ids.some((id) => document.getElementById(id))) throw new Error("quiz_fragment_id_collision");
        document.body.append(...islands);
        boot(islands[0]);
        return true;
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    })().catch((error) => { loading = null; throw error; });
    return loading;
  };
  window.CSQuizDeferred = Object.freeze({ load });
})();
