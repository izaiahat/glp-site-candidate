import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
test('all active ready-six detail returns remain outside the frozen editorial core', async () => {
  const registry = JSON.parse(await readFile(new URL('data/program-registry.json', root), 'utf8'));
  const records = registry.programs.filter(program => program.source_kind === 'approved53_ready6'
    && program.profiles['glp-clinic-scout'].canonical_identity?.role !== 'alias');
  assert.ok(records.length > 0);
  for (const record of records) {
    const html = await readFile(new URL(`public${record.review_path}index.html`, root), 'utf8');
    const core = html.match(/<header class="ready6-review-hero">[\s\S]*<\/main>/)?.[0];
    assert.ok(core, record.review_path);
    assert.ok(!core.includes('data-review-provider-detail-link'), record.review_path);
    const navigation = html.match(/<nav aria-label="Provider details">[\s\S]*?<\/nav>/)?.[0];
    assert.ok(navigation?.includes(`href="/providers/${record.program_id}/"`), record.review_path);
    assert.equal((html.match(/data-review-provider-detail-link/g) || []).length, 1, record.review_path);
  }
});
