# Eden qualified projection — source only

Producer/policy owner: [glp-business PR123](https://github.com/izaiahat/glp-business/pull/123). Renderer owner: this repository, not the old generated candidate HTML. No source sync, producer invocation, date renewal, merge or release is authorized by this PR.

## Interface and actual maintained consumers

The existing taxonomy row gains one optional `claim_qualification` plain-text field. It participates in its normalized digest only when present (historic unqualified rows retain identical digest bases). Validation rejects nonstrings, empty/untrimmed/over-2000-character values and markup/control characters. Eden's producer accepts only the independently reviewed exact text and exact four source URLs; it preserves all seven tags and link states. The previous complete row, bindings, dates and sources remain in the existing immutable verification manifest.

`src/therapeutic-taxonomy.mjs` validates/reconciles rows, resolves canonical identities and projects dynamic-profile-backed public compare rows/quiz candidates. Qualified rows carry their four active source URLs and note through `publicTaxonomy`; the public digest authenticates both taxonomy and dynamic profile. Dynamic-profile clocks are not renewed. The native profile/taxonomy consistency gate is unchanged.

`src/money-page.mjs` emits the note next to the options in both maintained table revisions (also used by `src/blog-system.mjs`), and next to affected branded facts/pros/cons in other row-owned projections, never blanket legal copy. Only qualified rows say "Reported options (conditional advertisement)" rather than "Verified options". All HTML text is escaped.

`src/quiz.mjs:buildPhase4PageData` carries the note and exact membership into `candidate_records`, consumed by both `src/quiz.mjs:renderQuiz` and `src/matches-customized.mjs:renderMatchesCustomized`. Both maintained card runtimes (`assets/quiz-page.js` and `assets/matches-customized.js`) use `textContent` for an always-visible adjacent qualification. The current survey completion hands off to `/matches/customized/`; testing only legacy quiz candidates would miss the actual consumer.

## Evidence and limits

The labelled closure fixture is generated offline by replaying the four actual retained October 1 producer receipts, not network collection. Its capture timestamps describe captures, not adopted renewal. Three extra control rows/profile/calculator details used by tests are synthetic. Consumer-authority fixture bytes are unchanged previously captured transitive inputs required by the native projection validator; CI maps them to its expected local paths in the ephemeral runner only, not the operator host.

Focused tests execute the native taxonomy, dynamic profile and consumer-authority validators, public projection, all five required compare paths, both table revisions, provider branded-prose projections, Phase4 dataset, and actual customized-matches DOM runtime. The DOM presentation fixture explicitly supplies a synthetic result-set entry; it is not live ranking/eligibility acceptance. The current `all_eligible` policy and legacy `slice(0, policy.result_count)` mismatch yields no result IDs in the source fixture; ranking repair is outside this task and is not bypassed in maintained code.

Full-site build remains held by stale operational rows; no full build/gate bypass occurred. Independent health/source/design acceptance remains pending with designated reviewers. Stock/supply/clinical indication are unverified, including separately captured stock ambiguity. Compounded medications are not FDA-approved; conditional offering is not a guaranteed prescription.
