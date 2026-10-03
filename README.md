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

D4 designates this private repository as the reviewable source for candidate code. Submit changes as pull requests, reviewed by the coordinator. Do not edit the legacy live candidate directly. Private runtime inputs remain separately governed: the four newly issued ClickDealer URLs and their private registry delta are deliberately NOT imported into Git. The registered hash-only authority and generated runtime source modules are imported byte-for-byte from the candidate, not hand-regenerated. Their source renderer and unchanged regression tests are retained; a failing private-input test is not waived or green. This checkout is a reproducible code/build baseline, not proof of complete private runtime parity.

`ops/source-input-manifest.json` enumerates the curated index, including authenticated historical predecessor inputs. Never stage with `git add .`; append exact reviewed paths and refresh the manifest. Preserve existing historical provenance files byte-for-byte.

Run `bash scripts/ci-bootstrap-gate.sh` on the exact PR head for the **ci-release-gate** host fallback. `.github/workflows/ci-release-gate.yml` uses that same command. It requires source/history and publish-closure gitleaks scans, a fresh dependency install, validated build, consent/privacy, affiliate authorization and held/paused/Fella negatives, pricing/claims checks, and candidate-owned Pages-equivalent HTTP smoke without following affiliate redirects. The P1.3 reviewed browser-effect harness and negative controls are still required before this becomes release authority. Full Node/frozen-byte and no-egress emulation suites are diagnostic warnings, never substitutes for required checks.

Actions availability read on 2026-09-25: repository workflow API returned `total_count: 0` (main has no registered workflows); PR #2 contains manual-only workflow source. User billing-minutes API returned HTTP 404 and reported missing `user` scope. Included minutes and billing behavior are **unknown**. No hosted run, PR trigger, paid capacity, plan change, or runner registration is authorized. Until capacity is confirmed, **CI green means all required ci-release-gate checks PASS on the exact PR head on this host, with command, SHA, exit status and sanitized log pasted into the PR**. A build PASS alone is not CI green. D7-defer means coordinator-enforced merges, not GitHub-enforced branch protection.

Do not edit the live candidate directly. Tests may be changed only with a cited accepted receipt; never weaken consent or privacy assertions. Preserve provider holds and the existing review/deployment gates. A passing PR does not authorize publication.
