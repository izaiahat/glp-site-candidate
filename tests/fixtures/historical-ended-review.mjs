import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Test-only custody of the authentic pre-marker renderer and full validator
// branch. Current release validation never imports or accepts this old oracle.
export const ENDED_PREDECESSOR_REF = '34db221edec1b3fbf4ae87aac67be64f75c30ca7';
const pins = {
  'src/provider-review.mjs': '54573956d4ea24b06b31da91f6a2873f9256a84ce3904600b9dab5856f6051a6',
  'scripts/validate-provider-fastpath-plus5.mjs': 'd6e552df4dd6b857a85476a566e5994dcb1d934deb77c2f9b25e945789d38532',
};
export function historicalEndedSource(file, bytes) {
  assert.ok(Object.hasOwn(pins, file));
  const raw = bytes ?? execFileSync('git', ['show', `${ENDED_PREDECESSOR_REF}:${file}`], {cwd: fileURLToPath(new URL('../../', import.meta.url)), maxBuffer: 128 * 1024});
  assert.equal(createHash('sha256').update(raw).digest('hex'), pins[file], `authentic ended predecessor:${file}`);
  return raw.toString('utf8');
}
export function historicalEndedValidator(bytes) {
  const source = historicalEndedSource('scripts/validate-provider-fastpath-plus5.mjs', bytes);
  const start = source.indexOf('  const selected = currentSelection?.programs?.[provider.program_id];');
  const end = source.indexOf('  // 2026-08-06 cluster 1:', start);
  assert.ok(start > 0 && end > start);
  return new (Object.getPrototypeOf(async function(){}).constructor)('assert', 'provider', 'currentSelection', 'promotionAuthority', 'GO_RUNTIME_MANIFEST', 'html', 'programRegistry', `let activeAffiliateCtas=0; const commerciallyActive=false; ${source.slice(start,end)}; return activeAffiliateCtas;`);
}
export async function historicalEndedRenderer(bytes) {
  const source = historicalEndedSource('src/provider-review.mjs', bytes);
  const origin = new URL('../../src/provider-review.mjs', import.meta.url);
  // Relocate only module resolution, not renderer logic. Every relative import
  // and asset lookup still resolves to the unchanged native dependency closure.
  const relocated = source.replace(/from (["'])(\.\/[^"']+)\1/g, (_all, _quote, specifier) => `from ${JSON.stringify(new URL(specifier, origin).href)}`).replaceAll('import.meta.url', JSON.stringify(origin.href));
  return import(`data:text/javascript;base64,${Buffer.from(relocated).toString('base64')}`);
}
