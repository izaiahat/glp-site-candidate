import { loadGoSelection } from './go-runtime-selection.mjs';
import { loadAffiliateLinkMap } from './affiliate-link-map.mjs';
const selection = loadGoSelection();
const links = loadAffiliateLinkMap('compare');

// A receipt-backed successor replaces the old rail at render time. Frozen
// pricing/evidence inputs keep their exact bytes and dates.
export function selectedGoOutbound(row, surfaceCode) {
  const id = row?.review_slug || row?.program_id;
  const selected = Object.values(selection?.programs || {}).find(p => p.program_id === id || p.render_id === id);
  if (!selected) return null;
  const link = links[selected.render_id];
  if (selected.disposition === 'HOLD' || link?.live !== true) return { held: true };
  if (!/^[a-z0-9][a-z0-9-]{0,79}\.[a-z0-9][a-z0-9-]{0,11}$/.test(surfaceCode)) throw new Error('selected_go_assignment_invalid');
  return { held: false, network: selected.network, issuedHref: selected.issued_link,
    href: `${selected.route}?s=${encodeURIComponent(surfaceCode)}&v=a`, surfaceCode };
}
