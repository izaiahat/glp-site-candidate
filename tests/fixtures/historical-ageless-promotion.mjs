import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Exact data/go-runtime-promotion-authority.json from authentic Git
// 9cd63e73d743d69104fa0a281ce42113743faf4a, before b94f904's relationship overlay.
// Historical pause provenance only: never a current approval or renderer input.
export function historicalAgelessPromotion(bytes = readFileSync(new URL('./ageless-promotion-pre-relationship.json', import.meta.url))) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2');
  return JSON.parse(bytes).programs['try-ageless'];
}
