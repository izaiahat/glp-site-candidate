# GLP-327 — content-first sponsor layout correction

**Awaiting the parent's independent visual review. Not operator approval. No send, payment, activation, merge or release.**

- PR: https://github.com/izaiahat/glp-site-candidate/pull/20
- Branch: `glp327/sponsor-placement-candidate`
- Captured source: `617928ea8cb8f3cd461b24256d0f95c5c7c38f75`
- Rejected predecessor: `b03ce727ac75009df1cf8e82dd8e3f97fd41d8ce`

## Composition correction

- Directory: concise heading and one provider-search / themed Search / closed native Filters row. All medication/form/plan/duration/dose/sort choices, one native state selector and themed Reset are inside Filters. Removed enhanced duplicate state injection and state reparenting. Sponsor remains after controls and outside the byte-identical organic results. Counts, price provenance, methodology and organic commission disclosure follow the sponsor.
- Rate: no breadcrumb, kicker or explanatory hero. Short title immediately precedes **$200 / 30 days**, the $100 setup + $100 placement/reporting split, two short deliverables, **$100 / 30 days same-scope renewal**, no-auto-renew terms and contact CTA. Full scope, routes, 720-hour term, affirmative renewal, reporting, tax, refunds and no-guarantee terms remain below.
- Promo: one Sponsored label and provider title, explicit factual placeholder, disabled CTA and conspicuous ad disclosure, then useful program-information slots. No fabricated NuImage facts or destination.
- Sponsor pages: maintained shared brand/tokens/components with only “Compare providers” in the header; no consumer mega-navigation or search. Directory navigation remains usable.

## Native first-screen evidence

Personally viewed all six unscrolled PNGs. The offer/card, rather than controls or narrative, now leads each screen. Geometry is supporting proof, not design acceptance.

| Surface | Mobile key positions (390 × 844) | Desktop CTA (1440 × 1000) |
|---|---|---|
| Directory | Sponsored panel top **210px**; CTA **402–453px**; closed filter row **54px** | **317–367px** |
| Rate card | Price top **164px**; CTA **405–455px** | **404–454px** |
| Promo | CTA **272–323px** | **280–330px** |

### Six viewport PNGs — review these first

- [Directory mobile](captures/providers-sponsored-panel-mobile-390x844-viewport.png)
- [Directory desktop](captures/providers-sponsored-panel-desktop-1440x1000-viewport.png)
- [Rate mobile](captures/rate-card-mobile-390x844-viewport.png)
- [Rate desktop](captures/rate-card-desktop-1440x1000-viewport.png)
- [Promo mobile](captures/paid-promo-mobile-390x844-viewport.png)
- [Promo desktop](captures/paid-promo-desktop-1440x1000-viewport.png)

### Expanded and supplementary evidence

- [Filters desktop](captures/providers-sponsored-panel-desktop-filters-expanded.png), [mobile](captures/providers-sponsored-panel-mobile-filters-expanded.png)
- [No-JS Filters desktop](captures/providers-sponsored-panel-desktop-filters-nojs.png), [mobile](captures/providers-sponsored-panel-mobile-filters-nojs.png)
- [Audience/reporting desktop](captures/rate-card-desktop-audience-expanded.png), [mobile](captures/rate-card-mobile-audience-expanded.png)
- Six supplementary page images accompany the viewport files. Directory page captures are top-anchored and bounded through the first organic results row, not the entire very long directory; rate full-page images expand the audience note.

## Verified

- **21/21 affected source tests pass**: `paid-promo`, `sponsor-placement-candidate`, `glp327-sponsor-design-system`, `glp327-sponsor-layouts`. One added clutter regression tightens directory panel/CTA, rate price/CTA and promo CTA positions instead of accepting anything below 844px.
- **6/6 native Chromium frames pass**, with no horizontal overflow, unresolved count tokens, browser page errors, unexpected external requests or serious/critical axe findings. Shared shell, disclosure, noindex, email-alias and preview-only assertions remain.
- Expanded native Filters work via keyboard and touch. Native state updates URL/heading; arrow-key filter tabs and provider autocomplete/Enter work; Reset clears state/search. Mobile expanded controls meet 44px minimum touch targets. Directory mobile navigation opens by touch and closes with Escape. Expanded controls pass serious/critical axe.
- No-JS native details, state options and organic cards remain accessible; actual search/filter application still requires JavaScript, as before. Native controls don't pretend to provide server-side filtering.
- `PARITY.json`: entire preview-OFF directory renderer output is byte-identical to the rejected predecessor (`12aa8510…`); preview-ON organic section/lazy payload/tail/runtime is byte-identical (`398090cd…`). All **18 filter choices** and **52 native options (51 states/DC + placeholder)** retained. Fella/holds/privacy gates and approved email untouched.
- `CAPTURE.json` binds every PNG and the maintained rendering source/assembled p3 bundle with SHA256. Its `head` is the captured **source** commit. The subsequent evidence-only commit adds these artifacts without changing rendering source.

## Reproduction and limits

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
# Acquire the real host candidate_build_lock before assembly/browser work.
npm run assemble:css
node scripts/glp327-capture.mjs --scoped reports/ops/sponsor-clean-layout-20261003/captures
node --test tests/paid-promo.test.mjs tests/sponsor-placement-candidate.test.mjs tests/glp327-sponsor-design-system.test.mjs tests/glp327-sponsor-layouts.test.mjs
```

These are real site-renderer/shared-shell/assembled-CSS captures in the private mirror, with registry counts finalized by the build's own derivation. The mirror lacks host-only registered full-build inputs; this is **not a release build**. No broad suites were run. Portable exact-head GitHub CI is distinct from native browser/build verification. No Cloud writer was started and no pipeline worker interrupted; the heavy/browser admission lock was acquired and released normally.

Parent remains the issue/delivery owner and must independently inspect the PNGs before deciding on any resend. Nothing was sent or accepted on the parent's behalf.
