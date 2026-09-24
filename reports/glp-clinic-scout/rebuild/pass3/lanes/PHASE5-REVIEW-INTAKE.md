# Pass 3 Phase 5 — two-step review intake and durable local moderation boundary

**Verdict:** PASS for the exclusive source lane and focused local verification. The parent-owned serial build, generated-byte integration, served browser run, and any release/deploy remain intentionally unproven.

**Contract:** `reports/glp-clinic-scout/rebuild/pass3/PHASE5-LANE-CONTRACT-20260826.md`
**Candidate:** `site-system/flagship-v2/candidates/glp-visual-ultracode-20260821`
**Service tier:** standard / non-fast
**External effects:** no build, deploy, provider write, spend, commit, or push.

## Implemented

- Replaced the rendered broad review form with a compact, accessible two-step intake:
  1. private verification contact, public display name, and required first provider/pharmacy review;
  2. optional opposite-entity review with explicit Back, Skip-and-submit-first, and Submit-both actions.
- Preserved a useful no-JavaScript multipart fallback posting directly to the same local `/api/review-capture` route.
- Generated lookup options from the existing provider registry and pharmacy render input. The accepted canonical boundary is exactly **33 providers + 90 pharmacies = 123 entities**. The single `SHED` alias remains registry-visible but disabled and is excluded from runtime/backend acceptance.
- Preserved accessible horizontal 1–5 radio ratings, public product/review-type/headline/body/date fields, 2 MB combined optional evidence, truthful/privacy/moderation attestations, private-field warnings, and a held-only success receipt.
- Added a structured `review_intake_v2` request contract while keeping legacy v1 capture compatibility for existing held synthetic receipts.
- Added durable local/D1 persistence for complete primary/counterpart public fields, private verification contact, attestations, evidence metadata/chunks, submitted timestamp, and explicit `held_manual_review` / `publish_approved=0` state.
- Added an atomic-batch requirement for v2. Missing local mode, D1 binding, or `batch()` fails closed with `503 REVIEW_CAPTURE_HELD`.
- Added the approval-gated `approved_review_publication` view; held rows returned an exact public count of **0** in focused tests.
- Hardened exact name/type matching and rejected unknown/mismatched entities, same-type counterparts, future dates, and private health/prescription/member/insurance/payment-card content.
- Carved `/reviews/submit/` out of editorial review-depth augmentation while preserving actual `/reviews/<slug>/` detail routes. The finalizer also removes action-route analytics config/runtime and copies only the first-party intake runtime.
- Added source-authored Playwright coverage for desktop two-step/skip/post/no-egress/public-count behavior and 390 px overflow/touch/reduced-motion behavior. Per contract it was not run before parent integration.

## Exclusive files

| File | Result | SHA-256 |
|---|---|---|
| `src/pass2-review-hub.mjs` | two-step source renderer and registry-derived lookup | `a8e04d2dd68711a4e4aa4a7bb74d52e41f13dd7730c2211ef224d46dd1501c1a` |
| `src/review-capture.mjs` | v2 validation, privacy boundary, multipart parsing, atomic held persistence | `cf070bc577388d66636d63e61b87eca211d9dcae1987754dd554ee8a1c730ae2` |
| `src/local-review-d1.mjs` | transactional D1-like local adapter | `07e006e8f046bd6d7949500a5b95aac4e75d47d091cc49e60df82a6185c6b556` |
| `migrations/004_review_capture.sql` | durable v2 moderation tables/evidence/view | `97976f30862c68bf6771e817e998a96064701a44ed09e454ebad9248ba0da138` |
| `functions/api/review-capture.js` | Pages POST/general request adapter | `38a412380d17b7999a578c092f3757eb85a57009224071bee25809148c506174` |
| `scripts/wave2-repairs.mjs` | intake route carve-out/finalizer/runtime copy | `5f7482da9208b0e94228b8ed88bf38aaec89574c5908f3b74c974d29b21a6cd2` |
| `assets/review-intake.js` | progressive two-step local-only browser runtime | `85480671b787dbd202cc2dadcc9082296cbdec8a8e5df1c8eb53191962e9caeb` |
| `assets/css-src/31-review-intake.css` | scoped compact responsive/a11y/reduced-motion UI | `db437501df6d8036ec7df9056bf5e8fb1c508c8314ae0e534234784d47a90064` |
| `tests/phase5-review-intake.test.mjs` | focused source/validation/D1/multipart/finalizer tests | `edef71ae067c113d0137e5dd91c7631f618f2855a9dbddf48c809226835f4d07` |
| `tests/browser/phase5-review-intake.spec.mjs` | parent-run served browser acceptance spec | `1be71eaf46ca647ed95db6bc8513367965a84c30dbb09fd487c100d51350d6b0` |

`public/`, shared build scripts, `assets/site.js`, `assets/motion.js`, existing CSS layers, and existing tests were not modified. `scripts/wave2-repairs.mjs` was already modified at lane entry; this lane made only the contract-owned targeted additions in that file.

## Verification evidence

### Final syntax and focused tests

```text
node --check (8 changed/new JS/MJS files)
syntax_checked=8 syntax_failed=0

node --test --test-concurrency=1 \
  tests/phase5-review-intake.test.mjs \
  tests/pass2-review-hub.test.mjs \
  tests/review-capture.test.mjs \
  tests/pass2-review-evidence-local-d1.test.mjs \
  tests/pass2-o25-review-runtime.test.mjs \
  tests/review-server.test.mjs

tests=23 pass=23 fail=0 cancelled=0 skipped=0 todo=0
```

The 23 focused tests include **7 new Phase 5 tests** and **16 existing affected review hub/capture/evidence/D1/runtime/server tests**.

### Additional focused checks

- CSS brace balance: `75/75`, balanced.
- Tracked path-restricted `git diff --check`: PASS.
- Untracked per-file `git diff --no-index --check`: **9/9 PASS**.
- Migration executed successfully through two fresh local SQLite/D1 databases.
- v2 evidence proof: one 330,000-byte PNG persisted in **2 ordered chunks**, digest/bytes reconstructed exactly, held status preserved.
- No-JS proof: multipart established field names persisted one primary review with no counterpart, held state, `publish_approved=0`, approved-view count `0`.
- Existing generated action bytes were inspected read-only through the finalizer (no write): `40,542 -> 30,217` bytes; **10,325 bytes** of generated action-page audit/analytics content would be removed; audit `true -> false`, analytics runtime `true -> false`.
- Browser runtime source has exactly one `fetch()` call, targeting only `/api/review-capture`, with `same-origin` credentials and `no-referrer`; no analytics/provider/external URL is present.
- UI effects are 160 ms; reduced-motion forces 0.01 ms. All authored durations are below 300 ms.

### Iteration note

An initial new-test run exposed two assertion-fixture issues (same-type fixture naming and SQLite null-prototype comparison), then the first combined run exposed an existing broad option-count assertion. Compatibility was corrected without weakening the canonical 123-entity backend boundary. The final full focused run above is green at 23/23.

## UI resources actually used

Applied guidance from the mandated UI registry for `anthropics/frontend-design`, `ibelick/baseline-ui`, `ibelick/improve-ui`, `ibelick/fixing-accessibility`, `ibelick/fixing-motion-performance`, and `emilkowalski/improve-animations`, plus the local `website-ui-design-resources` and `refactoring-ui` skills. The resulting primitives are a compact stepper, field groups, radio-card entity controls, horizontal star ratings, upload well, readiness/status receipt, and mobile stacked action group. No external component code, dependency, image, competitor asset, review, identity, prose, tracking, or CDN resource was copied or installed.

## Remaining parent integration steps

1. In the parent-owned serial build orchestration, invoke `finalizeReviewIntakeRoute({ publicDir })` **after** the generic `enforceReviewDepth` step. `applyWave2Repairs()` already invokes it before that later gate; the post-depth call is required to guarantee the final action route remains free of generated self-audit content.
2. Run the canonical serial parent build once. This will assemble `assets/css-src/31-review-intake.css` into shared site CSS and copy `assets/review-intake.js` into generated output without this lane touching `public/`.
3. Serve the fresh generated bytes and run `tests/browser/phase5-review-intake.spec.mjs` at desktop and 390×844, including the mocked one-post/no-egress/unchanged-public-count proof.
4. Re-run the broader parent suite and record generated DOM/browser evidence in `PASS3-RECEIPT.md`.
5. Keep deployment/release/provider writes gated on operator/Fable authority.

## Honest boundary

Proven here: exclusive source behavior, exact canonical lookup counts, v2 validation/privacy/fail-closed semantics, atomic local/D1 held persistence, evidence reconstruction, no-JS fallback, action-route finalizer behavior, and 23/23 focused Node tests.

Unproven here by design: parent serial build integration, generated final bytes, served Playwright behavior, live provider D1 binding/write, deployment, and operator acceptance.
