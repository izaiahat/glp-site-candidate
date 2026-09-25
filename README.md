# GLP Clinic Scout site candidate

Private working copy of the GLP Clinic Scout telehealth provider-comparison site candidate. This is **not** the live site or an authorized deployment source. Source includes site templates, data, validators, Node tests, and Playwright specs; generated `public/`, `artifacts/`, large (>5 MiB) inputs, and sensitive/uncertain files were excluded from this review copy. The mirror's `npm run build` now uses a local nonblocking build lock and retains the original generation/validation chain, but **it does not complete from a clean checkout**: approved image sources under `artifacts/ultracode/phase2-home/source/` and `phase3-product-renders/source/`, `data/blog/content-batch.json` (excluded because of an `owner_key`), `data/indexnow.json` (excluded because it contains a key), and authenticated predecessor artifacts are missing. The build also has host-bound external rail and lastmod provenance dependencies. These must be resolved through their source owners without fabricating keys, images, claims or predecessor receipts. Do not substitute a green result for actual build/test output.

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
