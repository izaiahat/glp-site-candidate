// Reader-facing identity, not a change to the frozen commercial/evidence name.
// GLP-233 authorizes only this unsupported superlative's removal. Never normalize
// IDs, slugs, URLs, quotes, hashes, permissions, prices or arbitrary body copy.
const LEGACY_SKINNYRX_NAME = 'SkinnyRx - #1 GLP Weight Loss Provider';
const LABEL_FIELDS = new Set(['display_name', 'render_display_name', 'provider', 'publisher', 'merchant', 'entity', 'label', 'alt']);

export function publicProviderName(value) {
  return value === LEGACY_SKINNYRX_NAME ? 'SkinnyRx' : value;
}

export function publicProviderNames(value) {
  if (Array.isArray(value)) return value.map(publicProviderNames);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (typeof child === 'string') {
      if (LABEL_FIELDS.has(key)) {
        if (key === 'alt' && child === `${LEGACY_SKINNYRX_NAME} logo`) return [key, 'SkinnyRx logo'];
        return [key, publicProviderName(child)];
      }
      // Authored quiz rationale begins with the provider name; retain the rest.
      if (key === 'why_match' && child.startsWith(`${LEGACY_SKINNYRX_NAME} `)) return [key, `SkinnyRx${child.slice(LEGACY_SKINNYRX_NAME.length)}`];
      return [key, child];
    }
    return [key, publicProviderNames(child)];
  }));
}
