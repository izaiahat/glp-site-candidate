import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadAcceptedGuides} from '../../src/accepted-guide-source.mjs';
import {loadAcceptedUpdates, applyAcceptedUpdates} from '../../src/accepted-update-source.mjs';

// Execute only the unchanged catalog-selection expressions, never the build.
export function selectBuildArticles(build, root, blogBatch, nationalArticles) {
  const consolidationStart = build.indexOf('const CONSOLIDATED_DUPLICATE_ROUTES =');
  const consolidationEnd = build.indexOf('// Design pass 2026-08-20 (Fable edit 1)', consolidationStart);
  const selectionStart = build.indexOf('  const commercialGuideRoutes =');
  const selectionEnd = build.indexOf('  const glpArticles =', selectionStart);
  assert.ok(consolidationStart >= 0 && consolidationEnd > consolidationStart);
  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart);
  return vm.runInNewContext(`${build.slice(consolidationStart, consolidationEnd)}\n${build.slice(selectionStart, selectionEnd)}\nallArticles`, {
    ROOT: root, blogBatch, nationalContent: {articles: nationalArticles},
    loadAcceptedGuides, loadAcceptedUpdates, applyAcceptedUpdates,
  });
}
