# Unified 53-approved-program READY6 successor candidate

Candidate: `glp-approved53-ready6-brand-slug-successor-20260802-r3`

## Scope and safety

This is a local, non-deployed successor candidate. It contains exactly 53 provider-joined/approved programs with exact immutable IDs and provider-issued tracking URLs: Awin 21, Katalys 23, CJ Affiliate 7, and Partnerize 2. Inclusion does not establish Bridge acceptance or deployment authority.

## Coverage model

- `data/approved-program-registry.json` is the exact-ID candidate registry.
- `data/approved-program-evidence-snapshot.json` pins canonical evidence and zero effects.
- `data/review-briefs/*.json` contains one fail-closed review scaffold per exact registry ID.
- `data/ready6-editorial-contract.json` binds the controlling final readjudication, merchant evidence, FDA source, exact routes, and zero effects.
- `src/approved-program-coverage.mjs` validates exact identity, provider counts, evidence bindings, tracking provenance, brief bijection, and state accounting.

Current candidate states:

- 53 provider-issued URLs in the isolated registry; zero tracking clicks.
- 4 accepted existing-page affiliate surfaces unchanged: MadeMed, telos rx, Strut Health, and TRT Nation.
- 6 source-cited, indexable production-review pages: Coivas, Sprout Health, MangoRx, Direct Meds, SHED, and BreezeMeds.
- 43 remaining link-dark review scaffolds pending evidence/editorial work.
- Research partition: 6 direct READY_EDITORIAL, 25 adjacent sister, 1 genuine route block, 0 held, total 32.
- 49 total briefs remain pending Bridge/editorial acceptance; deployment authority is false.

Each READY6 page contains one transparent direct provider-issued CTA, visible affiliate disclosure before the CTA, `index,follow` robots metadata, and one exact sitemap entry. The visitor-facing bytes contain no local-candidate or deployment-status copy. Governance remains explicit outside visitor-facing HTML: Bridge `PENDING`, deployment false, no tracking-click QA, and zero external effects.

The structural scaffold gate is `PASS_SCAFFOLD`, while the full-53 publication coverage gate remains `BLOCKED` because 49 briefs lack Bridge acceptance. This candidate is not deployed and does not claim deployment authority.

## Local verification

```bash
node scripts/build-staging.mjs
npm run validate
npm test
npm run validate:ready6
npm run test:browser -- tests/browser/ready6-editorial.spec.mjs
```
