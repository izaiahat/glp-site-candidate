import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizedProfileSha256 } from '../src/provider-dynamic-profiles.mjs';
import { normalizedTaxonomySha256 } from '../src/therapeutic-taxonomy.mjs';
import { projectProviderDisplayFacts, projectProviderDisplayLedger } from '../src/provider-display-evidence.mjs';
import { reviewBrief } from '../src/blog-system.mjs';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url)));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('GLP-234 registry projections name the first-party brand without altering routing or held commercial custody', async () => {
  const registry = await load('program-registry.json');
  const program = registry.programs.find((row) => row.program_id === 'try-ageless');
  const profile = registry.provider_dynamic_profiles.profiles['try-ageless'];
  const taxonomy = registry.therapeutic_taxonomy.programs['try-ageless'];
  assert.ok(program && profile && taxonomy);
  assert.deepEqual([program.display_name, profile.provider, taxonomy.provider],
    ['Try Ageless', 'Try Ageless', 'Try Ageless']);
  assert.deepEqual(profile.aliases, []); // AgelessRx is not a verified alias.
  assert.equal(profile.program_id, 'try-ageless');
  assert.equal(taxonomy.registry_program_id, 'try-ageless');
  assert.deepEqual(program.go, { entry_state: 'transparent_direct', route: '/go/try-ageless' });
  assert.deepEqual(taxonomy.commercial_link_state, { compare: 'live', quiz: 'live' });
  const binding = profile.evidence_bindings.find((row) => row.evidence_kind === 'registry_identity_projection');
  assert.equal(JSON.parse(binding.evidence_text).provider, 'Try Ageless');
  assert.equal(binding.evidence_sha256, sha(binding.evidence_text));
  assert.equal(profile.normalized_sha256, normalizedProfileSha256(profile));
  assert.equal(taxonomy.normalized_sha256, normalizedTaxonomySha256(taxonomy));

  // Historical network row is deliberately not rewritten as a brand-mapping assertion.
  const selection = await load('affiliate-activation-selection.json');
  assert.ok(selection.excluded_network_paused_programs.includes('try-ageless'));
  assert.deepEqual(selection.excluded_selection_evidence.find((row) => row.program_id === 'try-ageless'), {
    display_name: 'AgelessRx', link_mode: 'transparent_direct', network: 'Katalys',
    network_program_id: '1538', program_id: 'try-ageless', sheet_row: 94,
    sheet_status: 'approved_active_tracking_ready', tracking_host: 'track.revoffers.com',
    tracking_link_sha256: 'f160cdd13074620be4ba6fac5258d2480ae1dcb45327a9b11e0e49cc3e4ed650',
    disposition: 'historical_snapshot_only_not_activation_authority',
  });
  for (const [name, expected] of [
    ['affiliate-activation-selection.json', '63586a11a80878a008c61b0825ff5344726906b0e7efece6811dd986f3db0de6'],
    ['affiliate-held-link-manifest.json', '613ce4dcd21357466e11f9338c71c554d71c6feac71a57127c2059d0db153675'],
    ['go-runtime-promotion-authority.json', 'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2'],
  ]) assert.equal(sha(await readFile(new URL(`../data/${name}`, import.meta.url))), expected, name);
  assert.equal(sha(await readFile(new URL('../functions/go/program-manifest.js', import.meta.url))),
    'cab1f5b4a8437080c09f580daf7be19bb4b9a177673150ba1f1e8f9abe113f7a');

  // Current editorial projections must not import the distinct AgelessRx firm's
  // dated facts. Historical raw evidence and all commercial gates stay intact.
  const rawLedger = (await load('program-content-ledger.json')).programs.find((r) => r.program_id === 'try-ageless');
  assert.equal(rawLedger.display_name, 'AgelessRx'); // Hash-pinned price-index history.
  assert.equal(rawLedger.research_backfill_20260830.facts.shipping.source_url, 'https://agelessrx.com/');
  const ledger = projectProviderDisplayLedger(rawLedger);
  assert.equal(ledger.display_name, 'Try Ageless');
  assert.equal(ledger.research_backfill_20260830, undefined);
  const crossBusiness = structuredClone(rawLedger);
  crossBusiness.research_shipping_wait.source_url = 'https://agelessrx.com/faq/';
  assert.throws(() => projectProviderDisplayLedger(crossBusiness), /try_ageless_cross_business_fact/);
  for (const [key, fact] of Object.entries(ledger)) {
    if (!key.startsWith('research_') || !fact?.source_url) continue;
    assert.match(fact.source_url, /^https:\/\/tryageless\.com\//, key);
  }
  assert.match(ledger.research_first_month_price.value, /UNKNOWN|yearly|annual/i);
  assert.match(ledger.research_cancellation.value, /\$40|prepaid/i);
  const historical = (await load('provider-facts-backfill-20260830.json')).programs.find((r) => r.program_id === 'try-ageless');
  assert.equal(historical.display_name, 'AgelessRx');
  assert.equal(historical.facts.shipping.source_url, 'https://agelessrx.com/');
  const projected = projectProviderDisplayFacts(historical);
  assert.equal(projected.display_name, 'Try Ageless');
  for (const fact of Object.values(projected.facts)) {
    assert.match(fact.source_url, /^https:\/\/tryageless\.com\//);
    assert.doesNotMatch(JSON.stringify(fact), /agelessrx\.com|AgelessRx/i);
  }
  for (const [name, expected] of [
    ['program-page-eligibility.json', '751f063a70d26ab8f2b420f9d4f433fb7786cbfc59db82e7a3d21c1d03fc9d8b'],
    ['provider-facts-backfill-20260830.json', 'e08a533653dd20f8400ad35d4562ec21478704a4d6c5758d61e85f83c1b97f3f'],
    ['price-index-frozen-content-ledger.json', '374667b3f4a13bb7dd5776f1cd29add113b25fa1826c6af4620c07668b496830'],
  ]) assert.equal(sha(await readFile(new URL(`../data/${name}`, import.meta.url))), expected, name);

  const quiz = (await load('quiz-config.json')).candidates.find((r) => r.program_id === 'try-ageless');
  assert.equal(quiz.display_name, 'Try Ageless');
  assert.match(quiz.research_fact_ref, /^program-content-ledger\.json#/);
  const seo = (await load('page-seo-copy.json')).routes['/reviews/try-ageless/'];
  assert.match(seo.title, /^Try Ageless/);
  assert.doesNotMatch(JSON.stringify(seo), /AgelessRx/);
  const logo = (await load('provider-logo-sources.json')).programs.find((r) => r.program_id === 'try-ageless');
  assert.equal(logo.provider, 'Try Ageless');
  assert.equal((await load('provider-pricing-matrix.json')).providers['try-ageless'].provider, 'Try Ageless');
  for (const medication of ['semaglutide', 'tirzepatide']) {
    const packet = await load(`compounded-category-evidence/${medication}/PACKET.json`);
    assert.equal(packet.providers.find((r) => r.program_id === 'try-ageless').display_name, 'Try Ageless');
  }
  for (const file of ['../data/money-page-specs.json', '../src/money-page-specs.json']) {
    const specs = JSON.parse(await readFile(new URL(file, import.meta.url)));
    for (const page of specs.pages.filter((p) => p.rows.some((r) => r.program_id === 'try-ageless'))) {
      assert.doesNotMatch(JSON.stringify(page).replaceAll('agelessrx', ''), /AgelessRx/);
      const consumer = page.rows.find((r) => r.program_id === 'try-ageless');
      assert.equal(consumer.display_name, 'Try Ageless');
      assert.ok(page.sources.some((s) => s.source_id === consumer.citation_source_id && s.url.startsWith('https://tryageless.com/')));
      assert.equal(consumer.review_path, '/reviews/try-ageless/');
    }
  }
  const article = (await load('blog/content-batch.json')).articles.find((a) => a.canonical_path === '/guides/healthrx-vs-agelessrx/');
  assert.match(article.title, /Try Ageless/);
  assert.match(article.direct_answer, /\$1,908 prepaid yearly tirzepatide sublingual oral-drops/);
  assert.equal(article.status, 'HELD_SOURCE_REVIEW_IDENTITY_CORRECTION');
  assert.ok(article.sources.some((s) => s.url === 'https://tryageless.com/terms/'));
  assert.deepEqual(reviewBrief(article, { status: 'verified_organization', clinical_credentials_claimed: false }),
    { status: 'HELD', reason: 'evidence_review_receipt_missing' });
  const blogOwner = (await load('blog/keyword-ownership-map.json')).entries.find((e) => e.url === article.canonical_path);
  assert.equal(blogOwner.primary_keyword, 'HealthRX vs Try Ageless cost and terms');
  assert.equal(blogOwner.status, article.status);
});

test('GLP-234 held article uses current product-specific billing and preserves its review boundary', async () => {
  const article = (await load('blog/content-batch.json')).articles.find((a) => a.canonical_path === '/guides/healthrx-vs-agelessrx/');
  const prose = JSON.stringify([article.claims, article.direct_answer, article.sections, article.pros, article.cons, article.conclusion]);
  assert.doesNotMatch(prose, /\$133|\$99|one click|HealthRX.{0,80}(?:12-month|12 months|lower price)/);
  assert.match(article.direct_answer, /semaglutide at \$149 for the first month, then \$165\/month/);
  assert.match(article.direct_answer, /tirzepatide at \$193 for the first month, then \$214\/month/);
  assert.match(article.direct_answer, /\$199 every month/);
  assert.match(article.direct_answer, /selected first debit remains unknown/);
  assert.match(prose, /cancel by emailing support@healthrx\.com/);
  assert.match(prose, /\$40 non-TRT consultation fee/);
  assert.match(prose, /non-returned payment processing costs/);
  assert.match(prose, /prepaid-plan repricing/);
  assert.match(prose, /not a one-month charge/);
  assert.doesNotMatch(prose, /HealthRX publishes more detail/);
  assert.equal(article.source_checked_through, '2026-09-26');
  const paragraphWords = article.sections.flatMap((s) => s.paragraphs).join(' ').match(/\b[\w'-]+\b/g).length;
  assert.equal(article.word_count, paragraphWords); // Do not preserve the legacy inflated count.
  for (const id of ['healthrx', 'try-ageless', 'try-ageless-terms', 'fda-compounding-risks']) {
    assert.equal(article.sources.find((s) => s.source_id === id)?.verified_as_of, '2026-09-26');
  }
  const rate = article.claims.find((c) => c.claim_id === 'ageless-rate');
  assert.ok(rate.source_ids.includes('try-ageless-terms'));
  assert.deepEqual(article.evidence_review, {
    content_sha256: '639c0d8ae24b6fe25d42718881dcc75346a4f2e842f1cfa6cd4159b6c15b51af',
    reviewed_at: '2026-07-23T09:00:00Z', status: 'STALE_AFTER_IDENTITY_CORRECTION_REVIEW_REQUIRED',
  });
  assert.equal(article.article_id, 'phase2-batch2-low-healthrx-vs-agelessrx-20260723');
  assert.equal(article.brief_id, article.article_id);
  assert.equal(article.comparison_spec.page_slug, 'healthrx-vs-agelessrx');
  assert.equal(article.comparison_spec.live_link_allowed, false);
  assert.equal(article.comparison_spec.operator_gate_receipt, null);
  assert.equal(article.operator_release_receipt, null);
  assert.equal(article.batch_gate_passed, false);
  assert.deepEqual(reviewBrief(article, article.author), { status: 'HELD', reason: 'evidence_review_receipt_missing' });
});

test('GLP-234 annual-plan billing prose in both maintained money-spec copies', async (t) => {
  for (const file of ['../data/money-page-specs.json', '../src/money-page-specs.json']) {
    await t.test(file, async () => {
      const specs = JSON.parse(await readFile(new URL(file, import.meta.url)));
      const page = specs.pages.find((row) => row.path === '/compare/found-vs-yourera/');
      assert.ok(page, file);
      const prose = page.intro.join(' ');
      assert.match(prose, /compounded semaglutide plus B12 injection at \$2,388 prepaid yearly \(\$199 per month equivalent\)/);
      assert.match(prose, /compounded tirzepatide plus B12 injection at \$2,988 prepaid yearly \(\$249 per month equivalent\)/);
      assert.match(prose, /tirzepatide sublingual oral drops at \$1,908 prepaid yearly \(\$159 per month equivalent\)/);
      assert.match(prose, /annual-plan monthly equivalents, not month-to-month billing; the selected initial debit remains unknown/);
      assert.doesNotMatch(prose, /\$199 per month for compounded semaglutide|\$249 per month for compounded tirzepatide/);
    });
  }
});
