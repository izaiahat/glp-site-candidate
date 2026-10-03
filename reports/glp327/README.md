# GLP-327 · sponsor rate card and placement examples, rebuilt in the site design system

The operator rejected the earlier hand-built standalone HTML (own `<style>`, own palette, no site shell). All three surfaces are now **site pages**: rendered by the Phase 3 `pageDocument()` renderer, wrapped by the build's shared shell (`addSharedRuntime`: header, drawer, pre-footer, footer, fonts, consent/analytics runtime) and styled only by the shared `site-p3.css` bundle — the same bundle provider pages load. No surface emits a `<style>` block, inline style or colour value.

| Surface | Route | Renderer | Components reused |
| --- | --- | --- | --- |
| Rate card | `/sponsors/rates/` (noindex) | `renderRateCard()` in `src/paid-promo.mjs` | breadcrumbs, `p3-index-hero`, `gcs-kicker`, `lede`, `p3-plans`/`p3-plan-grid`/`p3-plan-card`/`p3-plan-pill`, `cs-price cs-price--xl`, `p3-detail-grid`, `p3-source-disclosure` |
| Sponsored panel | `/providers/`, after filters and before `#provider-results` | `renderSponsorPlacementCandidate()` → `renderSponsoredPanel()` in `src/sponsor-placement-candidate.mjs` | `p3-rail-card p3-rail-card--cta` (the provider rail CTA card), `p3-chip p3-chip--status` ("Sponsored"), wordmark `provider-logo`, `cs-btn cs-palette-action`, `p3-rail-note` |
| Paid promo template | `/sponsors/{provider}/` (noindex), example `/sponsors/example-provider/` | `renderPromo()` in `src/paid-promo.mjs` | provider-detail layout: breadcrumbs, back link, `p3-index-hero` + provider identity, `p3-detail-layout`/`p3-detail-main`/`p3-detail-rail` with the same Sponsored panel in the rail |

The only CSS change is one spacing rule in the shared source `assets/css-src/11-phase3.css` (`.p3-page > [data-sponsored-placement] { margin-bottom: clamp(24px, 4vw, 42px); }`), because `.listing-results` resets the results section's top margin. It has no colour; `npm run build` (`assemble:css`) compiles it into `site-p3.css`. Generated bundles are not committed in this PR.

**Gating.** Everything stays off by default. Only the explicit local build switch `GLP327_SPONSOR_PLACEMENT_PREVIEW=1` renders the `/providers/` panel and writes `sponsors/rates/` and `sponsors/example-provider/`. These pages are `noindex,nofollow,noarchive,nosnippet`, are absent from navigation, the sitemap and the search index, and the panel never enters, reorders or counts toward the results grid, ItemList schema or filters. The preview CTA is a disabled button; there is no destination or affiliate link. A live `/sponsors/{slug}/` page renders only through `renderPromo(order, { preview: false })`, which fails closed without operator, creative, payment, eligibility and inventory approval, a US provider, `held: false`, an https destination and an active 720-hour term, and always rejects Fella Health. That switch is not deploy, sale or booking approval.

## Captures

`scripts/glp327-capture.mjs` captures desktop (1440px) and mobile (390px) PNGs of the three surfaces with an unauthenticated Chromium that blocks every non-local request, and records geometry/contract checks in `captures/CAPTURE.json` (site shell and `site-p3.css` loaded, exactly one Sponsored-labelled panel where expected, panel after filters / before and outside `#provider-results`, noindex, no horizontal overflow, no excluded provider name).

```sh
GLP327_SPONSOR_PLACEMENT_PREVIEW=1 npm run build
node scripts/glp327-capture.mjs            # from built public/
```

**Captures in this PR were made with `--scoped`**, because the registered build cannot finish in this mirror: after imagery and CSS assembly, `build-staging.mjs` stops at `pricing_coverage_deployed_baseline:unreadable_or_malformed` (the host-only deployed release pointer under `/home/ubuntu/business/...` is absent; nothing was fabricated). `--scoped` first requires `npm run assemble:css` (the build's own CSS step), then renders the same routes with the same calls the build makes (`renderConfiguredListing` → `upgradePhase3PageVisuals` → `addSharedRuntime`; `renderRateCard`/`renderPromo` → `addSharedRuntime`). Copy tokens go through the build's own count finalization: `deriveLiveProviders()` (the identity-deduped live-merchant tally `main()` derives from `data/program-registry.json` and the projected content ledger) feeds `resolveDerivedCounts()`, which substitutes `{{LIVE_PROVIDER_COUNT}}` and runs the `assertTalliesDerived` gate on `providers/index.html`. No count is typed anywhere; `CAPTURE.json` records the derived value and fails any frame with an unresolved `{{TOKEN}}`. Other write-time finalizers are not applied. The `/providers/` frame is clipped after the first row of organic cards. Organic card order and content are whatever the repo data renders; they are not changed by this PR.

| Surface | Desktop 1440 | Mobile 390 |
| --- | --- | --- |
| Rate card | `captures/rate-card-desktop-1440.png` | `captures/rate-card-mobile-390.png` |
| `/providers/` Sponsored panel | `captures/providers-sponsored-panel-desktop-1440.png` | `captures/providers-sponsored-panel-mobile-390.png` |
| Paid promo page | `captures/paid-promo-desktop-1440.png` | `captures/paid-promo-mobile-390.png` |

No deployment, sponsor communication, real provider creative or affiliate link is part of this PR. Prices, terms and copy are the operator-approved GLP-327 copy; sponsorship remains subject to final operator approval.
