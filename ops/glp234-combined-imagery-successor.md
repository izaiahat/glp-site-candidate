# GLP-234 combined-source imagery successor — pending independent review

**PROPOSED_PENDING_INDEPENDENT_REVIEW.** This is source preparation authorized by
the coordinator's GLP-234 combined-source assignment, not independent input
acceptance, editorial approval, publication, merge or deployment authority.
No runtime approval flag is added or inferred. The draft consumer amendment must
receive independent exact-byte review before adoption.

## Exact lineages and scope

- Stack/base PR8: `206cccf81ff4ce51988dca76c3bb9571c961fc8b`.
- Integrated PR4: `752572dc8bfa64e5cea2c8da7de6181dade5fbdd`.
- Integrated PR6: `e62afa5e91afe5338f5d364413c4f2d6cde77c85`.
- Original authenticated generation baseline: `e52b7cb903ceaa77ff8d16f958a986398cf3abda`.

The combined catalog keeps PR4's HealthRX/Try Ageless and HSA/FSA article changes
and PR6's oral-guide description. PR8 has no catalog delta. All other article
records are unchanged. PR6's pharmacy scope copy, implementation, historical
verifier and all 106 retention assertions are reused, not recreated. PR8 consent
and public-name changes and PR4 caller/held-route changes remain in the merge.
Merge resolutions retain the union of registered tests, PR8's finally-based lock
release, and PR4's held-output test. No full gate is run here.

## Producer custody (SHA-256)

| Item | Exact digest |
|---|---|
| Original baseline content-batch | `8d9643a68b158b3f44e967dd742fa10e9b83d51191204abd5b1e55b661e7ec24` |
| Combined content-batch | `477d46570c8d27d236813bd0a404d19e21863dbe8d28082b0070c0de0f5a4018` |
| National catalog, unchanged | `a94d52663b17c9f69b2e059b82602cabc6812dd666abcffff670274c0e29622a` |
| Original manifest preimage, retained | `abfcc41435f896df48c68452c59c797c430841a2154149d673b5097e3f6b9af5` |
| PR6 manifest/new producer preimage | `7f3b9b7eca877071039a48caeedcf9fb7778478f38956976300a4f35560f8663` |
| Current producer manifest | `12aa0e7c539a090ebc18482990f8c6e61b0be90a7b1adadca21980711f4599c2` |
| PR6 receipt, unchanged | `0f6d74cbc966525b4a6d4cfffd4868b6e4d90ac95a104da81828d189d3963241` |
| New producer receipt | `3ae3640fe5f767e7ee335f75719b3dbe8995dfe71012eea1cf6725b62de8027c` |

The existing unmodified `generate-article-imagery.py --rebind-sources
--source-baseline <authenticated original root>` returned exit 0. It validated
77 articles, 539 outputs and 1,078 source/public mirrors, with exactly one WARN:
`/guides/healthrx-vs-agelessrx/`. Its original AgelessRx generation inputs, current
Try Ageless projection, nonempty H1/keyword diff and `inputs_stale=true` remain.
The article stays `HELD_SOURCE_REVIEW_IDENTITY_CORRECTION` and its review remains
`STALE_AFTER_IDENTITY_CORRECTION_REVIEW_REQUIRED`. HSA's sections/sources-only edit
is nonstale. This metadata result is not visual or editorial acceptance.

The new receipt is
`artifacts/ultracode/article-image-REBIND-7f3b9b7eca877071-12aa0e7c539a090e.json`;
its exact preimage is retained at the producer's full-content-addressed path.
All masters, derivatives, image-generation facts, old receipts/preimages, frozen
carrier manifest pins and held HTML stay unchanged. Only authenticated existing
derivatives were copied into ignored candidate-local public mirrors. No image
generation, encoding, live registry, full build, browser or paid service ran.

## Additive consumer contract

Only PR6's existing two exact carrier path/hash/route tuples remain eligible.
The existing mandatory six-field validation and frozen article anchor are intact.
The old receipt and original preimage remain required even for this successor.

An exact current manifest digest selects one additional hard-coded receipt.
The successor must authenticate the PR6 manifest as its exact preimage, bind the
old receipt's after-source set as its before-source set, and retain the **whole**
carrier record in that intermediate manifest. Both receipt entries must equal
the independently computed nonstale carrier inputs. The new whole current
manifest and all current source-file hashes are mandatory. Arbitrary future
receipts, missing chain members and unrelated catalog edits fail closed.

The historical comparison entry is unchanged and retains whole-record hashes.
There is no current-to-historical fallback, generic successor registry, caller
approval parameter, exemption for the held HealthRX article, replaced pin or
copied approval marker. Prior authority is not reused to approve this amendment.

## Verification and retained failures

- Existing retention suites: 106/106 PASS; assertions unchanged, fixtures only
  gain the two new mandatory proof files.
- New successor suite: 26/26 PASS, including old/new receipt and preimage byte
  tamper/deletion, unrelated whole-catalog drift, unregistered future manifests,
  historical refusal and prior-manifest/current-catalog mismatch. Before the
  amendment this suite was 16 pass / 9 fail; the positive loader was refused.
- Actual baseline/combined identity-body regression: 1/1 PASS, with repeated
  maintained projection retaining WARN. It reads the exact baseline Git object
  and verifies its hash; preserve repository history when running this check.
- Existing imagery fixtures: 5 pass / 1 FAIL, unchanged. The old missing-baseline
  case copies an already-bound record; the producer does not require a baseline
  for that case. No fixture rewrite or weakened assertion is included.
- Supplemental PR6 SEO tests retain their old whole-catalog/protected-input
  equality assumptions and fail against intentional PR4 deltas; not rewritten
  or waived. The new composition audit proves the exact union separately.
- Bootstrap Node-only diagnostics are not a build and have missing emitted and
  private-input failures. The full registered build/browser gate remains pending.

The maintained bootstrap includes the 26 new Node cases and one Python case.
Its expected Node denominator becomes 382 = existing 250 + PR6 retention 106 +
new successor 26. This count is a requirement, not a claim the full gate passed.

Full local receipts, failure logs, lineage/custody audit and exact-head evidence:
`reports/ops/glp234-combined-imagery-successor-20260927/RESULT.json`.
