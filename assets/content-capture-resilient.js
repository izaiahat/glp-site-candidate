(() => {
  "use strict";

  const RETRIABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 3;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setCalculatorFields(form) {
    if (form.closest("[data-capture-placement]")?.dataset.capturePlacement !== "calculator-result") return;
    const selected = document.querySelector("#provider option:checked");
    const displayedMoney = (selector) => (document.querySelector(selector)?.textContent || "").replace(/[$,]/g, "").trim();
    const fields = {
      cost_provider_id: selected?.value || "",
      cost_provider_name: selected?.textContent?.trim() || "",
      cost_first_month_usd: displayedMoney("#result-first"),
      cost_recurring_month_usd: displayedMoney("#result-recurring"),
      cost_months: document.querySelector("#months")?.value || "",
      cost_total_usd: displayedMoney("#result-period"),
      cost_price_context: document.querySelector("#cost-context")?.textContent?.trim() || "",
      cost_checked_as_of: document.querySelector("#cost-checked")?.textContent?.trim() || "",
    };
    for (const [name, value] of Object.entries(fields)) {
      const input = form.elements.namedItem(name);
      if (input) input.value = value;
    }
  }

  async function postCapture(form, payload, statusNode) {
    let lastFailure = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(form.action, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
          credentials: "same-origin",
          referrerPolicy: payload.guide_path ? 'no-referrer' : 'same-origin',
          keepalive: true,
        });
        const result = await response.json().catch(() => ({ status: "RESPONSE_INVALID" }));
        if (response.ok || result.status === "CAPTURED_PROVIDER_FAILED") return { response, result };
        lastFailure = new Error(result.status || `HTTP_${response.status}`);
        lastFailure.httpStatus = response.status;
        if (!RETRIABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) throw lastFailure;
        statusNode.textContent = `The save hit a temporary issue. Retrying (${attempt + 1}/${MAX_ATTEMPTS})…`;
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        await sleep(Math.min(2000, Math.max(300 * attempt, retryAfter * 1000)));
      } catch (error) {
        lastFailure = error;
        const retriable = !Number.isInteger(error?.httpStatus) || RETRIABLE_STATUS.has(error.httpStatus);
        if (!retriable || attempt === MAX_ATTEMPTS) throw error;
        statusNode.textContent = `The connection dropped. Retrying (${attempt + 1}/${MAX_ATTEMPTS})…`;
        await sleep(300 * attempt);
      }
    }
    throw lastFailure || new Error("CAPTURE_FAILED");
  }

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest?.("[data-p1-capture-surface] form[action='/api/content-upgrade']");
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.dataset.captureBusy === "true") return;

    const surface = form.closest("[data-p1-capture-surface]");
    const placement = surface?.dataset.capturePlacement || "inline";
    const statusNode = form.querySelector(".capture-status");
    const submit = form.querySelector("[type='submit']");
    if (!statusNode) return;

    setCalculatorFields(form);
    const requestId = form.elements.namedItem('request_id');
    if (requestId && !requestId.value) requestId.value = crypto.randomUUID();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.email_consent = "true";
    form.dataset.captureBusy = "true";
    if (submit) submit.disabled = true;
    statusNode.textContent = "Saving your request…";
    window.GCSAnalytics?.event("content_upgrade_submit", { page_slug: payload.source_page, surface: placement });

    try {
      const { result } = await postCapture(form, payload, statusNode);
      if (result.status === "CAPTURED_PROVIDER_FAILED") {
        statusNode.textContent = "Saved. Email delivery hit a temporary issue; submit again to retry the email.";
        window.GCSAnalytics?.event("content_upgrade_success", { page_slug: payload.source_page, surface: placement });
        return;
      }
      const delivered = result.status === "CAPTURED" && result.send === "sent";
      const held = result.status === "CAPTURED_SENDS_HELD";
      if (!delivered && !held) throw new Error(result.status || "UNEXPECTED_CAPTURE_STATUS");
      statusNode.textContent = delivered
        ? (placement === "guide-resource" ? "Done — your guide link was emailed." : placement === "calculator-result" ? "Done — your cost breakdown was emailed." : "Done — your checklist was emailed.")
        : "Saved — email delivery is not active yet.";
      form.reset();
      window.GCSAnalytics?.event("content_upgrade_success", { page_slug: payload.source_page, surface: placement });
      window.GCSAnalytics?.event("content_upgrade_complete", { page_slug: payload.source_page });
    } catch (error) {
      statusNode.textContent = error?.message === "CONTENT_UPGRADE_CAPTURE_HELD"
        ? "This request is temporarily unavailable. Your email is still here; try again later."
        : "We could not confirm the save. Your email is still here; try again.";
      window.GCSAnalytics?.event("content_upgrade_failure", { page_slug: payload.source_page, surface: placement });
    } finally {
      delete form.dataset.captureBusy;
      if (submit) submit.disabled = false;
    }
  }, true);
})();
