(() => {
  const root = document.querySelector("[data-compact-matcher]");
  const payloadNode = document.querySelector("#phase4-matches-data");
  if (!root || !payloadNode) return;

  let data;
  try { data = JSON.parse(payloadNode.textContent); } catch { return; }

  const flow = data.flow;
  const compact = flow.compact_matcher;
  const form = root.querySelector("[data-matches-form]");
  const medication = root.querySelector("[data-matches-medication]");
  const state = root.querySelector("[data-matches-state]");
  const dose = root.querySelector("[data-matches-dose]");
  const email = root.querySelector("[data-matches-email]");
  const error = root.querySelector("[data-matches-error]");
  const submit = root.querySelector("[data-search-providers]");
  const results = root.querySelector("[data-matches-results]");
  const cards = results.querySelector("[data-result-cards]");
  const empty = results.querySelector("[data-result-empty]");
  const summary = results.querySelector("[data-result-summary]");
  const explore = results.querySelector("[data-explore-providers]");
  const fullQuiz = root.querySelector("[data-full-quiz-link]");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  root.classList.add("qm-enhanced");
  results.hidden = true;

  const optionFor = () => compact.medication_options.find((option) => option.value === medication.value);
  const stateLabel = () => flow.jurisdictions.find((item) => item.code === state.value)?.name || state.value;

  function setError(message, control = null) {
    error.textContent = message;
    if (control) {
      control.setAttribute("aria-invalid", "true");
      control.focus({ preventScroll: true });
    }
  }

  function clearError() {
    error.textContent = "";
    medication.removeAttribute("aria-invalid");
    state.removeAttribute("aria-invalid");
    email.removeAttribute("aria-invalid");
  }

  function setDoseOptions() {
    const option = optionFor();
    const values = option ? compact.dose_options[option.family] || [] : [];
    dose.replaceChildren(new Option(option ? "Dose not selected" : "Choose a medication first", ""));
    for (const value of values) dose.add(new Option(`${value}${/^\d/.test(value) ? " mg/week" : ""}`, value));
    dose.value = "";
    dose.disabled = !option;
  }

  function updateFullQuizLink() {
    // Keep quiz answers out of the URL so consent-gated page analytics cannot
    // receive treatment or state through page_location.
    fullQuiz.href = "/quiz/provider-fit/";
  }

  function appendText(parent, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    parent.append(node);
    return node;
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
    if (record.claim_qualification) appendText(card, "p", "qz-card-qualification", record.claim_qualification);

    appendText(card, "p", "qz-card-context", dose.value ? `Selected dose context: ${dose.value}${/^\d/.test(dose.value) ? " mg/week" : ""}.` : "Dose context was not provided for this comparison.");
    const price = record.pricing?.[drug];
    if (price) {
      appendText(card, "p", "qz-card-plan", price.label ? `Published plan context: ${price.label}.` : "Published plan name was not bound to this price row.");
      const figure = appendText(card, "p", "qz-card-price", `$${Number(price.amount).toLocaleString("en-US")}/${price.cadence}`);
      const term = price.month_1_usd !== null && price.month_1_usd !== price.amount
        ? `Published first-month figure: $${Number(price.month_1_usd).toLocaleString("en-US")}; ongoing figure shown above.`
        : "Published ongoing figure; no longer-term commitment is inferred.";
      appendText(card, "p", "qz-card-term", `${term}${price.captured_on ? ` Checked ${price.captured_on}.` : ""}`);
      if (price.source_url) {
        const source = document.createElement("a");
        source.href = price.source_url;
        source.rel = "noopener noreferrer";
        source.textContent = "Open the price source";
        figure.after(source);
      }
    } else {
      appendText(card, "p", "qz-card-price qz-card-price--unknown", "Comparable price not published in the governed matrix.");
    }

    appendText(card, "p", "qz-card-why", record.why_match);
    appendText(card, "p", "qz-card-match", `${record.verified_features?.length || 0} provider-feature claims are explicitly bound to this result record.`);
    const featureList = document.createElement("ul");
    featureList.className = "qz-card-features";
    if (record.verified_features?.length) {
      for (const feature of record.verified_features) {
        const label = flow.features.find((item) => item.value === feature)?.label || feature;
        appendText(featureList, "li", "", label);
      }
    } else {
      appendText(featureList, "li", "", "The compact matcher did not ask for feature preferences; no feature match is inferred.");
    }
    card.append(featureList);
    appendText(card, "p", "qz-card-review", record.review_state);

    const actions = document.createElement("div");
    actions.className = "qz-card-actions";
    const learn = document.createElement("a");
    learn.href = record.review_path;
    learn.textContent = "Learn more";
    actions.append(learn);
    if (record.has_live_link && record.affiliate_href) {
      const start = document.createElement("a");
      start.href = record.affiliate_href;
      start.rel = "sponsored nofollow noopener";
      start.textContent = "Get Started";
      start.dataset.program = record.program_id;
      start.dataset.linkMode = "transparent-direct";
      // Preserve the survey's frozen DOM identity without rewriting its URL.
      if (new URLSearchParams(location.search).get("source") === "survey") {
        start.dataset.analyticsEvent = "affiliate_click";
        start.dataset.subid = `quiz-provider-fit.results.a.${record.program_id}`;
      }
      actions.append(start);
    }
    card.append(actions);
    return card;
  }

  function exploreUrl(drug) {
    const query = new URLSearchParams({ state: state.value, drug, form: "COMPOUNDED", sort: "cheapest" });
    if (dose.value && !["New Patient", "Not Sure"].includes(dose.value)) query.set("dose", dose.value);
    return `/providers/?${query.toString()}`;
  }

  function renderResults(drug, goal = "medication-form") {
    const ids = data.result_sets[`${drug}|${state.value}|${goal}`] || [];
    cards.replaceChildren();
    for (const [index, id] of ids.entries()) {
      const record = data.candidate_records[id];
      if (record) cards.append(buildCard(record, index, drug));
    }
    const shown = cards.querySelectorAll(".qz-card").length;
    results.querySelector("h2").textContent = `${shown} provider record${shown === 1 ? "" : "s"} to compare`;
    const matchInput = results.querySelector('[data-capture-placement="quiz-results"] [name="match_program_ids"]');
    if (matchInput) matchInput.value = ids.slice(0, 3).join(",");
    summary.textContent = `${stateLabel()} · ${drug === "SEMAGLUTIDE" ? "Compounded semaglutide" : "Compounded tirzepatide"} · ${shown} governed record${shown === 1 ? "" : "s"}`;
    empty.hidden = shown > 0;
    cards.hidden = shown === 0;
    explore.href = exploreUrl(drug);
    form.hidden = true;
    results.hidden = false;
    results.append(fullQuiz);
    results.classList.add("is-new");
    results.addEventListener("animationend", () => results.classList.remove("is-new"), { once: true });
    results.querySelector("h2")?.focus({ preventScroll: true });
    results.scrollIntoView?.({ block: "start" });
  }

  async function captureNewsletter() {
    const statuses = [...root.querySelectorAll("[data-newsletter-status],[data-result-newsletter-status]")];
    const setStatus = (message) => statuses.forEach((node) => { node.textContent = message; });
    const value = email.value.trim();
    if (!value) {
      setStatus("No email was submitted.");
      return;
    }
    setStatus("Saving your Clinic Scout subscription…");
    try {
      const response = await fetch(flow.contact.newsletter_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email: value,
          email_consent: true,
          company: "",
          consent_version: flow.contact.newsletter_consent_version,
          consent_source: flow.contact.newsletter_consent_source,
          source_surface: "matches-customized",
          provider_context: {
            state: state.value,
            medication_family: optionFor()?.family || medication.value,
          },
        }),
      });
      if (!response.ok) throw new Error("newsletter_capture_failed");
      setStatus("Your Clinic Scout subscription was saved.");
    } catch {
      setStatus("Your matches are ready, but the subscription could not be saved. Please try again from the site newsletter form.");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    const option = optionFor();
    if (!option) { setError("Choose a medication to compare.", medication); return; }
    if (!state.value) { setError("Choose a state or jurisdiction.", state); return; }
    if (email.value && !emailPattern.test(email.value)) { setError("Enter a valid email address or leave it blank.", email); return; }

    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    const subscription = captureNewsletter();
    if (option.route) {
      await subscription;
      const query = new URLSearchParams({
        state: state.value,
        drug: option.drug,
        form: option.form,
        sort: "cheapest",
      });
      location.assign(`${option.route}?${query.toString()}`);
      return;
    }
    renderResults(option.family);
    await subscription;
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
  });

  medication.addEventListener("change", () => {
    clearError();
    setDoseOptions();
    updateFullQuizLink();
  });
  state.addEventListener("change", () => { clearError(); updateFullQuizLink(); });
  email.addEventListener("input", clearError);
  setDoseOptions();
  updateFullQuizLink();

  // A shared results URL uses the quiz's computed goal, never a new ranking.
  // Hydration renders directly: it must not submit the optional newsletter form.
  const query = new URLSearchParams(location.search);
  const selectedGoal = query.get("goal") || "medication-form";
  const option = compact.medication_options.find((item) => !item.route && item.family === query.get("drug"));
  const jurisdiction = flow.jurisdictions.find((item) => item.code === query.get("state"));
  if (query.get("form") === "COMPOUNDED" && option && jurisdiction
      && ["medication-form", "coaching", "price"].includes(selectedGoal)) {
    medication.value = option.value;
    state.value = jurisdiction.code;
    setDoseOptions();
    if ([...dose.options].some((item) => item.value === query.get("dose"))) dose.value = query.get("dose");
    renderResults(option.family, selectedGoal);
    if (query.get("source") === "survey") {
      let acknowledgement = null;
      try {
        const raw = sessionStorage.getItem("gcs.quiz.newsletter-status.v1");
        sessionStorage.removeItem("gcs.quiz.newsletter-status.v1");
        acknowledgement = JSON.parse(raw || "null");
      } catch { /* Missing, malformed or blocked storage is not a successful subscription. */ }
      const age = Date.now() - acknowledgement?.saved_at;
      if (Number.isFinite(acknowledgement?.saved_at) && age >= 0 && age <= 60_000) {
        const message = acknowledgement.status === "saved" ? "Your Clinic Scout subscription was saved."
          : acknowledgement.status === "failed" ? "Your matches are ready, but the subscription could not be saved. Please try again from the site newsletter form." : "";
        root.querySelectorAll("[data-result-newsletter-status]").forEach((status) => { status.textContent = message; });
      }
    }
  }
})();
