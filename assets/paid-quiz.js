(() => {
  const cta = document.querySelector("[data-lp-quiz-start]");
  const root = document.querySelector("[data-phase4-quiz]");
  const intro = document.querySelector("[data-paid-intro]");
  const status = document.querySelector("[data-paid-status]");
  if (!cta || !root || !intro || !status) return;
  let pending = false;
  cta.addEventListener("click", async (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!window.CSQuizDeferred?.load) return; // Native organic fallback if scripts fail.
    event.preventDefault();
    if (pending) return;
    pending = true;
    cta.setAttribute("aria-busy", "true");
    status.textContent = "Loading the comparison data…";
    try {
      await window.CSQuizDeferred.load();
      root.hidden = false;
      intro.hidden = true;
      root.focus({ preventScroll: true });
      root.scrollIntoView({ block: "start", behavior: "instant" });
      status.textContent = "";
    } catch {
      status.textContent = "The comparison data could not load. Try again, or compare providers using the link below. No answers were sent.";
      cta.focus({ preventScroll: true });
    } finally {
      pending = false;
      cta.removeAttribute("aria-busy");
    }
  });
})();
