# F06 historical inputs — not current serving authority

Exact retained copies from `reports/ops/glp234-final-combined-review-20260927/checkout/` on the authorized host:

- `program-registry.json`: `612814c63d7276d2affe721a7e63664d02703c2554d049a4db25ee61ee05560d` (the original PR4 seven-path + PR8 five-group composition).
- `program-manifest.js`: `cab1f5b4a8437080c09f580daf7be19bb4b9a177673150ba1f1e8f9abe113f7a` (before the current XenTraffic denial).

Both hashes already existed in the unchanged failing tests; these files were copied, not regenerated or reconstructed. They are only historical test inputs. Current registry acceptance remains separately bound by `glp41-approved-input-successor.json`. Current GO comparison uses the native strict held-only successor guard, retaining exact non-held rows and refusing unrelated changes. No fixture grants commercial, source-refresh, production, send, or spending authority.
