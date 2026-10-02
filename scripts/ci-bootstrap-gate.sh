#!/usr/bin/env bash
# P1.1 host/Actions parity. P1.3 replaces selection with its reviewed harness.
# Not a deploy carrier; no credentials, live tracking requests, or publication.
set -euo pipefail
cd "$(dirname "$0")/.."
printf 'ci-release-gate head=%s\n' "$(git rev-parse HEAD)"
gitleaks git --redact --no-banner .
npm ci --ignore-scripts
npm run build
# The published closure is scanned separately from source/history.
gitleaks dir --redact --no-banner --config .gitleaks.toml public
status=0
node --test --test-concurrency=1 \
  tests/carrier-image-rebind-retention.test.mjs tests/d2s-carrier-article-retention.test.mjs tests/glp234-carrier-successor.test.mjs \
  tests/d2f-consent-defaults.test.mjs tests/d2o-consent-ui.test.mjs \
  tests/d2o-consent-purposes.test.mjs tests/d2o-server-consent.test.mjs \
  tests/d2o-consent-lifecycle.test.mjs tests/d2o-consent-races.test.mjs \
  tests/d2m-paid-consent.test.mjs tests/p27-consent-region.test.mjs \
  tests/welcome-quiz-privacy.test.mjs \
  tests/withheld-promotion-anchors.test.mjs tests/go-runtime-manifest.test.mjs \
  tests/go-link-rel-sponsored.test.mjs tests/trt-nation-link-dark.test.mjs \
  tests/d2w-release2-price-state.test.mjs tests/d2w-held-surface-price-basis.test.mjs \
  tests/mounjaro-coupon-recovery.test.mjs tests/p04-money-legal.test.mjs tests/p04b-rail-identity.test.mjs || status=1
PYTHONDONTWRITEBYTECODE=1 python3 tests/test_glp234_combined_imagery.py || status=1
node scripts/validate-provider-pricing-matrix.mjs || status=1
node scripts/validate-approved-provider-link-monetization.mjs || status=1
node scripts/ci-link-census.mjs || status=1
node scripts/ci-smoke.mjs || status=1
printf 'ci-release-gate required_exit=%s (P1.3 browser-effect harness still required before release)\n' "$status"
exit "$status"
