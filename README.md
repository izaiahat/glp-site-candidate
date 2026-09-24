# GLP Clinic Scout site candidate

Private working copy of the GLP Clinic Scout telehealth provider-comparison site candidate. This is **not** the live site or an authorized deployment source. Source includes site templates, data, validators, Node tests, and Playwright specs; generated `public/`, `artifacts/`, large (>5 MiB) inputs, and sensitive/uncertain files were excluded from this review copy. Some tests may fail because they require those inputs or the original host build-lock path. Do not substitute a green result for the actual test output.

## Setup and tests

```sh
npm ci
npm test
npx playwright test --workers=6
```

For the browser runner, install Chromium as needed (`npx playwright install chromium`). The Playwright config may expect a local server or built output; inspect the selected config and use unauthenticated static-site E2E only. Do not connect tests to live accounts or deploy from this repository.

## Contributing

Submit changes as pull requests, reviewed and applied by the Hermes **glp-design** seat. Do not edit the live candidate directly. Tests may be changed only with a cited accepted receipt; never weaken consent or privacy assertions. Preserve provider holds and the existing review/deployment gates. A passing PR does not authorize publication.
