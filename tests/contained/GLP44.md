# GLP-44 actual-SDK release regressions

These are strict **currently failing** release gates, not expected-failure tests and not release acceptance. The maintained consent emitter still has SDK-01 (retry after withdrawal) and SDK-02 (automatic `user_engagement`). No event is allowed to reach Google during these tests.

Run manually under the assigned sole heavy browser slot. This standalone runner is deliberately separate from the broad Node VM suite; VM success does not imply SDK success. It imports the current repository's exact consent emitter and Playwright runtime. Acquire the fleet lock through `/home/ubuntu/business/scripts/candidate_build_lock.py` as coordinated for GLP-44, and release it after browser exit, even on failure.

```sh
GLP44_SDK_FILE=/home/ubuntu/business/reports/ops/glp44-sdk-review-20260926/gtag-current.js \
GLP44_SDK_OUT=/home/ubuntu/business/reports/ops/glp44-sdk-fix-20260926/NEW_RUN \
node tests/contained/glp44-actual-sdk.mjs
```

The output directory must not exist. SDK SHA-256 is pinned to `c99a83ab9a4f9b26226657e466ddcefff8a009eac12c2627b857049b21a2c181`. The bytes are never fetched, edited, or stubbed. The predecessor root CSP input is separately pinned. A new capture/CSP requires explicit review, not silently changing the pin.

The two default regression cases are:

- `inflight-revoke-retry`: hold the actual first collection request; withdraw through the native consent controls; fail the held request locally; assert zero new requests for 65 seconds. Passive transport observation records the disable flag at each SDK fetch/beacon. The real fallback is counted even though containment aborts it.
- `active-lifecycle`: grant through the native control, exercise local form/scroll interactions and navigate away; require the exact page_view-only event allowlist and sanitized location/title/referrer. Automatic `user_engagement` is a failure, even if the local proxy prevents delivery.

`SDK_CASES` can select the retained reviewer cases (comma-separated), including denial, GPC, US-default, unknown-region, candidate, synthetic, sensitive entry/referrer, history transitions, delayed SDK, successful-path withdrawal and returning consent. Unknown or duplicate selections fail; every selected case must execute. The runner preserves the reviewer assertions and records each case, trace, emitted runtime and fixture.

## Unsupported boundary, not a shipped workaround

The current architecture puts gtag in the site's main Window. The application controls its command queue but not the SDK's transport closures. Documented `ga-disable-ID` plus denied consent is already applied synchronously on withdrawal. The observed retry nevertheless retains the prior granted request. Removing a script element cannot terminate executed closures.

`send_page_view:false` controls the automatic page_view, not every automatic event. Google's API reference documents config/get/set/event/consent, not an abort handle or SDK teardown. `event_callback` signals event-command processing completion (with a timeout), not completion/cancellation of all transports. It is not a revocation barrier.

A document/iframe lifecycle boundary alone is not a proven event filter: unload/keepalive sends can survive document teardown, and both approved and unapproved events share the collection endpoint. Introducing a realm that owns and validates every transport is a distinct measurement architecture requiring authorization and independent review. No iframe, worker, proxy, server, global network monkeypatch, invented SDK option, event-allowlist expansion or vendor-byte modification is implemented here.

**Minimal decision: keep PR3 draft and GA4 activation held under the existing contract.** If measurement must proceed, separately authorize investigation of an execution/transport-owning boundary; do not assume Admin enhanced-measurement changes fix either demonstrated defect. These tests do not prove impossibility of every alternative architecture, nor do they approve one.

Sources checked 2026-09-26:
- https://developers.google.com/tag-platform/security/guides/privacy#turn-off-analytics — documented disable flag.
- https://developers.google.com/analytics/devguides/collection/ga4/views — send_page_view scope and history behavior.
- https://developers.google.com/tag-platform/gtagjs/reference — public command surface.
- https://developers.google.com/tag-platform/gtagjs/reference/parameters — event_callback / event_timeout.
- https://support.google.com/analytics/answer/9234069 — automatic user_engagement.

This is a minimal source-slice fixture, not a complete built page or deployed-CSP readback. Browser containment is not a packet-capture attestation. Independent acceptance, Admin readback, full build integration and production approval remain separate.
