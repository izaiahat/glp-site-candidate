import assert from 'node:assert/strict';

// Compile only the maintained input, scoring and quiz expressions. This helper
// never imports/runs the build entry point, its writers or generated outputs.
export function quizInputSeam(source) {
  const start = source.indexOf('  const [identity, rawEligibility,');
  const end = source.indexOf('  const [phase3GraphConfig,', start);
  const call = source.match(/^  const canonicalQuiz = projectQuizFromRegistry\([^\n]+$/m)?.[0];
  assert.ok(start >= 0 && end > start && call, 'maintained build/quiz seams must be present');
  const scoreStart = source.indexOf('    const comparablePriceIds = comparablePriceProviderIds(');
  const scoreEnd = source.indexOf('    const ledgerById = new Map(', scoreStart);
  assert.ok(scoreStart >= 0 && scoreEnd > scoreStart, 'maintained scoring seam must be present');
  return new Function('readJson', 'projectProviderDisplayLedger', 'projectQuizFromRegistry', 'programRegistry', 'SITE_PROFILE', 'comparablePriceProviderIds', 'applyMeritScores', 'meritScore', 'effectiveAffiliateBuildInputs', 'rawProgramRegistry',
    `return (async () => {${source.slice(start, end)}\n${source.slice(scoreStart, scoreEnd)}\n${call}\nreturn {contentLedger, canonicalQuiz};})()`);
}
