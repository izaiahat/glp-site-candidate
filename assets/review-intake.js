export const REVIEW_CAPTURE_ENDPOINT = "/api/review-capture";
export const REVIEW_EVIDENCE_LIMIT_BYTES = 2 * 1024 * 1024;

const ALLOWED_EVIDENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const COUNTERPART_FIELDS = [
  "counterpart_entity_name",
  "counterpart_product",
  "counterpart_rating",
  "counterpart_review_type",
  "counterpart_headline",
  "counterpart_review_body",
  "counterpart_experience_date",
];

// Keep the established primary field names in source HTML for no-JS and
// pre-existing test compatibility while the runtime emits the v2 structure.
const FIELD_ALIASES = Object.freeze({
  primary_entity_name: "subject_name",
  primary_entity_type: "experience_type",
  primary_rating: "rating",
  primary_evidence: "evidence",
  primary_entity_registration: "entity_registration",
});

export function oppositeEntityType(type) {
  if (type === "provider") return "pharmacy";
  if (type === "pharmacy") return "provider";
  return null;
}

export function isLocalReviewEndpoint(value, origin = globalThis.location?.origin) {
  if (!origin) return value === REVIEW_CAPTURE_ENDPOINT;
  const resolved = new URL(value, origin);
  return resolved.origin === origin && resolved.pathname === REVIEW_CAPTURE_ENDPOINT;
}

function fieldControl(form, name) {
  return form.elements.namedItem(FIELD_ALIASES[name] || name);
}

function fieldValue(form, name) {
  const field = fieldControl(form, name);
  if (!field) return "";
  return String(field.value || "").trim();
}

function fieldChecked(form, name) {
  const field = fieldControl(form, name);
  return Boolean(field?.checked);
}

function bytesToBase64(bytes) {
  let binary = "";
  const windowSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += windowSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + windowSize, bytes.length)));
  }
  return btoa(binary);
}

function digestHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function evidencePayload(input) {
  const file = input?.files?.[0];
  if (!file) return undefined;
  if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) throw new Error("Choose a JPEG, PNG, WebP, or PDF file.");
  if (!file.size || file.size > REVIEW_EVIDENCE_LIMIT_BYTES) throw new Error("Each evidence file must be between 1 byte and 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    sha256: digestHex(await crypto.subtle.digest("SHA-256", bytes)),
    base64: bytesToBase64(bytes),
  };
}

function reviewItem(form, prefix) {
  const item = {
    entity_name: fieldValue(form, `${prefix}_entity_name`),
    entity_type: fieldValue(form, `${prefix}_entity_type`),
    product: fieldValue(form, `${prefix}_product`),
    rating: Number(fieldValue(form, `${prefix}_rating`)),
    review_type: fieldValue(form, `${prefix}_review_type`),
    headline: fieldValue(form, `${prefix}_headline`),
    review_body: fieldValue(form, `${prefix}_review_body`),
    experience_date: fieldValue(form, `${prefix}_experience_date`),
  };
  // Explicit user affordance only: "Add as a new provider/pharmacy" marks the
  // entity as proposed so the server flags it for moderator verification.
  if (fieldValue(form, `${prefix}_entity_registration`) === "proposed") item.entity_registration = "proposed";
  return item;
}

function setStatus(status, message, state = "") {
  if (!status) return;
  status.textContent = message;
  if (state) status.dataset.state = state;
  else delete status.dataset.state;
}

function exactEntityMap(root) {
  return new Map(Array.from(root.querySelectorAll("#review-provider-options option:not(:disabled)"), (option) => [option.value, option.dataset.reviewEntityType]));
}

function validateExactEntity(form, entities, prefix) {
  const input = fieldControl(form, `${prefix}_entity_name`);
  const name = fieldValue(form, `${prefix}_entity_name`);
  const expectedType = fieldValue(form, `${prefix}_entity_type`);
  const registration = fieldValue(form, `${prefix}_entity_registration`);
  const actualType = entities.get(name);
  let message = "";
  if (actualType) {
    if (actualType !== expectedType) message = `That entity is listed as a ${actualType}, not a ${expectedType || "selected type"}.`;
  } else if (registration === "proposed") {
    if (!expectedType) message = "Choose whether the new entity is a provider or a pharmacy.";
  } else {
    message = "Pick a listed entity, or choose “Add as new” to propose one.";
  }
  input?.setCustomValidity(message);
  return !message;
}

function counterpartAttempted(form) {
  return COUNTERPART_FIELDS.some((name) => fieldValue(form, name))
    || Boolean(form.elements.namedItem("counterpart_evidence")?.files?.length);
}

function counterpartComplete(form, entities) {
  if (!COUNTERPART_FIELDS.every((name) => fieldValue(form, name))) return false;
  const primaryType = fieldValue(form, "primary_entity_type");
  const counterpartType = fieldValue(form, "counterpart_entity_type");
  return counterpartType === oppositeEntityType(primaryType) && validateExactEntity(form, entities, "counterpart");
}

function clearCounterpart(form) {
  for (const name of COUNTERPART_FIELDS) {
    const field = fieldControl(form, name);
    if (!field) continue;
    if (typeof field.length === "number" && !field.tagName) {
      Array.from(field).forEach((item) => { item.checked = false; });
    } else {
      field.value = "";
      field.setCustomValidity?.("");
    }
  }
  const registration = form.elements.namedItem("counterpart_entity_registration");
  if (registration) registration.value = "";
  const evidence = form.elements.namedItem("counterpart_evidence");
  if (evidence) evidence.value = "";
}

/* ---- styled inline validation (replaces the native browser bubble) -------- */

function errorScope(field) {
  return field.closest?.(".p5-field, .cs-combobox, .cs-dropzone, .p5-check, fieldset") || field;
}

function setFieldError(field, message) {
  const scope = errorScope(field);
  if (!scope || !scope.querySelector) return;
  let note = scope.querySelector(":scope > .cs-field-error");
  if (!message) {
    scope.removeAttribute("data-field-invalid");
    note?.remove();
    return;
  }
  scope.setAttribute("data-field-invalid", "true");
  if (!note) {
    note = document.createElement("small");
    note.className = "cs-field-error";
    scope.append(note);
  }
  note.textContent = message;
}

function openAncestorDetails(field) {
  for (let node = field.closest?.("details"); node; node = node.parentElement?.closest("details")) node.open = true;
}

function invalidMessage(field) {
  const validity = field.validity;
  if (validity?.valueMissing) {
    if (field.type === "radio") return "Choose one option.";
    if (field.type === "checkbox") return "Confirm this to continue.";
    if (field.tagName === "SELECT") return "Choose one option.";
    return "This field is required.";
  }
  if (validity?.typeMismatch && field.type === "email") return "Enter a valid email address.";
  if (validity?.tooShort) return `Add at least ${field.minLength} characters (${String(field.value || "").length} so far).`;
  return field.validationMessage || "Check this field.";
}

function collectStepProblems(step) {
  const problems = [];
  const seenRadioGroups = new Set();
  for (const field of step.querySelectorAll("[required]")) {
    if (field.type === "radio") {
      if (seenRadioGroups.has(field.name)) continue;
      seenRadioGroups.add(field.name);
    }
    if (field.checkValidity()) {
      setFieldError(field, "");
      continue;
    }
    problems.push({ field, message: invalidMessage(field) });
  }
  return problems;
}

function renderSummary(form, problems) {
  const box = form.querySelector("[data-review-summary]");
  const list = form.querySelector("[data-review-summary-list]");
  if (!box || !list) return;
  list.textContent = "";
  for (const problem of problems) {
    const item = document.createElement("li");
    const scope = errorScope(problem.field);
    const label = scope?.querySelector?.("span, legend, label");
    let name = (label?.childNodes?.[0]?.textContent || label?.textContent || problem.field.name || "Field").trim();
    if (problem.field.type === "checkbox") name = "Confirmation";
    item.textContent = `${name} — ${problem.message}`;
    list.append(item);
  }
  box.hidden = problems.length === 0;
}

/* ---- accessible entity combobox ------------------------------------------- */

function initializeCombobox(form, entities, prefix, hooks = {}) {
  const wrap = form.querySelector(`[data-review-combobox="${prefix}"]`);
  const input = wrap?.querySelector("input[data-review-entity]");
  const list = wrap?.querySelector("[data-review-combobox-list]");
  const registration = wrap?.querySelector("[data-review-entity-registration]");
  if (!wrap || !input || !list || !registration) return null;
  input.removeAttribute("list");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  list.id = list.id || `${prefix}-entity-listbox`;
  list.setAttribute("role", "listbox");
  input.setAttribute("aria-controls", list.id);
  let activeIndex = -1;

  const allowedTypes = () => {
    if (prefix !== "counterpart") return ["provider", "pharmacy"];
    const opposite = oppositeEntityType(fieldValue(form, "primary_entity_type"));
    return opposite ? [opposite] : ["provider", "pharmacy"];
  };

  const close = () => {
    list.hidden = true;
    list.textContent = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  };

  const resolve = (name, type, proposed) => {
    input.value = name;
    registration.value = proposed ? "proposed" : "registered";
    wrap.dataset.entityState = proposed ? "proposed" : "registered";
    input.setCustomValidity("");
    setFieldError(input, "");
    hooks.onResolve?.(prefix, type, proposed);
    close();
    input.focus();
  };

  const optionButton = ({ name, type, proposed }, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.id = `${list.id}-option-${index}`;
    button.setAttribute("role", "option");
    button.className = `cs-combobox__option${proposed ? " cs-combobox__option--new" : ""}`;
    const label = document.createElement("span");
    label.className = "cs-combobox__name";
    label.textContent = proposed ? `Add “${name}” as a new ${type}` : name;
    const tag = document.createElement("span");
    tag.className = "cs-combobox__tag";
    tag.textContent = proposed ? "new" : type;
    button.append(label, tag);
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => resolve(name, type, proposed));
    return button;
  };

  const render = () => {
    const query = String(input.value || "").trim();
    const lower = query.toLocaleLowerCase();
    const types = allowedTypes();
    const matches = [];
    for (const [name, type] of entities) {
      if (!types.includes(type)) continue;
      if (lower && !name.toLocaleLowerCase().includes(lower)) continue;
      matches.push({ name, type, proposed: false });
    }
    const exact = entities.get(query);
    const options = [...matches];
    if (query.length >= 2 && !exact) {
      for (const type of types) options.push({ name: query, type, proposed: true });
    }
    list.textContent = "";
    options.forEach((option, index) => list.append(optionButton(option, index)));
    list.hidden = options.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
  };

  const move = (delta) => {
    const options = Array.from(list.querySelectorAll("[role='option']"));
    if (!options.length) return;
    activeIndex = (activeIndex + delta + options.length) % options.length;
    options.forEach((option, index) => option.setAttribute("aria-selected", String(index === activeIndex)));
    input.setAttribute("aria-activedescendant", options[activeIndex].id);
    options[activeIndex].scrollIntoView({ block: "nearest" });
  };

  input.addEventListener("input", () => {
    const typedType = entities.get(String(input.value || "").trim());
    registration.value = typedType ? "registered" : "";
    wrap.dataset.entityState = typedType ? "registered" : "unresolved";
    if (typedType) hooks.onResolve?.(prefix, typedType, false);
    render();
  });
  input.addEventListener("focus", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); if (list.hidden) render(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); if (list.hidden) render(); move(-1); }
    else if (event.key === "Enter") {
      if (!list.hidden && activeIndex >= 0) {
        event.preventDefault();
        list.querySelectorAll("[role='option']")[activeIndex]?.click();
      } else if (!list.hidden) {
        event.preventDefault();
        close();
      }
    } else if (event.key === "Escape" && !list.hidden) { event.preventDefault(); close(); }
    else if (event.key === "Tab") close();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!wrap.contains(event.target)) close();
  });
  return { input, registration, close, resolve };
}

/* ---- photo / evidence dropzone (presentation only; the 2 MB + type +
       sha256 pipeline in evidencePayload is untouched) --------------------- */

function formatBytes(size) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function initializeDropzone(form, prefix) {
  const wrap = form.querySelector(`[data-review-dropzone="${prefix}"]`);
  const zone = wrap?.querySelector("[data-review-dropzone-zone]");
  const input = wrap?.querySelector("input[type='file']");
  const preview = wrap?.querySelector("[data-review-dropzone-preview]");
  if (!wrap || !zone || !input || !preview) return;
  let objectUrl = null;

  const clearPreview = () => {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    preview.textContent = "";
    preview.hidden = true;
    delete zone.dataset.hasFile;
  };

  const renderPreview = () => {
    clearPreview();
    const file = input.files?.[0];
    if (!file) return;
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      input.value = "";
      setFieldError(input, "Choose a JPEG, PNG, WebP, or PDF file.");
      return;
    }
    if (!file.size || file.size > REVIEW_EVIDENCE_LIMIT_BYTES) {
      input.value = "";
      setFieldError(input, "Files must be between 1 byte and 2 MB.");
      return;
    }
    setFieldError(input, "");
    zone.dataset.hasFile = "true";
    const row = document.createElement("div");
    row.className = "cs-dropzone__file";
    if (file.type.startsWith("image/")) {
      objectUrl = URL.createObjectURL(file);
      const thumb = document.createElement("img");
      thumb.className = "cs-dropzone__thumb";
      thumb.alt = "";
      thumb.src = objectUrl;
      row.append(thumb);
    } else {
      const doc = document.createElement("span");
      doc.className = "cs-dropzone__doc";
      doc.textContent = "PDF";
      row.append(doc);
    }
    const meta = document.createElement("span");
    meta.className = "cs-dropzone__meta";
    meta.textContent = `${file.name} · ${formatBytes(file.size)} · held for moderation`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cs-dropzone__remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      input.value = "";
      clearPreview();
    });
    row.append(meta, remove);
    preview.append(row);
    preview.hidden = false;
  };

  zone.addEventListener("click", (event) => {
    if (event.target !== input && !preview.contains(event.target)) input.click();
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.dataset.drag = "true";
  });
  zone.addEventListener("dragleave", () => { delete zone.dataset.drag; });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    delete zone.dataset.drag;
    const files = Array.from(event.dataTransfer?.files || []);
    const file = files.find((candidate) => ALLOWED_EVIDENCE_TYPES.has(candidate.type)) || files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    renderPreview();
  });
  input.addEventListener("change", renderPreview);
}

export function initializeReviewIntake(root = document) {
  const form = root.querySelector?.("[data-review-intake]");
  if (!form || form.dataset.reviewInitialized === "true") return null;
  form.dataset.reviewInitialized = "true";
  form.noValidate = true;
  document.documentElement.dataset.reviewIntakeEnhanced = "true";
  const entities = exactEntityMap(root);
  const status = form.querySelector("[data-review-page-status]");
  const primaryStep = form.querySelector('[data-review-step="primary"]');
  const counterpartStep = form.querySelector('[data-review-step="counterpart"]');
  const progress = Array.from(form.querySelectorAll("[data-review-progress]"));
  const next = form.querySelector("[data-review-next]");
  const back = form.querySelector("[data-review-back]");
  const skip = form.querySelector("[data-review-skip]");
  const submit = form.querySelector("[data-review-submit]");
  const readiness = form.querySelector("[data-review-counterpart-readiness]");
  const title = form.querySelector("[data-review-counterpart-title]");
  const compact = form.hasAttribute("data-review-compact");
  const actionButtons = [next, back, skip, submit].filter(Boolean);

  for (const input of form.querySelectorAll('input[type="date"]')) input.max = new Date().toISOString().slice(0, 10);

  const setPrimaryType = (type) => {
    for (const radio of form.querySelectorAll('[name="experience_type"]')) radio.checked = radio.value === type;
    syncCounterpartType();
  };

  const showStep = (name, moveFocus = true) => {
    const primary = name === "primary";
    if (primaryStep) primaryStep.hidden = !primary;
    if (counterpartStep) counterpartStep.hidden = primary;
    progress.forEach((item) => {
      if (item.dataset.reviewProgress === name) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    if (moveFocus) {
      const heading = (primary ? primaryStep : counterpartStep)?.querySelector("h3");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
      }
    }
  };

  const syncCounterpartType = () => {
    if (compact) return;
    const primaryType = fieldValue(form, "primary_entity_type");
    const opposite = oppositeEntityType(primaryType);
    for (const radio of form.querySelectorAll('[name="counterpart_entity_type"]')) {
      radio.checked = radio.value === opposite;
      radio.disabled = Boolean(opposite);
    }
    const group = form.querySelector('[data-review-entity-type-group="counterpart"]');
    if (group && opposite) group.dataset.derived = opposite;
    else if (group) delete group.dataset.derived;
    if (opposite) {
      const counterpartLabel = opposite === "pharmacy" ? "pharmacy" : "provider";
      const primaryLabel = primaryType === "pharmacy" ? "pharmacy" : "provider";
      if (title) title.textContent = `Optional ${counterpartLabel} review`;
      if (skip) skip.textContent = `Skip ${counterpartLabel} review and submit ${primaryLabel} review`;
      const currentEntity = fieldValue(form, "counterpart_entity_name");
      const currentRegistration = fieldValue(form, "counterpart_entity_registration");
      if (currentEntity && currentRegistration !== "proposed" && entities.get(currentEntity) !== opposite) {
        fieldControl(form, "counterpart_entity_name").value = "";
        const registration = form.elements.namedItem("counterpart_entity_registration");
        if (registration) registration.value = "";
      }
    }
  };

  const updateReadiness = () => {
    if (!readiness) return;
    if (!counterpartAttempted(form)) {
      readiness.textContent = "Optional. Complete every field to submit both reviews, or skip this review.";
      readiness.dataset.state = "idle";
      return;
    }
    if (counterpartComplete(form, entities)) {
      readiness.textContent = "Both reviews are complete and will be held together for moderation.";
      readiness.dataset.state = "ready";
    } else {
      readiness.textContent = "Finish every counterpart field, or use the explicit skip action.";
      readiness.dataset.state = "incomplete";
    }
  };

  const validatePrimary = () => {
    syncCounterpartType();
    const problems = collectStepProblems(primaryStep);
    if (!validateExactEntity(form, entities, "primary")) {
      const entity = fieldControl(form, "primary_entity_name");
      if (entity && !problems.some((problem) => problem.field === entity)) {
        problems.push({ field: entity, message: entity.validationMessage });
      }
    } else {
      const entity = fieldControl(form, "primary_entity_name");
      if (entity && entity.checkValidity()) setFieldError(entity, "");
    }
    for (const problem of problems) setFieldError(problem.field, problem.message);
    renderSummary(form, problems);
    if (problems.length) {
      const first = problems[0].field;
      openAncestorDetails(first);
      first.focus({ preventScroll: false });
      first.scrollIntoView({ behavior: "auto", block: "center" });
      return false;
    }
    return true;
  };

  const submitIntake = async (includeCounterpart) => {
    if (!validatePrimary()) {
      showStep("primary", false);
      return;
    }
    if (includeCounterpart && !counterpartComplete(form, entities)) {
      setStatus(status, "The optional counterpart review is incomplete. Finish every field or skip it.", "error");
      updateReadiness();
      fieldControl(form, "counterpart_entity_name")?.focus();
      return;
    }
    const primary = reviewItem(form, "primary");
    const counterpart = includeCounterpart ? reviewItem(form, "counterpart") : null;
    actionButtons.forEach((button) => { button.disabled = true; });
    form.setAttribute("aria-busy", "true");
    setStatus(status, "Submitting to the local moderation queue…", "pending");
    try {
      const primaryEvidence = await evidencePayload(fieldControl(form, "primary_evidence"));
      const counterpartEvidence = includeCounterpart ? await evidencePayload(form.elements.namedItem("counterpart_evidence")) : undefined;
      if ((primaryEvidence?.size_bytes || 0) + (counterpartEvidence?.size_bytes || 0) > REVIEW_EVIDENCE_LIMIT_BYTES) {
        throw new Error("Combined evidence must be 2 MB or less.");
      }
      if (primaryEvidence) primary.evidence = primaryEvidence;
      if (counterpartEvidence && counterpart) counterpart.evidence = counterpartEvidence;
      // ONE visible checkbox carries all three attestation substances; checking
      // it asserts each of them. Individual checkboxes keep working if present.
      const combined = fieldChecked(form, "combined_attestation");
      const payload = {
        schema_version: "review_intake_v2",
        public_display_name: fieldValue(form, "public_display_name"),
        verification_email: fieldValue(form, "verification_email"),
        primary,
        counterpart,
        truthful_attestation: fieldChecked(form, "truthful_attestation") || combined,
        privacy_attestation: fieldChecked(form, "privacy_attestation") || combined,
        moderation_consent: fieldChecked(form, "moderation_consent") || combined,
        company: fieldValue(form, "company"),
      };
      if (!isLocalReviewEndpoint(REVIEW_CAPTURE_ENDPOINT)) throw new Error("Review endpoint boundary is not local.");
      const response = await fetch(REVIEW_CAPTURE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.published !== false) throw new Error(result.reason || result.status || "The moderation queue did not accept the review.");
      setStatus(status, `Moderation receipt ${result.review_id}. Held for manual review; nothing was published.`, "success");
      form.reset();
      syncCounterpartType();
      showStep("primary", false);
      updateReadiness();
    } catch (error) {
      setStatus(status, `Not submitted: ${error.message}`, "error");
    } finally {
      form.removeAttribute("aria-busy");
      actionButtons.forEach((button) => { button.disabled = false; });
    }
  };

  next?.addEventListener("click", () => {
    if (!validatePrimary()) return;
    setStatus(status, "", "");
    showStep("counterpart");
    updateReadiness();
  });
  back?.addEventListener("click", () => showStep("primary"));
  skip?.addEventListener("click", async () => {
    clearCounterpart(form);
    await submitIntake(false);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitIntake(compact ? false : counterpartAttempted(form));
  });
  form.addEventListener("input", (event) => {
    event.target?.setCustomValidity?.("");
    if (event.target?.checkValidity?.()) setFieldError(event.target, "");
    if (event.target?.name === "experience_type") syncCounterpartType();
    if (event.target?.name?.startsWith("counterpart_")) updateReadiness();
  });
  form.addEventListener("change", (event) => {
    if (event.target?.checkValidity?.()) setFieldError(event.target, "");
    if (event.target?.name === "experience_type") syncCounterpartType();
    if (event.target?.name?.startsWith("counterpart_")) updateReadiness();
  });

  const comboboxHooks = {
    onResolve: (prefix, type) => {
      if (prefix === "primary" && type) setPrimaryType(type);
      if (prefix === "counterpart") updateReadiness();
    },
  };
  initializeCombobox(form, entities, "primary", comboboxHooks);
  if (!compact) initializeCombobox(form, entities, "counterpart", comboboxHooks);
  for (const group of form.querySelectorAll("[data-review-entity-type-group]")) group.dataset.comboboxManaged = "true";
  if (!compact) {
    initializeDropzone(form, "primary");
    initializeDropzone(form, "counterpart");
  }

  // Entity-grid share links arrive as /reviews/submit/?entity=…&type=… —
  // prefill only when the requested entity is governed and the type matches.
  const params = new URLSearchParams(globalThis.location?.search || "");
  const requestedEntity = params.get("entity");
  if (requestedEntity && entities.has(requestedEntity)) {
    const entityInput = fieldControl(form, "primary_entity_name");
    const registration = form.elements.namedItem("entity_registration");
    if (entityInput) entityInput.value = requestedEntity;
    if (registration) registration.value = "registered";
    setPrimaryType(entities.get(requestedEntity));
  }

  showStep("primary", false);
  updateReadiness();
  return { form, entities, showStep };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initializeReviewIntake(document), { once: true });
  else initializeReviewIntake(document);
}
