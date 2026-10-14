import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scoreProvider } from '../../src/money-page.mjs';

// Retain the exact old wording oracle without reintroducing its unsupported
// present-day implication. These are authentic test-only source bytes.
export const HISTORICAL_SCORE_REF = '9cd63e73d743d69104fa0a281ce42113743faf4a';
let source;
export function historicalUnscoredBlock(row, provider, bytes) {
  assert.equal(scoreProvider(row), null, 'historical wording applies only to an actually unscored row');
  source ??= execFileSync('git', ['show', `${HISTORICAL_SCORE_REF}:src/provider-review.mjs`], {cwd: fileURLToPath(new URL('../../', import.meta.url)), maxBuffer: 128 * 1024});
  const text = bytes ?? source;
  assert.equal(createHash('sha256').update(text).digest('hex'), '0eb926521ef43a69d738e4dd86be03bd37ffff9be5613c9629a8bf2df70dcc94');
  const raw = text.toString('utf8');
  const extract = name => {
    const start = raw.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `authentic historical ${name} exists`);
    const end = raw.indexOf('\n}', start);
    assert.ok(end > start);
    return raw.slice(start, end + 2);
  };
  return new Function('score', `${extract('esc')}\n${extract('scoreBlock')}\nreturn scoreBlock;`)(scoreProvider)(row, provider);
}
