import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

// Exact Git source at fe0df36e273e26a994e6c75d09729295a219e6e8, matching
// the unchanged F17 pin. Historical custody only: no current-source approval,
// production input, provider eligibility, or release authority is conferred.
export function readF17PinnedRegistry() {
  const bytes = gunzipSync(readFileSync(new URL('../fixtures/f17-pinned-program-registry.json.gz', import.meta.url)));
  if (createHash('sha256').update(bytes).digest('hex') !== '7fd52a55dd68967fb2d4428d62785a41457281dac07c1a4f24129677869ab94f') {
    throw new Error('f17_historical_registry_bytes_drift');
  }
  return bytes;
}
