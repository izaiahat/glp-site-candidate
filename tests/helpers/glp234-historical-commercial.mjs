import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Authentic public-repository source before later accepted commercial overlays.
// Historical custody only: these bytes must never become a current build input,
// permission, selected link, relationship snapshot, or promotion authority.
export const GLP234_COMMERCIAL_REF = '9cd63e73d743d69104fa0a281ce42113743faf4a';
export const GLP234_COMMERCIAL_PINS = Object.freeze({
  'affiliate-activation-selection.json': '63586a11a80878a008c61b0825ff5344726906b0e7efece6811dd986f3db0de6',
  'affiliate-held-link-manifest.json': '613ce4dcd21357466e11f9338c71c554d71c6feac71a57127c2059d0db153675',
  'go-runtime-promotion-authority.json': 'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2',
  'program-manifest.js': '3fc413e3cda459083ba00cdb45ea01264ea0a067253656509c40085170a2c2d8',
  'program-page-eligibility.json': '751f063a70d26ab8f2b420f9d4f433fb7786cbfc59db82e7a3d21c1d03fc9d8b',
});
const readGit = file => execFileSync('git', ['show', `${GLP234_COMMERCIAL_REF}:${file === 'program-manifest.js' ? 'functions/go' : 'data'}/${file}`], {
  cwd: new URL('../../', import.meta.url), maxBuffer: 16 * 1024 * 1024,
});

export function readGLP234HistoricalCommercial(file, read = readGit) {
  assert.ok(Object.hasOwn(GLP234_COMMERCIAL_PINS, file), 'glp234_historical_commercial_scope');
  const bytes = read(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), GLP234_COMMERCIAL_PINS[file],
    `${file}: glp234_historical_commercial_bytes_drift`);
  return bytes;
}
