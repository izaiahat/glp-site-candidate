# SHED identity reconciliation — 2026-08-06 (surface-truth wave)

One merchant, two network offers, one indexable review.

## The ledger says 29; the site says 28. Both are right.

The affiliate machine's enriched-content ledger carries **29 live wire-ins**. The
site's every rendered count says **28 providers**. The difference is exactly one
row: Katalys offer `katalys-1516` ("SHED") and Awin program `shedrx` ("Shed") are
the same merchant — both first-party sources resolve to shedrx.com / tryshed.com.
Two wire-in waves registered the brand twice.

The registry declares the relationship (`profiles.glp-clinic-scout.
canonical_identity`): `shedrx` is the canonical row; `katalys-1516` is a declared
alias with a written reason. `live_rows()` in the deploy completeness sensor
counts one merchant, not two, so 28 is the derived truth on every list, tally,
and count-copy surface. The ledger keeps 29 entries because it tracks **offers**
(network relationships), not merchants — nothing in it needs rewriting.

## SHED-301 (this wave)

- `/reviews/shed/` → **301** → `/reviews/shedrx/` (and `/reviews/katalys-1516/`
  → `/reviews/shedrx/` directly, so no redirect ever chains).
- `/reviews/shed/` left the sitemap; no shipped page links to it internally
  (READY6 sibling rotation and the wave2 related-coverage block both exclude
  alias routes, derived from the registry declaration).
- The READY6 editorial record for the Katalys offer **stays in the tree,
  byte-asserted** — the frozen 2026-08-02 editorial contract, readjudication
  packet, and approval hashes are untouched. Only the route layer changed.
- Enforced persistently: `validate-ready6-editorial.mjs` asserts the alias route
  is sitemap-absent and both 301s exist; `validate-ready6-static.py` derives the
  expected `_redirects` contract from the registry and fails on any internal
  link to an alias route. The next alias merchant inherits all of this without
  editing any of these files.
