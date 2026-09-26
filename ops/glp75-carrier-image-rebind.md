# GLP-75: authenticated two-carrier imagery rebind

This is the operator-assigned implementation of Pro option (a), not acceptance,
publication or release authority. Both articles remain HELD. No frozen manifest,
historical record pin, HTML, media, content, provenance or rebind artifact changes.

## Contract

Only the exact raw frozen carrier manifest path/hash/route tuples for
`/guides/ezra-glp-1-reviews/` and `/guides/top-rated-glp-1-providers/`, and only
the `artifacts/ultracode/article-image-manifest.json` `records`/`route` binding,
exclude these six **top-level** keys from the historical digest:
`image_inputs`, `image_inputs_sha256`, `current_image_inputs`,
`current_image_inputs_sha256`, `image_input_diff`, `inputs_stale`.
Everything else remains under the original digest, including nested keys,
array order, unknown additions, all other bindings and all other routes.

The six fields are mandatory. Their exact schemas/values are recomputed from
the independently frozen article, not from the supplied original input object.
Original and current inputs must be identical for this approved metadata-only
transition: exact empty diff and boolean false stale flag. Missing bindings,
coherently rehashed original/current forgery and stale real input changes fail.
A future rebind is not automatically authorized by this exception.

The registered receipt is additionally authenticated by its unchanged raw
SHA-256 `0f6d74cbc966525b4a6d4cfffd4868b6e4d90ac95a104da81828d189d3963241`.
It authenticates the preimage and exact current image manifest, their source
pins, the current source-file bytes and both per-route input digests. The new
receipt check is **additive**; no historical pin is replaced with a new hash.
Receipt paths go through the existing path and symlink guards. Runtime validation
is inside `loadCarrierArticle`, mandatory through `loadCarrierArticles` in
`build-staging.mjs` before emission; it cannot be skipped by disabling a later
imagery check. Existing asset lengths/hashes and snapshot/output checks remain.

## Generation-baseline equivalence (executed before adopting this anchor)

The existing preimage raw SHA-256 is
`abfcc41435f896df48c68452c59c797c430841a2154149d673b5097e3f6b9af5`.
Its authenticated original source inputs are:

- `data/blog/content-batch.json`: `8d9643a68b158b3f44e967dd742fa10e9b83d51191204abd5b1e55b661e7ec24`
- `data/blog/content-national-wow-additions.json`: `a94d52663b17c9f69b2e059b82602cabc6812dd666abcffff670274c0e29622a`

Read-only verification of the prior registered generation baseline proved the
complete original article digest equals the existing frozen article binding and
the current article digest for each route (actual Node canonical serialization):

| Route suffix | Original/current frozen article digest | Three-field input digest |
|---|---|---|
| ezra-glp-1-reviews | `89bc11c88031e43eaaf9e708f718b76b27d1aa5a50b0008b9d2e7899fbd97f0d` | `22a4cb8694ab77635f615453e30ca2798c5fdd0a33c808f31b83e8df32eeab6d` |
| top-rated-glp-1-providers | `14ebacbf9b484ab9a9d7f5ba4836d35444d6dc104157daa381814b3784f0bbb4` | `245ecd9dd4c5f16baa0b5e2255817401136c789ff899a870c04b43114e724080` |

`generate-article-imagery.py:image_inputs/input_binding` consumes
`canonical_path`, `h1`, `primary_keyword` (empty-string default).
`pass2-generate-route-images.py` derives title/scene/composition from the route.
No article body or hero-brief field enters this projection. Complete article
and held HTML integrity remain protected independently.

Host evidence: `reports/ops/pr6-reseal-20260926/BASELINE-EQUIVALENCE.json`
and its `verify-baseline.mjs`, sourced from the prior registered
`reports/ops/seo-pr6-rebind-20260926/source-baseline`.
The final exact-head checks and full-gate disposition are in that report
folder's `RESULT.json`; do not infer a green gate from this contract document.

## Tests

`tests/carrier-image-rebind-retention.test.mjs` uses the real mandatory loader
without invoking a repairing producer. It checks positive two-carrier retention,
every non-excluded top-level key, nested/array/unknown keys, each missing or
unauthenticated binding, complete binding deletion, coherent forgeries,
receipt/preimage tampering, held HTML and every held asset. All 75 other records
have positive full-hash controls and negative projected-hash controls. An exact
route under a different carrier path/authority also cannot borrow the exception.

Existing retention assertions stay unchanged; their isolated fixture gains the
new mandatory receipt/preimage/source dependencies. Both retention suites are
registered in `scripts/ci-bootstrap-gate.sh`. Focused SEO remains separate.
