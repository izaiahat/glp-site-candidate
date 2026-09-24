# Claude Code instructions — GLP Clinic Scout candidate

This is a private review copy, not the live candidate or a deployment authorization. Work on a branch and submit pull requests; the Hermes **glp-design** seat reviews and applies changes. Do not change the live candidate directly or deploy/publish from this repository.

Setup: `npm ci`. Run `npm test` and the relevant Playwright tests using `npx playwright test --workers=6` (install Chromium via `npx playwright install chromium` if needed). Record actual failing and passing results. Some generated outputs and files over 5 MiB are intentionally absent; do not falsify green tests or bypass the host build-lock gate.

Tests may be changed **only with a cited accepted receipt**. Never weaken consent/privacy assertions. Keep provider holds, affiliate disclosure, claims, and existing release gates intact. Use unauthenticated static-site Playwright only; do not authenticate to portals or use credentials in tests.
