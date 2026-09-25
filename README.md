# GLP Clinic Scout site candidate

Private working copy of the GLP Clinic Scout telehealth provider-comparison site candidate. This is **not** the live site or an authorized deployment source. It retains the original validator chain and carries the exact, hash-checked Phase 2/3 source PNGs, article/carrier inputs, public IndexNow ownership proof, canonical affiliate rail resolver, accepted evidence-adoption records, and authenticated predecessor pages needed for a detached build. The IndexNow key is the already published `public/<key>.txt` ownership proof, not an account credential; article `owner_key` values are editorial ownership slugs/phrases. The historical production receipt, deployment manifest, and pointer are retained byte-for-byte, with predecessor file access relocated inside `data/predecessors/content-base/release/`; missing or altered predecessors must fail the existing SHA checks. Build outputs remain ignored. No cloud job, release, or production change is authorized by this copy.

## Setup and tests

```sh
npm ci --ignore-scripts
npm run build
npm test
npx playwright test --workers=6
```

For the browser runner, install Chromium as needed (`npx playwright install chromium`). The Playwright config may expect a local server or built output; inspect the selected config and use unauthenticated static-site E2E only. Do not connect tests to live accounts or deploy from this repository. `.github/workflows/mirror-ci.yml` is **manual-only** until the operator verifies included/free Actions capacity for this private repo; do not dispatch it on paid capacity. A failed build prevents its post-build test step, so a prebuild `npm test` run is not a post-build baseline.

## Contributing

Submit changes as pull requests, reviewed and applied by the Hermes **glp-design** seat. Do not edit the live candidate directly. Tests may be changed only with a cited accepted receipt; never weaken consent or privacy assertions. Preserve provider holds and the existing review/deployment gates. A passing PR does not authorize publication.
