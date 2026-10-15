(() => {
  const nav = document.querySelector('.gcs-nav');
  const menuButton = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-menu]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Pass 3 modality contract: keyboard-driven state is instant. Capture runs
     before control handlers; pointer/wheel input restores restrained feedback. */
  const root = document.documentElement;
  const setModality = (value) => { root.dataset.inputModality = value; };
  document.addEventListener('keydown', () => setModality('keyboard'), { capture: true });
  document.addEventListener('pointerdown', () => setModality('pointer'), { capture: true });
  document.addEventListener('wheel', () => setModality('pointer'), { capture: true, passive: true });

  const closeMenu = ({ returnFocus = false } = {}) => {
    if (!menuButton || !menu) return;
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) menuButton.focus();
  };

  // ULTRACODE 2026-08-21: the redesigned shell's drawer (.cs-drawer) has its own
  // controller below — transform-driven, focus-trapped. This legacy hidden-attr
  // controller keeps running any template that still ships the old menu markup,
  // and stands down when the menu IS the new drawer so the two never both bind.
  if (menuButton && menu && !menu.classList.contains('cs-drawer')) {
    const desktopMenu = window.matchMedia('(min-width: 1024px)');
    if (desktopMenu.matches) menu.hidden = false;
    else closeMenu();
    menuButton.addEventListener('click', () => {
      const opening = menu.hidden;
      menu.hidden = !opening;
      menuButton.setAttribute('aria-expanded', String(opening));
      if (opening) menu.querySelector('a')?.focus({ preventScroll: true });
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu({ returnFocus: true });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) closeMenu({ returnFocus: true });
    });
    desktopMenu.addEventListener('change', (event) => {
      if (event.matches) {
        menu.hidden = false;
        menuButton.setAttribute('aria-expanded', 'false');
      } else {
        closeMenu();
      }
    });
  }


  const pagePath = window.location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.gcs-links a').forEach((link) => {
    const linkPath = new URL(link.href, window.location.origin).pathname.replace(/\/+$/, '') || '/';
    const active = linkPath === '/' ? pagePath === '/' : pagePath.startsWith(linkPath);
    if (active) link.setAttribute('aria-current', 'page');
  });

  const overlayCollisionTargets = [...document.querySelectorAll('a[data-analytics-event="affiliate_click"][href^="https"]')]
    .filter((target) => !target.closest('.sticky, .exit-capture'));
  const overlayAffordances = [...document.querySelectorAll('.sticky, .exit-capture-trigger')];
  const rectanglesOverlap = (left, right) => left.right > right.left && left.left < right.right && left.bottom > right.top && left.top < right.bottom;
  let collisionFrame = 0;
  const syncOverlayCollisions = () => {
    collisionFrame = 0;
    overlayAffordances.forEach((overlay) => {
      const overlayRect = overlay.getBoundingClientRect();
      const active = overlayRect.width > 0 && overlayRect.height > 0;
      const blocked = active && overlayCollisionTargets.some((target) => {
        const targetRect = target.getBoundingClientRect();
        return targetRect.width > 0 && targetRect.height > 0 && rectanglesOverlap(overlayRect, targetRect);
      });
      overlay.classList.toggle('is-cta-overlap', blocked);
      overlay.inert = blocked;
      if (blocked) overlay.setAttribute('aria-hidden', 'true');
      else overlay.removeAttribute('aria-hidden');
    });
  };
  const queueOverlayCollisionSync = () => {
    if (!collisionFrame) collisionFrame = requestAnimationFrame(syncOverlayCollisions);
  };
  if (overlayAffordances.length && overlayCollisionTargets.length) {
    window.addEventListener('scroll', queueOverlayCollisionSync, { passive: true });
    window.addEventListener('resize', queueOverlayCollisionSync, { passive: true });
    queueOverlayCollisionSync();
  }

  const sticky = document.querySelector('[data-sticky-affiliate]')?.closest('.sticky');
  const leadCta = document.querySelector('#quick-answer .cta');
  const conclusion = document.querySelector('#conclusion, footer');
  if (sticky && leadCta && 'IntersectionObserver' in window) {
    let leadVisible = true;
    let conclusionVisible = false;
    const syncSticky = () => {
      const active = !leadVisible && !conclusionVisible;
      sticky.classList.toggle('is-active', active);
      document.body.classList.toggle('has-sticky-action', active);
      const stickyRect = sticky.getBoundingClientRect();
      const stickyClearance = active && stickyRect.height > 0
        ? Math.max(stickyRect.height + 12, window.innerHeight - stickyRect.top + 12)
        : 0;
      document.documentElement.style.setProperty('--sticky-clearance', stickyClearance + 'px');
      queueOverlayCollisionSync();
    };
    new IntersectionObserver(([entry]) => {
      leadVisible = entry.isIntersecting;
      syncSticky();
    }, { rootMargin: '24px 0px 0px' }).observe(leadCta);
    if (conclusion) {
      new IntersectionObserver(([entry]) => {
        conclusionVisible = entry.isIntersecting;
        syncSticky();
      }).observe(conclusion);
    }
  }

  document.querySelectorAll('[data-directory-sort]').forEach((select) => {
    select.addEventListener('change', () => {
      const list = document.querySelector('[data-directory-results]');
      if (!list) return;
      const cards = [...list.querySelectorAll('.clinic-card')];
      cards.sort((left, right) => {
        if (select.value === 'name') return left.dataset.name.localeCompare(right.dataset.name);
        return Number(right.dataset.directSource) - Number(left.dataset.directSource) || left.dataset.name.localeCompare(right.dataset.name);
      });
      cards.forEach((card) => list.append(card));
      document.querySelector('[data-results-count]')?.setAttribute('aria-live', 'polite');
    });
  });

  document.querySelectorAll('[data-directory-taxonomy]').forEach((select) => {
    select.addEventListener('change', () => {
      const cards = [...document.querySelectorAll('[data-directory-results] .clinic-card')];
      let visible = 0;
      cards.forEach((card) => {
        const show = !select.value || card.dataset.taxonomy === select.value;
        card.hidden = !show;
        if (show) visible += 1;
      });
      const count = document.querySelector('[data-results-count]');
      if (count) {
        count.textContent = `${visible} registry result${visible === 1 ? '' : 's'}`;
        count.setAttribute('aria-live', 'polite');
      }
    });
  });

  const citySearch = document.querySelector('[data-city-search]');
  const cityCards = [...document.querySelectorAll('[data-city-card]')];
  const cityCount = document.querySelector('[data-city-count]');
  let cityTier = 'all';
  const filterCities = () => {
    const query = citySearch?.value.trim().toLowerCase() || '';
    let visible = 0;
    cityCards.forEach((card) => {
      const matchesQuery = !query || card.dataset.cityName.includes(query);
      const matchesTier = cityTier === 'all' || card.dataset.cityTier === cityTier;
      const show = matchesQuery && matchesTier;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (cityCount) {
      cityCount.textContent = `${visible} cit${visible === 1 ? 'y' : 'ies'}`;
      cityCount.setAttribute('aria-live', 'polite');
    }
  };
  citySearch?.addEventListener('input', filterCities);
  document.querySelectorAll('[data-city-tier-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      cityTier = button.dataset.cityTierFilter;
      document.querySelectorAll('[data-city-tier-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      filterCities();
    });
  });

  document.querySelectorAll('a[aria-disabled="true"]').forEach((link) => {
    link.addEventListener('click', (event) => event.preventDefault());
  });

  if (reduceMotion) document.documentElement.dataset.motion = 'reduced';
})();


/* ============ DESIGN WAVE 2026-08-06: in-place citation disclosure ============ */
(() => {
  const links = [...document.querySelectorAll('.inline-citation a[href^="#"], .citation a[href^="#"], a.inline-citation[href^="#"], a.citation[href^="#"]')];
  if (!links.length) return;
  let open = null;
  const closeAll = () => {
    if (!open) return;
    open.pop.hidden = true;
    open.link.setAttribute('aria-expanded', 'false');
    open = null;
  };
  const place = (pop) => {
    pop.style.left = '0px';
    pop.style.top = '';
    pop.style.bottom = '';
    let rect = pop.getBoundingClientRect();
    const room = document.documentElement.clientWidth - 12;
    if (rect.right > room) pop.style.left = Math.round(room - rect.right) + 'px';
    rect = pop.getBoundingClientRect();
    if (rect.left < 12) pop.style.left = Math.round(12 - rect.left + parseFloat(pop.style.left || 0)) + 'px';
    // Flip above the citation rather than push the reader past the fold.
    rect = pop.getBoundingClientRect();
    if (rect.bottom > innerHeight - 12 && rect.height + 24 < innerHeight) {
      pop.style.top = 'auto';
      pop.style.bottom = 'calc(100% + 8px)';
    }
  };
  links.forEach((link, index) => {
    const id = link.getAttribute('href').slice(1);
    const entry = document.getElementById(id);
    // Only numbered source-ledger entries get this treatment; a plain in-page anchor
    // that happens to carry the class keeps its normal jump.
    if (!entry || entry.tagName !== 'LI') return;
    let host = link.closest('sup');
    if (!host) {
      host = document.createElement('span');
      link.replaceWith(host);
      host.append(link);
    }
    host.classList.add('cite-host');
    const source = entry.querySelector('a[href^="http"]');
    const dated = entry.querySelector('small');
    // Publisher naming differs by surface: money/review ledgers put the publisher in the
    // outbound link text; guide ledgers put it in a <strong> and the claim in a <span>.
    const publisher = entry.querySelector('strong');
    const supports = entry.querySelector('span:not([class])') || entry.querySelector('span');
    const pop = document.createElement('span');
    pop.className = 'cite-pop';
    pop.id = 'cite-pop-' + index;
    pop.hidden = true;
    const label = document.createElement('span');
    label.className = 'cite-pop-label';
    label.textContent = 'Source ' + (id.match(/(\d+)$/) || ['', id])[1];
    const name = document.createElement('span');
    name.className = 'cite-pop-name';
    name.textContent = ((publisher && publisher.textContent) || (source && source.textContent) || entry.textContent).trim();
    pop.append(label, name);
    // Money and review ledgers open their <li> with the bare citation number in a <span>;
    // only a real "supports" sentence is worth repeating in the panel.
    if (supports && supports.textContent.trim().length > 24 && supports.textContent.trim() !== name.textContent) {
      const claim = document.createElement('span');
      claim.className = 'cite-pop-supports';
      claim.textContent = supports.textContent.trim();
      pop.append(claim);
    }
    if (dated) {
      const when = document.createElement('span');
      when.className = 'cite-pop-date';
      when.textContent = dated.textContent.trim();
      pop.append(when);
    }
    if (source) {
      const out = document.createElement('a');
      out.className = 'cite-pop-link';
      out.href = source.href;
      out.rel = 'noopener nofollow';
      out.target = '_blank';
      // AEO P0-B: the citation panel already knows the publisher, so the link
      // names its issuer instead of shipping a semantically empty label.
      out.textContent = ((publisher && publisher.textContent.trim()) || (source.textContent || '').trim() || 'View source') + ' ↗';
      pop.append(out);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cite-pop-close';
    close.textContent = 'Close';
    pop.append(close);
    host.append(pop);
    link.setAttribute('aria-expanded', 'false');
    link.setAttribute('aria-controls', pop.id);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const wasOpen = !pop.hidden;
      closeAll();
      if (wasOpen) return;
      pop.hidden = false;
      link.setAttribute('aria-expanded', 'true');
      open = { pop, link };
      place(pop);
      requestAnimationFrame(() => { if (open && open.pop === pop) place(pop); });
    });
    close.addEventListener('click', () => { closeAll(); link.focus(); });
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAll(); });
  document.addEventListener('click', (event) => { if (open && !event.target.closest('.cite-host')) closeAll(); });
  let queued = false;
  const reposition = () => {
    if (!open || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (open) place(open.pop); });
  };
  addEventListener('resize', reposition, { passive: true });
  addEventListener('scroll', reposition, { passive: true });
})();

/* ============ 2026-08-10: canonical autocomplete + explicit apply ============ */
(() => {
  const canonicalProviderRoute = '/_retired-provider-autocomplete-runtime/';
  const normalizedPath = `${location.pathname.replace(/\/+$/, '')}/`;
  if (normalizedPath !== canonicalProviderRoute) return;
  const tables = [...document.querySelectorAll('.table-wrap.responsive-table table[data-sortable][data-therapeutic-facets="true"]')];
  if (tables.length !== 1 || !tables[0]?.tBodies[0]) {
    throw new Error(`provider_autocomplete_canonical_table_invalid:${tables.length}`);
  }
  const [table] = tables;
  const wrap = table.closest('.table-wrap');
  const items = [...table.tBodies[0].rows];
  const PAGE_SIZE = 8;
  const allMedicationDefinitions = [
    ['semaglutide', 'Semaglutide'], ['tirzepatide', 'Tirzepatide'],
    ['retatrutide', 'Retatrutide'],
    ['wegovy', 'Wegovy'], ['zepbound', 'Zepbound'], ['mounjaro', 'Mounjaro'],
    ['oral', 'Oral'], ['injectable', 'Injectable'],
  ];
  if (table.dataset.consumerAuthoritySchema !== 'glp-consumer-therapeutic-authority-v1') {
    throw new Error('consumer_therapeutic_authority_missing');
  }
  const consumerMedicationValues = new Set(String(table.dataset.consumerTherapeutics || '').split(',').filter(Boolean));
  const medicationDefinitions = allMedicationDefinitions.filter(([value]) => consumerMedicationValues.has(value));
  const sourceDefinitions = [
    ['all', 'Any source'], ['compounded', 'Compounded versions'],
    ['brand_name', 'Brand-name medications'], ['either', 'Either is fine'],
  ];
  const medicationValues = new Set(medicationDefinitions.map(([value]) => value));
  const sourceValues = new Set(sourceDefinitions.map(([value]) => value));
  const identity = (value) => String(value || '').trim().toLowerCase();
  const suggestions = items.map((item) => ({
    item,
    id: String(item.dataset.program || ''),
    label: String(item.dataset.provider || item.cells?.[0]?.textContent || '').trim(),
  })).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const labelKeys = suggestions.map((entry) => identity(entry.label));
  const programIds = suggestions.map((entry) => entry.id);
  const canonicalProfileIds = String(table.dataset.canonicalProviderIds || '').split(',').filter(Boolean).sort();
  const sortedProgramIds = [...programIds].sort();
  if (table.dataset.providerDynamicProfileSchema !== 'glp-provider-dynamic-profiles-v1'
      || canonicalProfileIds.length === 0 || new Set(canonicalProfileIds).size !== canonicalProfileIds.length
      || suggestions.some((entry) => !entry.id || !entry.label)
      || new Set(programIds).size !== suggestions.length || new Set(labelKeys).size !== suggestions.length
      || canonicalProfileIds.length !== suggestions.length
      || canonicalProfileIds.some((id, index) => id !== sortedProgramIds[index])) {
    throw new Error('provider_autocomplete_canonical_set_invalid:' + suggestions.length);
  }

  const defaults = () => ({ query: '', therapeutic: new Set(), treatment: 'all' });
  const clone = (value) => ({ query: value.query, therapeutic: new Set(value.therapeutic), treatment: value.treatment });
  const state = { draft: defaults(), applied: defaults(), page: 1 };
  const readUrl = () => {
    const params = new URL(location.href).searchParams;
    const next = defaults();
    next.query = String(params.get('provider') || '').trim();
    for (const value of params.getAll('therapeutic').flatMap((part) => part.split(','))) {
      const normalized = identity(value);
      if (medicationValues.has(normalized)) next.therapeutic.add(normalized);
    }
    const treatment = identity(params.get('treatment'));
    if (sourceValues.has(treatment)) next.treatment = treatment;
    return next;
  };
  state.applied = readUrl();
  state.draft = clone(state.applied);

  const controls = document.createElement('form');
  controls.className = 'cmp-controls cmp-controls--therapeutic cmp-apply-form';
  controls.noValidate = true;
  controls.setAttribute('role', 'search');
  const searchField = document.createElement('div');
  searchField.className = 'cmp-search-field cmp-combobox';
  const searchLabel = document.createElement('label');
  searchLabel.htmlFor = 'provider-autocomplete';
  searchLabel.textContent = 'Provider';
  const search = document.createElement('input');
  search.id = 'provider-autocomplete';
  search.type = 'search';
  search.className = 'cmp-search';
  search.autocomplete = 'off';
  search.placeholder = 'Start typing a provider';
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-expanded', 'false');
  search.setAttribute('aria-controls', 'provider-suggestions');
  const list = document.createElement('ul');
  list.id = 'provider-suggestions';
  list.className = 'cmp-suggestions';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  searchField.append(searchLabel, search, list);

  const facets = document.createElement('div');
  facets.className = 'cmp-facets';
  const inputs = [];
  const group = (legendText, definitions, kind) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'cmp-facet-group';
    const legend = document.createElement('legend');
    legend.textContent = legendText;
    const choices = document.createElement('div');
    choices.className = 'cmp-facet-choices';
    for (const [value, label] of definitions) {
      const option = document.createElement('label');
      option.className = 'cmp-facet-option';
      const input = document.createElement('input');
      input.type = kind === 'treatment' ? 'radio' : 'checkbox';
      input.name = kind;
      input.value = value;
      input.dataset.facetKind = kind;
      input.addEventListener('change', () => {
        if (kind === 'therapeutic') {
          if (input.checked) state.draft.therapeutic.add(value);
          else state.draft.therapeutic.delete(value);
        } else state.draft.treatment = value;
      });
      const optionCount = kind === 'therapeutic'
        ? items.filter((item) => String(item.dataset.therapeutic || '').split(/\s+/).includes(value)).length
        : value === 'all' ? items.length
          : value === 'either' ? items.filter((item) => item.dataset.treatmentVerified === 'true').length
            : items.filter((item) => String(item.dataset.treatment || '').split(/\s+/).includes(value)).length;
      const text = document.createElement('span');
      text.textContent = `${label} (${optionCount})`;
      option.append(input, text);
      choices.append(option);
      inputs.push(input);
    }
    fieldset.append(legend, choices);
    return fieldset;
  };
  facets.append(group('Medication or format', medicationDefinitions, 'therapeutic'), group('Medication source', sourceDefinitions, 'treatment'));
  const explanation = document.createElement('p');
  explanation.className = 'cmp-facet-note';
  explanation.textContent = 'Choose any medication or format; Medication source narrows those choices. Results change only when you search.';
  const retatrutide = document.createElement('p');
  retatrutide.className = 'cmp-retatrutide-note';
  retatrutide.innerHTML = 'Retatrutide is not available as a consumer provider filter. It remains investigational and is not FDA-approved; Lilly says it is lawfully available only in its clinical trials. <a href="https://www.fda.gov/drugs/drug-alerts-and-statements/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss" rel="noopener">FDA notice</a> · <a href="https://www.lilly.com/news/stories/what-to-know-about-retatrutide" rel="noopener">Lilly statement</a>.';
  facets.append(explanation);
  if (!consumerMedicationValues.has('retatrutide')) facets.append(retatrutide);

  const actions = document.createElement('div');
  actions.className = 'cmp-apply-actions';
  const applyButton = document.createElement('button');
  applyButton.type = 'submit';
  applyButton.className = 'gcs-button cmp-apply';
  applyButton.textContent = 'Search providers';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'gcs-button secondary cmp-reset';
  resetButton.textContent = 'Reset';
  actions.append(applyButton, resetButton);
  const count = document.createElement('p');
  count.className = 'cmp-count';
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  controls.append(searchField, facets, actions, count);

  const pager = document.createElement('nav');
  pager.className = 'cmp-pager';
  pager.setAttribute('aria-label', 'Provider pages');
  const empty = document.createElement('p');
  empty.className = 'cmp-empty';
  empty.hidden = true;
  wrap.parentNode.insertBefore(controls, wrap);
  wrap.parentNode.insertBefore(empty, wrap.nextSibling);
  wrap.parentNode.insertBefore(pager, empty);

  let activeSuggestion = -1;
  let visibleSuggestions = [];
  const closeSuggestions = () => {
    list.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
  };
  const highlightSuggestion = () => {
    [...list.children].forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === activeSuggestion));
      option.classList.toggle('is-active', index === activeSuggestion);
    });
    const option = list.children[activeSuggestion];
    if (option) {
      search.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  };
  const chooseSuggestion = (index) => {
    const choice = visibleSuggestions[index];
    if (!choice) return false;
    search.value = choice.label;
    state.draft.query = choice.label;
    closeSuggestions();
    return true;
  };
  const renderSuggestions = () => {
    const query = identity(search.value);
    visibleSuggestions = suggestions.filter((entry) => !query || identity(entry.label).includes(query));
    list.replaceChildren(...visibleSuggestions.map((entry, index) => {
      const option = document.createElement('li');
      option.id = `provider-suggestion-${index}`;
      option.role = 'option';
      option.textContent = entry.label;
      option.dataset.program = entry.id;
      option.setAttribute('aria-selected', 'false');
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => {
        chooseSuggestion(index);
        search.focus();
      });
      return option;
    }));
    activeSuggestion = -1;
    list.hidden = visibleSuggestions.length === 0;
    search.setAttribute('aria-expanded', String(visibleSuggestions.length > 0));
    highlightSuggestion();
  };
  search.addEventListener('focus', renderSuggestions);
  search.addEventListener('input', () => {
    state.draft.query = search.value.trim();
    renderSuggestions();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!list.hidden) { event.preventDefault(); closeSuggestions(); }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) renderSuggestions();
      if (!visibleSuggestions.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activeSuggestion = activeSuggestion < 0 ? (delta > 0 ? 0 : visibleSuggestions.length - 1)
        : (activeSuggestion + delta + visibleSuggestions.length) % visibleSuggestions.length;
      highlightSuggestion();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeSuggestion >= 0) chooseSuggestion(activeSuggestion);
      apply();
    }
  });
  document.addEventListener('mousedown', (event) => { if (!searchField.contains(event.target)) closeSuggestions(); });

  const syncDraftControls = () => {
    search.value = state.draft.query;
    for (const input of inputs) {
      input.checked = input.dataset.facetKind === 'therapeutic'
        ? state.draft.therapeutic.has(input.value)
        : state.draft.treatment === input.value;
    }
  };
  const matches = (item) => {
    const applied = state.applied;
    if (applied.query && !identity(item.dataset.provider || item.textContent).includes(identity(applied.query))) return false;
    const itemTherapeutic = new Set(String(item.dataset.therapeutic || '').split(/\s+/).filter(Boolean));
    const itemTreatment = new Set(String(item.dataset.treatment || '').split(/\s+/).filter(Boolean));
    if (applied.therapeutic.size && ![...applied.therapeutic].some((value) => itemTherapeutic.has(value))) return false;
    if (applied.treatment === 'all') return true;
    if (applied.treatment === 'either') return item.dataset.treatmentVerified === 'true';
    return itemTreatment.has(applied.treatment);
  };
  const sortValues = new Set(['score', 'price']);
  const currentSort = () => sortValues.has(table.dataset.sortedBy) ? table.dataset.sortedBy : 'score';
  const normalizedAppliedPayload = (sort = currentSort(), applied = state.applied) => ({
    version: 1,
    sort: sortValues.has(sort) ? sort : 'score',
    query: String(applied?.query || '').trim(),
    therapeutic: [...(applied?.therapeutic || [])].filter((value) => medicationValues.has(value)).sort(),
    treatment: sourceValues.has(applied?.treatment) ? applied.treatment : 'all',
  });
  const payloadEquals = (left, right) => Boolean(left && right
    && left.version === right.version && left.sort === right.sort && left.query === right.query
    && left.treatment === right.treatment && Array.isArray(left.therapeutic)
    && Array.isArray(right.therapeutic) && left.therapeutic.length === right.therapeutic.length
    && left.therapeutic.every((value, index) => value === right.therapeutic[index]));
  const restoreAppliedEntry = (entryState) => {
    const fromUrl = readUrl();
    const raw = entryState?.glpCompareFacet;
    const candidate = raw && typeof raw === 'object'
      ? normalizedAppliedPayload(raw.sort, {
        query: raw.query,
        therapeutic: Array.isArray(raw.therapeutic) ? new Set(raw.therapeutic) : new Set(),
        treatment: raw.treatment,
      })
      : null;
    const normalizedUrl = normalizedAppliedPayload(candidate?.sort || 'score', fromUrl);
    const rawIsCompleteAndNormalized = Boolean(candidate && raw.version === 1
      && sortValues.has(raw.sort) && typeof raw.query === 'string' && raw.query === candidate.query
      && Array.isArray(raw.therapeutic) && raw.therapeutic.length === candidate.therapeutic.length
      && raw.therapeutic.every((value, index) => value === candidate.therapeutic[index])
      && typeof raw.treatment === 'string' && raw.treatment === candidate.treatment);
    const payloadMatchesUrl = rawIsCompleteAndNormalized
      && candidate.query === normalizedUrl.query && candidate.treatment === normalizedUrl.treatment
      && candidate.therapeutic.length === normalizedUrl.therapeutic.length
      && candidate.therapeutic.every((value, index) => value === normalizedUrl.therapeutic[index]);
    const applied = payloadMatchesUrl ? {
      query: candidate.query,
      therapeutic: new Set(candidate.therapeutic),
      treatment: candidate.treatment,
    } : fromUrl;
    return { applied, sort: sortValues.has(raw?.sort) ? raw.sort : 'score' };
  };
  const historyPayload = (sort = currentSort()) => ({
    ...(history.state && typeof history.state === 'object' ? history.state : {}),
    glpCompareFacet: normalizedAppliedPayload(sort),
  });
  const writeUrl = ({ mode = 'replace', sort = currentSort() } = {}) => {
    const url = new URL(location.href);
    url.searchParams.delete('provider');
    url.searchParams.delete('therapeutic');
    url.searchParams.delete('treatment');
    if (state.applied.query) url.searchParams.set('provider', state.applied.query);
    const selected = [...state.applied.therapeutic].sort();
    if (selected.length) url.searchParams.set('therapeutic', selected.join(','));
    if (state.applied.treatment !== 'all') url.searchParams.set('treatment', state.applied.treatment);
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash;
    const current = location.pathname + location.search + location.hash;
    const nextState = historyPayload(sort);
    if (mode === 'push') history.pushState(nextState, '', next);
    else if (mode === 'replace' && (next !== current
        || !payloadEquals(history.state?.glpCompareFacet, nextState.glpCompareFacet))) {
      history.replaceState(nextState, '', next);
    }
  };
  const button = (text, page, options = {}) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    control.disabled = Boolean(options.disabled);
    if (options.current) control.setAttribute('aria-current', 'page');
    if (options.label) control.setAttribute('aria-label', options.label);
    control.addEventListener('click', () => {
      state.page = page;
      render();
      controls.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    return control;
  };
  const render = () => {
    const shown = items.filter(matches);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    state.page = Math.min(Math.max(state.page, 1), pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const visible = new Set(shown.slice(start, start + PAGE_SIZE));
    for (const item of items) item.toggleAttribute('data-cmp-hidden', !visible.has(item));
    empty.hidden = shown.length > 0;
    empty.textContent = 'No verified providers match the applied provider, medication, format, and source choices. Reset or broaden your choices.';
    count.textContent = shown.length
      ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, shown.length)} of ${shown.length} programs · page ${state.page} of ${pages}`
      : `0 of ${items.length} programs match the applied search`;
    pager.replaceChildren();
    if (shown.length) {
      pager.append(button('← Previous', state.page - 1, { disabled: state.page === 1, label: 'Previous page' }));
      for (let page = 1; page <= pages; page += 1) pager.append(button(String(page), page, { current: page === state.page, label: `Page ${page}` }));
      pager.append(button('Next →', state.page + 1, { disabled: state.page === pages, label: 'Next page' }));
    }
    return shown.length;
  };
  function apply({ historyMode = 'push' } = {}) {
    state.draft.query = search.value.trim();
    state.applied = clone(state.draft);
    state.page = 1;
    closeSuggestions();
    const shown = render();
    writeUrl({ mode: historyMode });
    window.GCSAnalytics?.event('comparison_filters_applied', {
      provider: state.applied.query || 'all',
      therapeutic: [...state.applied.therapeutic].sort().join(',') || 'all',
      treatment: state.applied.treatment,
      visible_count: shown,
    });
  }
  controls.addEventListener('submit', (event) => { event.preventDefault(); apply(); });
  resetButton.addEventListener('click', () => {
    state.draft = defaults();
    syncDraftControls();
    apply();
    search.focus();
  });
  let suppressSortHistory = false;
  const restoreSortWithoutHistory = (sort) => {
    if (currentSort() === sort) return;
    const control = document.querySelector(`[data-sort="${sort}"]`);
    if (!control) return;
    suppressSortHistory = true;
    try { control.click(); } finally { suppressSortHistory = false; }
  };
  addEventListener('popstate', (event) => {
    const restored = restoreAppliedEntry(event.state);
    state.applied = restored.applied;
    state.draft = clone(state.applied);
    state.page = 1;
    restoreSortWithoutHistory(restored.sort);
    items.splice(0, items.length, ...table.tBodies[0].rows);
    syncDraftControls();
    render();
  });
  for (const control of document.querySelectorAll('[data-sort]')) {
    control.addEventListener('click', () => {
      if (suppressSortHistory) return;
      items.splice(0, items.length, ...table.tBodies[0].rows);
      state.page = 1;
      writeUrl({ mode: 'replace', sort: currentSort() });
      render();
    });
  }

  const reveal = (node) => {
    const item = items.find((entry) => entry === node || entry.contains(node));
    if (!item) return false;
    state.draft = defaults();
    state.applied = defaults();
    syncDraftControls();
    const index = items.filter(matches).indexOf(item);
    state.page = Math.floor(index / PAGE_SIZE) + 1;
    writeUrl();
    render();
    return true;
  };
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href^="#"]');
    if (!anchor || anchor.closest('.cite-host')) return;
    let node;
    try { node = document.getElementById(decodeURIComponent(anchor.hash.slice(1))); } catch { node = null; }
    if (!node || !reveal(node)) return;
    event.preventDefault();
    const url = new URL(location.href);
    url.hash = anchor.hash;
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    node.scrollIntoView({ behavior: 'auto', block: 'start' });
  });
  const hydrated = restoreAppliedEntry(history.state);
  state.applied = hydrated.applied;
  state.draft = clone(state.applied);
  state.page = 1;
  restoreSortWithoutHistory(hydrated.sort);
  items.splice(0, items.length, ...table.tBodies[0].rows);
  writeUrl({ mode: 'replace', sort: hydrated.sort });
  syncDraftControls();
  render();
})();

/* REBUILD V2 — B-14 InfoDot / price-citation popover.
   The evidence pattern lets every price chip hang a popover
   carrying the check date and the source link. Progressive: the popover markup
   ships in the DOM (readable, crawlable, printable) and this only collapses it
   into a disclosure once JS is present. */
(() => {
  const dots = document.querySelectorAll('.cs-infodot[aria-controls]');
  if (!dots.length) return;
  const close = (dot) => {
    const pop = document.getElementById(dot.getAttribute('aria-controls'));
    if (!pop) return;
    pop.hidden = true;
    dot.setAttribute('aria-expanded', 'false');
  };
  for (const dot of dots) close(dot);
  document.addEventListener('click', (event) => {
    const dot = event.target.closest('.cs-infodot[aria-controls]');
    for (const other of dots) if (other !== dot) close(other);
    if (!dot) return;
    const pop = document.getElementById(dot.getAttribute('aria-controls'));
    if (!pop) return;
    const opening = pop.hidden;
    pop.hidden = !opening;
    dot.setAttribute('aria-expanded', opening ? 'true' : 'false');
    event.preventDefault();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const dot of dots) close(dot);
  });
})();

/* REBUILD V2 — B-15 compare-grid faceting.
   Query-param faceted, client-side, and additive only: every card ships in the
   DOM, so a filter changes what is SHOWN and never what the page contains. With
   JS off the grid is a complete, readable, crawlable list. */
(() => {
  const grid = document.querySelector('[data-compare-grid]');
  if (!grid) return;
  const cards = [...grid.children];
  const order = new Map(cards.map((card, index) => [card, index]));
  const state = { filter: 'all', sort: 'rank' };

  const press = (button, on) => {
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('is-active', on);
  };

  const apply = () => {
    for (const card of cards) {
      const shown = state.filter === 'all'
        || [...card.querySelectorAll('.cs-medgrid__row')].some((row) => row.dataset.medication === state.filter);
      card.hidden = !shown;
    }
    const sorted = [...cards].sort((left, right) => {
      if (state.sort !== 'cheapest') return order.get(left) - order.get(right);
      const a = Number(left.dataset.price);
      const b = Number(right.dataset.price);
      if (!Number.isFinite(a) && !Number.isFinite(b)) return order.get(left) - order.get(right);
      if (!Number.isFinite(a)) return 1;
      if (!Number.isFinite(b)) return -1;
      return a - b || order.get(left) - order.get(right);
    });
    for (const card of sorted) grid.append(card);
    const url = new URL(location.href);
    if (state.filter === 'all') url.searchParams.delete('drug'); else url.searchParams.set('drug', state.filter);
    if (state.sort === 'rank') url.searchParams.delete('sort'); else url.searchParams.set('sort', state.sort);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  };

  for (const button of document.querySelectorAll('[data-compare-filter]')) {
    button.addEventListener('click', () => {
      state.filter = button.dataset.compareFilter;
      for (const other of document.querySelectorAll('[data-compare-filter]')) press(other, other === button);
      apply();
    });
  }
  for (const button of document.querySelectorAll('[data-compare-sort]')) {
    button.addEventListener('click', () => {
      state.sort = button.dataset.compareSort;
      for (const other of document.querySelectorAll('[data-compare-sort]')) press(other, other === button);
      apply();
    });
  }
  const params = new URLSearchParams(location.search);
  const drug = params.get('drug');
  const sort = params.get('sort');
  if (drug) {
    const button = document.querySelector(`[data-compare-filter="${CSS.escape(drug)}"]`);
    if (button) { state.filter = drug; for (const other of document.querySelectorAll('[data-compare-filter]')) press(other, other === button); }
  }
  if (sort === 'cheapest') {
    const button = document.querySelector('[data-compare-sort="cheapest"]');
    if (button) { state.sort = 'cheapest'; for (const other of document.querySelectorAll('[data-compare-sort]')) press(other, other === button); }
  }
  if (drug || sort) apply();
})();

/* REBUILD V2 — sticky compare tray. Selection is bounded, local to the page,
   and operated entirely through native buttons so pointer, Enter, and Space all
   share the same path. */
(() => {
  const tray = document.querySelector('[data-compare-tray]');
  const addButtons = [...document.querySelectorAll('[data-compare-add]')];
  if (!tray || !addButtons.length) return;
  const slots = tray.querySelector('.cs-tray__slots');
  const count = tray.querySelector('.cs-tray__count');
  const selected = new Map();

  const render = () => {
    slots.replaceChildren();
    for (const [program, name] of selected) {
      const item = document.createElement('li');
      item.className = 'cs-tray__slot';
      item.dataset.compareItem = program;
      const label = document.createElement('span');
      label.textContent = name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cs-tray__remove';
      remove.dataset.compareRemove = program;
      remove.setAttribute('aria-label', `Remove ${name} from comparison`);
      remove.textContent = '×';
      item.append(label, remove);
      slots.append(item);
    }
    count.textContent = `${selected.size} of 4 selected`;
    tray.classList.toggle('is-open', selected.size > 0);
    for (const button of addButtons) {
      const active = selected.has(button.dataset.program);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.textContent = active ? 'Added to compare' : 'Add to compare';
      button.disabled = !active && selected.size >= 4;
    }
  };

  for (const button of addButtons) {
    button.addEventListener('click', () => {
      const program = button.dataset.program;
      if (selected.has(program)) selected.delete(program);
      else if (selected.size < 4) selected.set(program, button.dataset.providerName || program);
      render();
    });
  }
  tray.addEventListener('click', (event) => {
    const button = event.target.closest('[data-compare-remove]');
    if (!button) return;
    selected.delete(button.dataset.compareRemove);
    render();
  });
  render();
})();

/* REBUILD V2 — B-15 compare-grid disclosure. Every card is in the DOM; the
   button reveals the ones a phone should not be asked to paint up front. */
(() => {
  const button = document.querySelector('[data-compare-more]');
  const grid = document.querySelector('[data-compare-grid]');
  if (!button || !grid) return;
  button.addEventListener('click', () => {
    for (const card of grid.children) card.removeAttribute('data-cmp-hidden');
    button.remove();
  });
})();

/* ============================================================================
   ULTRACODE SHELL 2026-08-21 — runtime for the redesigned shell.
   Every class these controllers touch is styled by assets/css-src/02-shell.css
   (or 00/01); every controller binds only when its markup exists, so templates
   that have not adopted the new shell keep exactly their old behavior. Motion
   is CSS-transition-driven (timings live in the stylesheet, reduced-motion
   handled by the 00-foundation kill switch); this file only flips state.
   ========================================================================== */

/* ---- body.cs-scrolled: condensed-header scroll state (rAF-throttled) ------ */
(() => {
  let frame = 0;
  const sync = () => {
    frame = 0;
    const scrolled = window.scrollY > 8;
    document.body.classList.toggle('cs-scrolled', scrolled);
    document.querySelector('.gcs-nav')?.classList.toggle('is-condensed', window.scrollY > 64);
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(sync); };
  // Initial documents are emitted in their unscrolled state. Avoid forcing the
  // first full-page layout solely to confirm scrollY === 0; the first real
  // scroll/resize event synchronizes restored or user-moved pages.
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
})();

/* ---- .cs-navgroup dropdowns: hover-first glass menus ----------------------
   Fine-pointer readers open menus by hover; keyboard/touch readers retain the
   same aria-expanded state through focus and click. */
(() => {
  const groups = [...document.querySelectorAll('.cs-navgroup')]
    .map((group) => ({ group, button: group.querySelector(':scope > button'), menu: group.querySelector(':scope > .cs-navmenu') }))
    .filter((entry) => entry.button && entry.menu);
  if (!groups.length) return;
  const hoverMode = window.matchMedia('(hover: hover) and (pointer: fine)');
  let open = null;
  let closeTimer = 0;
  const close = ({ returnFocus = false } = {}) => {
    clearTimeout(closeTimer);
    closeTimer = 0;
    if (!open) return;
    open.button.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('cs-navmenu-open');
    if (returnFocus) open.button.focus();
    open = null;
  };
  const show = (entry) => {
    clearTimeout(closeTimer);
    closeTimer = 0;
    if (open === entry) return;
    close();
    entry.button.setAttribute('aria-expanded', 'true');
    document.body.classList.add('cs-navmenu-open');
    open = entry;
  };
  const scheduleClose = (entry) => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (open === entry) close(); }, 110);
  };
  for (const entry of groups) {
    entry.button.setAttribute('aria-expanded', 'false');
    entry.button.setAttribute('aria-haspopup', 'true');
    entry.group.addEventListener('pointerenter', () => { if (hoverMode.matches) show(entry); });
    entry.group.addEventListener('pointerleave', () => { if (hoverMode.matches) scheduleClose(entry); });
    entry.button.addEventListener('focus', () => show(entry));
    entry.button.addEventListener('click', () => {
      if (hoverMode.matches) { show(entry); return; }
      const wasOpen = open === entry;
      close();
      if (!wasOpen) show(entry);
    });
    entry.group.addEventListener('focusout', (event) => {
      // Keyboard focus leaving the group is unambiguous: close synchronously so
      // the menu cannot remain over the newly focused control. Pointer hover
      // keeps the small forgiveness delay above for diagonal movement.
      if (open === entry && event.relatedTarget && !entry.group.contains(event.relatedTarget)) close();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) close({ returnFocus: true });
  });
  document.addEventListener('pointerdown', (event) => {
    if (open && !event.target.closest('.cs-navgroup')) close();
  });
})();

/* ---- .cs-drawer: mobile navigation drawer ---------------------------------
   Focus-trapped while open, body scroll locked via body.cs-drawer-open,
   closed by Escape / scrim / outside press / choosing a route, and focus is
   restored to wherever the reader was. */
(() => {
  const toggle = document.querySelector('.cs-menu-toggle');
  const drawer = document.querySelector('.cs-drawer');
  if (!toggle || !drawer) return;
  const closeButton = drawer.querySelector('[data-menu-close]');
  if (!drawer.id) drawer.id = 'cs-drawer';
  if (!drawer.hasAttribute('tabindex')) drawer.setAttribute('tabindex', '-1');
  toggle.setAttribute('aria-controls', drawer.id);
  toggle.setAttribute('aria-expanded', 'false');
  // renderer:shell integration — the drawer ships SSR'd on every page with
  // `hidden` as its resting state (display:none): desktop never sees the
  // block un-styled outside 02-shell's mobile media query, and a CLOSED drawer
  // keeps its links out of the tab order. open()/close() animate through the
  // attribute: remove -> reflow -> .is-open; on close, re-hide after the
  // transform transition settles (transitionend, with a timer fallback so a
  // cancelled transition can never leave a phantom drawer in the tab order).
  if (!drawer.classList.contains('is-open')) drawer.hidden = true;
  let hideTimer = 0;
  const settleHidden = () => {
    clearTimeout(hideTimer);
    hideTimer = 0;
    if (!drawer.classList.contains('is-open')) drawer.hidden = true;
  };
  drawer.addEventListener('transitionend', (event) => {
    if (event.target === drawer && hideTimer) settleHidden();
  });
  let scrim = document.querySelector('.cs-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'cs-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    drawer.before(scrim);
  }
  let lastFocus = null;
  const sectionToggles = [...drawer.querySelectorAll('[data-drawer-section-toggle]')];
  const setSection = (button, expanded) => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel || !drawer.contains(panel)) return;
    button.setAttribute('aria-expanded', String(expanded));
    panel.hidden = !expanded;
  };
  sectionToggles.forEach((button) => {
    setSection(button, button.getAttribute('aria-expanded') === 'true');
    button.addEventListener('click', () => setSection(button, button.getAttribute('aria-expanded') !== 'true'));
  });
  const focusables = () => [...drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.getClientRects().length > 0);
  const isOpen = () => drawer.classList.contains('is-open');
  const trap = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close({ returnFocus: true }); return; }
    if (event.key !== 'Tab') return;
    const nodes = focusables();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const inside = drawer.contains(document.activeElement);
    if (event.shiftKey && (!inside || document.activeElement === first)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (!inside || document.activeElement === last)) { event.preventDefault(); first.focus(); }
  };
  const onOutside = (event) => {
    if (!drawer.contains(event.target) && !toggle.contains(event.target)) close();
  };
  const open = () => {
    if (isOpen()) return;
    clearTimeout(hideTimer);
    hideTimer = 0;
    lastFocus = document.activeElement;
    drawer.hidden = false;
    drawer.getBoundingClientRect(); // reflow so the slide-in transition plays
    drawer.classList.add('is-open');
    scrim.classList.add('is-open');
    document.body.classList.add('cs-drawer-open');
    window.CS_MOTION?.stop();
    toggle.setAttribute('aria-expanded', 'true');
    (focusables()[0] || drawer).focus({ preventScroll: true });
    document.addEventListener('keydown', trap, true);
    document.addEventListener('pointerdown', onOutside, true);
  };
  const close = ({ returnFocus = false } = {}) => {
    if (!isOpen()) return;
    drawer.classList.remove('is-open');
    scrim.classList.remove('is-open');
    document.body.classList.remove('cs-drawer-open');
    window.CS_MOTION?.start();
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', trap, true);
    document.removeEventListener('pointerdown', onOutside, true);
    clearTimeout(hideTimer);
    if (document.documentElement.dataset.inputModality === 'keyboard') settleHidden();
    else hideTimer = setTimeout(settleHidden, 240);
    if (returnFocus) (lastFocus instanceof HTMLElement ? lastFocus : toggle).focus();
  };
  toggle.addEventListener('click', () => (isOpen() ? close({ returnFocus: true }) : open()));
  closeButton?.addEventListener('click', () => close({ returnFocus: true }));
  scrim.addEventListener('click', () => close());
  drawer.addEventListener('click', (event) => {
    if (event.target.closest('a[href]')) close();
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', (event) => { if (event.matches) close(); });
})();

/* ---- .cs-search: local search over search-index.json -----------------------
   The query never leaves the page. Desktop expands inside the header; W18 turns
   the same panel into a focus-contained 390px search sheet and locks page scroll. */
(() => {
  const toggle = document.querySelector('.cs-search-toggle');
  if (!toggle) return;
  const root = toggle.closest('.cs-search') || toggle.parentElement;
  let panel = root?.querySelector('.cs-search-panel') || document.querySelector('.cs-search-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'cs-search-panel';
    panel.id = 'cs-header-search';
    root?.append(panel);
  }
  panel.setAttribute('role', 'search');
  panel.setAttribute('aria-label', 'Search Clinic Scout');
  panel.removeAttribute('aria-modal');
  if (!panel.classList.contains('is-open')) panel.hidden = true;
  let hideTimer = 0;
  const settleHidden = () => {
    clearTimeout(hideTimer);
    hideTimer = 0;
    if (!panel.classList.contains('is-open')) panel.hidden = true;
  };
  panel.addEventListener('transitionend', (event) => {
    if (event.target === panel && hideTimer) settleHidden();
  });

  let box = panel.querySelector('.cs-search-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'cs-search-box';
    panel.append(box);
  }
  let closeButton = box.querySelector('button[data-search-close]');
  if (!closeButton) {
    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'cs-search-back';
    closeButton.setAttribute('data-search-close', '');
    closeButton.setAttribute('aria-label', 'Close search and clear');
    closeButton.textContent = '←';
    box.append(closeButton);
  }
  let input = box.querySelector('input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    box.append(input);
  }
  input.placeholder = 'Search providers or pharmacies';
  input.setAttribute('aria-label', 'Search providers or pharmacies');
  let status = box.querySelector('.cs-search-status');
  if (!status) {
    status = document.createElement('span');
    status.className = 'cs-search-status';
    status.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement('span');
      dot.className = 'cs-dot';
      status.append(dot);
    }
    box.append(status);
  }
  let results = panel.querySelector('.cs-search-results');
  if (!results) {
    results = document.createElement('div');
    results.className = 'cs-search-results';
    panel.append(results);
  }
  const live = document.createElement('span');
  live.className = 'cs-search-live';
  live.setAttribute('role', 'status');
  panel.append(live);
  toggle.setAttribute('aria-controls', panel.id || 'cs-header-search');
  toggle.setAttribute('aria-expanded', 'false');

  let indexPromise = null;
  const loadIndex = () => {
    indexPromise = indexPromise || fetch('/assets/search-index.json', { credentials: 'omit' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('search_index_' + response.status))))
      .then((data) => (Array.isArray(data.entries) ? data.entries : []))
      .catch(() => []);
    return indexPromise;
  };
  /* Design pass 2026-08-26 (home spec fix #12): typeahead quick-links on focus.
     Before a query exists, the panel offers the seven owned MEDICATION ROUTES
     (route taxonomy, not a provider list — providers stay data-driven through
     the search index). Self-contained: no request is needed to render these. */
  const QUICK_ROUTES = [
    ['Compounded semaglutide', '/lp/best-providers/compounded-semaglutide/'],
    ['Compounded tirzepatide', '/lp/best-providers/compounded-tirzepatide/'],
    ['Ozempic', '/ozempic/'],
    ['Wegovy pill', '/wegovy-pill/'],
    ['Wegovy', '/wegovy/'],
    ['Mounjaro', '/mounjaro/'],
    ['Zepbound', '/zepbound/'],
  ];
  const renderQuickLinks = () => {
    cursor = -1;
    results.replaceChildren();
    const summary = document.createElement('p');
    summary.className = 'cs-search-summary';
    summary.textContent = 'Popular medication routes';
    results.append(summary);
    /* ADOPTED (design pass 2026-08-27, Phase-2 selection #3): transitions.dev
       free-tier input-expand pattern (commercial use + modification permitted)
       — typeahead rows stagger 20ms, but ONLY on this panel-open render.
       Typed re-renders (render()/showSearching()) never animate per item
       (Kowalski filter B2), and any keyboard-driven path is killed outright by
       the 00-foundation input-modality rule (filter B4). */
    QUICK_ROUTES.forEach(([label, url], index) => {
      const hit = document.createElement('a');
      hit.className = 'cs-search-hit cs-search-hit--enter';
      hit.style.animationDelay = `${index * 20}ms`;
      hit.href = url;
      const badge = document.createElement('span');
      badge.className = 'cs-search-type';
      badge.textContent = 'Route';
      const title = document.createElement('span');
      title.className = 'cs-search-hit__title';
      title.textContent = label;
      hit.append(badge, title);
      results.append(hit);
    });
    live.textContent = 'Popular medication routes shown';
  };
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
  const highlight = (text, terms) => {
    const fragment = document.createDocumentFragment();
    const pattern = terms.map(escapePattern).join('|');
    if (!pattern) { fragment.append(text); return fragment; }
    let last = 0;
    for (const match of text.matchAll(new RegExp(pattern, 'gi'))) {
      if (match.index > last) fragment.append(text.slice(last, match.index));
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      fragment.append(mark);
      last = match.index + match[0].length;
    }
    fragment.append(text.slice(last));
    return fragment;
  };
  const rankOf = (entry, terms) => {
    const title = String(entry.title || '').toLowerCase();
    const body = (String(entry.description || '') + ' ' + String(entry.url || '')).toLowerCase();
    let rank = 0;
    for (const term of terms) {
      if (title.startsWith(term)) rank += 0;
      else if (title.includes(term)) rank += 1;
      else if (body.includes(term)) rank += 3;
      else return -1;
    }
    return rank;
  };

  let cursor = -1;
  const hits = () => [...results.querySelectorAll('.cs-search-hit')];
  const setCursor = (next) => {
    const all = hits();
    cursor = all.length ? Math.max(0, Math.min(next, all.length - 1)) : -1;
    all.forEach((hit, index) => hit.classList.toggle('is-cursor', index === cursor));
    if (cursor >= 0) all[cursor].scrollIntoView({ block: 'nearest' });
  };
  const stopSearching = () => {};
  const showSearching = () => {
    stopSearching();
    results.replaceChildren();
    const state = document.createElement('div');
    state.className = 'cs-search-loading';
    const title = document.createElement('strong');
    title.textContent = 'Searching Clinic Scout';
    const note = document.createElement('span');
    note.textContent = 'Providers, pharmacies, guides, and prices';
    state.append(title, note);
    /* ADOPTED (design pass 2026-08-27, Phase-2 selection #1): shadcn Skeleton
       pattern (MIT) — placeholder rows in the exact .cs-search-hit geometry
       (02-shell.css) while the index resolves, so real hits land in the same
       boxes. Decorative only: the live region above stays the announcement. */
    const skeleton = document.createElement('div');
    skeleton.className = 'cs-search-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index += 1) {
      const row = document.createElement('div');
      row.className = 'cs-search-hit--skeleton';
      for (const part of ['cs-search-type-skeleton', 'cs-search-title-skeleton', 'cs-search-meta-skeleton']) {
        const block = document.createElement('span');
        block.className = `cs-skeleton ${part}`;
        row.append(block);
      }
      skeleton.append(row);
    }
    state.append(skeleton);
    results.append(state);
    live.textContent = 'Searching';
  };
  const render = (entries, rawQuery) => {
    stopSearching();
    cursor = -1;
    results.replaceChildren();
    const query = rawQuery.trim().toLowerCase();
    if (!query) { live.textContent = ''; return; }
    const terms = query.split(/\s+/).filter(Boolean);
    const ranked = entries
      .map((entry) => ({ entry, rank: rankOf(entry, terms) }))
      .filter((item) => item.rank >= 0)
      .sort((left, right) => left.rank - right.rank || String(left.entry.title).localeCompare(String(right.entry.title)))
      .slice(0, 12);
    if (!ranked.length) {
      const none = document.createElement('div');
      none.className = 'cs-search-empty';
      const icon = document.createElement('span');
      icon.className = 'cs-search-empty__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⌁';
      const title = document.createElement('strong');
      title.textContent = 'No match yet';
      const note = document.createElement('span');
      note.textContent = 'Try a provider, pharmacy, medication, or a word like “cost”.';
      none.append(icon, title, note);
      results.append(none);
      live.textContent = 'No matching pages';
      return;
    }
    const summary = document.createElement('p');
    summary.className = 'cs-search-summary';
    summary.textContent = `${ranked.length} ${ranked.length === 1 ? 'result' : 'results'}`;
    results.append(summary);
    for (const { entry } of ranked) {
      const hit = document.createElement('a');
      hit.className = 'cs-search-hit';
      hit.href = entry.url;
      const badge = document.createElement('span');
      badge.className = 'cs-search-type';
      badge.textContent = String(entry.family || 'Page');
      const title = document.createElement('span');
      title.className = 'cs-search-hit__title';
      title.append(highlight(String(entry.title || entry.url), terms));
      hit.append(badge, title);
      const meta = [entry.description, entry.date ? 'updated ' + entry.date : '']
        .map((part) => String(part || '').trim()).filter(Boolean).join(' · ');
      if (meta) {
        const small = document.createElement('small');
        small.textContent = meta;
        hit.append(small);
      }
      results.append(hit);
    }
    live.textContent = `${ranked.length} ${ranked.length === 1 ? 'result' : 'results'}`;
  };

  let debounceTimer = 0;
  let searchSequence = 0;
  const run = () => {
    const sequence = ++searchSequence;
    const query = input.value;
    loadIndex().then((entries) => {
      if (sequence !== searchSequence) return;
      panel.classList.remove('is-searching');
      render(entries, query);
    });
  };
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    if (!input.value.trim()) {
      searchSequence += 1;
      panel.classList.remove('is-searching');
      stopSearching();
      renderQuickLinks();
      return;
    }
    panel.classList.add('is-searching');
    showSearching();
    debounceTimer = setTimeout(run, 160);
  });

  let lastFocus = null;
  let motionStopped = false;
  const desktop = window.matchMedia('(min-width: 901px)');
  const openPanel = () => {
    if (panel.classList.contains('is-open')) return;
    clearTimeout(hideTimer);
    hideTimer = 0;
    lastFocus = document.activeElement;
    panel.hidden = false;
    panel.getBoundingClientRect();
    panel.classList.add('is-open');
    document.body.classList.add('cs-search-open');
    toggle.setAttribute('aria-expanded', 'true');
    if (!desktop.matches) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Search Clinic Scout');
    }
    if (window.CS_MOTION) {
      window.CS_MOTION.stop();
      motionStopped = true;
    }
    input.focus({ preventScroll: true });
    input.select();
    loadIndex();
    if (!input.value.trim()) renderQuickLinks();
  };
  const closePanel = ({ returnFocus = false } = {}) => {
    if (!panel.classList.contains('is-open')) return;
    panel.classList.remove('is-open', 'is-searching');
    document.body.classList.remove('cs-search-open');
    panel.setAttribute('role', 'search');
    panel.removeAttribute('aria-modal');
    toggle.setAttribute('aria-expanded', 'false');
    clearTimeout(debounceTimer);
    searchSequence += 1;
    input.value = '';
    stopSearching();
    results.replaceChildren();
    live.textContent = '';
    if (motionStopped) window.CS_MOTION?.start();
    motionStopped = false;
    clearTimeout(hideTimer);
    if (document.documentElement.dataset.inputModality === 'keyboard') settleHidden();
    else hideTimer = setTimeout(settleHidden, 240);
    if (returnFocus) (lastFocus instanceof HTMLElement ? lastFocus : toggle).focus();
  };
  toggle.addEventListener('click', () => (panel.classList.contains('is-open') ? closePanel({ returnFocus: true }) : openPanel()));
  closeButton.addEventListener('click', () => closePanel({ returnFocus: true }));
  document.addEventListener('pointerdown', (event) => {
    if (panel.classList.contains('is-open') && root && !root.contains(event.target)) closePanel();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closePanel({ returnFocus: true }); return; }
    if (event.key === 'Tab' && !desktop.matches) {
      const nodes = [...panel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter((node) => node.getClientRects().length > 0);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(cursor + 1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(cursor - 1); return; }
    if (event.key === 'Enter' && event.target === input) {
      const all = hits();
      const target = all[cursor >= 0 ? cursor : 0];
      if (target) { event.preventDefault(); target.click(); }
    }
  });
  /* Result links keep their native browser navigation. Pass 3 forbids a
     transition screen or delayed location owner. */
})();

/* ---- [data-price-roll]: truthful numeric state -----------------------------
   The server-rendered value remains authoritative. User-triggered price changes
   may tween for 600ms through the shared GSAP owner; reduced motion and missing
   runtime paths always paint the final value immediately. */
(() => {
  const paint = (el) => {
    const target = el.getAttribute('data-value');
    if (target !== null) el.textContent = target;
  };
  document.querySelectorAll('[data-price-roll]').forEach(paint);
  new MutationObserver((mutations) => mutations.forEach((mutation) => paint(mutation.target)))
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-value'] });
})();

/* ---- [data-counter-to]: count-up on stats ---------------------------------
   BUILT IN-HOUSE (design pass 2026-08-27, Phase-2 selection #7): native GSAP
   number tween — no counter library shipped anywhere (menu-A negative
   finding), and the 2026-08-27 audit found the home markup already carries
   data-counter-to with NO runtime in site.js/motion.js, so this IS the
   upgrade, not a duplicate (the calculator anchor keeps its own page runtime
   in src/cost-calculator.mjs, reconciled to the same 600ms contract).
   600ms, once, on-enter; tabular-nums via 01-primitives; reduced motion or a
   missing GSAP leaves the final value that is already server-rendered. */
(() => {
  const counters = [...document.querySelectorAll('[data-counter-to]')];
  if (!counters.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bind = () => {
    const gsap = window.CS_MOTION?.gsap || window.gsap;
    if (!gsap || !('IntersectionObserver' in window)) return false;
    const animate = (el) => {
      const target = Number(el.getAttribute('data-counter-to'));
      if (!Number.isFinite(target) || target <= 0) return;
      const proxy = { value: 0 };
      el.textContent = '0';
      let tween;
      let deadline;
      const finish = () => {
        clearTimeout(deadline);
        tween?.kill();
        el.textContent = target.toLocaleString('en-US');
      };
      tween = gsap.to(proxy, {
        value: target,
        duration: 0.6,
        ease: 'power2.out',
        snap: { value: 1 },
        onUpdate: () => { el.textContent = Math.round(proxy.value).toLocaleString('en-US'); },
        onComplete: finish,
      });
      // Frame throttling must not strand an intermediate displayed count.
      deadline = setTimeout(finish, 600);
    };
    const seen = new WeakSet();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || seen.has(entry.target)) continue;
        seen.add(entry.target);
        observer.unobserve(entry.target);
        animate(entry.target);
      }
    }, { threshold: 0.6 });
    counters.forEach((el) => observer.observe(el));
    return true;
  };
  if (!bind()) window.addEventListener('gcs:motion-ready', bind, { once: true });
})();

/* ---- W5 / D17: one sitewide subscribe bottom sheet ---------------------- */
(() => {
  const layer = document.querySelector('[data-subscribe-layer]');
  const sheet = layer?.querySelector('.cs-subscribe-sheet');
  const form = layer?.querySelector('[data-subscribe-form]');
  if (!layer || !sheet || !form) return;
  const status = form.querySelector('.cs-subscribe-status');
  const email = form.elements.email;
  const submit = form.querySelector('button[type="submit"]');
  let lastFocus = null;
  let closeTimer = 0;
  let motionStopped = false;

  const open = (trigger) => {
    clearTimeout(closeTimer);
    lastFocus = trigger || document.activeElement;
    layer.hidden = false;
    layer.getBoundingClientRect();
    layer.classList.add('is-open');
    document.body.classList.add('cs-subscribe-open');
    if (window.CS_MOTION) {
      window.CS_MOTION.stop();
      motionStopped = true;
    }
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 700px)').matches;
    if (coarsePointer) sheet.querySelector('[data-subscribe-close]')?.focus({ preventScroll: true });
    else email?.focus({ preventScroll: true });
  };
  const close = ({ returnFocus = true } = {}) => {
    if (layer.hidden) return;
    layer.classList.remove('is-open');
    document.body.classList.remove('cs-subscribe-open');
    if (motionStopped) window.CS_MOTION?.start();
    motionStopped = false;
    clearTimeout(closeTimer);
    if (document.documentElement.dataset.inputModality === 'keyboard') layer.hidden = true;
    else closeTimer = setTimeout(() => { layer.hidden = true; }, 240);
    if (returnFocus && lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-subscribe-open],[data-newsletter-open]');
    if (trigger) { event.preventDefault(); open(trigger); return; }
    if (event.target.closest('[data-subscribe-close]')) close();
  });
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    status.textContent = 'Saving your subscription…';
    const values = Object.fromEntries(new FormData(form).entries());
    values.email_consent = true;
    values.source_surface = 'sitewide-price-watch';
    try {
      const response = await fetch('/api/newsletter-subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.status || 'subscribe_failed');
      form.reset();
      status.textContent = 'You’re subscribed. Watch your inbox for the next price update.';
      setTimeout(() => close({ returnFocus: false }), 1600);
    } catch {
      status.textContent = 'We could not save that yet. Please try again.';
    } finally {
      submit.disabled = false;
    }
  });
})();

/* ---- W6 / D30: returning-session welcome toast -------------------------- */
(() => {
  const VISIT_KEY = 'gcs.visit.v1';
  const SESSION_KEY = 'gcs.visit.session.v1';
  const SESSION_MARKER = ':gcs-visit-session-v1:';
  let previous = null;
  try { previous = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null'); } catch { previous = null; }
  let sessionSeen = false;
  try {
    sessionSeen = sessionStorage.getItem(SESSION_KEY) === 'active';
    sessionStorage.setItem(SESSION_KEY, 'active');
  } catch { /* window.name fallback below keeps internal navigation quiet */ }
  const namedSessionSeen = String(window.name || '').includes(SESSION_MARKER);
  sessionSeen = sessionSeen || namedSessionSeen;
  if (!namedSessionSeen) {
    try { window.name = `${window.name || ''}${SESSION_MARKER}`; } catch { /* best-effort fallback */ }
  }
  const now = Date.now();
  const previousSeenAt = Number(previous?.lastSeenAt);
  const returnWindow = Number.isFinite(previousSeenAt) && previousSeenAt > 0
    && now >= previousSeenAt && now - previousSeenAt <= 30 * 24 * 60 * 60 * 1000;
  let sameOriginReferrer = false;
  try { sameOriginReferrer = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin; } catch { sameOriginReferrer = false; }
  const returningSession = !sessionSeen && !sameOriginReferrer && returnWindow;
  const lastPath = typeof previous?.lastPath === 'string' && previous.lastPath.startsWith('/') ? previous.lastPath : null;
  const lastTitle = typeof previous?.lastTitle === 'string' ? previous.lastTitle.slice(0, 80) : '';
  const persist = () => {
    try { localStorage.setItem(VISIT_KEY, JSON.stringify({ lastPath: location.pathname, lastTitle: document.title, lastSeenAt: Date.now() })); } catch { /* storage is optional */ }
  };
  addEventListener('pagehide', persist, { once: true });
  persist();
  /* A returning-session prompt must not cover the active provider-fit form.
     The quiz already owns the viewport and its primary Next action; resume
     context remains available after the reader leaves this route. */
  if (!returningSession || location.pathname === '/quiz/provider-fit/') return;

  const toast = document.createElement('aside');
  toast.className = 'cs-welcome-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const copy = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = 'Welcome back.';
  copy.append(strong, document.createTextNode(' Pick up where you left off.'));
  toast.append(copy);
  if (lastPath && lastPath !== location.pathname) {
    const resume = document.createElement('a');
    resume.href = lastPath;
    resume.textContent = lastTitle ? `Continue: ${lastTitle.replace(/\s*[·|].*$/, '')}` : 'Continue reading';
    toast.append(resume);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss welcome message');
  close.textContent = '×';
  toast.append(close);
  toast.classList.add('is-visible');
  document.body.append(toast);
  // Consent has priority, but must not intercept the ordinary Continue link.
  // Its height changes with preferences/viewport: reserve the actual banner
  // bounds independently of the mobile-only page-content clearance.
  const placeToast = () => {
    const banner = document.querySelector('#gcs-consent');
    const bounds = banner?.getBoundingClientRect();
    const clearance = bounds?.height ? Math.max(0, innerHeight - bounds.top + 12) : 0;
    toast.style.bottom = `max(18px, env(safe-area-inset-bottom), ${clearance}px)`;
  };
  const consentSize = new ResizeObserver(placeToast);
  const watchConsent = () => {
    consentSize.disconnect();
    const banner = document.querySelector('#gcs-consent');
    if (banner) consentSize.observe(banner);
    placeToast();
  };
  const consentTree = new MutationObserver(watchConsent);
  consentTree.observe(document.body, { childList: true });
  addEventListener('resize', placeToast, { passive: true });
  watchConsent();
  const hide = () => {
    consentTree.disconnect();
    consentSize.disconnect();
    removeEventListener('resize', placeToast);
    toast.classList.remove('is-visible');
    if (document.documentElement.dataset.inputModality === 'keyboard') toast.remove();
    else setTimeout(() => toast.remove(), 240);
  };
  close.addEventListener('click', hide);
  addEventListener('scroll', hide, { once: true, passive: true });
  /* ADOPTED (design pass 2026-08-27, Phase-2 selection #6): timed-toast
     contract from the shadcn/Design-System-Checklist recipe set (paraphrased
     criterion, no code copied): a timed toast PAUSES its dismiss timer while
     hovered or focused, and the remaining time resumes on leave — the reader
     who is reading or tabbing into "Continue" never has it vanish mid-use. */
  const TOAST_LIFETIME = 7000;
  let remaining = TOAST_LIFETIME;
  let startedAt = Date.now();
  let dismissTimer = setTimeout(hide, remaining);
  let hovered = false;
  let focused = false;
  const pause = () => {
    if (!dismissTimer) return;
    clearTimeout(dismissTimer);
    dismissTimer = 0;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };
  const resume = () => {
    if (hovered || focused || dismissTimer || !toast.isConnected) return;
    startedAt = Date.now();
    dismissTimer = setTimeout(hide, Math.max(remaining, 1000));
  };
  toast.addEventListener('mouseenter', () => { hovered = true; pause(); });
  toast.addEventListener('focusin', () => { focused = true; pause(); });
  toast.addEventListener('mouseleave', () => { hovered = false; resume(); });
  toast.addEventListener('focusout', (event) => {
    if (toast.contains(event.relatedTarget)) return;
    focused = false;
    resume();
  });
})();

/* ---- W7 / D50: state detection and reusable H1 personalization ---------- */
(() => {
  const STORAGE_KEY = 'gcs.state.v1';
  const STATES = Object.freeze({
    AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', DC:'District of Columbia'
  });
  const targets = [...document.querySelectorAll('[data-state-title-template]')];
  let selected = null;
  try { const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); if (STATES[stored?.state]) selected = stored.state; } catch { selected = null; }
  const stateDefaultTitles = new Map(targets.map(target => [target, target.textContent]));
  const apply = (code, source = 'reader') => {
    if (code === '') {
      selected = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage optional */ }
      for (const target of targets) target.textContent = stateDefaultTitles.get(target);
      for (const select of document.querySelectorAll('[data-state-select]')) select.value = '';
      dispatchEvent(new CustomEvent('cs:statechange', { detail: { state: '', source } }));
      return true;
    }
    if (!STATES[code]) return false;
    selected = code;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: code, source, selectedAt: Date.now() })); } catch { /* storage optional */ }
    for (const target of targets) {
      const template = target.dataset.stateTitleTemplate || '';
      const product = target.dataset.stateProduct || '';
      target.textContent = template.replaceAll('{state}', STATES[code]).replaceAll('{product}', product);
    }
    for (const select of document.querySelectorAll('[data-state-select]')) select.value = code;
    dispatchEvent(new CustomEvent('cs:statechange', { detail: { state: code, stateName: STATES[code], source } }));
    return true;
  };
  window.CS_STATE = Object.freeze({ get: () => selected, set: (code) => apply(String(code || '').toUpperCase(), 'reader'), states: STATES });
  const existingStateControl = document.querySelector('[data-state-open]') || document.querySelector('[data-sponsor-preview-filters] [data-state-native]');
  if (!targets.length && !existingStateControl) return;

  for (const target of targets) {
    if (existingStateControl) continue;
    const wrap = document.createElement('label');
    wrap.className = 'cs-state-chip';
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = 'Your state';
    const select = document.createElement('select');
    select.setAttribute('data-state-select', '');
    select.setAttribute('aria-label', 'Choose your state');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose state';
    select.append(placeholder);
    for (const [code, name] of Object.entries(STATES)) {
      const option = document.createElement('option'); option.value = code; option.textContent = name; select.append(option);
    }
    select.addEventListener('change', () => apply(select.value, 'reader'));
    wrap.append(dot, text, select);
    target.insertAdjacentElement('afterend', wrap);
  }
  if (selected) { apply(selected, 'stored'); return; }
  fetch('/api/geo-state', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((result) => { if (result?.available && STATES[result.state]) apply(result.state, 'cloudflare-geo'); })
    .catch(() => { /* graceful manual fallback remains visible */ });
})();



/* Legacy quiz answers must not survive in browser storage or personalize cards. */
(() => {
  const keys = ['gcs.quiz.provider-fit.preferences.v1', 'gcs.quiz.provider-fit.progress.v1'];
  for (const storage of ['localStorage', 'sessionStorage']) {
    for (const key of keys) {
      try { window[storage].removeItem(key); } catch { /* Storage may be unavailable. */ }
    }
  }
})();

/* ---- W9 / D53: verified coupon copy + palette confirmation toast -------- */
(() => {
  let toast = null; let timer = 0;
  const showToast = () => {
    if (!toast) { toast = document.createElement('div'); toast.className = 'cs-coupon-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.textContent = 'Coupon code copied — apply at checkout'; document.body.append(toast); }
    clearTimeout(timer); toast.classList.add('is-visible'); timer = setTimeout(() => toast.classList.remove('is-visible'), 5000);
  };
  const copy = async (code) => {
    try { await navigator.clipboard.writeText(code); }
    catch { const input = document.createElement('textarea'); input.value = code; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); }
  };
  // Provider cards can arrive after startup through the deferred payload path.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-coupon-copy][data-coupon-code]');
    if (!button) return;
    await copy(button.dataset.couponCode);
    button.classList.add('is-copied');
    showToast();
    setTimeout(() => button.classList.remove('is-copied'), 1200);
  });
})();


/* Phase 2 home interactions — D21, D29, D32, D34, W16 */
(function () {
  'use strict';

  const homeValue = document.querySelector('[data-home-value]');
  if (homeValue) {
    const lines = ['Compare reported monthly costs.', 'Explore insurance and self-pay paths.', 'Compare compounded treatment options.', 'See providers’ reported prior-authorization support.'];
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let valueIndex = 0;
    let valueTimer = 0;
    let valueTween = null;
    const valueToggle = document.querySelector('[data-home-value-toggle]');
    let valuePaused = false;
    const stopValueRotation = () => {
      window.clearInterval(valueTimer);
      valueTimer = 0;
      valueTween?.kill();
      valueTween = null;
      window.gsap?.set(homeValue, { clearProps: 'opacity,transform' });
    };
    const syncValueRotation = () => {
      stopValueRotation();
      if (valueToggle) {
        valueToggle.hidden = motionPreference.matches;
        valueToggle.textContent = valuePaused ? 'Play changing text' : 'Pause changing text';
        valueToggle.setAttribute('aria-pressed', String(valuePaused));
      }
      if (motionPreference.matches || document.hidden || valuePaused) return;
      valueTimer = window.setInterval(() => {
        if (!window.gsap) return;
        valueTween = window.gsap.timeline({ onComplete: () => { valueTween = null; } });
        valueTween.to(homeValue, { y: 24, opacity: 0.15, duration: 0.24, ease: 'power2.in' });
        valueTween.call(() => {
          valueIndex = (valueIndex + 1) % lines.length;
          homeValue.textContent = lines[valueIndex];
        });
        valueTween.fromTo(homeValue, { y: 24, opacity: 0.15 }, { y: 0, opacity: 1, duration: 0.36, ease: 'power2.out', immediateRender: false, clearProps: 'opacity,transform' });
      }, 3500);
    };
    valueToggle?.addEventListener('click', () => { valuePaused = !valuePaused; syncValueRotation(); });
    motionPreference.addEventListener('change', syncValueRotation);
    document.addEventListener('visibilitychange', syncValueRotation);
    syncValueRotation();
  }

  document.querySelectorAll('[data-med-track]').forEach((track) => {
    const viewport = track.closest('[data-med-viewport]');
    const section = track.closest('.cs-home2-meds');
    const cards = Array.from(track.querySelectorAll('[data-med-card]'));
    const prev = section?.querySelector('[data-med-prev]');
    const next = section?.querySelector('[data-med-next]');
    const dots = section?.querySelector('[data-med-dots]');
    const toggle = section?.querySelector('[data-med-toggle]');
    if (!viewport || !section || cards.length < 2) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pauseReasons = new Set();
    let index = 0;
    let autoplayTimer = 0;
    let interactionTimer = 0;

    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-roledescription', 'carousel');
    viewport.setAttribute('aria-label', 'Medication options');
    track.setAttribute('aria-live', 'off');

    /* R3 (operator ruling 2026-09-02, final): one visible pause/play control.
       'user' is a durable pause reason; hover/focus/interaction reasons still
       apply on top of it and clear on their own timers. Under reduced motion the
       rail is static/manual, so the control hides and prev/next remain. */
    const syncToggle = () => {
      if (!toggle) return;
      const userPaused = pauseReasons.has('user');
      toggle.hidden = motionPreference.matches; // markup ships hidden; only an initialised handler reveals it
      toggle.dataset.medToggleReady = 'true';
      toggle.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
      toggle.setAttribute('aria-label', userPaused ? 'Play the medication carousel' : 'Pause the medication carousel');
      toggle.dataset.medToggleState = userPaused ? 'paused' : 'playing';
      const label = toggle.querySelector('[data-med-toggle-label]');
      if (label) label.textContent = userPaused ? 'Play' : 'Pause';
    };
    const syncState = () => {
      const paused = motionPreference.matches || document.hidden || pauseReasons.size > 0;
      section.dataset.medRailState = paused ? 'paused' : 'playing';
      syncToggle();
      if (paused) {
        window.clearInterval(autoplayTimer);
        autoplayTimer = 0;
      } else if (!autoplayTimer) {
        autoplayTimer = window.setInterval(() => move(1), 3000);
      }
    };
    const pause = (reason) => {
      pauseReasons.add(reason);
      syncState();
    };
    const resume = (reason) => {
      pauseReasons.delete(reason);
      syncState();
    };
    const pauseForInteraction = () => {
      pause('interaction');
      window.clearTimeout(interactionTimer);
      interactionTimer = window.setTimeout(() => resume('interaction'), 3000);
    };

    const maxOffset = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
    const apply = () => {
      const peek = Math.min((cards[0]?.offsetWidth || 0) * 0.3, viewport.clientWidth * 0.14);
      const raw = (cards[index]?.offsetLeft - track.offsetLeft || 0) - peek;
      const offset = Math.max(0, Math.min(raw, maxOffset()));
      track.style.transform = `translate3d(${-offset}px,0,0)`;
      track.dataset.medActiveIndex = String(index);
      cards.forEach((card) => card.removeAttribute('aria-hidden'));
      dots?.querySelectorAll('button').forEach((dot, dotIndex) => dot.setAttribute('aria-current', dotIndex === index ? 'true' : 'false'));
    };
    const move = (delta) => {
      index = (index + delta + cards.length) % cards.length;
      apply();
    };
    const choose = (cardIndex) => {
      index = cardIndex;
      apply();
    };

    if (dots) cards.forEach((card, cardIndex) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Show ${card.querySelector('h3')?.textContent || `slide ${cardIndex + 1}`}`);
      dot.addEventListener('click', () => { choose(cardIndex); pauseForInteraction(); });
      dots.appendChild(dot);
    });
    prev?.addEventListener('click', () => { move(-1); pauseForInteraction(); });
    next?.addEventListener('click', () => { move(1); pauseForInteraction(); });
    toggle?.addEventListener('click', () => {
      if (pauseReasons.has('user')) resume('user'); else pause('user');
      syncToggle();
    });
    /* W9 G01 gesture contract: exactly one move per qualifying horizontal drag or swipe,
       both directions, wrapping through move(). Native link/image drag is suppressed so a
       mouse drag delivers pointerup instead of dragstart+pointercancel; pointermove is
       tracked so the decision uses the last observed point; a vertically dominant gesture
       never advances (touch-action: pan-y keeps native vertical scroll). */
    let dragStartX = null;
    let dragStartY = null;
    let dragLastX = null;
    let dragLastY = null;
    let dragPointerId = null;
    let suppressSwipeClick = false;
    viewport.addEventListener('dragstart', (event) => event.preventDefault());
    viewport.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragStartX = dragLastX = event.clientX;
      dragStartY = dragLastY = event.clientY;
      dragPointerId = event.pointerId;
      suppressSwipeClick = false;
      pause('drag');
      // No pointer capture: capturing on the viewport retargeted the click to the
      // viewport, so a plain mouse click on a card never reached its link. Release
      // outside the viewport is handled by the window listeners below.
    });
    window.addEventListener('pointermove', (event) => {
      if (event.pointerId !== dragPointerId || dragStartX == null) return;
      dragLastX = event.clientX;
      dragLastY = event.clientY;
    }, { passive: true });
    const endDrag = () => { dragStartX = dragStartY = dragLastX = dragLastY = null; dragPointerId = null; resume('drag'); };
    window.addEventListener('pointerup', (event) => {
      if (event.pointerId !== dragPointerId || dragStartX == null) return;
      const endX = Number.isFinite(event.clientX) ? event.clientX : dragLastX;
      const endY = Number.isFinite(event.clientY) ? event.clientY : dragLastY;
      const deltaX = endX - dragStartX;
      const deltaY = endY - dragStartY;
      endDrag();
      // Any real movement (>= 8px drag slop) is a drag, not a click: never let it navigate.
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) suppressSwipeClick = true;
      if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      move(deltaX > 0 ? -1 : 1);
      pauseForInteraction();
    });
    window.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('click', (event) => {
      if (!suppressSwipeClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressSwipeClick = false;
    }, true);
    section.addEventListener('pointerenter', () => pause('hover'));
    section.addEventListener('pointerleave', () => resume('hover'));
    section.addEventListener('focusin', (event) => {
      // Focus resting on the toggle itself releases the 'focus' pause so a keyboard
      // Play visibly resumes; any other focus inside the rail still pauses (R3).
      if (toggle && toggle.contains(event.target)) { resume('focus'); return; }
      pause('focus');
    });
    section.addEventListener('focusout', (event) => {
      if (!section.contains(event.relatedTarget)) resume('focus');
    });
    document.addEventListener('visibilitychange', syncState);
    motionPreference.addEventListener('change', syncState);
    /* Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #10): the rail
       auto-advanced while fully off-viewport (verified idx 0->2 while
       invisible), forcing layout reads + a transform write for nobody. The
       auto-advance is now gated through the EXISTING pause-reason machinery by
       an IntersectionObserver on the section; the interval expression itself
       (pinned by phase2-home.test) and every hover/focus/visibility/reduced-
       motion semantic are unchanged. */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry.isIntersecting) resume('offscreen');
        else pause('offscreen');
      }, { threshold: 0.05 }).observe(section);
    }
    window.addEventListener('resize', apply, { passive: true });
    apply();
    syncState();
  });

  /* Decorative product/category/card loops run continuously while visible, but
     pause once they leave the viewport. This preserves the operator's live
     motion doctrine without spending frames on an offscreen aurora. */
  const decorativeLoops = Array.from(document.querySelectorAll('.p3-product-float, .listing__drug-summary > figure.p3-product-visual, .p3-category-orb')); // GSAP owns card auroras in motion.js.
  if (decorativeLoops.length && 'IntersectionObserver' in window) {
    const decorativeMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const loopVisibility = new WeakMap();
    const syncLoop = (loop) => {
      const active = !decorativeMotionPreference.matches && !document.hidden && loopVisibility.get(loop) === true;
      loop.style.animationPlayState = active ? 'running' : 'paused';
    };
    const loopObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        loopVisibility.set(entry.target, entry.isIntersecting);
        syncLoop(entry.target);
      });
    }, { threshold: 0.02 });
    decorativeLoops.forEach((loop) => {
      loopVisibility.set(loop, false);
      loop.style.animationPlayState = 'paused';
      loopObserver.observe(loop);
    });
    document.addEventListener('visibilitychange', () => decorativeLoops.forEach(syncLoop));
    decorativeMotionPreference.addEventListener('change', () => decorativeLoops.forEach(syncLoop));
  }

  document.querySelectorAll('.cs-home2-marquee').forEach((section) => {
    const track = section.querySelector('.cs-home2-marquee__track');
    if (!track) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cs-btn cs-btn--quiet';
    toggle.dataset.marqueePause = '';
    let paused = false;
    const sync = () => {
      track.style.animationPlayState = paused || preference.matches || document.hidden ? 'paused' : '';
      toggle.textContent = paused ? 'Resume animation' : 'Pause animation';
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.hidden = preference.matches;
    };
    toggle.addEventListener('click', () => { paused = !paused; sync(); });
    preference.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    section.append(toggle);
    sync();
  });

  document.querySelectorAll('[data-price-card]').forEach((card) => {
    const amount = card.querySelector('[data-price-roll]');
    const unit = card.querySelector('.cs-home2-price__number small');
    const destination = card.querySelector('[data-price-destination]');
    const choices = Array.from(card.querySelectorAll('[data-price-choice]'));
    if (!amount || !unit || !destination || !choices.length) return;
    const paint = (choice, { immediate = false } = {}) => {
      choices.forEach((button) => button.setAttribute('aria-pressed', button === choice ? 'true' : 'false'));
      const raw = Number(choice.dataset.priceValue);
      const hasPrice = Number.isFinite(raw) && raw > 0;
      const text = hasPrice ? `$${raw.toLocaleString('en-US')}` : 'See guide';
      const previous = Number(amount.dataset.priceNumeric);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const gsap = window.CS_MOTION?.gsap || window.gsap;
      if (amount._csPriceProxy && gsap) gsap.killTweensOf(amount._csPriceProxy);
      if (!immediate && hasPrice && Number.isFinite(previous) && previous > 0 && gsap && !reduced) {
        const proxy = { value: previous };
        amount._csPriceProxy = proxy;
        gsap.to(proxy, {
          value: raw,
          duration: 0.6,
          ease: 'power2.out',
          overwrite: true,
          onUpdate: () => {
            const current = Math.round(proxy.value);
            amount.textContent = `$${current.toLocaleString('en-US')}`;
            amount.dataset.priceNumeric = String(current);
          },
          onComplete: () => {
            amount.textContent = text;
            amount.dataset.priceNumeric = String(raw);
            delete amount._csPriceProxy;
          },
        });
      } else {
        amount.textContent = text;
        amount.dataset.priceNumeric = hasPrice ? String(raw) : '';
      }
      unit.textContent = hasPrice ? '/month starting price' : 'published guide';
      if (choice.dataset.priceHref) destination.href = choice.dataset.priceHref;
    };
    choices.forEach((choice) => choice.addEventListener('click', () => paint(choice)));
    paint(choices.find((choice) => Number(choice.dataset.priceValue) > 0) || choices[0], { immediate: true });
  });

  const priceTooltips = [];
  document.querySelectorAll('[data-price-info]').forEach((trigger, index) => {
    const tooltip = trigger.nextElementSibling?.matches('[role="tooltip"]') ? trigger.nextElementSibling : null;
    if (!tooltip) return;
    if (!tooltip.id) tooltip.id = `cs-price-tooltip-${index + 1}`;
    trigger.setAttribute('aria-describedby', tooltip.id);
    trigger.setAttribute('aria-expanded', 'false');
    tooltip.hidden = true;
    const setOpen = (open) => {
      tooltip.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
    };
    trigger.addEventListener('focus', () => setOpen(true));
    trigger.addEventListener('blur', () => setOpen(false));
    trigger.addEventListener('pointerenter', () => setOpen(true));
    trigger.addEventListener('pointerleave', () => { if (document.activeElement !== trigger) setOpen(false); });
    trigger.addEventListener('click', () => setOpen(true));
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    });
    priceTooltips.push({ trigger, setOpen });
  });
  if (priceTooltips.length) document.addEventListener('pointerdown', (event) => {
    priceTooltips.forEach(({ trigger, setOpen }) => { if (!trigger.contains(event.target)) setOpen(false); });
  });

  document.querySelectorAll('[data-risk-card]').forEach((card) => {
    const setOpen = (open) => card.setAttribute('aria-pressed', open ? 'true' : 'false');
    let touchInteraction = false;
    card.addEventListener('pointerdown', (event) => {
      touchInteraction = event.pointerType === 'touch' || event.pointerType === 'pen';
    });
    card.addEventListener('click', (event) => {
      const touchLike = touchInteraction || event.pointerType === 'touch' || event.pointerType === 'pen';
      if (event.detail === 0 || touchLike) setOpen(card.getAttribute('aria-pressed') !== 'true');
      touchInteraction = false;
    });
    card.addEventListener('mouseleave', () => setOpen(false));
    card.addEventListener('blur', () => {
      if (!touchInteraction && !window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints === 0) setOpen(false);
    });
    card.addEventListener('keydown', (event) => { if (event.key === 'Escape') card.setAttribute('aria-pressed', 'false'); });
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-risk-card]')) return;
    document.querySelectorAll('[data-risk-card][aria-pressed="true"]').forEach((card) => card.setAttribute('aria-pressed', 'false'));
  });

  const sheet = document.querySelector('[data-review-sheet]');
  if (sheet) {
    const panel = sheet.querySelector('.cs-review-sheet__panel');
    const form = sheet.querySelector('[data-review-form]');
    const status = sheet.querySelector('[data-review-status]');
    let returnFocus = null;
    let motionStopped = false;
    let closeTimer = 0;
    const focusables = () => Array.from(panel.querySelectorAll('button:not([disabled]),input:not([disabled]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled])'));
    const open = (trigger) => {
      window.clearTimeout(closeTimer);
      returnFocus = trigger;
      sheet.hidden = false;
      document.body.classList.add('cs-review-open');
      if (window.CS_MOTION) { window.CS_MOTION.stop(); motionStopped = true; }
      sheet.getBoundingClientRect();
      window.requestAnimationFrame(() => {
        sheet.classList.add('is-open');
        focusables()[0]?.focus({ preventScroll: true });
      });
    };
    const close = () => {
      if (sheet.hidden) return;
      sheet.classList.remove('is-open');
      document.body.classList.remove('cs-review-open');
      if (motionStopped) window.CS_MOTION?.start();
      motionStopped = false;
      window.clearTimeout(closeTimer);
      const focusTarget = returnFocus;
      const settle = () => {
        sheet.hidden = true;
        focusTarget?.focus({ preventScroll: true });
      };
      if (document.documentElement.dataset.inputModality === 'keyboard') settle();
      else closeTimer = window.setTimeout(settle, 240);
    };
    document.querySelectorAll('[data-review-open]').forEach((trigger) => trigger.addEventListener('click', () => open(trigger)));
    sheet.querySelectorAll('[data-review-close]').forEach((button) => button.addEventListener('click', close));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !sheet.hidden) { event.preventDefault(); close(); }
    });
    sheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const data = Object.fromEntries(new FormData(form));
      data.truthful_attestation = form.elements.truthful_attestation.checked;
      data.moderation_consent = form.elements.moderation_consent.checked;
      submit.disabled = true;
      status.textContent = 'Checking your submission…';
      try {
        const response = await fetch('/api/review-capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.reason || result.status || 'Unable to submit');
        status.textContent = 'Received. We will check your review before publication.';
        form.reset();
      } catch (error) {
        status.textContent = `Not submitted: ${error.message}`;
      } finally { submit.disabled = false; }
    });
  }
})();

/* Provider-detail review handoff: open the existing moderated capture sheet and prefill governed identity. */
(() => {
  const query = new URL(location.href).searchParams;
  if (query.get('review') !== 'provider' || !query.get('entity')) return;
  const trigger = document.querySelector('[data-review-open]');
  const form = document.querySelector('[data-review-form]');
  if (!trigger || !form) return;
  if (form.elements.subject_name) form.elements.subject_name.value = query.get('entity');
  if (form.elements.experience_type) form.elements.experience_type.value = 'provider';
  requestAnimationFrame(() => trigger.click());
})();

/* Phase 3 page-graph interactions — D47, D49-D51, W14, W17 */
(() => {
  'use strict';
  const number = (value) => Number.parseFloat(String(value || '').replace(/[^0-9.]/g, ''));

  document.querySelectorAll('[data-provider-context-back]').forEach((link) => {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === location.origin && referrer.pathname.replace(/\/+$/, '/') === '/providers/') link.href = `${referrer.pathname}${referrer.search}`;
    } catch { /* direct visits keep the canonical provider listing */ }
  });

  document.querySelectorAll('[data-insurance-wizard]').forEach((form) => {
    const coverage = form.elements.coverage;
    const coverageOutput = form.querySelector('[data-coverage-label]');
    const result = form.querySelector('[data-insurance-result]');
    const copays = Array.from(form.querySelectorAll('[data-copay]'));
    const monthlyInput = form.elements.monthly_oop;
    const labels = Array.from(form.querySelectorAll('.p3-progress-labels span'));
    const finish = form.querySelector('[data-insurance-complete]');
    const status = form.querySelector('[data-insurance-finish-status]');
    if (!coverage || !coverageOutput || !result || !monthlyInput || !finish || !status || labels.length !== 4) return;
    const money = (amount) => `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    const paint = () => {
      delete result.dataset.finished;
      result.dataset.estimateAmount = '';
      result.dataset.estimateBasis = 'unknown';
      status.textContent = '';
      finish.textContent = 'Finish estimate';
      const state = coverage.valueAsNumber;
      if (!Number.isInteger(state) || state < 0 || state > 3) {
        result.textContent = 'Estimated monthly out-of-pocket: unknown. Choose a coverage expectation.';
        return false;
      }
      const likelihood = labels[state].textContent.trim();
      coverageOutput.textContent = likelihood;
      coverage.setAttribute('aria-valuetext', likelihood);
      coverage.style.setProperty('--p3-progress', `${state / 3 * 100}%`);
      labels.forEach((label, index) => label.classList.toggle('is-active', index === state));
      const entered = monthlyInput.valueAsNumber;
      const validEntered = monthlyInput.value !== '' && monthlyInput.validity.valid && Number.isFinite(entered) && entered >= 0;
      copays.forEach((button) => button.setAttribute('aria-pressed', String(validEntered && entered === Number(button.dataset.copay))));
      const raw = form.dataset.selfPayAmount || '';
      const published = Number(raw);
      let hasSource = false;
      try { hasSource = ['https:', 'http:'].includes(new URL(form.dataset.selfPaySource).protocol); }
      catch { /* Missing evidence must not become a zero-dollar estimate. */ }
      const validPublished = raw.trim() !== '' && Number.isFinite(published) && published >= 0
        && form.dataset.selfPayCadence === 'month' && hasSource && /^\d{4}-\d{2}-\d{2}$/.test(form.dataset.selfPayChecked || '');
      const selfPay = state < 2;
      const valid = selfPay ? validPublished : validEntered;
      if (!valid) {
        result.textContent = selfPay
          ? 'Estimated monthly out-of-pocket: unknown. No source-linked monthly self-pay amount is available; your copay is not used for this coverage expectation.'
          : 'Estimated monthly out-of-pocket: unknown. Enter a non-negative monthly estimate or choose your own copay amount.';
        return false;
      }
      const amount = selfPay ? published : entered;
      const basis = selfPay
        ? 'Uses the published monthly self-pay amount above, with its source terms; your copay is not used.'
        : state === 2
          ? 'Uses your entered amount or selected copay if coverage applies; likely coverage is not confirmed.'
          : 'Uses your entered amount or selected copay and self-reported coverage; coverage is not confirmed.';
      result.dataset.estimateAmount = String(amount);
      result.dataset.estimateBasis = selfPay ? 'self-pay' : 'entered';
      result.textContent = `Estimated monthly out-of-pocket: ${money(amount)}. ${likelihood}. ${basis} This is not a coverage quote or verified pharmacy price.`;
      return true;
    };
    coverage.addEventListener('input', paint);
    coverage.addEventListener('change', paint);
    // Home/End can confirm an already-selected endpoint without an input event.
    // Keep initial server content intact; evaluate only after that user action.
    coverage.addEventListener('keyup', (event) => {
      if (event.key === 'Home' || event.key === 'End') paint();
    });
    monthlyInput.addEventListener('input', paint);
    monthlyInput.addEventListener('change', paint);
    copays.forEach((button) => button.addEventListener('click', () => {
      monthlyInput.value = button.dataset.copay;
      paint();
    }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!paint()) return;
      result.dataset.finished = 'true';
      status.textContent = 'Estimate ready. Compare it with the published self-pay paths below. Coverage, eligibility and actual charges remain unverified.';
      finish.textContent = 'Estimate ready';
    });
    finish.disabled = false;
  });

  document.querySelectorAll('[data-insurance-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = button.closest('main')?.querySelector('[data-insurance-wizard]');
      if (!form?.elements.coverage) return;
      // A bare provider amount has no monthly/source contract. Keep the page's evidence.
      form.elements.coverage.dispatchEvent(new Event('input', { bubbles: true }));
      form.scrollIntoView({ behavior: 'auto', block: 'start' });
      form.elements.coverage.focus({ preventScroll: true });
    });
  });

  const PRODUCT_ROUTE_BY_DRUG = Object.freeze({
    WEGOVY_PILL: '/wegovy-pill/',
    WEGOVY: '/wegovy/',
    OZEMPIC: '/ozempic/',
    MOUNJARO: '/mounjaro/',
    ZEPBOUND: '/zepbound/',
  });
  // GLP-37: closed molecule vocabulary; unknown tokens never imply semaglutide.
  const COHORT_MOLECULE_BY_DRUG = Object.freeze({
    SEMAGLUTIDE: 'SEMAGLUTIDE', WEGOVY_PILL: 'SEMAGLUTIDE', WEGOVY: 'SEMAGLUTIDE', OZEMPIC: 'SEMAGLUTIDE',
    TIRZEPATIDE: 'TIRZEPATIDE', MOUNJARO: 'TIRZEPATIDE', ZEPBOUND: 'TIRZEPATIDE',
  });
  const COMPOUNDED_ROUTE_BY_MOLECULE = Object.freeze({
    SEMAGLUTIDE: '/lp/best-providers/compounded-semaglutide/',
    TIRZEPATIDE: '/lp/best-providers/compounded-tirzepatide/',
  });
  const DEFAULT_BRAND_BY_MOLECULE = Object.freeze({ SEMAGLUTIDE: 'WEGOVY', TIRZEPATIDE: 'ZEPBOUND' });
  const FILTER_QUERY_KEYS = Object.freeze(['region', 'state', 'product', 'molecule', 'drug', 'form', 'plan', 'duration', 'dose', 'sort']);
  const normalizedPath = (value = location.pathname) => `${String(value).replace(/\/+$/, '')}/`;
  const currentProductPath = normalizedPath();
  const medicationToken = (value) => {
    const id = String(value || '').trim().toLowerCase().replaceAll('-', '_');
    if (id.includes('wegovy_pill')) return 'WEGOVY_PILL';
    if (id.includes('wegovy')) return 'WEGOVY';
    if (id.includes('ozempic')) return 'OZEMPIC';
    if (id.includes('mounjaro')) return 'MOUNJARO';
    if (id.includes('zepbound')) return 'ZEPBOUND';
    if (id.includes('tirzepatide')) return 'TIRZEPATIDE';
    if (id.includes('semaglutide')) return 'SEMAGLUTIDE';
    return id.toUpperCase();
  };
  const moleculeForDrug = (value) => ['MOUNJARO', 'ZEPBOUND', 'TIRZEPATIDE'].includes(medicationToken(value)) ? 'TIRZEPATIDE' : 'SEMAGLUTIDE';
  const formToken = (value) => {
    const token = String(value || '').trim().toUpperCase().replaceAll('-', '_');
    if (['BRAND', 'BRAND_NAME', 'BRANDNAME'].includes(token)) return 'brand';
    if (token === 'COMPOUNDED') return 'compounded';
    return token.toLowerCase();
  };
  const routeDrug = (path = currentProductPath) => {
    const brand = Object.entries(PRODUCT_ROUTE_BY_DRUG).find(([, route]) => route === normalizedPath(path));
    if (brand) return brand[0];
    const compounded = Object.entries(COMPOUNDED_ROUTE_BY_MOLECULE).find(([, route]) => route === normalizedPath(path));
    return compounded?.[0] || '';
  };
  const isBrandPath = (path = currentProductPath) => Object.values(PRODUCT_ROUTE_BY_DRUG).includes(normalizedPath(path));
  const isCompoundedPath = (path = currentProductPath) => Object.values(COMPOUNDED_ROUTE_BY_MOLECULE).includes(normalizedPath(path));
  const isProductPath = (path = currentProductPath) => isBrandPath(path) || isCompoundedPath(path);
  const routeAllowsDuration = (path) => {
    const normalized = normalizedPath(path);
    return normalized === '/wegovy-pill/' || normalized === '/providers/' || isCompoundedPath(normalized);
  };
  const productRoute = (drug, form) => {
    const normalizedDrug = medicationToken(drug);
    if (formToken(form) === 'compounded') return COMPOUNDED_ROUTE_BY_MOLECULE[moleculeForDrug(normalizedDrug)];
    const brandDrug = PRODUCT_ROUTE_BY_DRUG[normalizedDrug] ? normalizedDrug : DEFAULT_BRAND_BY_MOLECULE[moleculeForDrug(normalizedDrug)];
    return PRODUCT_ROUTE_BY_DRUG[brandDrug];
  };
  const productDestination = ({ route, drug, form, source = location.href }) => {
    const target = new URL(route, location.origin);
    const prior = new URL(source, location.origin);
    const normalizedDrug = medicationToken(drug);
    const normalizedForm = formToken(form);
    const destinationDrug = isCompoundedPath(target.pathname)
      ? moleculeForDrug(normalizedDrug)
      : routeDrug(target.pathname) || normalizedDrug;
    const state = String(prior.searchParams.get('state') || prior.searchParams.get('region') || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(state)) target.searchParams.set('state', state);
    target.searchParams.set('drug', destinationDrug);
    target.searchParams.set('form', normalizedForm === 'brand' ? 'BRAND_NAME' : 'COMPOUNDED');
    if (routeAllowsDuration(target.pathname)) {
      const plan = prior.searchParams.get('plan');
      const duration = prior.searchParams.get('duration');
      if (target.pathname === '/wegovy-pill/') {
        if (duration) target.searchParams.set('duration', duration === 'monthly' ? '1' : duration);
      } else {
        if (plan) target.searchParams.set('plan', plan);
        if (duration && !plan && ['1', '3', 'monthly'].includes(duration.toLowerCase())) {
          target.searchParams.set('plan', duration.toLowerCase() === 'monthly' ? '1' : duration);
        } else if (duration) target.searchParams.set('duration', duration === 'monthly' ? '1' : duration);
      }
    }
    const dose = prior.searchParams.get('dose');
    if (dose) target.searchParams.set('dose', dose);
    target.searchParams.set('sort', String(prior.searchParams.get('sort') || 'cheapest').toLowerCase());
    return `${target.pathname}${target.search}${target.hash}`;
  };

  // Product cards and medication tabs stay useful without JavaScript, while this
  // enhancement canonicalizes their state and makes the active destination explicit.
  document.querySelectorAll('a[data-product-card], a[data-filter-route][data-route-family]').forEach((link) => {
    const target = new URL(link.getAttribute('href') || location.href, location.origin);
    const drug = medicationToken(link.dataset.drug || target.searchParams.get('drug') || routeDrug(target.pathname));
    const form = formToken(link.dataset.form || target.searchParams.get('form') || (isCompoundedPath(target.pathname) ? 'compounded' : 'brand'));
    link.href = productDestination({ route: target.pathname, drug, form, source: location.href });
    if (normalizedPath(target.pathname) === currentProductPath) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.p3-med-tabs a[href]').forEach((link) => {
    const target = new URL(link.getAttribute('href'), location.origin);
    const drug = routeDrug(target.pathname);
    if (drug) link.href = productDestination({ route: target.pathname, drug, form: 'brand', source: location.href });
    if (normalizedPath(target.pathname) === currentProductPath) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  // A details/review path must never acquire affiliate analytics semantics. External
  // conversion, internal evidence, and fit actions remain three disjoint controls.
  document.querySelectorAll('[data-phase3-provider] .p3-card-actions').forEach((actions) => {
    actions.querySelectorAll('a[href]').forEach((link) => {
      const target = new URL(link.getAttribute('href'), location.origin);
      const affiliate = link.matches('[data-analytics-event="affiliate_click"]');
      const fit = target.origin === location.origin && target.pathname.startsWith('/quiz/');
      if (affiliate) link.dataset.providerConversionAction = 'external';
      else if (fit) link.dataset.providerFitAction = 'internal';
      else if (target.origin === location.origin) link.dataset.providerDetailsAction = 'internal';
    });
  });

  const setupProviderFilters = (filters) => {
    // Funnel V2 can sit between the filter controls and the organic provider
    // results. Resolve the owned results section by contract rather than by
    // sibling position so canonical filtering still initializes.
    const siblings = Array.from(filters.parentElement?.children || []);
    const section = siblings
      .slice(siblings.indexOf(filters) + 1)
      .find((node) => node.matches?.('.p3-provider-section') && node.querySelector('[data-phase3-provider-grid]'));
    const grid = section?.querySelector('[data-phase3-provider-grid]');
    const cards = grid ? Array.from(grid.querySelectorAll('[data-phase3-provider]')) : [];
    const initialOrder = new Map(cards.map((card, index) => [card, index]));
    const result = filters.closest('main.listing')?.querySelector('[data-filter-result]') || section?.querySelector('[data-filter-result]');
    const empty = section?.querySelector('[data-filter-empty]');
    if (!grid) return;

    let deferredCardBodies = [];
    let deferredCardLoad = null;
    let deferredApplyScheduled = false;
    const deferredPayload = section.querySelector('[data-provider-card-payloads]');
    try { deferredCardBodies = JSON.parse(deferredPayload?.textContent || '[]'); } catch { deferredCardBodies = []; }
    const loadDeferredCardBodies = () => {
      if (deferredCardBodies.length || !deferredPayload?.dataset.src) return Promise.resolve(deferredCardBodies);
      if (!deferredCardLoad) {
        deferredCardLoad = fetch(deferredPayload.dataset.src, { credentials: 'same-origin' })
          .then((response) => {
            if (!response.ok) throw new Error(`provider_card_payload_http_${response.status}`);
            return response.json();
          })
          .then((payload) => {
            deferredCardBodies = Array.isArray(payload) ? payload : [];
            return deferredCardBodies;
          })
          .catch(() => []);
      }
      return deferredCardLoad;
    };
    const hydrateCard = (card) => {
      const index = Number(card.dataset.providerLazyIndex);
      if (!Number.isInteger(index)) return true;
      if (typeof deferredCardBodies[index] !== 'string') return false;
      card.innerHTML = deferredCardBodies[index];
      delete card.dataset.providerLazyIndex;
      return true;
    };

    const batchSize = 12;
    let pageLimit = Math.max(1, Number(section.dataset.initialVisible) || batchSize);
    let loadMore = section.querySelector('[data-provider-load-more]');
    if (!loadMore && cards.length > batchSize) {
      loadMore = document.createElement('button');
      loadMore.type = 'button';
      loadMore.className = 'cs-btn cs-btn--quiet p3-load-more';
      loadMore.dataset.providerLoadMore = '';
      loadMore.hidden = true;
      loadMore.textContent = 'Show more providers';
      section.insertBefore(loadMore, empty || null);
    }

    filters.dataset.phase3RouteReady = 'true';
    // No persisted health-answer profile may influence listing order.
    const quizMatches = new Set();
    const selected = Object.create(null);
    const searchForm = filters.querySelector('[data-provider-search]');
    const providerSearch = searchForm?.querySelector('[role="combobox"]');
    const providerOptions = searchForm?.querySelector('[role="listbox"]');
    const providerEmpty = searchForm?.querySelector('[data-provider-search-empty]');
    const suggestions = Array.from(providerOptions?.querySelectorAll('[role="option"][data-program]') || []);
    const providerNames = new Map(suggestions.map((option) => [option.dataset.program, option.textContent.trim()]));
    let providerQuery = '';
    let appliedGroups = null;
    let activeProvider = -1;
    const normalizeProviderQuery = (value) => {
      const text = String(value || '').trim().replace(/\s+/g, ' ');
      return [...providerNames.values()].find((name) => name.toLowerCase() === text.toLowerCase()) || text;
    };
    if (searchForm) {
      const declared = (searchForm.dataset.canonicalProviderIds || '').split(',').filter(Boolean);
      const actual = cards.map((card) => card.dataset.program);
      const sameIds = (ids) => ids.length === declared.length && new Set(ids).size === ids.length
        && ids.every((id) => declared.includes(id));
      if (new Set(declared).size !== declared.length || !sameIds(actual) || !sameIds(suggestions.map((option) => option.dataset.program))) {
        throw new Error('provider_search_identity_mismatch');
      }
    }
    const closeProviderSearch = () => {
      if (!providerSearch) return;
      providerOptions.hidden = true;
      providerEmpty.hidden = true;
      providerSearch.setAttribute('aria-expanded', 'false');
      providerSearch.removeAttribute('aria-activedescendant');
      suggestions.forEach((option) => option.setAttribute('aria-selected', 'false'));
      activeProvider = -1;
    };
    const openProviderSearch = () => {
      const query = providerSearch.value.trim().toLowerCase();
      suggestions.forEach((option) => { option.hidden = !option.textContent.toLowerCase().includes(query); });
      const visible = suggestions.filter((option) => !option.hidden);
      providerOptions.hidden = false;
      providerEmpty.hidden = visible.length !== 0;
      providerSearch.setAttribute('aria-expanded', 'true');
      providerSearch.removeAttribute('aria-activedescendant');
      suggestions.forEach((option) => option.setAttribute('aria-selected', 'false'));
      activeProvider = -1;
      return visible;
    };
    const applyProviderSearch = () => {
      providerQuery = normalizeProviderQuery(providerSearch.value);
      providerSearch.value = providerQuery;
      pageLimit = batchSize;
      closeProviderSearch();
      apply({ persist: true });
    };
    providerSearch?.addEventListener('focus', openProviderSearch);
    providerSearch?.addEventListener('input', openProviderSearch);
    providerSearch?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeProviderSearch(); return; }
      if (event.key === 'Enter') {
        event.preventDefault();
        const visible = suggestions.filter((option) => !option.hidden);
        if (!providerOptions.hidden && activeProvider >= 0) providerSearch.value = visible[activeProvider].textContent.trim();
        applyProviderSearch();
        return;
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const visible = providerOptions.hidden ? openProviderSearch() : suggestions.filter((option) => !option.hidden);
      if (!visible.length) return;
      activeProvider = event.key === 'ArrowDown' ? (activeProvider + 1) % visible.length
        : (activeProvider < 0 ? visible.length - 1 : (activeProvider - 1 + visible.length) % visible.length);
      suggestions.forEach((option) => option.setAttribute('aria-selected', String(option === visible[activeProvider])));
      providerSearch.setAttribute('aria-activedescendant', visible[activeProvider].id);
      visible[activeProvider].scrollIntoView({ block: 'nearest' });
    });
    suggestions.forEach((option) => option.addEventListener('click', () => {
      providerSearch.value = option.textContent.trim();
      providerSearch.focus({ preventScroll: true });
      closeProviderSearch();
    }));
    searchForm?.addEventListener('submit', (event) => { event.preventDefault(); applyProviderSearch(); });
    searchForm?.addEventListener('focusout', (event) => {
      if (!searchForm.contains(event.relatedTarget)) closeProviderSearch();
    });
    document.addEventListener('pointerdown', (event) => {
      if (searchForm && !searchForm.contains(event.target)) closeProviderSearch();
    });
    const brandWithoutDuration = isBrandPath() && currentProductPath !== '/wegovy-pill/';
    let planGroup = filters.querySelector('[data-filter-group="plan"]');
    let durationGroup = filters.querySelector('[data-filter-group="duration"]');

    if (currentProductPath === '/wegovy-pill/') {
      // Wegovy Pill owns one unambiguous duration state. Older source markup split
      // monthly/3-month and 6+ controls across two groups, so normalize it at runtime.
      if (planGroup) {
        if (durationGroup && durationGroup !== planGroup) durationGroup.hidden = true;
        durationGroup = planGroup;
        durationGroup.dataset.filterGroup = 'duration';
        durationGroup.hidden = false;
        planGroup = null;
      }
      if (durationGroup) {
        durationGroup.hidden = false;
        const legend = durationGroup.querySelector('legend');
        if (legend) legend.textContent = 'Duration';
        const chips = durationGroup.querySelector('.p3-filter-chips') || durationGroup;
        chips.replaceChildren(...[
          ['all', 'Any published duration'], ['1', 'Monthly'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months'],
        ].map(([value, label], index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.filter = 'duration';
          button.dataset.value = value;
          button.setAttribute('aria-pressed', String(index === 0));
          button.textContent = label;
          return button;
        }));
      }
      // Default this page to oral compounded alternatives. The selected form
      // still has to be present on each card; the page default is not a
      // classification of the branded pill's medication identifier.
      const typeGroup = filters.querySelector('[data-filter-group="type"]');
      const compoundedType = typeGroup?.querySelector('[data-filter="type"][data-value="compounded"]');
      if (compoundedType) {
        typeGroup.querySelectorAll('[data-filter="type"]').forEach((button) => button.setAttribute(button.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-pressed', String(button === compoundedType)));
      }
    } else if (brandWithoutDuration) {
      // Brand routes such as Wegovy intentionally have no term filter. Hiding both
      // legacy term groups also guarantees a stale duration cannot appear selected.
      if (planGroup) planGroup.hidden = true;
      if (durationGroup) durationGroup.hidden = true;
    }

    const normalizeGroupValue = (key, value) => {
      if (['treatment', 'molecule'].includes(key)) return medicationToken(value);
      if (key === 'type') return formToken(value);
      if (['duration', 'plan'].includes(key) && String(value).toLowerCase() === 'monthly') return '1';
      return String(value || '').trim().toLowerCase();
    };
    const groupElement = (key) => Array.from(filters.querySelectorAll('[data-filter-group]'))
      .find((group) => !group.hidden && group.dataset.filterGroup === key);
    const groupButtons = (key) => {
      const group = groupElement(key);
      return group ? Array.from(group.querySelectorAll('button[data-filter][data-value]:not([disabled])')) : [];
    };
    const setGroup = (key, value, { fallback = true } = {}) => {
      const buttons = groupButtons(key);
      if (!buttons.length) { delete selected[key]; return false; }
      const normalized = normalizeGroupValue(key, value);
      const match = buttons.find((button) => normalizeGroupValue(key, button.dataset.value) === normalized) || (fallback ? buttons[0] : null);
      if (!match) return false;
      groupElement(key).querySelectorAll('button[data-filter][data-value]').forEach((button) => {
        const active = button === match && !button.disabled;
        if (button.getAttribute('role') === 'tab') {
          button.removeAttribute('aria-pressed');
          button.setAttribute('aria-selected', String(active));
          button.tabIndex = active ? 0 : -1;
        } else {
          button.setAttribute('aria-pressed', String(active));
        }
      });
      selected[key] = match.dataset.value;
      return normalizeGroupValue(key, match.dataset.value) === normalized;
    };
    const groupDefaults = new Map();
    filters.querySelectorAll('[data-filter-group]').forEach((group) => {
      if (group.hidden) return;
      const initial = group.querySelector('button[data-filter][role="tab"][aria-selected="true"]:not([disabled]), button[data-filter]:not([role="tab"])[aria-pressed="true"]:not([disabled])')
        || group.querySelector('button[data-filter]:not([disabled])');
      if (initial) groupDefaults.set(group.dataset.filterGroup, initial.dataset.value);
    });
    const resetGroupsToMarkup = () => {
      for (const key of Object.keys(selected)) delete selected[key];
      filters.querySelectorAll('[data-filter-group]').forEach((group) => {
        if (group.hidden) return;
        const value = groupDefaults.get(group.dataset.filterGroup);
        if (value !== undefined) setGroup(group.dataset.filterGroup, value);
      });
    };
    resetGroupsToMarkup();

    const stateIntro = document.querySelector('main.listing:is([data-listing-archetype="C"], [data-listing-archetype="E"]) .listing__intro');
    const stateControl = filters.querySelector('.p3-state-control') || stateIntro?.querySelector(':scope > .p3-state-control');
    const opener = stateControl?.querySelector('[data-state-open]');
    const popover = stateControl?.querySelector('.p3-state-popover');
    const stateLabel = stateControl?.querySelector('[data-state-label]');
    const stateSearch = stateControl?.querySelector('[data-state-search]');
    const nativeState = stateControl?.querySelector('[data-state-native]');
    const stateButtons = popover ? Array.from(popover.querySelectorAll('[data-state]')) : [];
    const stateHeading = stateIntro?.querySelector('h1') || document.querySelector('[data-state-heading]');
    // Sponsor preview keeps its single native selector inside closed Filters.
    // Do not pull it back into the heading during enhancement.
    if (stateIntro && stateControl && stateHeading && !filters.hasAttribute('data-sponsor-preview-filters')) {
      stateHeading.dataset.stateHeading = '';
      stateHeading.dataset.stateTitleTemplate = 'Compare weight loss providers in {state}';
      if (stateControl.parentElement !== stateIntro) {
        stateIntro.classList.add('listing__intro--state');
        stateIntro.prepend(stateControl);
      }
      const arrows = document.createElement('span');
      arrows.textContent = ' ▴▾';
      arrows.setAttribute('aria-hidden', 'true');
      opener.append(arrows);
    }
    const defaultStateHeading = stateHeading?.textContent.trim() || '';
    const validState = (code) => stateButtons.some((button) => button.dataset.state === code)
      || Array.from(nativeState?.options || []).some((option) => option.value === code);
    const stateName = (code) => stateButtons.find((button) => button.dataset.state === code)?.textContent.trim()
      || Array.from(nativeState?.options || []).find((option) => option.value === code)?.textContent.trim() || code;
    let selectedState = '';
    let ignoredState = '';

    const readUrl = ({ useStoredState = true } = {}) => {
      resetGroupsToMarkup();
      const query = new URL(location.href).searchParams;
      providerQuery = providerSearch ? normalizeProviderQuery(query.get('provider')) : '';
      if (providerSearch) providerSearch.value = providerQuery;
      closeProviderSearch();
      const rawState = String(query.get('state') || query.get('region') || (useStoredState ? window.CS_STATE?.get() : '') || '').trim().toUpperCase();
      selectedState = validState(rawState) ? rawState : '';
      ignoredState = rawState && !selectedState ? rawState : '';
      const product = query.get('product');
      const drug = query.get('molecule') || query.get('drug');
      const form = query.get('form');
      const plan = query.get('plan');
      const duration = String(query.get('duration') || '').toLowerCase();
      const dose = query.get('dose');
      const sort = String(query.get('sort') || 'cheapest').toLowerCase();
      if (product) setGroup('product', product);
      if (drug) {
        setGroup('molecule', drug);
        setGroup('treatment', drug);
      }
      if (form) setGroup('type', form);
      if (plan) setGroup('plan', plan);
      if (duration) {
        const exactDuration = setGroup('duration', duration, { fallback: false });
        if (!exactDuration && !plan && ['1', '3'].includes(duration)) setGroup('plan', duration);
      }
      if (dose) setGroup('dose', dose);
      setGroup('sort', sort);
    };
    const writeUrl = (mode = 'replace') => {
      const url = new URL(location.href);
      FILTER_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
      if (searchForm) {
        url.searchParams.delete('provider');
        if (providerQuery) url.searchParams.set('provider', providerQuery);
      }
      if (selectedState) url.searchParams.set('state', selectedState);
      if (selected.product && selected.product !== 'all') url.searchParams.set('product', selected.product);
      const treatment = selected.molecule || selected.treatment;
      if (treatment && treatment !== 'all') url.searchParams.set('drug', medicationToken(treatment));
      if (selected.type && selected.type !== 'all') url.searchParams.set('form', formToken(selected.type) === 'brand' ? 'BRAND_NAME' : 'COMPOUNDED');
      // Both is an explicit choice, not the default on every route (e.g. /3-month/).
      if (selected.plan) url.searchParams.set('plan', normalizeGroupValue('plan', selected.plan));
      if (selected.duration && selected.duration !== 'all') url.searchParams.set('duration', normalizeGroupValue('duration', selected.duration));
      if (selected.dose && selected.dose !== 'all') url.searchParams.set('dose', selected.dose);
      if (selected.sort) url.searchParams.set('sort', normalizeGroupValue('sort', selected.sort));
      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${location.pathname}${location.search}${location.hash}`;
      if (!searchForm) {
        if (next !== current) history.replaceState(null, '', next);
        return;
      }
      const payload = { version: 1, query: providerQuery, state: selectedState, selected: { ...selected } };
      const changed = JSON.stringify(history.state?.glpProviderFilters) !== JSON.stringify(payload);
      if (next !== current || changed) {
        const state = { ...(history.state || {}), glpProviderFilters: payload };
        const method = mode === 'push' && next !== current ? 'pushState' : 'replaceState';
        history[method](state, '', next);
      }
    };
    const syncStateUi = () => {
      if (stateLabel) stateLabel.textContent = selectedState ? stateName(selectedState) : 'Choose state';
      if (nativeState) nativeState.value = selectedState;
      const firstVisible = stateButtons.find((button) => !button.hidden);
      stateButtons.forEach((button) => {
        const active = button.dataset.state === selectedState;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active || (!selectedState && button === firstVisible) ? 0 : -1;
      });
      if (stateHeading) {
        const product = stateHeading.dataset.stateProduct || 'GLP-1';
        const template = stateHeading.dataset.stateTitleTemplate || '{product} providers in {state}';
        stateHeading.textContent = selectedState
          ? template.replace('{product}', product).replace('{state}', stateName(selectedState))
          : defaultStateHeading;
      }
    };
    const activePrice = (card, drug) => {
      // Governed comparison cards sort on ongoing medication cost, never on a
      // membership teaser or an unrelated medication's legacy directory price.
      const governed = Object.hasOwn(card.dataset, 'ongoingPriceMap');
      const values = String(governed ? card.dataset.ongoingPriceMap : (card.dataset.priceMap || ''))
        .split('|').map((item) => item.split(':'));
      const prices = values
        .filter(([token, value]) => (!drug || drug === 'all' || token === drug) && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0)
        .map(([, value]) => Number(value));
      const raw = String(card.dataset.price ?? '').trim();
      const fallback = raw === '' ? Infinity : Number(raw);
      if (governed && drug && drug !== 'all') return prices.length ? Math.min(...prices) : Infinity;
      return governed ? (Number.isFinite(fallback) && fallback >= 0 ? fallback : Infinity)
        : prices.length ? Math.min(...prices) : Number.isFinite(fallback) && fallback >= 0 ? fallback : Infinity;
    };
    const sortCards = (drug) => {
      const sort = normalizeGroupValue('sort', selected.sort || 'cheapest');
      const canonicalTie = (left, right) => String(left.dataset.program || '').localeCompare(String(right.dataset.program || ''))
        || String(left.querySelector('h3')?.textContent || '').localeCompare(String(right.querySelector('h3')?.textContent || ''));
      const priceTie = (left, right) => drug === 'all'
        ? initialOrder.get(left) - initialOrder.get(right)
        : canonicalTie(left, right);
      return cards.slice().sort((left, right) => {
        const leftPrice = activePrice(left, drug);
        const rightPrice = activePrice(right, drug);
        // Best means quiz matches first, including matches without a cash price.
        if (sort === 'best') {
          const matchOrder = Number(!quizMatches.has(String(left.dataset.program || '')))
            - Number(!quizMatches.has(String(right.dataset.program || '')));
          if (matchOrder) return matchOrder;
        }
        // Missing evidence is not zero. Keep it last within each match cohort.
        if (sort !== 'name') {
          const missingOrder = Number(!Number.isFinite(leftPrice)) - Number(!Number.isFinite(rightPrice));
          if (missingOrder) return missingOrder;
          if (!Number.isFinite(leftPrice)) return priceTie(left, right);
        }
        if (sort === 'price-high') return rightPrice - leftPrice || priceTie(left, right);
        if (sort === 'name') return canonicalTie(left, right);
        return leftPrice - rightPrice || priceTie(left, right);
      });
    };
    const apply = ({ persist = false, historyMode = 'push' } = {}) => {
      const draftGroups = searchForm && !persist && appliedGroups ? { ...selected } : null;
      if (draftGroups) Object.entries(appliedGroups).forEach(([key, value]) => setGroup(key, value));
      // A brand route fixes the molecule even after URL replay or Reset.
      if (isBrandPath()) {
        setGroup('treatment', routeDrug());
        setGroup('molecule', COHORT_MOLECULE_BY_DRUG[routeDrug()]);
      }
      const treatment = selected.molecule || selected.treatment;
      const drug = !treatment || treatment === 'all' ? 'all' : medicationToken(treatment);
      const form = formToken(selected.type || 'all');
      const matchesDrug = (drugs) => isBrandPath()
        ? drugs.some((token) => COHORT_MOLECULE_BY_DRUG[token] === COHORT_MOLECULE_BY_DRUG[routeDrug()])
        : drug === 'all' || drugs.includes(drug);
      let visible = 0;
      let stateVerified = 0;
      let stateUnknown = 0;
      const classifyCard = (card, remainder = false) => {
        const durations = String(card.dataset.duration || 'unknown').split(/\s+/);
        const doses = String(card.dataset.doseValues || card.dataset.dose || 'unknown').split(/\s+/);
        const drugs = String(card.dataset.drugs || '').split(/\s+/);
        const forms = String(card.dataset.forms || '').split(/\s+/).map(formToken);
        const drugOk = matchesDrug(drugs);
        const formOk = form === 'all' || forms.includes(form);
        const plan = normalizeGroupValue('plan', selected.plan || 'both');
        const duration = normalizeGroupValue('duration', selected.duration || 'all');
        const planOk = ['all', 'both', 'more'].includes(plan) || durations.includes(plan);
        const durationOk = duration === 'all' || durations.includes(duration) || (duration === '6' && durations.some((value) => Number(value) >= 6));
        const doseOk = !selected.dose || selected.dose === 'all' || doses.includes(selected.dose);
        const included = String(card.dataset.stateIncludes || '').split(/\s+/).filter(Boolean);
        const excluded = String(card.dataset.stateExcludes || '').split(/\s+/).filter(Boolean);
        const stateMode = card.dataset.stateMode || 'unknown';
        const stateOk = !selectedState || (!excluded.includes(selectedState) && (stateMode === 'unknown' || stateMode === 'all'
          || (stateMode === 'included' && included.includes(selectedState))
          || stateMode === 'excluded'));
        const providerOk = !providerQuery || (providerNames.get(card.dataset.program) || '').toLowerCase().includes(providerQuery.toLowerCase());
        const show = providerOk && drugOk && formOk && planOk && durationOk && doseOk && stateOk;
        card.dataset.filterMatch = String(show);
        card.hidden = !show;
        card.dataset.selectedStateStatus = !selectedState ? 'not-selected' : !stateOk ? 'excluded' : stateMode === 'unknown' ? 'unverified' : 'verified';
        if (show) {
          if (!remainder) visible += 1;
          if (selectedState && stateMode === 'unknown') stateUnknown += 1;
          else if (selectedState && !remainder) stateVerified += 1;
        }
        card.querySelectorAll('[data-medication]').forEach((row) => {
          row.hidden = !matchesDrug([medicationToken(row.dataset.medication)]);
        });
      };
      cards.forEach((card) => classifyCard(card));
      const unverifiedSection = filters.closest('main')?.querySelector('[data-state-unverified-remainder]');
      if (unverifiedSection) {
        const remainderCards = [...unverifiedSection.querySelectorAll('[data-phase3-provider]')];
        remainderCards.forEach((card) => classifyCard(card, true));
        unverifiedSection.hidden = !remainderCards.some((card) => card.dataset.filterMatch === 'true');
      }
      /* Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #2):
         re-appending every card forced a DOM mutation + reflow per card even
         when the computed order already matched the served order (the server
         renders cheapest-first, the default sort). Only touch the DOM when the
         order actually differs; when it differs, the append sequence — and the
         final DOM order — is byte-identical to the old behavior. */
      const orderedCards = sortCards(drug);
      const interstitial = grid.querySelector('[data-quiz-interstitial]');
      const desiredOrder = orderedCards.slice();
      if (interstitial) desiredOrder.splice(Math.min(2, desiredOrder.length), 0, interstitial);
      const desiredSet = new Set(desiredOrder);
      const currentOrder = [...grid.children].filter((node) => desiredSet.has(node));
      if (currentOrder.length !== desiredOrder.length || desiredOrder.some((node, nodeIndex) => currentOrder[nodeIndex] !== node)) {
        desiredOrder.forEach((node) => grid.append(node));
      }
      let displayed = 0;
      let hydrationPending = false;
      for (const card of orderedCards) {
        const matches = card.dataset.filterMatch === 'true';
        const show = matches && (!loadMore || displayed < pageLimit);
        if (show) {
          if (!hydrateCard(card)) {
            hydrationPending = true;
            card.hidden = true;
            continue;
          }
          card.querySelectorAll('[data-medication]').forEach((row) => {
            row.hidden = !matchesDrug([medicationToken(row.dataset.medication)]);
          });
        }
        card.hidden = !show;
        if (show) displayed += 1;
      }
      if (hydrationPending && !deferredApplyScheduled) {
        deferredApplyScheduled = true;
        loadDeferredCardBodies().then((payload) => {
          deferredApplyScheduled = false;
          if (payload.length) apply({ persist: false });
        });
      }
      if (loadMore) {
        const remaining = Math.max(0, visible - displayed);
        loadMore.hidden = remaining === 0;
        loadMore.textContent = remaining ? `Show ${Math.min(batchSize, remaining)} more provider${Math.min(batchSize, remaining) === 1 ? '' : 's'}` : 'All matching providers shown';
      }
      const dose = selected.dose && selected.dose !== 'all' ? selected.dose : '';
      filters.closest('main')?.querySelectorAll('[data-dose-row]').forEach((row) => {
        const active = Boolean(dose) && row.dataset.doseRow === dose;
        row.dataset.selected = String(active);
        row.classList.toggle('is-selected-dose', active);
        if (active) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
      });
      /* Keep the visible pressed state authoritative after card reordering and
         row highlighting. This also repairs legacy markup where the default
         chip retained aria-pressed=true after a dose selection. */
      filters.querySelectorAll('[data-filter-group]').forEach((group) => {
        if (group.hidden) return;
        const key = group.dataset.filterGroup;
        const activeValue = selected[key];
        setGroup(key, activeValue);
      });
      if (result) {
        const stateSummary = selectedState
          ? ` for ${stateName(selectedState)}: ${stateVerified} with explicit state evidence, ${stateUnknown} requiring direct state verification.`
          : '';
        const ignoredSummary = ignoredState ? ` State code “${ignoredState}” was not recognized and was ignored.` : '';
        const countLabel = (['/3-month/', '/6-month/'].includes(currentProductPath)
          || ['B', 'C'].includes(filters.closest('main')?.dataset.listingArchetype)) ? 'comparable price result'
          : currentProductPath === '/providers/' ? 'program card' : 'source-backed provider row';
        const treatmentSummary = ['/3-month/', '/6-month/'].includes(currentProductPath)
          && ['SEMAGLUTIDE', 'TIRZEPATIDE'].includes(drug) ? ` Treatment: ${drug === 'SEMAGLUTIDE' ? 'Semaglutide' : 'Tirzepatide'}.` : '';
        result.textContent = `${countLabel === 'comparable price result' ? '' : 'Showing '}${visible} ${countLabel}${visible === 1 ? '' : 's'}${stateSummary}${ignoredSummary}${treatmentSummary}`;
      }
      const activeFilterLabel = empty?.querySelector('[data-active-filter-label]');
      if (activeFilterLabel) {
        const labels = Array.from(filters.querySelectorAll('[data-filter-group]')).flatMap((group) => {
          const key = group.dataset.filterGroup;
          if (group.hidden || key === 'sort' || selected[key] === undefined
            || normalizeGroupValue(key, selected[key]) === normalizeGroupValue(key, groupDefaults.get(key))) return [];
          const button = Array.from(group.querySelectorAll('button[data-filter][data-value]'))
            .find((item) => item.dataset.value === selected[key]);
          return button ? [`${group.getAttribute('aria-label') || key}: ${button.textContent.trim()}`] : [];
        });
        if (selectedState) labels.push(`State: ${stateName(selectedState)}`);
        if (providerQuery) labels.push(`Provider: ${providerQuery}`);
        activeFilterLabel.textContent = `Active filters: ${labels.length ? labels.join(', ') : 'none'}.`;
      }
      if (empty) empty.hidden = visible !== 0;
      syncStateUi();
      if (searchForm) appliedGroups = { ...selected };
      if (draftGroups) Object.entries(draftGroups).forEach(([key, value]) => setGroup(key, value));
      if (persist) {
        writeUrl(historyMode);
        filters.closest('[data-g08-medication]')?.dispatchEvent(new CustomEvent('cs:categoryfilters', { detail: { source: filters } }));
      }
    };
    filters.closest('[data-g08-medication]')?.addEventListener('cs:categoryfilters', (event) => {
      if (event.detail.source === filters) return;
      readUrl();
      apply();
    });
    window.addEventListener('cs:statechange', (event) => {
      const code = String(event.detail?.state || '').toUpperCase();
      if (!validState(code)) return;
      selectedState = code;
      ignoredState = '';
      apply({ persist: true });
    });
    loadMore?.addEventListener('click', () => {
      pageLimit += batchSize;
      apply();
      if (!loadMore.hidden) loadMore.focus({ preventScroll: true });
    });
    const navigateForSelection = (key, value) => {
      if (!['treatment', 'molecule', 'type'].includes(key)) return false;
      if (!isProductPath()) return false;
      let drug = medicationToken(selected.treatment || selected.molecule || routeDrug());
      let form = formToken(selected.type || (isCompoundedPath() ? 'compounded' : 'brand'));
      if (['treatment', 'molecule'].includes(key)) drug = medicationToken(value);
      if (key === 'type') form = formToken(value);
      const route = isBrandPath() && key !== 'type' ? PRODUCT_ROUTE_BY_DRUG[drug] : productRoute(drug, form);
      if (!route || (normalizedPath(route) === currentProductPath && drug === medicationToken(routeDrug()))) return false;
      location.assign(productDestination({ route, drug, form, source: location.href }));
      return true;
    };
    filters.querySelectorAll('button[data-filter][data-value]').forEach((button) => button.addEventListener('click', () => {
      if (button.disabled) return;
      const group = button.closest('[data-filter-group]');
      if (!group || group.hidden) return;
      const key = group.dataset.filterGroup;
      if (key === 'plan' && button.dataset.value === 'more') {
        const more = filters.querySelector('.p3-more-filters');
        if (more?.matches('details')) { more.open = true; more.querySelector('summary')?.focus(); return; }
      }
      if (navigateForSelection(key, button.dataset.value)) return;
      ignoredState = '';
      if (searchForm && key === 'sort') {
        const draft = { ...selected };
        Object.entries(appliedGroups || selected).forEach(([name, value]) => setGroup(name, value));
        setGroup(key, button.dataset.value);
        apply({ persist: true, historyMode: 'replace' });
        Object.entries(draft).filter(([name]) => name !== 'sort').forEach(([name, value]) => setGroup(name, value));
        return;
      }
      setGroup(key, button.dataset.value);
      if (searchForm) return; // Search/Enter commits; tabs alone remain drafts.
      apply({ persist: true });
    }));
    filters.addEventListener('keydown', (event) => {
      if (!['Home', 'End', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
      const button = event.target.closest('button[role="tab"][data-filter]');
      const group = button?.closest('[data-filter-group][role="tablist"]');
      if (!group || group.hidden || button.disabled) return;
      const buttons = groupButtons(group.dataset.filterGroup);
      if (!buttons.length) return;
      const index = buttons.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[next].focus();
      // Route-changing tabs use manual activation: arrows move focus, while
      // Enter/Space activate. Navigation on an arrow discards keyboard focus.
      if (buttons[next].dataset.route) {
        buttons.forEach((item, i) => { item.tabIndex = i === next ? 0 : -1; });
      } else {
        buttons[next].click();
      }
    });
    const reset = () => {
      providerQuery = '';
      if (providerSearch) providerSearch.value = '';
      closeProviderSearch();
      pageLimit = batchSize;
      resetGroupsToMarkup();
      selectedState = '';
      ignoredState = '';
      // Publish reset groups before the shared state event can replay a sibling.
      apply({ persist: true });
      window.CS_STATE?.set('');
    };
    section?.querySelectorAll('[data-filter-reset]').forEach((button) => button.addEventListener('click', reset));
    searchForm?.querySelector('[data-provider-search-reset]')?.addEventListener('click', reset);

    const closeState = ({ returnFocus = false } = {}) => {
      if (!popover) return;
      popover.hidden = true;
      opener?.setAttribute('aria-expanded', 'false');
      if (returnFocus) opener?.focus({ preventScroll: true });
    };
    const filterStateButtons = () => {
      const query = stateSearch?.value.trim().toLowerCase() || '';
      const visible = [];
      stateButtons.forEach((button) => {
        button.hidden = !button.textContent.toLowerCase().includes(query);
        if (!button.hidden) visible.push(button);
      });
      // Empty search results are a status, not an invalid input.
      const options = popover?.querySelector('.p3-state-options');
      const emptyStatus = popover?.querySelector('[data-state-empty]');
      if (options) options.hidden = visible.length === 0;
      if (emptyStatus) emptyStatus.hidden = visible.length !== 0;
      const roving = visible.find((button) => button.dataset.state === selectedState) || visible[0];
      visible.forEach((button) => { button.tabIndex = button === roving ? 0 : -1; });
      return visible;
    };
    const chooseState = (code, { returnFocus = false } = {}) => {
      const normalized = String(code || '').toUpperCase();
      if (normalized && !validState(normalized)) {
        ignoredState = normalized;
        selectedState = '';
      } else {
        ignoredState = '';
        selectedState = normalized;
        window.CS_STATE?.set(normalized);
      }
      apply({ persist: true });
      closeState({ returnFocus });
    };
    opener?.addEventListener('click', () => {
      if (!popover) return;
      const opening = popover.hidden;
      popover.hidden = !opening;
      opener.setAttribute('aria-expanded', String(opening));
      if (opening) {
        if (stateSearch) stateSearch.value = '';
        filterStateButtons();
        stateSearch?.focus({ preventScroll: true });
        popover.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
      }
    });
    stateButtons.forEach((button) => button.addEventListener('click', () => chooseState(button.dataset.state, { returnFocus: true })));
    nativeState?.addEventListener('change', () => chooseState(nativeState.value));
    stateSearch?.addEventListener('input', filterStateButtons);
    popover?.addEventListener('keydown', (event) => {
      const visible = stateButtons.filter((button) => !button.hidden);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeState({ returnFocus: true });
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !visible.length) return;
      event.preventDefault();
      const current = visible.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? visible.length - 1
          : event.key === 'ArrowDown' ? (current + 1 + visible.length) % visible.length
            : current < 0 ? visible.length - 1 : (current - 1 + visible.length) % visible.length;
      visible.forEach((button, index) => { button.tabIndex = index === next ? 0 : -1; });
      visible[next].focus({ preventScroll: true });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && popover && !popover.hidden) { event.preventDefault(); closeState({ returnFocus: true }); }
    });
    document.addEventListener('click', (event) => {
      if (popover && !popover.hidden && !stateControl?.contains(event.target)) closeState({ returnFocus: true });
    });

    /* Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #2): the initial
       URL-state hydration + full-grid apply ran synchronously inside the load
       burst on the biggest DOMs on the site (providers hub measured 12 long
       tasks / 1.7-2.2s under 4x CPU throttle) where it could eat a first tap.
       Every listener above is already live and the served markup defaults are
       already correct, so the initial pass now runs at idle (bounded by a
       1500ms timeout). A tap before idle applies on markup defaults and writes
       the URL; the idle pass then re-reads that same URL — filter correctness
       and the site.js data-* contract are unchanged. */
    const initialQuery = new URL(location.href).searchParams;
    const routeDefaultDrug = routeDrug();
    const routeDefaultForm = isCompoundedPath() ? 'compounded' : 'brand';
    const hasNonDefaultFilter = ['state', 'region', 'product', 'molecule', 'plan', 'duration', 'dose']
      .some((key) => initialQuery.has(key));
    const requestedDrug = initialQuery.get('drug');
    const requestedForm = initialQuery.get('form');
    const requestedSort = String(initialQuery.get('sort') || 'cheapest').toLowerCase();
    const serverMarkupNeedsProgressiveDisclosure = Boolean(loadMore)
      && cards.filter((card) => !card.hidden).length > batchSize;
    const serverMarkupNeedsHydration = cards.some((card) => card.hasAttribute('data-provider-lazy-index'));
    const serverMarkupMatchesQuery = !searchForm && !isBrandPath() && !hasNonDefaultFilter
      && (!requestedDrug || medicationToken(requestedDrug) === routeDefaultDrug)
      && (!requestedForm || formToken(requestedForm) === routeDefaultForm)
      && requestedSort === 'cheapest'
      && !serverMarkupNeedsProgressiveDisclosure
      && !serverMarkupNeedsHydration;
    const initialHydrate = () => {
      readUrl();
      if (serverMarkupMatchesQuery) {
        /* Product pages are emitted in their route-default drug/form and
           cheapest-first state. Reapplying that same state forces a full-grid
           style/layout pass during the mobile LCP window. Keep the URL
           canonical, but leave already-correct server DOM untouched. */
        writeUrl();
        return;
      }
      filterStateButtons();
      apply({ persist: true, historyMode: 'replace' });
    };
    const hydrateFilterState = () => {
      initialHydrate();
      filters.dataset.filterStateReady = 'true';
    };
    // Category controls must not race a later idle replay of their first page.
    if (filters.closest('[data-g08-medication]')) hydrateFilterState();
    else if ('requestIdleCallback' in window) requestIdleCallback(hydrateFilterState, { timeout: 1500 });
    else setTimeout(hydrateFilterState, 1);
    window.addEventListener('popstate', () => {
      readUrl({ useStoredState: !searchForm });
      filterStateButtons();
      if (searchForm) { pageLimit = batchSize; appliedGroups = null; }
      apply({ persist: !searchForm });
    });
  };

  document.querySelectorAll('[data-provider-filters]').forEach((filters) => {
    const initialQuery = new URL(location.href).searchParams;
    const canDeferWegovyDefaults = currentProductPath === '/wegovy/'
      && !['state', 'region', 'product', 'molecule', 'plan', 'duration', 'dose']
        .some((key) => initialQuery.has(key))
      && (!initialQuery.get('drug') || medicationToken(initialQuery.get('drug')) === 'WEGOVY')
      && (!initialQuery.get('form') || formToken(initialQuery.get('form')) === 'brand')
      && String(initialQuery.get('sort') || 'cheapest').toLowerCase() === 'cheapest';
    if (!canDeferWegovyDefaults) {
      setupProviderFilters(filters);
      return;
    }

    /* This route is already rendered in the requested default state. Keep the
       filter runtime dormant through LCP/TBT, then initialize synchronously on
       the first pointer or keyboard intent. Capture-phase pointerdown/keydown
       runs before the browser's click/change event, so the initiating action is
       handled normally and no no-JS content is removed. */
    filters.dataset.phase3RouteReady = 'deferred';
    const activationRoot = filters.parentElement || filters;
    let observer = null;
    const activate = () => {
      observer?.disconnect();
      activationRoot.removeEventListener('pointerdown', activate, true);
      activationRoot.removeEventListener('keydown', activate, true);
      setupProviderFilters(filters);
    };
    activationRoot.addEventListener('pointerdown', activate, { capture: true, once: true });
    activationRoot.addEventListener('keydown', activate, { capture: true, once: true });
    const deferredSection = Array.from(activationRoot.children || [])
      .find((node) => node.matches?.('.p3-provider-section') && node.querySelector('[data-provider-lazy-index]'));
    if (deferredSection && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) activate();
      }, { rootMargin: '900px 0px' });
      observer.observe(deferredSection);
    }
  });

  document.querySelectorAll('[data-bulk-drug]').forEach((controls) => {
    const section = controls.closest('.p3-bulk-hero')?.nextElementSibling;
    const grid = section?.querySelector('[data-bulk-grid]');
    const cards = grid ? Array.from(grid.querySelectorAll('.p3-provider-card')) : [];
    const buttons = Array.from(controls.querySelectorAll('[data-bulk-drug-value]'));
    const result = section?.querySelector('[data-bulk-result]');
    const empty = section?.querySelector('[data-bulk-empty]');
    const validDrugs = new Set(buttons.map((button) => button.dataset.bulkDrugValue));
    const apply = (requestedDrug, { persist = false } = {}) => {
      const drug = validDrugs.has(requestedDrug) ? requestedDrug : 'SEMAGLUTIDE';
      const token = drug === 'TIRZEPATIDE' ? 'compounded-tirzepatide-injection' : 'compounded-semaglutide-injection';
      let visible = 0;
      cards.forEach((card) => {
        const medications = String(card.dataset.medications || '').split(/\s+/);
        const show = medications.includes(token);
        card.hidden = !show;
        if (show) visible += 1;
      });
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.bulkDrugValue === drug)));
      if (result) result.textContent = `Showing ${visible} ${drug === 'TIRZEPATIDE' ? 'tirzepatide' : 'semaglutide'} row${visible === 1 ? '' : 's'}`;
      if (empty) empty.hidden = visible !== 0;
      if (persist) {
        const url = new URL(location.href);
        url.searchParams.set('drug', drug);
        const next = `${url.pathname}${url.search}${url.hash}`;
        if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
      }
    };
    buttons.forEach((button) => button.addEventListener('click', () => apply(button.dataset.bulkDrugValue, { persist: true })));
    const readUrl = () => apply(String(new URL(location.href).searchParams.get('drug') || '').toUpperCase(), { persist: true });
    readUrl();
    window.addEventListener('popstate', readUrl);
  });

  document.querySelectorAll('[data-pharmacy-filters]').forEach((filters) => {
    const grid = filters.parentElement?.querySelector('[data-pharmacy-grid]');
    const cards = grid ? Array.from(grid.querySelectorAll('[data-pharmacy-card]')) : [];
    const result = filters.parentElement?.querySelector('[data-pharmacy-result]');
    const empty = filters.parentElement?.querySelector('[data-pharmacy-empty]');
    const loadMore = filters.parentElement?.querySelector('[data-pharmacy-load-more]');
    if (!grid) return;
    const batchSize = 18;
    let pageLimit = batchSize;
    const stateChoices = [...filters.querySelectorAll('[data-state]')];
    const stateCode = value => {
      const text = String(value).trim().toLowerCase();
      return stateChoices.find(choice => choice.textContent.trim().toLowerCase() === text)?.dataset.state.toLowerCase() || text;
    };
    const apply = () => {
      const query = filters.querySelector('[data-pharmacy-search]').value.trim().toLowerCase();
      const pathway = filters.querySelector('[data-pharmacy-class]').value;
      const medication = filters.querySelector('[data-pharmacy-med]').value;
      const additive = filters.querySelector('[data-pharmacy-additive]')?.value || 'all';
      const state = filters.querySelector('[data-pharmacy-state]').value;
      let visible = 0;
      let displayed = 0;
      cards.forEach((card) => {
        const show = (!query || card.dataset.name.includes(query))
          && (pathway === 'all' || card.dataset.classification.includes(pathway))
          && (medication === 'all' || card.dataset.medications.includes(medication))
          && (additive === 'all' || String(card.dataset.additives || '').split(/\s+/).includes(additive))
          && (state === 'all' || String(card.dataset.states || '').split('|').some(value => stateCode(value) === stateCode(state)));
        if (show) visible += 1;
        const showOnPage = show && displayed < pageLimit;
        card.hidden = !showOnPage;
        if (showOnPage) displayed += 1;
      });
      if (result) result.textContent = displayed < visible
        ? `Showing ${displayed} of ${visible} evidence records`
        : `Showing ${visible} evidence record${visible === 1 ? '' : 's'}`;
      if (loadMore) {
        const remaining = Math.max(0, visible - displayed);
        loadMore.hidden = remaining === 0;
        loadMore.textContent = remaining ? `Show ${Math.min(batchSize, remaining)} more pharmacy record${Math.min(batchSize, remaining) === 1 ? '' : 's'}` : 'All matching pharmacy records shown';
      }
      if (empty) empty.hidden = visible !== 0;
    };
    const readPharmacyQuery = () => {
      const query = new URL(location.href).searchParams;
      const pathway = String(query.get('pharmacyType') || '').toLowerCase();
      const medication = String(query.get('pharmacyDrug') || '').toLowerCase();
      filters.querySelector('[data-pharmacy-class]').value = ['503a', '503b'].includes(pathway) ? pathway : 'all';
      filters.querySelector('[data-pharmacy-med]').value = ['semaglutide', 'tirzepatide'].includes(medication) ? medication : 'all';
      const additive = filters.querySelector('[data-pharmacy-additive]');
      additive.value = [...additive.options].some(option => option.value === query.get('additive')) ? query.get('additive') : 'all';
      filters.querySelector('[data-pharmacy-search]').value = query.get('pharmacySearch') || '';
      const region = stateChoices.find(choice => choice.dataset.state.toLowerCase() === String(query.get('state') || '').toLowerCase());
      filters.querySelector('[data-pharmacy-state]').value = region?.dataset.state || 'all';
      const label = filters.querySelector('[data-state-label]');
      if (label) label.textContent = region?.textContent.trim() || 'Choose state';
      paintControls();
      pageLimit = batchSize;
      apply();
    };
    const resetAndApply = () => {
      pageLimit = batchSize;
      const url = new URL(location.href);
      const pathway = filters.querySelector('[data-pharmacy-class]').value;
      const medication = filters.querySelector('[data-pharmacy-med]').value;
      if (pathway === 'all') url.searchParams.delete('pharmacyType');
      else url.searchParams.set('pharmacyType', pathway.toUpperCase());
      url.searchParams.set('pharmacyDrug', medication === 'all' ? 'BOTH' : medication);
      for (const [attribute, parameter] of [['data-pharmacy-additive', 'additive'], ['data-pharmacy-state', 'state'], ['data-pharmacy-search', 'pharmacySearch']]) {
        const value = filters.querySelector(`[${attribute}]`).value;
        if (!value || value === 'all') url.searchParams.delete(parameter); else url.searchParams.set(parameter, value);
      }
      if (url.href !== location.href) history.pushState(null, '', url.pathname + url.search + url.hash);
      paintControls();
      apply();
    };
    const paintControls = () => {
      filters.querySelectorAll('button[data-filter]').forEach(button => {
        const selected = filters.querySelector(`[${button.dataset.filter}]`).value === button.dataset.value;
        button.setAttribute('aria-selected', String(selected));
        button.removeAttribute('aria-pressed');
        button.tabIndex = selected ? 0 : -1;
      });
      stateChoices.forEach(choice => choice.setAttribute('aria-selected', String(choice.dataset.state === filters.querySelector('[data-pharmacy-state]').value)));
    };
    filters.querySelectorAll('[data-filter-group]').forEach(group => {
      const tabs = [...group.querySelectorAll('button[data-filter]')];
      tabs.forEach(button => button.addEventListener('click', () => {
        filters.querySelector(`[${button.dataset.filter}]`).value = button.dataset.value;
        resetAndApply();
      }));
      group.addEventListener('keydown', event => {
        if (!['End', 'Home', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    });
    const trigger = filters.querySelector('[data-state-open]');
    const popover = filters.querySelector('.p3-state-popover');
    const stateSearch = filters.querySelector('[data-state-search]');
    const closeRegion = () => { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus({ preventScroll: true }); };
    trigger?.addEventListener('click', () => {
      if (!popover.hidden) { closeRegion(); return; }
      stateSearch.value = '';
      stateChoices.forEach(choice => { choice.hidden = false; });
      popover.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      stateSearch.focus();
    });
    stateSearch?.addEventListener('input', () => {
      const query = stateSearch.value.trim().toLowerCase();
      stateChoices.forEach(choice => { choice.hidden = !choice.textContent.toLowerCase().includes(query) && !choice.dataset.state.toLowerCase().includes(query); });
      filters.querySelector('[data-state-empty]').hidden = stateChoices.some(choice => !choice.hidden);
    });
    stateChoices.forEach(choice => choice.addEventListener('click', () => {
      filters.querySelector('[data-pharmacy-state]').value = choice.dataset.state;
      filters.querySelector('[data-state-label]').textContent = choice.textContent.trim();
      resetAndApply();
      closeRegion();
    }));
    popover?.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRegion(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const options = stateChoices.filter(choice => !choice.hidden);
        const index = options.indexOf(document.activeElement);
        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
      }
    });
    document.addEventListener('click', event => { if (popover && !popover.hidden && !event.target.closest('.p3-state-control')) closeRegion(); });
    filters.addEventListener('input', event => { if (event.target.matches('[data-pharmacy-search],[data-pharmacy-additive]')) resetAndApply(); });
    filters.addEventListener('change', event => { if (event.target.matches('[data-pharmacy-search],[data-pharmacy-additive]')) resetAndApply(); });
    loadMore?.addEventListener('click', () => {
      pageLimit += batchSize;
      apply();
      if (!loadMore.hidden) loadMore.focus({ preventScroll: true });
    });
    readPharmacyQuery();
    window.addEventListener('popstate', readPharmacyQuery);
  });

  document.querySelectorAll('[data-pharmacy-reverse-filters]').forEach((filters) => {
    const root = filters.closest('main') || document;
    const cards = Array.from(root.querySelectorAll('[data-pharmacy-reverse-card]'));
    const result = root.querySelector('[data-pharmacy-reverse-result]');
    const empty = root.querySelector('[data-pharmacy-reverse-empty]');
    const names = ['state', 'drug', 'dose', 'duration'];
    const readUrl = () => {
      const query = new URL(location.href).searchParams;
      for (const name of names) {
        const select = filters.elements[name];
        const value = query.get(name) || 'all';
        select.value = Array.from(select.options).some((option) => option.value === value) ? value : 'all';
      }
    };
    const apply = ({ persist = false } = {}) => {
      const active = names.filter((name) => filters.elements[name].value !== 'all');
      const canShow = active.length === 0;
      cards.forEach((card) => { card.hidden = !canShow; });
      if (result) result.textContent = canShow
        ? `Showing ${cards.length} verified source relationship${cards.length === 1 ? '' : 's'}`
        : '0 relationships establish every selected comparison control';
      if (empty) empty.hidden = canShow;
      if (persist) {
        const url = new URL(location.href);
        for (const name of names) {
          const value = filters.elements[name].value;
          if (value === 'all') url.searchParams.delete(name); else url.searchParams.set(name, value);
        }
        history.replaceState(null, '', url);
      }
    };
    const reset = () => {
      names.forEach((name) => { filters.elements[name].value = 'all'; });
      apply({ persist: true });
    };
    filters.addEventListener('change', () => apply({ persist: true }));
    root.querySelectorAll('[data-pharmacy-reverse-reset]').forEach((button) => button.addEventListener('click', reset));
    readUrl();
    apply();
    window.addEventListener('popstate', () => { readUrl(); apply(); });
  });
})();

/* ---- W18 mobile parity ----------------------------------------------------
   Progressive enhancement only: source HTML remains complete without JS.
   Mobile sheets, card tables, swipe rails and quiz choreography are derived
   from the same served markup used at desktop. */
(() => {
  const mobile = window.matchMedia('(max-width: 760px)');

  document.querySelectorAll('main table').forEach((table) => {
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
    if (!headers.length || !table.tBodies.length) return;
    table.classList.add('cs-mobile-card-table');
    for (const row of table.tBodies[0].rows) {
      [...row.cells].forEach((cell, index) => {
        cell.dataset.label = headers[index] || `Column ${index + 1}`;
      });
    }
  });

  let filterSheetNumber = 0;
  const setupFilterSheet = (filters, label) => {
    if (!filters || filters.dataset.mobileFilterReady === 'true') return;
    if (filters.closest('main.listing[data-listing-archetype]:not([data-listing-archetype="D"])')) return;
    const nativeShell = filters.closest('[data-native-pharmacy-filters]');
    filters.dataset.mobileFilterReady = 'true';
    filterSheetNumber += 1;
    const id = filters.id || `cs-mobile-filters-${filterSheetNumber}`;
    filters.id = id;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-mobile-filter-trigger';
    trigger.setAttribute('aria-controls', id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<span>${label}</span><span aria-hidden="true">Tune filters&nbsp;↗</span>`;
    filters.before(trigger);

    const header = document.createElement('div');
    header.className = 'cs-mobile-filter-header';
    const title = document.createElement('strong');
    title.textContent = label;
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Show results';
    header.append(title, done);
    filters.prepend(header);

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'cs-mobile-filter-backdrop';
    backdrop.setAttribute('aria-label', `Close ${label.toLowerCase()}`);
    backdrop.hidden = true;
    document.body.append(backdrop);

    let lastFocus = null;
    const close = ({ focus = false } = {}) => {
      if (!filters.classList.contains('is-open')) return;
      filters.classList.remove('is-open');
      filters.removeAttribute('role');
      filters.removeAttribute('aria-modal');
      backdrop.hidden = true;
      document.body.classList.remove('cs-mobile-filters-open');
      trigger.setAttribute('aria-expanded', 'false');
      window.CS_MOTION?.start();
      if (mobile.matches) filters.hidden = true;
      if (focus) (lastFocus instanceof HTMLElement ? lastFocus : trigger).focus();
    };
    const open = () => {
      if (!mobile.matches || filters.classList.contains('is-open')) return;
      lastFocus = document.activeElement;
      filters.hidden = false;
      backdrop.hidden = false;
      filters.setAttribute('role', 'dialog');
      filters.setAttribute('aria-modal', 'true');
      filters.setAttribute('aria-label', label);
      filters.getBoundingClientRect();
      filters.classList.add('is-open');
      document.body.classList.add('cs-mobile-filters-open');
      trigger.setAttribute('aria-expanded', 'true');
      window.CS_MOTION?.stop();
      (filters.querySelector('fieldset button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled])') || filters).focus({ preventScroll: true });
    };
    const sync = () => {
      close();
      filters.hidden = mobile.matches;
      trigger.hidden = !mobile.matches;
      if (!mobile.matches) backdrop.hidden = true;
    };
    trigger.addEventListener('click', open);
    done.addEventListener('click', () => close({ focus: true }));
    backdrop.addEventListener('click', () => close({ focus: true }));
    filters.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close({ focus: true }); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...filters.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter((node) => node.getClientRects().length > 0);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    mobile.addEventListener('change', sync);
    sync();
    nativeShell?.replaceWith(trigger, filters);
  };
  document.querySelectorAll('[data-provider-filters]').forEach((filters) => {
    // The provider directory and Wegovy product route are the two W18 surfaces
    // whose server-rendered filters make the critical-window sheet conversion
    // more expensive than the interaction it adds. Keep those filters inline;
    // category pages retain the focused bottom-sheet treatment.
    if (['/providers/', '/wegovy/'].includes(location.pathname)) {
      filters.dataset.mobileFilterReady = 'inline';
      return;
    }
    setupFilterSheet(filters, 'Filters and sort');
  });
  document.querySelectorAll('[data-pharmacy-filters]').forEach((filters) => setupFilterSheet(filters, 'Pharmacy filters'));

  /* Keep provider actions fixed until the pre-footer/footer boundary enters
     the viewport, then anchor the bar to the end of main so it cannot cover
     newsletter, footer, or legal links. */
  const providerSticky = document.querySelector('[data-provider-sticky]');
  if (providerSticky) {
    const footer = document.querySelector('.cs-prefooter, .gcs-footer');
    let stickyFrame = 0;
    const syncProviderSticky = () => {
      stickyFrame = 0;
      providerSticky.classList.toggle('is-active', mobile.matches);
      if (!mobile.matches || !footer) {
        providerSticky.classList.remove('is-released');
        return;
      }
      providerSticky.classList.toggle(
        'is-released',
        footer.getBoundingClientRect().top <= window.innerHeight,
      );
    };
    const queueProviderStickySync = () => {
      if (stickyFrame) return;
      stickyFrame = window.requestAnimationFrame(syncProviderSticky);
    };
    // Scroll already runs after geometry changes; update immediately so a
    // WebKit frame delayed at the footer cannot leave the prior mode visible.
    // Keep resize/font/observer work coalesced through the animation frame.
    window.addEventListener('scroll', syncProviderSticky, { passive: true });
    window.addEventListener('resize', queueProviderStickySync, { passive: true });
    mobile.addEventListener('change', queueProviderStickySync);
    if ('ResizeObserver' in window) {
      const stickyObserver = new ResizeObserver(queueProviderStickySync);
      stickyObserver.observe(providerSticky);
      stickyObserver.observe(footer);
    }
    document.fonts?.ready?.then(queueProviderStickySync);
    queueProviderStickySync();
  }

  const swipe = (surface, onPrevious, onNext) => {
    if (!surface || surface.dataset.swipeReady === 'true') return;
    surface.dataset.swipeReady = 'true';
    let startX = 0;
    let startY = 0;
    let pointer = null;
    surface.addEventListener('pointerdown', (event) => {
      if (!mobile.matches || event.pointerType === 'mouse') return;
      pointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      try { surface.setPointerCapture?.(pointer); } catch {}
    });
    surface.addEventListener('pointerup', (event) => {
      if (pointer !== event.pointerId) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      pointer = null;
      if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      if (deltaX > 0) onPrevious(); else onNext();
    });
    surface.addEventListener('pointercancel', () => { pointer = null; });
  };
  /* W9 G01: the medication rail owns its own pointer gesture (see the med-rail block above).
     Binding the generic swipe() here as well made one touch swipe advance twice. */

  const questions = document.querySelector('#quiz-questions');
  if (questions) {
    const paintStep = () => {
      const fields = [...questions.querySelectorAll('.question')];
      fields.forEach((field, index) => {
        field.dataset.mobileStep = String(index + 1);
        field.setAttribute('aria-label', `Quiz step ${index + 1} of ${fields.length}`);
      });
    };
    new MutationObserver(paintStep).observe(questions, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    paintStep();
  }

  const result = document.querySelector('#result');
  const cards = document.querySelector('#match-cards');
  if (result && cards) {
    const setupResultRail = () => {
      if (result.hidden || !cards.children.length || cards.dataset.mobileRailReady === 'true') return;
      cards.dataset.mobileRailReady = 'true';
      const viewport = document.createElement('div');
      viewport.className = 'cs-quiz-result-viewport';
      cards.before(viewport);
      viewport.append(cards);
      const dots = document.createElement('div');
      dots.className = 'cs-quiz-result-dots';
      dots.setAttribute('aria-label', 'Provider result cards');
      viewport.after(dots);
      const items = [...cards.children];
      let index = 0;
      const apply = () => {
        const raw = items[index]?.offsetLeft - cards.offsetLeft || 0;
        cards.style.transform = `translate3d(${-raw}px,0,0)`;
        dots.querySelectorAll('button').forEach((dot, dotIndex) => dot.setAttribute('aria-current', String(dotIndex === index)));
      };
      const move = (delta) => { index = Math.max(0, Math.min(items.length - 1, index + delta)); apply(); };
      items.forEach((item, itemIndex) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.setAttribute('aria-label', `Show provider match ${itemIndex + 1}`);
        dot.addEventListener('click', () => { index = itemIndex; apply(); });
        dots.append(dot);
      });
      swipe(viewport, () => move(-1), () => move(1));
      window.addEventListener('resize', apply, { passive: true });
      apply();
    };
    const reveal = () => {
      if (result.hidden || result.dataset.mobileReveal === 'true') return;
      result.dataset.mobileReveal = 'true';
      setupResultRail();
    };
    new MutationObserver(() => { reveal(); setupResultRail(); }).observe(result, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
    reveal();
  }
})();

// D3b: hero owns the first-screen primary; no-JS keeps the header quiet.
(()=>{const action=document.querySelector('.cs-home2-hero .cs-palette-action, .cs-home2-hero .cs-btn:not(.cs-btn--quiet)');if(!action||!("IntersectionObserver" in window))return;const observer=new IntersectionObserver(([entry])=>{document.documentElement.toggleAttribute("data-d3-hero-action-out",!entry.isIntersecting);});observer.observe(action);window.addEventListener("pagehide",()=>observer.disconnect(),{once:true});})();
