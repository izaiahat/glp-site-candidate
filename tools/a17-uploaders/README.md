# A17 bounded uploader work copy

Local-only continuation of the actual A12b-guarded A6 uploaders. Original A6 files are immutable; `A17/uploader/A6-PREIMAGE.json` binds the copied originals.

## Run (from train work-copy root)

```sh
python -m unittest discover -s tools/a17-uploaders -p 'test_*.py' -v
python -m unittest discover -s tools/a17-uploaders/meta -p test_sender.py -v
python -m unittest discover -s tools/a17-uploaders/microsoft -p test_uploader.py -v
python tools/a17-uploaders/run_dryrun.py --output /absolute/local/report/DRYRUN-PAYLOADS.json
```

Requires Python 3.12 and `jsonschema` 4.x (Draft202012Validator). No credentials, SDK, endpoint, deployment, or network adapter is required or accepted by the runner. The copied CLIs without a resolver continue to fail closed.

`issuer_adapter.StagingIssuerResolver(database, clock=...)` is a read-only LOCAL SQLite seam. Each resolve opens a fresh coherent transaction and validates full immutable A12b permission/consent shapes. The trusted clock defaults to current server milliseconds; fixed clocks are fixture-only runtime injection. Do not construct an adapter from browser JSON. Do not use the synthetic writer as a production seed tool.

Required database columns: a6_platform_event_permissions(evidence_ref,permission_json), a6_advertising_consent_receipts(receipt_id,consent_json), a17_issuer_probes(probe_ref,probe_json), a17_issuer_revocations(subject_ref,permission_ref,epoch), a17_issuer_scopes(scope_id,permission_ref,scope_json), a17_issuer_reviews(review_ref,review_json), and a17_issuer_sessions(session_id,session_json). The writer must enforce unique immutable record keys, monotonic revocation (including wildcards), authenticated source provenance, and atomic issuance. An exact subject/permission revocation row is mandatory: missing state is not epoch zero. No legacy missing-scope-table fallback exists. The resolver rejects duplicate JSON keys and unavailable/malformed records, checks notice bytes against their digest, and binds session scope/origin/epoch/GPC/age/jurisdiction. Permission and consent records remain unchanged and retain whole-record canonical digests.

A server-owned administrative fixture probe additionally carries `source_kind=TEST_SERVER_OWNED_ADMINISTRATIVE_INQUIRY` and the complete native source-row digest. Consumer quiz/affiliate CaptureProbe records must NOT acquire that label or source digest. Uploader source authority is not permission to reinterpret a `/go` click as an inquiry.

Meta payload contains an explicitly fictional `OFFLINE_ONLY` test-event code and synthetic dataset; it is a native CAPI request shape, not a vendor-accepted test. Microsoft fixture uses the TEST_A12_Microsoft_B2BInquiry goal name, non-platform TEST goal ID, UTC conversion time, explicit zero value/USD. Legacy TEST network/program columns are codec bookkeeping, not an affiliate sale. Original source files retain their legacy fixture path; only this copy admits the distinct synthetic B2B capture-source label under the exact staging resolver.

Positive reservation tests invoke only OfflineTransport/Mock callbacks. These local callback invocations are counted separately from external sends (zero). After durable reservation, every actual copied dispatcher resolves fresh database records; revoke/expiry/store timeout/source mutation and forged authority block transport and persist a blocked ledger state. A blocked or ambiguous reservation is never automatically reopened.

The actual parent JavaScript issuer-to-uploader path is exercised: `issue_fixture.mjs` calls issuePermission/registerSession and advertisingConsent GET/POST, registers a separate typed synthetic administrative probe, then exports the actual database with VACUUM INTO. The send-time suite and final dry-run runner read these issuer-written records. The typed wrapper is `kind=a17-uploader-source-v1`, with probe, session_id and permission_ref; ordinary consumer/capture wrappers cannot be used. Current scope/review/session/epoch are re-read in the same transaction. Node 22+ with node:sqlite is required for this fixture bridge.

Remaining boundaries: no live administrative event producer, platform permission, authentic ad click, platform test code/goal, production D1 adapter, final-read-to-network atomicity, attribution, release, or vendor erasure is claimed.
