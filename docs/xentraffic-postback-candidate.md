# GLP-90: candidate XenTraffic Pages receiver

**Source-only; not deployed, configured at XenTraffic, or accepted for release.**
The candidate route is `GET /api/postback/xentraffic`. The older n8n registration
is a different field map and is not silently migrated by this change.

## Original acceptance wording (preserved)

> Targeted tests show authenticated valid acceptance, durable transaction dedupe, reversal semantics, invalid/missing click quarantine, TEST exclusion and privacy-preserving storage. Exact source/patch and existing receiver contracts reviewed before deployment; no synthetic business success.

The six named tests in `tests/xentraffic-postback.test.mjs` address these source
behaviors, with a seventh regression for the actual click-account lineage bug.
They invoke handlers directly with synthetic credentials and real local SQLite;
they do not send callbacks, navigate tracking links or establish partner effects.

## Candidate authentication and exact ownership

- `XENTRAFFIC_POSTBACK_KEY` declares a candidate Pages environment slot for the
  **same already-existing XenTraffic shared secret**, using the existing `pb_key`
  query convention. No real secret was read, created, copied, installed or rotated.
  No fallback to `AFFILIATI_POSTBACK_KEY` exists. Missing binding refuses with 503;
  missing/wrong/duplicate `pb_key` refuses with 403 before payload parsing or SQL.
  Comparison follows the established Pages SHA-256/fixed-digest XOR pattern.
- Source-bound tenant **2068**, partner/account **4384** come from business-control
  `scripts/glp_xentraffic_postback_config.py` (`NETWORK_ID`, `NETWORK_AFFILIATE_ID`)
  and `scripts/marketplace_adapters/everflow.py` (`TENANT_BINDINGS`). The established
  `network_account_ref` stays numeric text `4384`, not a new composite identifier.
  Tenant 2068 is included in event identity and `network_tenant_ref` attributes.
- `src/xentraffic-attribution.mjs` pins the seven exact canonical program/offer/
  issued-link tuples already selected in `data/go-selection-receipt.json`.
  The regression checks full tuple parity, all seven bindings and excluded holds.
  Yucca's historical program slug ends in 3117; its selected offer is **3142**.
  The worker only writes account 4384 for an exact tuple; drift fails closed before
  mapping/redirect. Generic Everflow is not XenTraffic. Promotion gates stay intact.
- Receiver ownership requires exactly one stored click with matching network,
  account, offer and bound canonical program. No request supplies account/tenant.
  Historical NULL-account clicks remain unowned; no backfill or weaker join occurs.

## Five-field payload and storage

Only `payout`, `offer_id`, `transaction_id`, `sub1`, `sub2` plus `pb_key` are allowed;
unknown and duplicate fields are rejected. `sub1` must be the exact lowercase
owned c1 token or UUIDv7. The existing outbound constructor is unchanged.
`transaction_id` is the external transaction identity, never the owned click ID.
`sub2` is optional opaque metadata, not a guessed event/status/TEST macro or click
substitute. Only its SHA-256 survives for replay comparison; raw sub2 is discarded.

Identity fields are bounded tokens; email/URL/control-containing values fail.
Payout is a nonnegative fixed-point hundredth representation, with at most four
fractional digits and only zero sub-cent digits. Empty/absent stays NULL, not zero.
Currency is **unknown (NULL)** because it is absent from this contract. Neither
payout parsing nor `accepted_conversion`/`RECORDED` asserts earned commission,
payable money, cash, advertiser approval or a financial posting.

Persistence reuses `affiliate_click_map` and `analytics_revenue_ledger_v1` with
existing migrations 001/006/007; there is no new schema or remote migration.
Transaction identity is account-wide, independent of program/click/payout, backed
by the ledger's unique event ID. Exact normalized replays are durable no-ops;
changed program, click, offer, payout, metadata or classification conflicts.
Writes require exact readback. A lost write response is reconciled, not blindly
retried; concurrent insert conflicts are read back once.

Server `is_test=1` or a probe reference yields TEST regardless of request data.
Server 0 without a probe is only `server_classified_non_test`; missing lineage
remains UNKNOWN. No incoming TEST flag can promote a record. TEST/UNKNOWN rows
never become commission/payment events, approved balances or ad exports here.
Financial reporting still needs its own classification and reconciliation gates.

## Limited reversal and quarantine policy — independent review required

**Reversal semantics here are reject/quarantine-only.** There is no source-owned
advertiser reversal discriminator in the supplied five fields. Negative payout
returns `400 QUARANTINED / correction_not_supported`; a changed replay returns
`409 QUARANTINED / idempotency_identity_conflict`. Neither changes the original
accepted row. `status` and `event` fields are rejected rather than interpreted.
This does **not** ingest actual advertiser reversals, satisfy future financial
reconciliation, obtain partner approval or waive any later contract requirement.

Invalid/missing/unowned clicks are quarantined **out of the accepted ledger** by
an explicit non-2xx response. This is rejection, not a durable quarantine queue:
no rejected payload, callback URL, authentication key or arbitrary PII is retained.
No queue or operational recovery workflow is activated by this source change.

## Privacy and remaining live limitations

The receiver does not log, fetch or export. It stores bounded reconciliation
identities, normalized payout, server classification, hashes and receive times;
not raw query/headers, cookie, IP, UA, referrer, raw sub2 or probe text. Responses
do not echo payload values. Hashes are not anonymity guarantees, and token shape
cannot prove upstream values contain no sensitive data. Partner payload ownership,
access controls, retention and edge/access-log redaction (especially query `pb_key`)
need independent review before any live integration.

Still held: secret installation, Pages/D1 readiness and exact deployed readback,
partner configuration and macro validation, any callback/canary, real attribution
round-trip, currency/status/reversal wire agreement, financial reconciliation,
merge/release acceptance and operational activation. No provider hold is released.

Run only the focused source checks:

```sh
node --test tests/xentraffic-postback.test.mjs
```

The dedicated PR workflow runs this command at the exact PR head. A green source
check is not full-site build, deployment, partner acceptance or money evidence.
