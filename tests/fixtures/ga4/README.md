# GA4 SDK fixture and accepted contract

Unmodified Google public SDK, copied from the retained PR #3 actual-SDK review capture (`reports/ops/glp44-sdk-review-20260926/gtag-current.js`).

- URL: `https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer`
- Captured: 2026-09-26T07:57:30.848504+00:00; HTTP 200, no cookies/referrer, not executed during fetch.
- Bytes: 522101; SHA256: `c99a83ab9a4f9b26226657e466ddcefff8a009eac12c2627b857049b21a2c181`.
- Copyright belongs to Google. Test fixture only, not a vendored production SDK.

`ga4-sdk-contract.spec.mjs` runs these bytes with the emitted consent runtime, locally fulfilled Google transport and context-wide default-deny interception. The registered no-write browser runner adds a non-forwarding proxy. No real Google collection occurs. Fixture models ordinary-browser/production-seal eligibility; it is not live GA Admin verification or production acceptance.

Authority: `ops/linear/approvals/OPERATOR-DECISION-20260926-ga4-on.md`. The GA-only successor replaces PR3's strict zero post-withdrawal transport requirement: already-in-flight request completion/retry is accepted; no NEW loads/events/page_views on subsequent pages is permitted. Automatic `user_engagement` is accepted. The held-request case records every attempt through 65 seconds then verifies navigation silence. PostHog's stricter oracle remains untouched.

Native enhanced measurement collects DOM-derived link URLs, form metadata and history. The site blocks those collectors per page and emits minimal `scroll` (90%), `click` (outbound=true) and `file_download` events with no destination, text, filename or form fields. Quiz/matches/intake/calculator/search routes emit only neutral `/private/` page views (plus SDK lifecycle engagement); queries, fragments, document title and referrer never become analytics dimensions. Tests fail on unapproved native events, canaries, unexpected transport or CSP-masked silence. Future Google SDK/property changes require replay of this contract; no GA Admin changes are made here.
