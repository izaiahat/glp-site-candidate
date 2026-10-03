# GLP327 — plain sponsor website copy

**Fresh copy and native screenshots for independent Fable review. Not accepted, merged or live.**

- Existing PR: https://github.com/izaiahat/glp-site-candidate/pull/20 . Captured rendering source: `194af685b5b7fd3d9242027074a9b4fcc85def3d`; current main `81b1161` merged mechanically, no conflicts.
- Changed only two rendering modules: `src/paid-promo.mjs`, `src/sponsor-placement-candidate.mjs`. Compact layout/shared styles retained. Removed repeated advertising explanations, rhetorical headings and placeholder essays. Neutral Example Provider replaces any inference of a Nu Image client; no Nu Image permission was assumed.
- Contextual **Sponsored** stays beside identity/decision. Example pages say no provider is being promoted. Gated live render names the payer and, when applicable, says “We may also earn a commission if you use this link.” Organic affiliate disclosures remain unchanged.
- $200 initial / 30 days, $100 setup + $100 placement/reporting, $100 affirmative same-scope renewal, 720 hours, no automatic charge, tax/refunds/reporting/no-guarantee terms retained. No new health/performance/endorsement claims.
- RED: new plain-copy regression failed against predecessor. GREEN: 22/22 affected tests; zero failed/skipped. `TESTS.log` retained. The old-capture source-hash assertion failed after edits until redirected to these fresh captures; historical evidence was not overwritten.
- Native Chromium: 6/6 fresh frames pass at 1440×1000 and 390×844; 18 PNGs include expanded controls/no-JS evidence. No overflow, unresolved tokens, browser errors, unexpected external requests or serious/critical axe findings in tested scopes. Keyboard/touch native filter and mobile menu checks pass. No affiliate redirects requested.
- Visually inspected all six unscrolled PNGs. Mobile CTA bottoms: directory 381px, rate 455px, promo 323px. Sponsored/example qualifiers are visible; price, renewal and contact fit rate first screen.
- `CAPTURE.json` binds source hashes and every PNG. New `ops/rebuild-source-manifest.json` explicitly covers only this five-file site-source/test subset; prescribed helper returned `MANIFEST_RESOLVED entries=5 tracked_count=6 dropped_missing=0` then `MANIFEST_OK`. Integrator must refresh its full host source manifest on import.
- Captures use the maintained site's scoped renderer/shared shell/assembled p3 stylesheet, **not a registered full release build**. Prior byte-parity claim is not reused across this main merge; organic source was not edited by this copy patch. Main's provider registry corrections are retained.
- Approved sponsor email/campaign job/send state, all payment/provider/privacy gates and Fella exclusion untouched. No preview published publicly, outreach, payments or paid activation.

## Review these six first-screen PNGs first

|Surface|Desktop|Mobile|
|---|---|---|
|Directory|[desktop](captures/providers-sponsored-panel-desktop-1440x1000-viewport.png)|[mobile](captures/providers-sponsored-panel-mobile-390x844-viewport.png)|
|Rates|[desktop](captures/rate-card-desktop-1440x1000-viewport.png)|[mobile](captures/rate-card-mobile-390x844-viewport.png)|
|Promo template|[desktop](captures/paid-promo-desktop-1440x1000-viewport.png)|[mobile](captures/paid-promo-mobile-390x844-viewport.png)|

Parent: bind genuine Fable copy/design review to this exact successor and six new images, then have the existing GLP44 owner consume the approved rendering modules into the fresh coherent cache/article release. Portable CI and native scoped captures are not release acceptance. No old packet/visual verdict blesses this copy. Existing review-packaging route only; approved email stays byte-identical.
