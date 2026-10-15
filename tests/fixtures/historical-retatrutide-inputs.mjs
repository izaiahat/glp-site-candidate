import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// TEST ONLY. Complete September input generation, never mixed with October
// provider rows or relabelled as current evidence. Production does not import it.
export const RETATRUTIDE_HISTORICAL_REF = 'e61a0017e8888570b00f4bd6c1eeef1572f421e1';
export const RETATRUTIDE_HISTORICAL_PINS = Object.freeze({
  'program-content-ledger.json': '88f1ec3e3d8c543e64caaa83ef5baab517e410cd180ee54ca2263eb2b1bbc95d',
  'program-registry.json': 'b37017463dbcb1b706e71f87f126e0c118ed24a6d923dbb0362cfff03f59911b',
  'money-page-specs.json': 'fccb5c440b2f3b7f97cb45de4faa224496cfa7524e338d550dfe29890b9ae0cc',
  'quiz-config.json': 'fbf9d1044cf98b7676efdaf63d42a8ef9245dfbe867413f2ead4ec55cdddd565',
  'cost-calculator.json': '10ae898bd529c6db45100630ed59c555abd8e5b6c518bb294263bf6e5fc34d75',
  'provider-page-contracts.json': '6f64b4de008cfd9808f1007d9eb80a64f5eb7b6c7444b5ea2de2eaaff777db55',
  'provider-fastpath-contract.json': '523962644b9e4f5774234fe9db14c27724d35a1deeb8add2bb05c96ffe7b001e',
  'provider-pricing-matrix.json': '173b7184ea490756e73c2b7e536b201aa630cf9a48782b1ce9b4de7870a7bcf0',
});
const root = fileURLToPath(new URL('../../', import.meta.url));
export function historicalRetatrutideInputs(read = file => execFileSync('git', ['show', `${RETATRUTIDE_HISTORICAL_REF}:data/${file}`], {cwd: root, maxBuffer: 16 * 1024 * 1024})) {
  const input = Object.fromEntries(Object.entries(RETATRUTIDE_HISTORICAL_PINS).map(([file, pin]) => {
    const bytes = read(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin, `${file}: immutable September source bytes`);
    return [file, JSON.parse(bytes)];
  }));
  const registry = input['program-registry.json'];
  const date = [registry.provider_dynamic_profiles.sealed_as_of, registry.therapeutic_taxonomy.sealed_as_of].sort().at(-1);
  assert.equal(date, '2026-09-24', 'authentic generation clock, not a renewed capture');
  return {registry, money: input['money-page-specs.json'], quiz: input['quiz-config.json'],
    contentLedger: input['program-content-ledger.json'],
    calculator: input['cost-calculator.json'], providerContracts: input['provider-page-contracts.json'],
    pricingMatrix: input['provider-pricing-matrix.json'],
    fastpath: input['provider-fastpath-contract.json'], asOf: new Date(`${date}T12:00:00Z`)};
}
