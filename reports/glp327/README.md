# GLP-327 · sponsor rate card, paid promo template and /providers/ Sponsored slot

All three surfaces are **site pages**: rendered by the Phase 3 `pageDocument()` renderer, wrapped by the build's shared shell (`addSharedRuntime`: header, drawer, pre-footer, footer, fonts, consent/analytics runtime) and styled by the shared `site-p3.css` bundle that provider pages load. They are built from existing components (`p3-rail-card--cta`, `cs-card`, `cs-btn`, `p3-chip`, `cs-price`, `cs-details`, `p3-detail-grid`, `p3-source-disclosure`, `provider-logo`). No surface emits a `<style>` block, inline style or colour value.

**Layout rework (operator rejection 2026-10-03).** The earlier pages matched the theme but wasted the first screen on giant headings and buried price, offer and CTA. Composition now lives in the shared CSS source: one block in `assets/css-src/11-phase3.css`, compiled into `site-p3.css` by the build's `assemble:css`. It is scoped to `data-sponsor-*` hooks that only the sponsor renderers emit. It uses grid, flex, spacing and type scale from the shared tokens, with no colour literals, font-family, visibility, opacity, shadow or animation declarations. `tests/glp327-sponsor-design-system.test.mjs` enforces that contract.

| Surface | Route | First viewport (390x844 and 1440x1000) |
| --- | --- | --- |
| Rate card | `/sponsors/rates/` (noindex) | Short title ("Sponsor placements") and one-line explainer. Then one offer card: Initial 30-day pilot, **$200**, "$100 setup + $100 placement and reporting", the two labelled deliverables (directory placement, sponsor page), the $100 same-scope renewal with no automatic renewal, a **Discuss a placement** `mailto:partners@glpclinicscout.com` CTA, and the no-paid-ranking disclosure. On desktop the native Sponsored-panel example sits beside it. |
| Paid promo template | `/sponsors/{provider}/` (noindex), example `/sponsors/example-provider/` | One lead card: Sponsored label, a single provider identity, the concise paid intro, the primary provider-information button (disabled in preview) and the ad/independence disclosure. A "Program at a glance" card shows the four slots an approved provider brief fills (summary, published price, eligibility/states, current offer). In preview each slot says it is reserved; no fact is supplied. |
| Sponsored panel | `/providers/`, after the filters and before `#provider-results` | Sponsored label, identity and primary CTA within the first 844px on mobile; to the right of the copy on desktop. |

Below the fold, the rate card keeps every approved term:
- remaining pilot items, renewal reporting and the "no guarantee" line;
- booking, payment, tax and refund terms, which stay visible;
- the audience and reporting note, as the only accordion.

The promo continues with the "What to check" checklist, the independent comparison path and the publisher disclaimer. Sponsor pages end in a partner pre-footer ("Questions about a placement? Email partners@glpclinicscout.com."). They do not end in the reader price-alert band; the shared site footer is unchanged.

**Email aliases.** Per the operator (2026-10-03), the PayPal remittance address (`ops@`) goes only in the order email. The public rate page says "PayPal payment details are supplied after a confirmed order. Contact: partners@glpclinicscout.com." Both sponsor pages pass the repo's `validate:email-aliases` audit (`auditPage`), which the capture runs on the exact captured bytes and fails on any finding.

## /providers/ preview composition

The composition applies only with `GLP327_SPONSOR_PLACEMENT_PREVIEW=1`. With the switch off, the `/providers/` listing renders the original composition byte for byte. The full shell output is identical apart from the shared `?v=` asset hash, which changes because `site-p3.css` gained the GLP-327 block.

With the switch on, the same markup is reordered and compacted:
1. **Intro.** Heading, prices-checked date, support line with the live count, and the commission disclosure, all compacted. The two state controls share one row.
2. **Filter bar.** Search, sort and state stay visible. Medication, form, plan, longer plan and dose are the same chip groups and runtime hooks, placed behind a native `<details>` labelled "More filters". The filter runtime still applies them (smoke-tested: Tirzepatide + Search narrows 50 to 45 records).
3. **Sponsored panel.**
4. **Moved organic intro pieces.** The registry-scope note ("We track 57 providers…") and the organic first-card preview, unchanged, now directly above the results.
5. **Results.** The independent results section, source disclosure and runtime, byte-identical to the switch-off render.

No organic record, order, count, schema or disclosure is removed or changed. `tests/glp327-sponsor-layouts.test.mjs` asserts each of these.

## Captures

`scripts/glp327-capture.mjs` loads each surface at 1440x1000 and 390x844 in unauthenticated Chromium, blocks every non-local request, and writes:
- **`*-viewport.png`:** the unscrolled first viewport, accordions collapsed, exactly as rendered.
- **`*-full.png`** (sponsor pages): the full page, with the secondary-terms accordion expanded for use as an attachment reference.
- **`providers-sponsored-panel-*-page-through-first-results.png`:** `/providers/` renders every organic record and is about 74,000px tall on mobile. Its page image is top-anchored and ends after the first row of independent results. `--providers-full-page` writes the unbounded page.

`CAPTURE.json` records, per frame:
- the fold rects of the required elements, which must be fully inside the unscrolled viewport and not covered (checked with `elementFromPoint`);
- `h1` font sizes, with limits of ≤48px desktop and ≤32px mobile;
- horizontal overflow, noindex, the sponsor pre-footer and the directory controls;
- the Axe WCAG A/AA serious/critical result, which must be zero;
- external requests and the email-alias gate.

```sh
GLP327_SPONSOR_PLACEMENT_PREVIEW=1 npm run build && node scripts/glp327-capture.mjs   # from built public/
npm run assemble:css && node scripts/glp327-capture.mjs --scoped                       # mirror without host inputs
```

**Captures in this PR were made with `--scoped`.** The registered build cannot finish in this mirror: `build-staging.mjs` stops at `pricing_coverage_deployed_baseline:unreadable_or_malformed` because the host-only deployed release pointer is absent, and nothing was fabricated. `--scoped` renders the same routes with the same calls the build makes: `renderConfiguredListing` → `upgradePhase3PageVisuals` → `addSharedRuntime` for `/providers/`, and `renderRateCard`/`renderPromo` → `addSharedRuntime` for the sponsor pages. It finalizes count tokens through `deriveLiveProviders()` → `resolveDerivedCounts()` (with the `assertTalliesDerived` gate) and serves the CSS assembled from the shared source. The build's other write-time finalizers are not applied. Host build verification is the parent's.

Nothing is deployed or sold, and no sponsor or email was contacted or sent. The panel and promo page stay off by default, noindex, and unlinked from navigation, the sitemap and the search index.
