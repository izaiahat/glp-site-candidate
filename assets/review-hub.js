(() => {
  const hub = document.querySelector('[data-review-hub]');
  if (hub) {
    const input = hub.querySelector('[data-review-filter]');
    const cards = Array.from(hub.querySelectorAll('[data-review-card]'));
    const count = hub.querySelector('[data-review-count]');
    const empty = hub.querySelector('[data-review-empty]');
    const clear = hub.querySelector('[data-review-filter-clear]');
    const loadMore = hub.querySelector('[data-review-load-more]');
    const typeButtons = Array.from(hub.querySelectorAll('[data-review-type-filter]'));
    const pageSize = Math.max(1, Number(hub.dataset.reviewPageSize) || cards.length);
    let activeType = 'all';
    let shown = pageSize;
    const normalize = (value) => String(value || '').trim().toLocaleLowerCase();
    const render = () => {
      const query = normalize(input?.value);
      const matches = cards.filter((card) => {
        const typeMatch = activeType === 'all' || card.dataset.reviewType === activeType;
        return typeMatch && (!query || normalize(card.dataset.reviewName).includes(query));
      });
      const visible = new Set(matches.slice(0, shown));
      cards.forEach((card) => { card.hidden = !visible.has(card); });
      if (count) count.textContent = `${matches.length} matching evidence profile${matches.length === 1 ? '' : 's'} · ${visible.size} shown`;
      if (empty) empty.hidden = matches.length !== 0;
      if (loadMore) loadMore.hidden = shown >= matches.length || matches.length === 0;
      typeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.reviewTypeFilter === activeType)));
    };
    input?.addEventListener('input', () => { shown = pageSize; render(); });
    // Hero trust search drives the SAME live directory filter (one honest
    // count, one source of truth) and lands the reader on the results grid.
    const heroSearch = document.querySelector('[data-review-hero-search]');
    const heroInput = heroSearch?.querySelector('input[type="search"]');
    if (heroSearch && heroInput && input) {
      heroInput.addEventListener('input', () => {
        input.value = heroInput.value;
        shown = pageSize;
        render();
      });
      heroSearch.addEventListener('submit', (event) => {
        event.preventDefault();
        input.value = heroInput.value;
        shown = pageSize;
        render();
        document.getElementById('review-results')?.scrollIntoView({ block: 'start' });
      });
    }
    typeButtons.forEach((button) => button.addEventListener('click', () => {
      activeType = button.dataset.reviewTypeFilter || 'all';
      shown = pageSize;
      render();
    }));
    loadMore?.addEventListener('click', () => { shown += pageSize; render(); });
    clear?.addEventListener('click', () => {
      if (input) input.value = '';
      activeType = 'all';
      shown = pageSize;
      render();
      input?.focus();
    });
    render();
  }

  const form = document.querySelector('[data-review-page-form]');
  if (!form) return;
  const status = form.querySelector('[data-review-page-status]');
  const submit = form.querySelector('[type="submit"]');
  const entity = form.querySelector('[data-review-entity]');
  const evidenceInput = form.querySelector('[data-review-evidence]');
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  const maxBytes = 2 * 1024 * 1024;
  const exactEntities = new Map(Array.from(document.querySelectorAll('#review-provider-options option')).map((option) => [option.value, option.dataset.reviewEntityType]));
  const setStatus = (message) => { if (status) status.textContent = message; };
  const bytesToBase64 = (bytes) => {
    let binary = '';
    const windowSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += windowSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + windowSize, bytes.length)));
    }
    return btoa(binary);
  };
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const evidencePayload = async () => {
    const file = evidenceInput?.files?.[0];
    if (!file) return undefined;
    if (!allowedTypes.has(file.type)) throw new Error('Choose a JPEG, PNG, WebP, or PDF file.');
    if (!file.size || file.size > maxBytes) throw new Error('Evidence must be between 1 byte and 2 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    return {
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      sha256,
      base64: bytesToBase64(bytes),
    };
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!entity || !exactEntities.has(entity.value)) {
      entity?.setCustomValidity('Choose an exact entity from the governed review directory.');
      entity?.reportValidity();
      entity?.focus();
      return;
    }
    entity.setCustomValidity('');
    const selectedType = form.querySelector('[name="experience_type"]:checked')?.value;
    if (exactEntities.get(entity.value) !== selectedType) {
      entity.setCustomValidity('The entity type must match the selected provider or pharmacy.');
      entity.reportValidity();
      entity.focus();
      return;
    }
    submit.disabled = true;
    setStatus('Checking your submission…');
    try {
      const data = Object.fromEntries(new FormData(form));
      delete data.evidence;
      data.truthful_attestation = form.elements.truthful_attestation.checked;
      data.moderation_consent = form.elements.moderation_consent.checked;
      const evidence = await evidencePayload();
      if (evidence) data.evidence = evidence;
      const response = await fetch('/api/review-capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.reason || result.status || 'Unable to submit');
      setStatus(result.evidence_received
        ? 'Received with evidence. We will check it before publication.'
        : 'Received. We will check your review before publication.');
      form.reset();
    } catch (error) {
      setStatus(`Not submitted: ${error.message}`);
    } finally {
      submit.disabled = false;
    }
  });
  entity?.addEventListener('input', () => entity.setCustomValidity(''));
})();
