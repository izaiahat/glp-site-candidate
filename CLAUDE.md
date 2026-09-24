# Claude Code instructions — GLP Clinic Scout candidate

This is a private review copy, not the live candidate or a deployment authorization. Work on a branch and submit pull requests; the Hermes **glp-design** seat reviews and applies changes. Do not change the live candidate directly or deploy/publish from this repository.

## Build before test-fix work

Run `npm ci` first. The registered build step in `package.json` is **`npm run build`**, not `npm test`: it generates `public/` and performs the source's full validation chain. Run it successfully **before** diagnosing a missing-output test failure, then run `npm test` and relevant unauthenticated static-site Playwright tests (`npx playwright test --workers=6`; install Chromium if needed). Record the build exit status and post-build test totals. Never treat a missing generated file as a product bug.

**Current mirror hold:** `npm run build` starts by calling the absolute host-only `/home/ubuntu/business/scripts/candidate_build_lock.py require-held` with `CANDIDATE_BUILD_SEAT`; that path and the guarded host lock are not available in the cloud VM. `scripts/build-staging.mjs` also reads `data/indexnow.json`, which was excluded from this private mirror because it contains a key, and uses historical `artifacts/`/predecessor inputs that were excluded. Do not invent a key or bypass the build lock, copy host secrets into this mirror, weaken tests, or claim a post-build baseline from a failed build. Until an authorized, secret-free, self-contained build path and its real post-build baseline are established, **do not start test-fix jobs**. Read-only review/patch-draft work may continue. The original clean-mirror prebuild baseline was 1,438 tests: 1,143 pass, 286 fail, 9 skipped; those failures are not a post-build product baseline.

Tests may be changed **only with a cited accepted receipt**. Never weaken consent/privacy assertions. Keep provider holds, affiliate disclosure, claims, and existing release gates intact. Use unauthenticated static-site Playwright only; do not authenticate to portals or use credentials in tests.
